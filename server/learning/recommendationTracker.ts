/**
 * @responsibility recommendations.json 기반 월간/ready-check 캘리브레이션 — fill 가중 winRate
 *
 * PR-18: closed shadow trades 의 winRate 를 fill SSOT (getWeightedPnlPct > 0) 로
 * 계산해 부분익절이 많은 trade 가 형식적으로 HIT_STOP 이어도 경제적 승으로 반영된다.
 */
import fs from 'fs';
import { RECOMMENDATIONS_FILE, REAL_TRADE_FLAG_FILE, ensureDataDir } from '../persistence/paths.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadShadowTrades, getWeightedPnlPct } from '../persistence/shadowTradeRepo.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { computeNetPnL } from '../trading/executionCosts.js';

/** v2 이후 fills 데이터가 있는 거래가 이 수에 도달해야 가중치 재조정이 허용된다. */
export const CALIBRATION_MIN_TRADES = 30;

export interface RecommendationRecord {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  priceAtRecommend: number;
  stopLoss: number;
  targetPrice: number;
  kellyPct: number;
  gateScore: number;
  signalType: 'STRONG_BUY' | 'BUY';
  conditionKeys?: string[];
  /** 신호 발생 시점 레짐 레벨 (예: 'R2_BULL') — 레짐별 가중치 캘리브레이션에 사용 */
  entryRegime?: string;
  status: 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED';
  actualReturn?: number;
  resolvedAt?: string;
  /**
   * 아이디어 5 (Phase 3): EXPIRED → WIN 지연 평가 표식.
   * 30일 만료 후 60/90일 재추적에서 targetPrice 도달 시 true로 전환.
   * status 는 'WIN' 으로 덮어쓰고 lateWin=true 로 표기 — 기존 승률 집계와
   * 호환 유지하면서 "타이밍 조건(momentum, turtle_high)"에 대한 별도 페널티 산출.
   */
  lateWin?: boolean;
  /** EXPIRED 시점 (lateWin 전환 전의 원래 resolvedAt 보존) */
  expiredAt?: string;
  /** 60일 시점 종가 기준 수익률 */
  return60d?: number;
  /** 90일 시점 종가 기준 수익률 */
  return90d?: number;
  /** 지연 평가 마지막 점검 시각 — 중복 재실행 억제 */
  lateEvalCheckedAt?: string;
}

export interface MonthlyStats {
  month: string;
  total: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  avgReturn: number;
  strongBuyWinRate: number;
  /** 표본 5건 미만이면 통계 신뢰 불가 — 숫자 대신 "표본 부족" 표시 필요 */
  sampleSufficient: boolean;
  /** 복리 누적 수익률 (산술평균과 별도 — 실제 자본 성장에 근접) */
  compoundReturn: number;
  /** Profit Factor = sum(wins 수익) / |sum(losses 손실)|. 손실 없으면 null. */
  profitFactor: number | null;
}

/** 통계 신뢰 판정 최소 표본 수. */
export const MIN_STATS_SAMPLE = 5;

function loadRecommendations(): RecommendationRecord[] {
  ensureDataDir();
  if (!fs.existsSync(RECOMMENDATIONS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RECOMMENDATIONS_FILE, 'utf-8')); } catch { return []; }
}

function saveRecommendations(recs: RecommendationRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(RECOMMENDATIONS_FILE, JSON.stringify(recs.slice(-1000), null, 2));
}

export function addRecommendation(rec: Omit<RecommendationRecord, 'id' | 'status'>): void {
  const recs = loadRecommendations();
  const alreadyPending = recs.some(
    (r) => r.stockCode === rec.stockCode && r.status === 'PENDING'
  );
  if (alreadyPending) return;

  recs.push({ ...rec, id: `rec_${Date.now()}_${rec.stockCode}`, status: 'PENDING' });
  saveRecommendations(recs);
  console.log(`[자기학습] 추천 기록 추가: ${rec.stockName}(${rec.stockCode}) @${rec.priceAtRecommend.toLocaleString()}`);
}

export function getRecommendations(): RecommendationRecord[] {
  return loadRecommendations();
}

