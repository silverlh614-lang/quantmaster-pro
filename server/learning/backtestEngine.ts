// @responsibility backtestEngine 학습 엔진 모듈
/**
 * backtestEngine.ts — KIS 일봉 OHLCV 기반 실데이터 백테스트 엔진
 *
 * 기존 추천 이력을 "현재가 스냅샷 평가" 대신 실제 OHLCV 경로로 재검증:
 *   - 일별 저가(low) ≤ stopLoss    → LOSS (stop 체결)
 *   - 일별 고가(high) ≥ targetPrice → WIN  (target 체결)
 *   - 30영업일 초과    → EXPIRED (만료일 종가)
 *   - OHLCV 미확보     → NO_DATA (집계 제외 + 정직 표기 — EXPIRED 위장·stored return 재사용 금지)
 *
 * 소스: **KIS 일봉(L1, 최고 신뢰 — ADR-0561 KIS-primary)**. Yahoo 의존 제거 — KR stale
 *       (ADR-0563 Yahoo burn-down). 과거 Yahoo 경로는 `result.timestamps`(오타, 실제는 timestamp) 로
 *       전건 빈 배열→NO_DATA 묵살→stored return 재집계 오염을 유발했다. KIS 미공급 종목은 NO_DATA(정직).
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { computeNetPnL } from '../trading/executionCosts.js';
import { fetchKisStockDailyBars } from '../clients/kisClient.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface OHLCVDay {
  date:  string;   // YYYY-MM-DD
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

export type BacktestOutcome = 'WIN' | 'LOSS' | 'EXPIRED' | 'NO_DATA';

export interface BacktestTradeResult {
  id:          string;
  code:        string;
  entryDate:   string;
  exitDate:    string;
  outcome:     BacktestOutcome;
  returnPct:   number;
  holdingDays: number;
  source:      'KIS_DAILY';
}

export interface BacktestSummary {
  runAt:          string;
  period:         string;   // "YYYY-MM ~ YYYY-MM"
  totalTrades:    number;
  resolved:       number;   // OHLCV 확보분 (집계 모수)
  noData:         number;   // OHLCV 미확보 (집계 제외)
  wins:           number;
  losses:         number;
  expired:        number;
  winRate:        number;   // % (resolved 기준)
  avgReturn:      number;   // % (resolved 기준)
  sharpe:         number;
  mdd:            number;   // % (음수, [-100, 0] 복리 자본곡선)
  profitFactor:   number;
  avgHoldingDays: number;
  source:         'KIS_DAILY';
}

// ── KIS OHLCV 조회 ──────────────────────────────────────────────────────────

/**
 * KIS 일봉을 [from, to] 범위로 조회해 오름차순 OHLCVDay[] 반환. 실패/범위밖 → 빈 배열
 * (호출자가 NO_DATA 로 정직 처리). fetchKisStockDailyBars 가 KIS 미설정/오류 시 빈 배열 그레이스.
 */
