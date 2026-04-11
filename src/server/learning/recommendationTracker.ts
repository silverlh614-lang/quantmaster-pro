import fs from 'fs';
import { RECOMMENDATIONS_FILE, REAL_TRADE_FLAG_FILE, ensureDataDir } from '../persistence/paths.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';

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
  status: 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED';
  actualReturn?: number;
  resolvedAt?: string;
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
}

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

      const returnPct = ((currentPrice - rec.priceAtRecommend) / rec.priceAtRecommend) * 100;
      const ageMs     = Date.now() - new Date(rec.signalTime).getTime();
      const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;

      if (currentPrice <= rec.stopLoss) {
        rec.status       = 'LOSS';
        rec.actualReturn = parseFloat((((rec.stopLoss - rec.priceAtRecommend) / rec.priceAtRecommend) * 100).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ❌ LOSS: ${rec.stockName} ${rec.actualReturn}%`);
      } else if (currentPrice >= rec.targetPrice) {
        rec.status       = 'WIN';
        rec.actualReturn = parseFloat((((rec.targetPrice - rec.priceAtRecommend) / rec.priceAtRecommend) * 100).toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ✅ WIN: ${rec.stockName} +${rec.actualReturn}%`);
      } else if (ageMs > EXPIRE_MS) {
        rec.status       = 'EXPIRED';
        rec.actualReturn = parseFloat(returnPct.toFixed(2));
        rec.resolvedAt   = new Date().toISOString();
        changed = true;
        console.log(`[자기학습] ⏱ EXPIRED: ${rec.stockName} ${rec.actualReturn}%`);
      }
    } catch (e: unknown) {
      console.error(`[자기학습] ${rec.stockCode} 평가 실패:`, e instanceof Error ? e.message : e);
    }
  }

  if (changed) saveRecommendations(recs);

  const stats = getMonthlyStats();
  console.log(
    `[자기학습] ${stats.month} 통계 — 전체 WIN률: ${stats.winRate.toFixed(1)}% ` +
    `| STRONG_BUY: ${stats.strongBuyWinRate.toFixed(1)}% ` +
    `| 평균 수익: ${stats.avgReturn.toFixed(2)}%`
  );

  await sendTelegramAlert(
    `📊 <b>[QuantMaster] ${stats.month} 자기학습 일일 평가</b>\n` +
    `결산: ${stats.total}건 (승 ${stats.wins} / 패 ${stats.losses} / 만료 ${stats.expired})\n` +
    `WIN률: <b>${stats.winRate.toFixed(1)}%</b> | 평균 수익: ${stats.avgReturn.toFixed(2)}%\n` +
    `STRONG_BUY 적중률: <b>${stats.strongBuyWinRate.toFixed(1)}%</b>`
  ).catch(console.error);

  const shadows = loadShadowTrades();
  const closedShadows = shadows.filter(
    (s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP'
  );
  const shadowReturns = closedShadows.map((s) => s.returnPct ?? 0);

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
  const winRate = closedCount > 0 ? (closedShadows.filter(s => s.status === 'HIT_TARGET').length / closedCount) * 100 : 0;

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