export function getMonthlyStats(): MonthlyStats {
  const all     = loadRecommendations();
  const month   = new Date().toISOString().slice(0, 7);
  const monthly = all.filter((r) => r.signalTime.startsWith(month) && r.status !== 'PENDING');
  const wins    = monthly.filter((r) => r.status === 'WIN');
  const losses  = monthly.filter((r) => r.status === 'LOSS');
  const expired = monthly.filter((r) => r.status === 'EXPIRED');
  const total   = monthly.length;
  const avgReturn = total > 0
    ? monthly.reduce((s, r) => s + (r.actualReturn ?? 0), 0) / total
    : 0;

  // 복리 수익률: ∏(1 + r/100) - 1. 산술평균은 분산이 큰 표본에서 왜곡되므로 복리로 보완.
  const compoundReturn = total > 0
    ? (monthly.reduce((acc, r) => acc * (1 + (r.actualReturn ?? 0) / 100), 1) - 1) * 100
    : 0;

  // Profit Factor = 승 총수익 ÷ |패 총손실|. 수학적으로 손실 없으면 정의 불가.
  const winSum  = wins.reduce((s, r) => s + (r.actualReturn ?? 0), 0);
  const lossSum = Math.abs(losses.reduce((s, r) => s + (r.actualReturn ?? 0), 0));
  const profitFactor = lossSum > 0 ? winSum / lossSum : null;

  const sbMonthly = monthly.filter((r) => r.signalType === 'STRONG_BUY');
  const sbWins    = sbMonthly.filter((r) => r.status === 'WIN');

  return {
    month, total,
    wins:    wins.length,
    losses:  losses.length,
    expired: expired.length,
    winRate: total > 0 ? (wins.length / total) * 100 : 0,
    avgReturn,
    strongBuyWinRate: sbMonthly.length > 0 ? (sbWins.length / sbMonthly.length) * 100 : 0,
    sampleSufficient: total >= MIN_STATS_SAMPLE,
    compoundReturn,
    profitFactor,
  };
}

export function isRealTradeReady(): boolean {
  return fs.existsSync(REAL_TRADE_FLAG_FILE);
}

function writeRealTradeFlag(stats: MonthlyStats): void {
  ensureDataDir();
  fs.writeFileSync(REAL_TRADE_FLAG_FILE, JSON.stringify({
    createdAt:        new Date().toISOString(),
    month:            stats.month,
    total:            stats.total,
    winRate:          stats.winRate,
    avgReturn:        stats.avgReturn,
    strongBuyWinRate: stats.strongBuyWinRate,
  }, null, 2));
  console.log('[RealTrade] real-trade-ready.flag 생성');
}