async function fetchOHLCVRange(
  code: string,
  from: Date,
  to: Date,
): Promise<OHLCVDay[]> {
  const fromStr = from.toISOString().slice(0, 10);
  const toStr   = to.toISOString().slice(0, 10);
  // from 부터 오늘까지 커버할 달력일(+버퍼), 45~400 클램프. fetchKisStockDailyBars 는 calendar-day 인자.
  const calendarDays = Math.ceil((Date.now() - from.getTime()) / 86_400_000);
  const lookback = Math.min(400, Math.max(45, calendarDays + 10));

  // KIS 일봉(L1, 최고 신뢰 — ADR-0561). 내림차순 응답 → 오름차순 + [from,to] 범위 필터.
  const bars = await fetchKisStockDailyBars(code, lookback);
  const days: OHLCVDay[] = [];
  for (const b of bars) {
    if (b.date < fromStr || b.date > toStr) continue;
    days.push({
      date:  b.date,
      open:  b.open ?? b.close,
      high:  b.high ?? b.close, // high/low 미제공 봉은 close 근사(정상 KIS 응답엔 존재)
      low:   b.low ?? b.close,
      close: b.close,
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date)); // 진입→전진 오름차순
  return days;
}

// ── 단일 거래 시뮬레이션 ──────────────────────────────────────────────────────

export function simulateTrade(
  rec: RecommendationRecord,
  ohlcv: OHLCVDay[],
): BacktestTradeResult {
  const EXPIRE_DAYS = 30;
  const entryDate = rec.signalTime.slice(0, 10);
  // Phase 2-⑥: executionCosts 통합 — gross 대신 수수료·세금·슬리피지 차감 후 net.
  const netPctAt = (exitPrice: number): number =>
    computeNetPnL({ entryPrice: rec.priceAtRecommend, exitPrice, quantity: 1 }).netPct;

  // OHLCV 미확보 → NO_DATA. EXPIRED 로 위장하거나 stored actualReturn 을 재사용하지 않는다(정직 표기).
  if (ohlcv.length === 0) {
    return {
      id: rec.id, code: rec.stockCode,
      entryDate, exitDate: entryDate,
      outcome: 'NO_DATA', returnPct: 0, holdingDays: 0, source: 'KIS_DAILY',
    };
  }

  let holdingDays = 0;
  for (const day of ohlcv) {
    holdingDays++;
    // 손절 체크 (저가 기준)
    if (day.low <= rec.stopLoss) {
      return {
        id: rec.id, code: rec.stockCode, entryDate, exitDate: day.date,
        outcome: 'LOSS', returnPct: parseFloat(netPctAt(rec.stopLoss).toFixed(2)),
        holdingDays, source: 'KIS_DAILY',
      };
    }
    // 목표가 체크 (고가 기준)
    if (day.high >= rec.targetPrice) {
      return {
        id: rec.id, code: rec.stockCode, entryDate, exitDate: day.date,
        outcome: 'WIN', returnPct: parseFloat(netPctAt(rec.targetPrice).toFixed(2)),
        holdingDays, source: 'KIS_DAILY',
      };
    }
    // 30영업일 만료
    if (holdingDays >= EXPIRE_DAYS) {
      return {
        id: rec.id, code: rec.stockCode, entryDate, exitDate: day.date,
        outcome: 'EXPIRED', returnPct: parseFloat(netPctAt(day.close).toFixed(2)),
        holdingDays, source: 'KIS_DAILY',
      };
    }
  }

  // bars 있으나 stop/target/만료 미도달(<30봉) → 마지막 종가로 EXPIRED.
  const last = ohlcv[ohlcv.length - 1];
  return {
    id: rec.id, code: rec.stockCode, entryDate, exitDate: last.date,
    outcome: 'EXPIRED', returnPct: parseFloat(netPctAt(last.close).toFixed(2)),
    holdingDays, source: 'KIS_DAILY',
  };
}

// ── 집계 통계 ─────────────────────────────────────────────────────────────────

export function aggregateStats(trades: BacktestTradeResult[]): Omit<BacktestSummary, 'runAt' | 'period'> {
  const noData   = trades.filter(t => t.outcome === 'NO_DATA');
  const resolved = trades.filter(t => t.outcome !== 'NO_DATA'); // 집계 모수 = 데이터 확보분만

  if (resolved.length === 0) {
    return {
      totalTrades: trades.length, resolved: 0, noData: noData.length,
      wins: 0, losses: 0, expired: 0,
      winRate: 0, avgReturn: 0, sharpe: 0, mdd: 0,
      profitFactor: 0, avgHoldingDays: 0, source: 'KIS_DAILY',
    };
  }

  const wins    = resolved.filter(t => t.outcome === 'WIN');
  const losses  = resolved.filter(t => t.outcome === 'LOSS');
  const expired = resolved.filter(t => t.outcome === 'EXPIRED');

  const returns = resolved.map(t => t.returnPct);
  const avgRet  = returns.reduce((s, r) => s + r, 0) / returns.length;

  // Sharpe
  const std = returns.length < 2 ? 0 : Math.sqrt(
    returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length
  );
  const sharpe = std > 0 ? avgRet / std : 0;

  // MDD — 복리 자본곡선(시간순) 기준. 단순 %합산이 아니라 ∏(1+r) → drawdown 은 [-100%, 0] 바운드.
  let equity = 1, peak = 1, mdd = 0;
  for (const t of [...resolved].sort((a, b) => a.exitDate.localeCompare(b.exitDate))) {
    equity *= (1 + t.returnPct / 100);
    peak    = Math.max(peak, equity);
    const dd = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    mdd      = Math.min(mdd, dd);
  }

  // Profit Factor
  const totalWin  = wins.reduce((s, t)   => s + t.returnPct, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.returnPct, 0));
  const pf = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  const avgHoldDays = resolved.reduce((s, t) => s + t.holdingDays, 0) / resolved.length;

  return {
    totalTrades:    trades.length,
    resolved:       resolved.length,
    noData:         noData.length,
    wins:           wins.length,
    losses:         losses.length,
    expired:        expired.length,
    winRate:        parseFloat(((wins.length / resolved.length) * 100).toFixed(1)),
    avgReturn:      parseFloat(avgRet.toFixed(2)),
    sharpe:         parseFloat(sharpe.toFixed(2)),
    mdd:            parseFloat(mdd.toFixed(2)),
    profitFactor:   parseFloat(pf.toFixed(2)),
    avgHoldingDays: parseFloat(avgHoldDays.toFixed(1)),
    source:         'KIS_DAILY',
  };
}

function emptySummary(period: string): BacktestSummary {
  return {
    runAt: new Date().toISOString(), period,
    totalTrades: 0, resolved: 0, noData: 0,
    wins: 0, losses: 0, expired: 0,
    winRate: 0, avgReturn: 0, sharpe: 0, mdd: 0,
    profitFactor: 0, avgHoldingDays: 0, source: 'KIS_DAILY',
  };
}

/** 데이터 커버리지 표기 — 미확보분이 있으면 ⚠️, 전건 확보면 ✅. */
function coverageBadge(stats: { resolved: number; noData: number }): string {
  if (stats.resolved === 0) return '⚠️ 데이터 0건 — 백테스트 불가';
  return stats.noData > 0
    ? `⚠️ 데이터 ${stats.resolved}/${stats.resolved + stats.noData} (미확보 ${stats.noData} 제외)`
    : `✅ 데이터 ${stats.resolved}/${stats.resolved}`;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 전체 완료 추천 이력(WIN/LOSS/EXPIRED)을 KIS OHLCV 경로로 재검증하여 집계.
 * 결과를 Telegram으로 발송하고 BacktestSummary 반환.
 */
export async function runBacktest(): Promise<BacktestSummary> {
  const all = getRecommendations().filter(r => r.status !== 'PENDING');
  if (all.length === 0) {
    console.log('[Backtest] 완료된 추천 없음 — 건너뜀');
    return emptySummary('');
  }

  console.log(`[Backtest] KIS OHLCV 기반 재검증 시작 — ${all.length}건`);
  const tradeResults: BacktestTradeResult[] = [];

  for (const rec of all) {
    const entryDate = new Date(rec.signalTime);
    const toDate    = rec.resolvedAt ? new Date(rec.resolvedAt) : new Date();
    const maxTo     = new Date(entryDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    const fetchTo   = toDate > maxTo ? maxTo : toDate;

    const ohlcv  = await fetchOHLCVRange(rec.stockCode, entryDate, fetchTo);
    tradeResults.push(simulateTrade(rec, ohlcv));
    await new Promise(r => setTimeout(r, 150)); // KIS 정중 호출 간격
  }

  const dates  = tradeResults.map(t => t.entryDate).sort();
  const period = dates.length > 0
    ? `${dates[0].slice(0, 7)} ~ ${dates[dates.length - 1].slice(0, 7)}`
    : '';

  const stats   = aggregateStats(tradeResults);
  const summary: BacktestSummary = { runAt: new Date().toISOString(), period, ...stats };

  console.log(
    `[Backtest] 완료 — ${stats.totalTrades}건(데이터 ${stats.resolved}/미확보 ${stats.noData}) | ` +
    `WIN률 ${stats.winRate}% | Sharpe ${stats.sharpe} | MDD ${stats.mdd}% | PF ${stats.profitFactor}`
  );

  await sendTelegramAlert(
    `📊 <b>[Backtest 검증(KIS 일봉)] ${period}</b>\n` +
    `거래 ${stats.totalTrades}건 · 승 ${stats.wins} / 패 ${stats.losses} / 만료 ${stats.expired}\n` +
    `WIN률: <b>${stats.winRate}%</b> | 평균수익: ${stats.avgReturn}% (데이터확보분 기준)\n` +
    `Sharpe: <b>${stats.sharpe}</b> | MDD: ${stats.mdd}% | PF: ${stats.profitFactor}\n` +
    `평균 보유: ${stats.avgHoldingDays}일 | 소스: KIS 일봉 ${coverageBadge(stats)}`
  ).catch(console.error);

  return summary;
}

/**
 * 주간 미니 백테스트 — 최근 7일 결산 추천만 KIS OHLCV로 재검증.
 * 샘플이 없으면 Telegram 발송도 스킵.
 */
export async function runWeeklyMiniBacktest(): Promise<BacktestSummary | null> {
  const cutoff = Date.now() - 7 * 86_400_000;
  const recent = getRecommendations().filter(
    (r) => r.status !== 'PENDING' && new Date(r.signalTime).getTime() >= cutoff,
  );
  if (recent.length === 0) {
    console.log('[MiniBacktest] 전주 결산 신호 없음 — 건너뜀');
    return null;
  }

  console.log(`[MiniBacktest] 전주 ${recent.length}건 재검증 시작`);
  const tradeResults: BacktestTradeResult[] = [];
  for (const rec of recent) {
    const entryDate = new Date(rec.signalTime);
    const toDate    = rec.resolvedAt ? new Date(rec.resolvedAt) : new Date();
    const maxTo     = new Date(entryDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const fetchTo   = toDate > maxTo ? maxTo : toDate;

    const ohlcv = await fetchOHLCVRange(rec.stockCode, entryDate, fetchTo);
    tradeResults.push(simulateTrade(rec, ohlcv));
    await new Promise(r => setTimeout(r, 120));
  }

  const stats   = aggregateStats(tradeResults);
  const summary: BacktestSummary = { runAt: new Date().toISOString(), period: '최근 7일', ...stats };

  console.log(
    `[MiniBacktest] 완료 — ${stats.totalTrades}건(데이터 ${stats.resolved}) | WIN률 ${stats.winRate}% | Sharpe ${stats.sharpe}`,
  );
  await sendTelegramAlert(
    `⚡ <b>[주간 미니 백테스트(KIS 일봉)]</b>\n` +
    `최근 7일 ${stats.totalTrades}건 · 승 ${stats.wins} / 패 ${stats.losses} / 만료 ${stats.expired}\n` +
    `WIN률: <b>${stats.winRate}%</b> | Sharpe: ${stats.sharpe} | PF: ${stats.profitFactor}\n` +
    `평균 보유: ${stats.avgHoldingDays}일 | ${coverageBadge(stats)}`,
  ).catch(console.error);

  return summary;
}

/**
 * PENDING 추천을 KIS OHLCV 기반으로 즉시 재평가 — evaluateRecommendations() 대체.
 * 각 PENDING 레코드의 stop/target 도달 여부를 일봉 고가/저가로 정확히 판별.
 * @returns 업데이트된 레코드 수
 */
export async function reEvaluatePendingWithOHLCV(): Promise<number> {
  const { getRecommendations: getRecs } = await import('./recommendationTracker.js');

  const recs    = getRecs();
  const pending = recs.filter(r => r.status === 'PENDING');
  if (pending.length === 0) return 0;

  console.log(`[Backtest] PENDING ${pending.length}건 KIS OHLCV 재평가`);
  let updated = 0;

  for (const rec of pending) {
    const entryDate = new Date(rec.signalTime);
    const ohlcv     = await fetchOHLCVRange(rec.stockCode, entryDate, new Date());
    if (ohlcv.length === 0) continue; // 데이터 미확보 → PENDING 유지(정직)

    const result = simulateTrade(rec, ohlcv);
    if (result.outcome === 'NO_DATA') continue;                          // 안전망(위 가드와 동치)
    if (result.outcome === 'EXPIRED' && result.holdingDays < 2) continue; // 아직 이른 만료 → PENDING 유지

    rec.status       = result.outcome; // 'WIN' | 'LOSS' | 'EXPIRED'
    rec.actualReturn = result.returnPct;
    rec.resolvedAt   = result.exitDate;
    updated++;

    await new Promise(r => setTimeout(r, 150));
  }

  if (updated > 0) {
    console.log(`[Backtest] ${updated}건 KIS OHLCV 기반 결과 업데이트`);
  }

  return updated;
}