export async function evaluateRecommendations(): Promise<void> {
  const recs    = loadRecommendations();
  const pending = recs.filter((r) => r.status === 'PENDING');

  if (pending.length === 0) {
    console.log('[자기학습] 평가할 PENDING 추천 없음');
    return;
  }

  console.log(`[자기학습] PENDING 추천 ${pending.length}건 평가 시작`);
  let changed = false;

  for (const rec of pending) {
    try {
      const currentPrice = await fetchCurrentPrice(rec.stockCode).catch(() => null);
      if (!currentPrice) continue;

      // Phase 2-⑥: 모든 returnPct 산출을 computeNetPnL().netPct 로 통일.
      // 기존 gross 수익률은 왕복 비용 0.4~1.0% 를 무시해 자기학습이 낙관 편향된 RRR 로
      // 가중치를 조정하던 문제를 해소한다.
      const ageMs     = Date.now() - new Date(rec.signalTime).getTime();
      const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;
      const netPctAt = (exitPrice: number): number =>
        computeNetPnL({
          entryPrice: rec.priceAtRecommend,
          exitPrice,
          quantity: 1, // 비율(%) 산출용 — qty 는 상쇄됨
        }).netPct;

      if (currentPrice <= rec.stopLoss) {
        rec.status       = 'LOSS';
        rec.actualReturn = parseFloat(netPctAt(rec.stopLoss).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ❌ LOSS(net): ${rec.stockName} ${rec.actualReturn}%`);
      } else if (currentPrice >= rec.targetPrice) {
        rec.status       = 'WIN';
        rec.actualReturn = parseFloat(netPctAt(rec.targetPrice).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ✅ WIN(net): ${rec.stockName} +${rec.actualReturn}%`);
      } else if (ageMs > EXPIRE_MS) {
        rec.status       = 'EXPIRED';
        rec.actualReturn = parseFloat(netPctAt(currentPrice).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ⏱ EXPIRED(net): ${rec.stockName} ${rec.actualReturn}%`);
      }
    } catch (e: unknown) {
      console.error(`[자기학습] ${rec.stockCode} 평가 실패:`, e instanceof Error ? e.message : e);
    }
  }

  if (changed) saveRecommendations(recs);

  const stats = getMonthlyStats();
  if (stats.sampleSufficient) {
    console.log(
      `[자기학습] ${stats.month} 통계 — 전체 WIN률: ${stats.winRate.toFixed(1)}% ` +
      `| STRONG_BUY: ${stats.strongBuyWinRate.toFixed(1)}% ` +
      `| 평균: ${stats.avgReturn.toFixed(2)}% | 복리: ${stats.compoundReturn.toFixed(2)}% ` +
      `| PF: ${stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : 'N/A'}`
    );
  } else {
    console.log(
      `[자기학습] ${stats.month} 통계 — 표본 부족 ${stats.total}건 (신뢰 통계 위해 ${MIN_STATS_SAMPLE}건 이상 필요)`,
    );
  }

  const statsBody = stats.sampleSufficient
    ? `WIN률: <b>${stats.winRate.toFixed(1)}%</b> | 평균: ${stats.avgReturn.toFixed(2)}% | 복리: ${stats.compoundReturn >= 0 ? '+' : ''}${stats.compoundReturn.toFixed(2)}%\n` +
      `PF: ${stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : 'N/A'} | STRONG_BUY 적중률: <b>${stats.strongBuyWinRate.toFixed(1)}%</b>`
    : `⚠️ <b>표본 부족</b> — ${stats.total}건 (신뢰 통계 위해 ${MIN_STATS_SAMPLE}건 이상 필요)`;

  await sendTelegramAlert(
    `📊 <b>[QuantMaster] ${stats.month} 자기학습 일일 평가</b>\n` +
    `결산: ${stats.total}건 (승 ${stats.wins} / 패 ${stats.losses} / 만료 ${stats.expired})\n` +
    statsBody
  ).catch(console.error);

  const shadows = loadShadowTrades();
  const closedShadows = shadows.filter(
    (s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP'
  );

  // v2 이전 데이터는 returnPct가 오염되어 캘리브레이션에 사용할 수 없다.
  // fills가 있는 거래만 신뢰할 수 있는 클린 데이터로 간주한다.
  const cleanTrades  = closedShadows.filter(s => (s.fills ?? []).length > 0);
  const legacyCount  = closedShadows.length - cleanTrades.length;

  if (cleanTrades.length < CALIBRATION_MIN_TRADES) {
    console.log(
      `[자기학습] 오염 데이터 격리 중 — 신규 데이터 ${cleanTrades.length}/${CALIBRATION_MIN_TRADES}건 수집 중` +
      (legacyCount > 0 ? ` (레거시 ${legacyCount}건 제외)` : '')
    );
  }

  // 클린 데이터가 충분하면 클린 트레이드만, 아직 부족하면 전체 폴백 (fills-기반 getWeightedPnlPct 사용)
  const calibrationSet = cleanTrades.length >= CALIBRATION_MIN_TRADES ? cleanTrades : closedShadows;
  const shadowReturns  = calibrationSet.map(s => getWeightedPnlPct(s));

  let peak = 0, mdd = 0, cumReturn = 0;
  for (const r of shadowReturns) {
    cumReturn += r;
    peak = Math.max(peak, cumReturn);
    mdd = Math.min(mdd, cumReturn - peak);
  }

  const totalWin  = shadowReturns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const totalLoss = Math.abs(shadowReturns.filter((r) => r <= 0).reduce((a, b) => a + b, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  const holdingDays = closedShadows
    .filter((s) => s.exitTime && s.signalTime)
    .map((s) => {
      const ms = new Date(s.exitTime!).getTime() - new Date(s.signalTime).getTime();
      return ms / (1000 * 60 * 60 * 24);
    });
  const avgHoldingDays = holdingDays.length > 0
    ? holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length
    : 0;

  let maxConsecLoss = 0, currentStreak = 0;
  for (const s of closedShadows) {
    if (s.status === 'HIT_STOP') {
      currentStreak++;
      maxConsecLoss = Math.max(maxConsecLoss, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const closedCount = closedShadows.length;
  // PR-18: winRate 를 fill SSOT 기반으로 정정 — trade 가 전량 HIT_STOP 이어도
  // 도중 부분익절이 있었으면 경제적으로는 순이익일 수 있다. getWeightedPnlPct 가
  // fill 가중 평균을 계산하므로 `> 0` 이면 승으로 카운트. 레거시(fills 없는) trade 는
  // status 로 폴백.
  const weightedWins = closedShadows.filter((s) => {
    const pct = getWeightedPnlPct(s);
    return (s.fills && s.fills.length > 0) ? pct > 0 : s.status === 'HIT_TARGET';
  }).length;
  const winRate = closedCount > 0 ? (weightedWins / closedCount) * 100 : 0;

  const readyChecks = {
    sampleSize:    closedCount >= 30,
    winRate:       winRate >= 55,
    profitFactor:  profitFactor >= 1.5,
    mddSafe:       mdd > -10,
    holdingPeriod: avgHoldingDays >= 3 && avgHoldingDays <= 15,
    consecLoss:    maxConsecLoss <= 3,
  };

  const passCount   = Object.values(readyChecks).filter(Boolean).length;
  const totalChecks = Object.keys(readyChecks).length;

  const progressBar = (current: number, target: number, width = 10): string => {
    const ratio  = Math.min(current / (target || 1), 1);
    const filled = Math.round(ratio * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled) + ` ${Math.round(ratio * 100)}%`;
  };

  if (passCount === totalChecks) {
    const curStats = getMonthlyStats();
    writeRealTradeFlag(curStats);
    await sendTelegramAlert(
      `🎯 <b>[QuantMaster] 실거래 전환 준비 완료!</b>\n\n` +
      `Shadow ${closedCount}건 검증 완료 — 6개 조건 모두 충족 ✅\n\n` +
      `✅ 건수: ${closedCount}/30\n` +
      `✅ 승률: ${winRate.toFixed(1)}%\n` +
      `✅ PF: ${profitFactor.toFixed(2)}\n` +
      `✅ MDD: ${mdd.toFixed(2)}%\n` +
      `✅ 보유기간: ${avgHoldingDays.toFixed(1)}일\n` +
      `✅ 연속손절: 최대 ${maxConsecLoss}회\n\n` +
      `📋 <b>전환 절차 (반자동):</b>\n` +
      `1️⃣ Railway 대시보드 → Variables\n` +
      `2️⃣ KIS_IS_REAL = true 설정\n` +
      `3️⃣ 재배포(Redeploy) 클릭\n` +
      `4️⃣ 다음 장 시작 시 자동 실거래 전환\n\n` +
      `⚠️ data/real-trade-ready.flag 생성됨`
    ).catch(console.error);
    console.log('[자기학습] 🎯 실거래 전환 조건 모두 충족!');
  } else {
    const remaining = 30 - closedCount;
    await sendTelegramAlert(
      `📊 <b>[실거래 전환 진행률] ${passCount}/${totalChecks} 조건 충족</b>\n` +
      `건수: ${closedCount}/30 ${progressBar(closedCount, 30)} ${readyChecks.sampleSize ? '✅' : '⏳'}\n` +
      `승률: ${winRate.toFixed(1)}%/55% ${readyChecks.winRate ? '✅' : '❌'}\n` +
      `PF: ${profitFactor.toFixed(2)}/1.5 ${readyChecks.profitFactor ? '✅' : '❌'}\n` +
      `MDD: ${mdd.toFixed(2)}%/-10% ${readyChecks.mddSafe ? '✅' : '❌'}\n` +
      `보유기간: ${avgHoldingDays.toFixed(1)}일/3~15일 ${readyChecks.holdingPeriod ? '✅' : '❌'}\n` +
      `연속손절: ${maxConsecLoss}회/≤3회 ${readyChecks.consecLoss ? '✅' : '❌'}` +
      (remaining > 0 ? `\n→ ${remaining}건 더 쌓이면 전환 검토 가능` : '')
    ).catch(console.error);
    console.log(`[자기학습] 전환 진행률: ${passCount}/${totalChecks}`);
  }
}
