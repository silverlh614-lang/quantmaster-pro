/**
 * @responsibility 일일/장중/장마감 Telegram 리포트 생성 + 당일 실현 이벤트 fill SSOT 집계
 *
 * 리포트는 signalTime 이 아닌 fill timestamp 기준으로 오늘 실현을 모아, 부분매도
 * 익절과 이월 청산이 누락되지 않도록 한다 (PR-15).
 */
// Phase 5-⑩: 이메일 채널 제거 — 모든 리포트는 Telegram 통합 채널로 발송.
import { emitMaintenanceWarn } from '../observability/maintenanceWarn.js';
import {
  loadShadowTrades,
  getWeightedPnlPct,
  isActiveFill,
  type ServerShadowTrade,
  type PositionFill,
} from '../persistence/shadowTradeRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
import { callGemini } from '../clients/geminiClient.js';
import { fetchCurrentPrice, fetchKospiCompositeIntradayQuote } from '../clients/kisClient.js';
import { sendTelegramAlert } from './telegramClient.js';
import { channelMarketBriefing, channelPerformance } from './channelPipeline.js';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { loadGlobalScanReport } from './globalScanAgent.js';
import { resolveCanonicalRegimeLevel } from '../trading/regime/canonicalRegimeAccess.js';
import { getFomcProximity } from '../trading/fomcCalendar.js';
// ADR-0561 — technicalQuoteRouter SSOT 위임(byte-equiv funnel) — `${code}.KS ?? .KQ` brute-force
// 패턴 영구 차단. flag OFF 시 fetchYahooQuoteByCode(code, fetchYahooQuote) funnel 그대로 위임
// (마스터 매칭 + ADR-0241 sanity 회복: 한쪽 시장 STALE_BASE 시 다른 시장 자동 fallback).
import { fetchTechnicalQuoteByCode } from '../screener/adapters/technicalQuoteRouter.js';
import { evaluateServerGate } from '../quantFilter.js';
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import { analyzeAttribution } from '../learning/attributionAnalyzer.js';
import { loadTomorrowPriming } from '../persistence/reflectionRepo.js';
import { getRemainingQty, isOpenShadowStatus } from '../trading/signalScanner.js';
import { safePctChange } from '../utils/safePctChange.js';
import {
  classifyTradeLifecycleOutcome,
  formatTradeLifecycleOutcome,
  type TradeLifecycleOutcome,
} from '../trading/exitOutcomeClassifier.js';
import {
  resolveCanonicalTradeOutcomeFromShadowTrade,
  describeCanonicalTradeOutcome,
} from '../trading/canonicalTradeOutcomeResolver.js';
// scanTracer 요약은 scanReviewReport.ts(16:40) 로 이관되어 이 파일에서는 더 이상 직접 사용하지 않는다.

// ── 당일 실현 이벤트 집계 SSOT (PR-15) ────────────────────────────────────────
//
// 기존 리포트 로직 버그: (1) signalTime 기준 필터라 어제 진입→오늘 청산 건 누락,
// (2) HIT_TARGET/HIT_STOP 만 `closed` 로 카운트해 ACTIVE 상태의 부분매도(익절)
// 실현손익이 집계에서 통째로 빠짐. 이 헬퍼는 fill 단위로 오늘 KST 에 발생한
// 모든 SELL 이벤트를 SSOT 로 모아, 부분매도·전량청산·이월청산을 균등 집계한다.
export interface TodayRealization {
  trade: ServerShadowTrade;
  fill: PositionFill;
  /** 이 fill 이 해당 trade 의 마지막 CONFIRMED SELL 이고 trade 가 전량 청산됐는지 */
  isFinalClose: boolean;
}

/** 오늘(KST) 에 CONFIRMED 된 모든 SELL fill 을 trade 와 함께 나열한다. */
export function collectTodayRealizations(
  shadows: ServerShadowTrade[],
  today: string,
): TodayRealization[] {
  const out: TodayRealization[] = [];
  for (const trade of shadows) {
    const fills = trade.fills ?? [];
    // 살아 있는 SELL fill 중 오늘 타임스탬프인 것만.
    const sellsToday = fills.filter((f) => {
      if (f.type !== 'SELL' || !isActiveFill(f)) return false;
      const ts = f.confirmedAt ?? f.timestamp;
      if (!ts) return false;
      const d = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      return d === today;
    });
    if (sellsToday.length === 0) continue;

    // 이 trade 의 마지막 CONFIRMED SELL id — "전량 청산" 판정에 사용.
    const allConfirmedSells = fills.filter((f) => f.type === 'SELL' && isActiveFill(f));
    const lastSellId = allConfirmedSells[allConfirmedSells.length - 1]?.id;
    const isClosed = trade.status === 'HIT_TARGET' || trade.status === 'HIT_STOP';

    for (const f of sellsToday) {
      out.push({
        trade,
        fill: f,
        isFinalClose: isClosed && f.id === lastSellId,
      });
    }
  }
  return out;
}

export interface TodayRealizationStats {
  realizations: TodayRealization[];
  /** fill 개수 (부분매도 포함) */
  realizationCount: number;
  /** 이익 fill 개수 */
  wins: number;
  /** 손실 fill 개수 */
  losses: number;
  /** 전량 청산된 trade 수 (중복 제거) */
  fullClosedCount: number;
  lifecycleBreakdown: Record<TradeLifecycleOutcome, number>;
  winBreakevens: number;
  partialWins: number;
  breakevens: number;
  economicWinRate: number;
  directionalWinRate: number;
  fullTargetWinRate: number;
  /** 부분매도만 발생한 trade 수 (전량 청산 제외) */
  partialOnlyCount: number;
  /** fill 가중 평균 pnlPct (Σ pnlPct×qty / Σ qty) */
  weightedReturnPct: number;
  /** fill 기반 실현 원화 합계 */
  totalRealizedKrw: number;
  /** 0~100 — 이익 fill 비율 */
  winRate: number;
}

export function summarizeTodayRealizations(r: TodayRealization[]): TodayRealizationStats {
  const wins = r.filter((x) => (x.fill.pnl ?? 0) > 0).length;
  const losses = r.filter((x) => (x.fill.pnl ?? 0) < 0).length;
  const fullClosedIds = new Set(r.filter((x) => x.isFinalClose).map((x) => x.trade.id));
  const finalCloseTrades = r
    .filter((x) => x.isFinalClose)
    .map((x) => x.trade)
    .filter((trade, index, arr) => arr.findIndex((other) => other.id === trade.id) === index);
  const lifecycle = finalCloseTrades.map((trade) => classifyTradeLifecycleOutcome(trade));
  const lifecycleBreakdown: Record<TradeLifecycleOutcome, number> = {
    FULL_WIN: 0,
    PARTIAL_WIN: 0,
    WIN_BREAKEVEN: 0,
    BREAKEVEN: 0,
    SMALL_WIN: 0,
    SMALL_LOSS: 0,
    FULL_LOSS: 0,
    FORCED_EXIT: 0,
  };
  for (const c of lifecycle) lifecycleBreakdown[c.tradeLifecycleOutcome]++;
  const directionalWins = lifecycleBreakdown.FULL_WIN + lifecycleBreakdown.PARTIAL_WIN + lifecycleBreakdown.WIN_BREAKEVEN;
  const directionalDenominator = directionalWins + lifecycleBreakdown.SMALL_LOSS + lifecycleBreakdown.FULL_LOSS + lifecycleBreakdown.FORCED_EXIT;
  const economicWins = lifecycle.filter((c) => c.economicWin).length;
  const allTradeIds = new Set(r.map((x) => x.trade.id));
  const partialOnlyCount = [...allTradeIds].filter((id) => !fullClosedIds.has(id)).length;

  const totalQty = r.reduce((s, x) => s + x.fill.qty, 0);
  const weightedReturnPct = totalQty > 0
    ? r.reduce((s, x) => s + (x.fill.pnlPct ?? 0) * x.fill.qty, 0) / totalQty
    : 0;
  const totalRealizedKrw = r.reduce((s, x) => s + (x.fill.pnl ?? 0), 0);

  return {
    realizations: r,
    realizationCount: r.length,
    wins,
    losses,
    fullClosedCount: fullClosedIds.size,
    lifecycleBreakdown,
    winBreakevens: lifecycleBreakdown.WIN_BREAKEVEN,
    partialWins: lifecycleBreakdown.PARTIAL_WIN,
    breakevens: lifecycleBreakdown.BREAKEVEN,
    economicWinRate: finalCloseTrades.length > 0 ? Math.round((economicWins / finalCloseTrades.length) * 100) : 0,
    directionalWinRate: directionalDenominator > 0 ? Math.round((directionalWins / directionalDenominator) * 100) : 0,
    fullTargetWinRate: finalCloseTrades.length > 0 ? Math.round((lifecycleBreakdown.FULL_WIN / finalCloseTrades.length) * 100) : 0,
    partialOnlyCount,
    weightedReturnPct,
    totalRealizedKrw,
    winRate: r.length > 0 ? Math.round((wins / r.length) * 100) : 0,
  };
}

// ── 당일 매수 이벤트 집계 SSOT (PR-17) ────────────────────────────────────────
//
// "오늘 매수 N개" 는 기존 `shadows.filter(s => s.signalTime.startsWith(today))`
// 로 계산되어 어제 signaled → 오늘 tranche 체결·오늘 signaled → 오늘 체결 등
// fill 타임라인이 signalTime 과 괴리되는 케이스를 놓쳤다. 여기서는 실제 CONFIRMED
// BUY fill 의 timestamp 를 기준으로 집계해 체결 현실을 반영한다.
export interface TodayBuyEvent {
  trade: ServerShadowTrade;
  fill: PositionFill;
  /** 이 trade 의 첫 BUY fill 인지 — true 면 "신규 진입", false 면 tranche */
  isInitial: boolean;
}

export function collectTodayBuyEvents(
  shadows: ServerShadowTrade[],
  today: string,
): TodayBuyEvent[] {
  const out: TodayBuyEvent[] = [];
  for (const trade of shadows) {
    const fills = trade.fills ?? [];
    const buys = fills.filter((f) => f.type === 'BUY' && isActiveFill(f));
    if (buys.length === 0) continue;
    // 시간순 정렬 — 첫 BUY 가 INITIAL, 나머지는 TRANCHE.
    const sorted = [...buys].sort((a, b) => (a.confirmedAt ?? a.timestamp).localeCompare(b.confirmedAt ?? b.timestamp));
    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      // PROVISIONAL 도 집계 포함 (실제 주문 접수 완료 상태 — 체결 확인 대기).
      if (f.status === 'REVERTED') continue;
      const ts = f.confirmedAt ?? f.timestamp;
      if (!ts) continue;
      const d = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      if (d !== today) continue;
      out.push({ trade, fill: f, isInitial: i === 0 });
    }
  }
  return out;
}

export interface TodayBuyEventStats {
  events: TodayBuyEvent[];
  totalBuys: number;
  /** 오늘 신규 진입한 trade 수 (isInitial 이면서 오늘) */
  newEntries: number;
  /** 기존 trade 에 대한 오늘 tranche 체결 수 */
  tranches: number;
  /** 오늘 BUY 체결로 유입된 총 주식 수량 */
  totalQty: number;
  /** 오늘 BUY 체결로 소요된 원화 총액 (qty × price) */
  totalCostKrw: number;
}

export function summarizeTodayBuyEvents(events: TodayBuyEvent[]): TodayBuyEventStats {
  const newEntries = events.filter((e) => e.isInitial).length;
  const tranches = events.filter((e) => !e.isInitial).length;
  const totalQty = events.reduce((s, e) => s + e.fill.qty, 0);
  const totalCostKrw = events.reduce((s, e) => s + e.fill.qty * e.fill.price, 0);
  return {
    events,
    totalBuys: events.length,
    newEntries,
    tranches,
    totalQty,
    totalCostKrw,
  };
}

function buildDailyTradeLines(realizations: TodayRealization[]): string {
  return realizations.length > 0
    ? realizations.map((x) => {
        const icon = (x.fill.pnl ?? 0) >= 0 ? '✅' : '❌';
        const kind = x.isFinalClose
          ? formatTradeLifecycleOutcome(classifyTradeLifecycleOutcome(x.trade).tradeLifecycleOutcome)
          : '부분매도';
        const pct = (x.fill.pnlPct ?? 0).toFixed(2);
        const canonical = x.isFinalClose ? ` | canonical=${formatCanonicalOutcomeShort(x.trade)}` : '';
        return `  ${icon} ${x.trade.stockName}(${x.trade.stockCode}) ${kind} ${pct}% · ${x.fill.qty}주${canonical}`;
      }).join('\n')
    : '  (오늘 실현 이벤트 없음)';
}

function buildDailyStatsLine(r: TodayRealizationStats): string {
  const totalReturn = r.weightedReturnPct;
  return r.realizationCount >= 5
    ? `▶ 적중률: ${r.winRate}%  |  일일 P&L(가중): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  |  실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원`
    : `▶ 표본 ${r.realizationCount}건 (통계 ${Math.max(0, 5 - r.realizationCount)}건 더 필요)  |  일일 P&L(가중): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  |  실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원`;
}

function formatCanonicalOutcomeShort(trade: ServerShadowTrade): string {
  const outcome = resolveCanonicalTradeOutcomeFromShadowTrade(trade);
  return `${outcome.outcome} / ${outcome.winRateBucket} / ${outcome.returnR >= 0 ? '+' : ''}${outcome.returnR.toFixed(2)}R / ${outcome.exitPath}`;
}

function formatCanonicalOutcomeExplanation(trade: ServerShadowTrade): string {
  const outcome = resolveCanonicalTradeOutcomeFromShadowTrade(trade);
  return describeCanonicalTradeOutcome(outcome.outcome);
}

function buildMonthlyLine(stats: ReturnType<typeof getMonthlyStats>): string {
  return stats.sampleSufficient
    ? `[월간 ${stats.month}] WIN률 ${stats.winRate.toFixed(1)}% | PF ${
        stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : 'N/A'
      } | 평균 ${stats.avgReturn.toFixed(2)}% | 복리 ${stats.compoundReturn.toFixed(2)}%`
    : `[월간 ${stats.month}] 표본 ${stats.total}건 — 통계 신뢰 위해 5건 이상 필요`;
}

async function loadDailyShadowLearningLines(
  stats: ReturnType<typeof getMonthlyStats>,
): Promise<{ shadowReportLine: string; shadowNarrativeLine: string }> {
  try {
    const { buildShadowLearningSummary } = await import('./shadowLearningSummary.js');
    const summary = buildShadowLearningSummary(stats.compoundReturn ?? 0);
    return {
      shadowReportLine: summary.reportLine,
      shadowNarrativeLine: summary.narrativeLine,
    };
  } catch (e) {
    emitMaintenanceWarn({ domain: 'DIAGNOSTIC', code: 'P3_REPORT_GENERATOR_DEGRADED', source: 'REPORT_GENERATOR', message: 'Daily report shadow learning summary failed.', dedupKey: 'p3:report-generator:shadow-learning-summary', error: e });
    return { shadowReportLine: '', shadowNarrativeLine: '' };
  }
}

function buildDailyBaseReport(params: {
  today: string;
  todaySignalsCount: number;
  r: TodayRealizationStats;
  macro: ReturnType<typeof loadMacroState>;
  watchlistCount: number;
  tradeLines: string;
  dailyStatsLine: string;
  monthlyLine: string;
  shadowReportLine: string;
}): string {
  const { today, todaySignalsCount, r, macro, watchlistCount, tradeLines, dailyStatsLine, monthlyLine, shadowReportLine } = params;
  return [
    `[QuantMaster Pro] ${today} 자동매매 일일 리포트`,
    '',
    `▶ 당일 신호: ${todaySignalsCount}건`,
    `▶ 실현 이벤트: ${r.realizationCount}건 (익 ${r.wins} / 손 ${r.losses})` +
      (r.partialOnlyCount > 0 ? ` · 부분매도 진행 ${r.partialOnlyCount}건` : '') +
      (r.fullClosedCount > 0 ? ` · 전량 청산 ${r.fullClosedCount}건` : ''),
    r.fullClosedCount > 0
      ? `Position lifecycle: FULL_WIN ${r.lifecycleBreakdown.FULL_WIN} / PARTIAL_WIN ${r.partialWins} / WIN_BREAKEVEN ${r.winBreakevens} / BREAKEVEN ${r.breakevens} / LOSS ${r.lifecycleBreakdown.SMALL_LOSS + r.lifecycleBreakdown.FULL_LOSS + r.lifecycleBreakdown.FORCED_EXIT}`
      : '',
    dailyStatsLine,
    `▶ MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`,
    `▶ 워치리스트: ${watchlistCount}개`,
    shadowReportLine ? `▶ ${shadowReportLine}` : '',
    '',
    tradeLines,
    '',
    monthlyLine,
    `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'SHADOW (가상매매)' : 'LIVE (실매매)'}`,
  ].filter(Boolean).join('\n');
}

function buildDailyRealizedDetail(realizations: TodayRealization[]): string {
  return realizations.length > 0
    ? realizations.map((x) => {
        const kind = x.isFinalClose
          ? formatTradeLifecycleOutcome(classifyTradeLifecycleOutcome(x.trade).tradeLifecycleOutcome)
          : '부분익절';
        const canonical = x.isFinalClose ? ` / canonical=${formatCanonicalOutcomeShort(x.trade)}` : '';
        return `${x.trade.stockName} ${kind} ${(x.fill.pnlPct ?? 0).toFixed(2)}%${canonical}`;
      }).join(', ')
    : '';
}

function buildDailyDataBlock(params: {
  today: string;
  todaySignalsCount: number;
  r: TodayRealizationStats;
  macro: ReturnType<typeof loadMacroState>;
  watchlist: ReturnType<typeof loadWatchlist>;
  stats: ReturnType<typeof getMonthlyStats>;
  realizedDetail: string;
  shadowNarrativeLine: string;
}): string {
  const { today, todaySignalsCount, r, macro, watchlist, stats, realizedDetail, shadowNarrativeLine } = params;
  const totalReturn = r.weightedReturnPct;
  return [
    `날짜: ${today} (KST)`,
    `거래 모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '[SHADOW] (가상매매 — 실계좌 잔고 아님)' : 'LIVE (실매매)'}`,
    `당일 신호: ${todaySignalsCount}건 | 실현 이벤트 ${r.realizationCount}건 (익 ${r.wins} / 손 ${r.losses})`,
    `부분매도 ${r.partialOnlyCount}건 · 전량청산 ${r.fullClosedCount}건`,
    `일일 P&L(가중 평균): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  |  실현 원화: ${Math.round(r.totalRealizedKrw).toLocaleString()}원`,
    `MHS: ${macro?.mhs ?? 'N/A'} | 레짐: ${macro?.regime ?? 'N/A'}`,
    `워치리스트: ${watchlist.length}개 (${watchlist.slice(0, 5).map(w => w.name).join(', ')}${watchlist.length > 5 ? ' 외' : ''})`,
    `월간 통계 (${stats.month}): 전체 ${stats.total}건 / WIN률 ${stats.winRate.toFixed(1)}% / 평균수익 ${stats.avgReturn.toFixed(2)}%`,
    `STRONG_BUY 적중률: ${stats.strongBuyWinRate.toFixed(1)}%`,
    realizedDetail ? `오늘 실현 상세: ${realizedDetail}` : '',
    shadowNarrativeLine,
  ].filter(Boolean).join('\n');
}

function buildDailyGeminiPrompt(dataBlock: string): string {
  return [
    '당신은 한국 주식 자동매매 시스템의 일일 리포트 작성 AI입니다.',
    '아래 오늘의 거래 데이터를 바탕으로 트레이더가 내일 아침 읽을 간결한 한국어 내러티브 리포트를 작성하세요.',
    '주의: "실현 이벤트" 는 전량 청산뿐 아니라 ACTIVE 포지션의 부분매도(익절)도 포함한다. 손익 방향은 반드시 "일일 P&L(가중 평균)" 의 부호와 "오늘 실현 상세" 의 각 항목 부호를 그대로 따라 서술하라. 부분매도 익절이 있으면 "손실만 있었다" 고 단정 짓지 마라.',
    '형식: 오늘 요약 2~3문장 + 주목할 점 1~2개 bullet + 내일 주의사항 1~2개 bullet.',
    '반드시 한국어로, 300자 이내로 작성하세요. 외부 검색은 필요 없습니다.',
    '',
    '=== 오늘 데이터 ===',
    dataBlock,
  ].join('\n');
}

function buildDailyTelegramMessage(params: {
  narrative: string | null;
  today: string;
  baseReport: string;
  totalReturn: number;
  r: TodayRealizationStats;
  macro: ReturnType<typeof loadMacroState>;
}): string {
  const { narrative, today, baseReport, totalReturn, r, macro } = params;
  return narrative
    ? `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${narrative}\n\n` +
      `<i>P&L ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% | ` +
      `WIN ${r.winRate}% (${r.wins}/${r.realizationCount}) | MHS ${macro?.mhs ?? 'N/A'}</i>`
    : `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${baseReport}`;
}

interface WeeklyReportMetrics {
  weekAgo: number;
  closed: ServerShadowTrade[];
  wins: ServerShadowTrade[];
  losses: ServerShadowTrade[];
  winRate: number;
  avgWin: number;
  avgLoss: number;
  rrr: number;
  weekStart: Date;
  weekEnd: Date;
}

export function buildWeeklyReportMetrics(shadows: ServerShadowTrade[], now: number): WeeklyReportMetrics {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const week = shadows.filter(s => new Date(s.signalTime).getTime() > weekAgo);
  const closed = week.filter(s => s.status !== 'ACTIVE' && s.status !== 'PENDING');
  const wins = closed.filter(s => s.status === 'HIT_TARGET');
  const losses = closed.filter(s => s.status === 'HIT_STOP');
  const winRate = closed.length > 0 ? Math.round(wins.length / closed.length * 100) : 0;
  // ADR-0561/SSOT: returnPct 는 영속에서 strip 되므로(updateShadow 불변 규칙 1) 직접 읽으면
  // 항상 0 이다. 청산 실현 수익률은 fills 가중평균(getWeightedPnlPct)이 단일 진실 원천.
  const winReturns = wins.map(s => getWeightedPnlPct(s));
  const lossReturns = losses.map(s => getWeightedPnlPct(s));
  const avgWin = winReturns.length > 0
    ? winReturns.reduce((a, b) => a + b, 0) / winReturns.length
    : 0;
  const avgLoss = lossReturns.length > 0
    ? Math.abs(lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length)
    : 0;
  const rrr = avgLoss > 0 ? avgWin / avgLoss : 0;

  return {
    weekAgo,
    closed,
    wins,
    losses,
    winRate,
    avgWin,
    avgLoss,
    rrr,
    weekStart: new Date(weekAgo + 9 * 60 * 60 * 1000),
    weekEnd: new Date(now + 9 * 60 * 60 * 1000),
  };
}

function fmtWeeklyDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function buildWeeklyAttributionTopLines(weekAgo: number): string {
  const weeklyAttrRecords = loadAttributionRecords().filter(
    r => new Date(r.closedAt).getTime() > weekAgo,
  );
  if (weeklyAttrRecords.length < 3) return '';

  const ranked = analyzeAttribution(weeklyAttrRecords)
    .filter(a => a.totalTrades >= 2 && a.avgReturn > 0)
    .sort((a, b) => (b.avgReturn * b.totalTrades) - (a.avgReturn * a.totalTrades))
    .slice(0, 3);
  if (ranked.length === 0) return '';

  let top3Lines = `\n<b>최고 기여 조건 TOP${ranked.length}:</b>\n`;
  ranked.forEach((a, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}위`;
    top3Lines += `${medal} ${a.conditionName} — 기여 +${a.avgReturn.toFixed(1)}%\n`;
  });
  return top3Lines;
}

function buildWeeklyActionLines(params: {
  macroNow: ReturnType<typeof loadMacroState>;
  winRate: number;
  closedCount: number;
  rrr: number;
}): string[] {
  const { macroNow, winRate, closedCount, rrr } = params;
  const regimeNow = resolveCanonicalRegimeLevel(macroNow); // ADR-0531: Gate0 정본 레짐
  const fomc = getFomcProximity(
    macroNow
      ? {
          mhs: macroNow.mhs,
          regime: regimeNow ?? macroNow.regime,
          vkospi: macroNow.vkospi,
        }
      : undefined,
  );
  const actionLines: string[] = [];
  if (fomc.nextFomcDate) {
    const daysUntil = fomc.daysUntil ?? 999;
    if (daysUntil <= 7) {
      actionLines.push(`⚠️ 이번주 FOMC: ${fomc.nextFomcDate} (D-${daysUntil}) — 진입 규모 축소 권고`);
    } else if (daysUntil <= 14) {
      actionLines.push(`📅 2주 내 FOMC: ${fomc.nextFomcDate} (D-${daysUntil}) — 포지션 롤오버 시 유의`);
    }
  }
  if (regimeNow === 'R5_CAUTION' || regimeNow === 'R6_DEFENSE') {
    actionLines.push(`🔴 현재 레짐 ${regimeNow} — 신규 진입 자제, 기존 포지션 점검 우선`);
  } else if (regimeNow === 'R1_TURBO' || regimeNow === 'R2_BULL') {
    actionLines.push(`🟢 현재 레짐 ${regimeNow} — 주도주 집중도 강화, Kelly 배율 정상화`);
  }
  if (winRate < 40 && closedCount >= 5) {
    actionLines.push(`⚠️ 지난주 WIN률 ${winRate}% — 손절 기준·필터 재점검 권고`);
  }
  if (rrr < 1.5 && closedCount >= 5) {
    actionLines.push(`⚠️ RRR ${rrr.toFixed(2)} — 목표가 상향 또는 손절폭 축소 검토`);
  }
  return actionLines;
}

function buildWeeklyActionBlock(actionLines: string[]): string {
  return actionLines.length > 0
    ? `\n<b>이번주 액션 아이템:</b>\n${actionLines.map(l => `• ${l}`).join('\n')}\n`
    : `\n<i>이번주 특이사항 없음 — 기존 운용 원칙 유지.</i>\n`;
}

function buildWeeklyTelegramMessage(metrics: WeeklyReportMetrics, top3Lines: string, actionBlock: string): string {
  return `<b>[주간 캘리브레이션] ${fmtWeeklyDate(metrics.weekStart)}~${fmtWeeklyDate(metrics.weekEnd)}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `거래 ${metrics.closed.length}건: WIN ${metrics.wins.length} / LOSS ${metrics.losses.length}  (WIN률 ${metrics.winRate}%)\n` +
    `평균 수익: +${metrics.avgWin.toFixed(1)}%  평균 손실: -${metrics.avgLoss.toFixed(1)}%\n` +
    `RRR 달성: ${metrics.rrr.toFixed(2)} (목표 2.0 ${metrics.rrr >= 2.0 ? '✅' : '⚠️'})\n` +
    `━━━━━━━━━━━━━━━━` +
    top3Lines +
    (top3Lines ? `━━━━━━━━━━━━━━━━` : '') +
    actionBlock;
}

function pickBestWeeklyTrade(wins: ServerShadowTrade[]): ServerShadowTrade | undefined {
  return wins.length > 0
    ? wins.reduce((a, b) => getWeightedPnlPct(a) > getWeightedPnlPct(b) ? a : b)
    : undefined;
}

function pickWorstWeeklyTrade(losses: ServerShadowTrade[]): ServerShadowTrade | undefined {
  return losses.length > 0
    ? losses.reduce((a, b) => getWeightedPnlPct(a) < getWeightedPnlPct(b) ? a : b)
    : undefined;
}

function calculateWeeklyTotalPnlPct(closed: ServerShadowTrade[]): number {
  return closed.length > 0
    ? closed.reduce((sum, s) => sum + getWeightedPnlPct(s), 0) / closed.length
    : 0;
}

type WatchlistBriefingEntry = ReturnType<typeof loadWatchlist>[number];
type WatchlistBriefingQuote = NonNullable<Awaited<ReturnType<typeof fetchTechnicalQuoteByCode>>>;

const WATCHLIST_REGIME_EMOJI: Record<string, string> = {
  R1_TURBO: '🟢',
  R2_BULL: '🟢',
  R3_EARLY: '🟡',
  R4_NEUTRAL: '⚪',
  R5_CAUTION: '🟠',
  R6_DEFENSE: '🔴',
};

function buildOpenShadowCodes(): Set<string> {
  return new Set(
    loadShadowTrades()
      .filter((s) => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0)
      .map((s) => s.stockCode),
  );
}

function buildWatchlistBriefingHeader(
  regime: string,
  macro: ReturnType<typeof loadMacroState>,
): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');

  return `🌅 <b>[${hh}:${mm} 장전 브리핑]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `레짐: <b>${regime}</b> ${WATCHLIST_REGIME_EMOJI[regime] ?? '⚪'}  ` +
    `MHS: ${macro?.mhs ?? 'N/A'}  ` +
    `VKOSPI: ${macro?.vkospi?.toFixed(1) ?? 'N/A'}\n` +
    `━━━━━━━━━━━━━━━━\n`;
}

function resolveWatchlistGapLabel(quote: WatchlistBriefingQuote): string {
  if (!quote.prevClose || quote.prevClose <= 0 || !quote.dayOpen || quote.dayOpen <= 0) {
    return '';
  }
  const gapPct = safePctChange(quote.dayOpen, quote.prevClose, {
    label: 'reportGenerator.gapPct',
  });
  if (gapPct === null) return '';
  if (gapPct >= 4) return `Gap+${gapPct.toFixed(1)}% 과열`;
  if (gapPct >= 1) return `Gap+${gapPct.toFixed(1)}%`;
  if (gapPct <= -1) return `Gap${gapPct.toFixed(1)}%`;
  return '';
}

function resolveWatchlistEntryStatus(w: WatchlistBriefingEntry, quote: WatchlistBriefingQuote): string {
  const gate = evaluateServerGate(quote);
  const cs = gate.compressionScore;
  const gapLabel = resolveWatchlistGapLabel(quote);

  if (gate.signalType === 'STRONG') {
    return `진입대기 @${w.entryPrice.toLocaleString()}`;
  }
  if (gate.signalType === 'NORMAL') {
    return `조건 부분충족 (Score ${gate.gateScore.toFixed(1)})`;
  }
  if (cs >= 0.4) {
    return `VCP 압축 중 (CS: ${cs.toFixed(2)})`;
  }

  let status = `조건 미달`;
  if (gapLabel) status += ` (${gapLabel})`;
  return status;
}

async function buildWatchlistBriefingItemLine(
  w: WatchlistBriefingEntry,
  openCodes: Set<string>,
): Promise<string> {
  if (openCodes.has(w.code)) {
    const focusMark = w.isFocus ? '★ ' : '• ';
    return `${focusMark}${w.name}  보유중 · 대기목록 제외\n`;
  }

  // 시세 조회하여 CS, Gap 판단 (ADR-0561: technicalQuoteRouter funnel 위임, ADR-0241 sanity 자동).
  const quote = await fetchTechnicalQuoteByCode(w.code).catch(() => null);
  if (quote && quote.price > 0) {
    const focusMark = w.isFocus ? '★ ' : '• ';
    return `${focusMark}${w.name}  ${resolveWatchlistEntryStatus(w, quote)}\n`;
  }
  return `• ${w.name}  (시세 조회 실패)\n`;
}

async function buildWatchlistBriefingRows(
  list: WatchlistBriefingEntry[],
  openCodes: Set<string>,
): Promise<string> {
  if (list.length === 0) return `워치리스트 비어있음\n`;

  let msg = `<b>워치리스트 ${list.length}종목</b>\n`;
  for (const w of list.slice(0, 8)) {
    msg += await buildWatchlistBriefingItemLine(w, openCodes);
  }
  if (list.length > 8) {
    msg += `  <i>... 외 ${list.length - 8}종목</i>\n`;
  }
  return msg;
}

function buildWatchlistBriefingFooter(fomc: ReturnType<typeof getFomcProximity>): string {
  let msg = `━━━━━━━━━━━━━━━━\n`;
  if (fomc.phase !== 'NORMAL') {
    msg += `⚠️ 오늘 주의: ${fomc.description}\n`;
  }

  const kellyNote = fomc.kellyMultiplier !== 1.0
    ? `Kelly ×${fomc.kellyMultiplier.toFixed(2)} 자동 적용`
    : null;
  if (kellyNote) {
    msg += `📌 ${kellyNote}\n`;
  }

  if (fomc.phase === 'NORMAL' && !kellyNote) {
    msg += `<i>오늘도 원칙대로 ✊</i>\n`;
  }
  return msg;
}

/**
 * 아이디어 9: 일일 리포트 2.0 — Gemini AI 내러티브 리포트
 * 1. 거래 데이터 + MHS + 월간 통계를 Gemini에 주입 (googleSearch 없음)
 * 2. 자연어 요약 리포트 생성
 * 3. Telegram으로 즉시 발송 (이메일은 보조)
 */
export async function generateDailyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const macro   = loadMacroState();
  const stats   = getMonthlyStats();
  const today   = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  // PR-15: 오늘의 "신호 건수" 는 signalTime 기준, "실현 손익" 은 fill SSOT 기준으로 분리.
  // 부분매도(ACTIVE 상태 유지) 익절도 realizations 에 포함되어 이익 실종 방지.
  const todaySignals = shadows.filter(
    (s) => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );
  const realizations = collectTodayRealizations(shadows, today);
  const r = summarizeTodayRealizations(realizations);
  const totalReturn = r.weightedReturnPct;
  const watchlist = loadWatchlist();

  const tradeLines = buildDailyTradeLines(realizations);
  const dailyStatsLine = buildDailyStatsLine(r);
  const monthlyLine = buildMonthlyLine(stats);
  const { shadowReportLine, shadowNarrativeLine } = await loadDailyShadowLearningLines(stats);
  const baseReport = buildDailyBaseReport({
    today,
    todaySignalsCount: todaySignals.length,
    r,
    macro,
    watchlistCount: watchlist.length,
    tradeLines,
    dailyStatsLine,
    monthlyLine,
    shadowReportLine,
  });

  const realizedDetail = buildDailyRealizedDetail(realizations);
  const dataBlock = buildDailyDataBlock({
    today,
    todaySignalsCount: todaySignals.length,
    r,
    macro,
    watchlist,
    stats,
    realizedDetail,
    shadowNarrativeLine,
  });
  const geminiPrompt = buildDailyGeminiPrompt(dataBlock);
  const narrative = await callGemini(geminiPrompt, 'report-generator');

  const telegramMsg = buildDailyTelegramMessage({
    narrative,
    today,
    baseReport,
    totalReturn,
    r,
    macro,
  });

  await sendTelegramAlert(telegramMsg).catch(console.error);

  // Phase 5-⑩: 이메일 보조 채널 제거 — 모든 리포트는 Telegram 단일 채널로 발송.
  // 기존 이메일 코드는 유지비용만 남기고 사용되지 않아 삭제함.
  console.log('[AutoTrade] 일일 리포트 완료 (Telegram ✅)');
}

/**
 * 주간 캘리브레이션 리포트 — 매주 월요일 08:00 KST (UTC 일요일 23:00) 자동 발송.
 *
 * Phase 4 (참뮌 스펙 #7): 기존 금요일 16:30 발송은 주말 동안 잊혀지는 문제가 있어
 * 월요일 아침으로 이동. "지난 주 이렇게 움직였고 이번 주 주의사항은 이것" 맥락.
 *
 * 구조화된 주간 리포트:
 *  ① 거래 건수, WIN/LOSS, WIN률
 *  ② 평균 수익/손실, RRR 달성
 *  ③ 최고 기여 조건 TOP3 (attributionAnalyzer 연동)
 *  ④ 이번주 액션 아이템 (FOMC·레짐 기반 narrative)
 */
export async function generateWeeklyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const now = Date.now();
  const metrics = buildWeeklyReportMetrics(shadows, now);
  const top3Lines = buildWeeklyAttributionTopLines(metrics.weekAgo);

  // ── 이번주 액션 아이템 (FOMC + 현재 레짐 기반 narrative) ───────────────────
  // v3.1 (2026-04-26): macro snapshot 전달해 우호 환경 완화 일관성 확보.
  const macroNow = loadMacroState();
  const actionLines = buildWeeklyActionLines({
    macroNow,
    winRate: metrics.winRate,
    closedCount: metrics.closed.length,
    rrr: metrics.rrr,
  });
  const msg = buildWeeklyTelegramMessage(metrics, top3Lines, buildWeeklyActionBlock(actionLines));

  await sendTelegramAlert(msg, { tier: 'T2_REPORT', category: 'weekly_calibration' }).catch(console.error);

  const bestShadow = pickBestWeeklyTrade(metrics.wins);
  const worstShadow = pickWorstWeeklyTrade(metrics.losses);
  const totalPnlPct = calculateWeeklyTotalPnlPct(metrics.closed);
  await channelPerformance({
    period:      'WEEKLY',
    totalTrades: metrics.closed.length,
    winCount:    metrics.wins.length,
    lossCount:   metrics.losses.length,
    totalPnlPct,
    bestTrade:   bestShadow  ? { name: bestShadow.stockName,  pnlPct: getWeightedPnlPct(bestShadow) } : undefined,
    worstTrade:  worstShadow ? { name: worstShadow.stockName, pnlPct: getWeightedPnlPct(worstShadow) } : undefined,
  }).catch(console.error);

  console.log('[AutoTrade] 주간 리포트 완료 (구조화)');
}

/**
 * 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
 *
 * 구조화된 브리핑:
 *  ① 레짐 + MHS + VKOSPI 요약
 *  ② 워치리스트 종목별 CompressionScore, Gap 판정, 진입 상태
 *  ③ FOMC 근접도 경고 (해당 시)
 */
export async function sendWatchlistBriefing(): Promise<void> {
  const list = loadWatchlist();
  const openCodes = buildOpenShadowCodes();
  const macro = loadMacroState();
  const regime = resolveCanonicalRegimeLevel(macro); // ADR-0531: Gate0 정본 레짐
  // v3.1 (2026-04-26): macro snapshot 전달해 우호 환경 완화 일관성 확보.
  const fomc = getFomcProximity(
    macro
      ? {
          mhs: macro.mhs,
          regime: regime ?? macro.regime,
          vkospi: macro.vkospi,
        }
      : undefined,
  );

  const msg =
    buildWatchlistBriefingHeader(regime, macro) +
    (await buildWatchlistBriefingRows(list, openCodes)) +
    buildWatchlistBriefingFooter(fomc);

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[AutoTrade] 워치리스트 브리핑 완료 (구조화)');
}

/**
 * 장중 중간 점검 알림 — 포지션 보유 시에만 발송 (포지션 없는 날 생략)
 * @param type 'midday' | 'preclose'
 *   - 'midday'   : 오전 11:30 KST (UTC 02:30)
 *   - 'preclose' : 오후 14:00 KST (UTC 05:00)
 */
export async function sendIntradayCheckIn(type: 'midday' | 'preclose'): Promise<void> {
  const shadows = loadShadowTrades();
  const active = shadows.filter(
    s => s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' || s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL'
  );

  // 포지션 없는 날은 생략
  if (active.length === 0) return;

  const macro = loadMacroState();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const todaySignals = shadows.filter(
    s => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );

  // 각 활성 포지션에 대해 현재가 조회 (병렬)
  const positionLines: string[] = [];
  let nearStopLoss = false;
  let nearTarget = false;

  for (const shadow of active) {
    const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) {
      positionLines.push(`• ${shadow.stockName} (시세 없음)`);
      continue;
    }
    // ADR-0059: stale currentPrice 시 0 fallback — 일일 리포트 표시용.
    const returnPct = safePctChange(currentPrice, shadow.shadowEntryPrice, {
      label: `reportGenerator.return:${shadow.stockCode}`,
    }) ?? 0;
    const distToTarget = ((shadow.targetPrice - currentPrice) / currentPrice) * 100;
    const distToStop   = ((currentPrice - shadow.stopLoss) / shadow.stopLoss) * 100;

    if (distToStop < 5) nearStopLoss = true;
    if (distToTarget < 3) nearTarget = true;

    const statusEmoji =
      distToTarget < 3  ? '🟢 목표 근접' :
      distToStop   < 5  ? '⚠️ 손절 모니터링' :
      returnPct    >= 0 ? '📈' : '📉';

    positionLines.push(
      `• ${shadow.stockName} ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}% ${statusEmoji}`
    );
  }

  // 주목할 상황이 없는 날(preclose)은 생략
  if (type === 'preclose' && !nearStopLoss && !nearTarget) return;

  // 헤더 시간은 unifiedBriefing footer 의 단일 타임스탬프로 통합한다 — 하드코딩 제거.
  const header = type === 'midday'
    ? `📡 <b>[장 중간 현황]</b>`
    : `⏰ <b>[마감 2시간 전]</b>`;

  const msg =
    `${header}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `활성 포지션: ${active.length}개\n` +
    positionLines.join('\n') + '\n\n' +
    `오늘 신호: ${todaySignals.length}건\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log(`[AutoTrade] 장중 점검 알림 완료 (${type})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 시장상황 요약 레포트 — 장전 / 장중 / 장마감 자동 송출
// ═══════════════════════════════════════════════════════════════════════════

/** 변화율 포맷 헬퍼 */
function fmtPct(v: number | null | undefined): string {
  if (v == null) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ── 리포트 정직성 마킹 (provider 글리치/저신뢰를 사실처럼 표시하지 않음) ──────────
//
// 배경 (2026-06-09 운영자 진단): 장마감 요약이 KOSPI 종가를 Yahoo `^KS11` 에서 받아
// "+8.18% (8096.93)" 를 *확정 사실처럼* 출력했으나, 같은 시점 Gate0 macro 는
// macroSignalConfidence=MISSING_OR_PARTIAL · sourceHealth=STALE 였다. provider 데이터
// 글리치/저하를 캐비엇 없이 권위있게 표시하면 운영자를 오도한다 (9대 불변식 #6:
// provider 장애 ≠ market signal). 본 헬퍼들은 *표시 전용* 마킹만 한다 — 값 출처·매매·
// SourceSnapshot 무변경. 정상값은 빈 문자열(byte-equivalent).

/** 일일 변동률이 데이터 글리치로 의심되는 상한 (표시 전용 sanity 경계, 매매 임계 아님). */
const ANOMALY_CHANGE_PCT_BOUND = { INDEX: 8, FX: 3 } as const;

/**
 * KOSPI/USD-KRW 당일 변동률이 비현실적으로 클 때 ⚠️ 마킹.
 * INDEX(지수) ≥ 8% · FX(환율) ≥ 3% 는 정상 거래일에선 거의 나오지 않는 값이라
 * provider 글리치(예: Yahoo stale candle)일 가능성이 높다 → 사실 대신 "확인 요망" 표시.
 */
export function formatQuoteAnomalyTag(
  changePct: number | null | undefined,
  kind: 'INDEX' | 'FX',
): string {
  if (changePct == null || !Number.isFinite(changePct)) return '';
  return Math.abs(changePct) >= ANOMALY_CHANGE_PCT_BOUND[kind]
    ? ' ⚠️ 이례적 변동 — 데이터 확인 요망'
    : '';
}

/**
 * MHS/regime 이 저하(degrade)된 매크로 스냅샷에서 나왔을 때 ⚠️ 저신뢰 마킹 (ADR-0583 SSOT).
 * mhsConfidence PARTIAL(한쪽 결손)/FALLBACK(전면 결손) 또는 mhsDegraded=true → 저신뢰.
 * 이 신호는 scan_blockers 의 macroSignalConfidence=MISSING_OR_PARTIAL 에 대응한다.
 */
export function formatMacroConfidenceTag(
  macro: { mhsConfidence?: 'FULL' | 'PARTIAL' | 'FALLBACK'; mhsDegraded?: boolean } | null | undefined,
): string {
  if (!macro) return '';
  const degraded = macro.mhsDegraded === true || macro.mhsConfidence === 'PARTIAL' || macro.mhsConfidence === 'FALLBACK';
  return degraded ? ` ⚠️ 저신뢰(${macro.mhsConfidence ?? 'DEGRADED'})` : '';
}

/** KOSPI 현재가 + 전일대비 변화율 조회 — ADR-0059: stale prev 시 0 fallback. */
// ── KOSPI/USD-KRW 표시 소스 선택 (ADR-0561 KIS Primary) ───────────────────────
//
// 장마감 요약의 KOSPI/USD-KRW 는 기존엔 리포트가 직접 Yahoo(`^KS11`/`KRW=X`)에서 받아
// (frozen non-execution Yahoo use) 글리치 값(+8.18% 8096.93)을 사실처럼 표시했다.
//   - KOSPI: KIS 종합지수(L1, code 0001 / FHPUP02100000)를 primary 로 — 장마감 시점
//     intraday quote = 종가. KIS 실패/미가용(flag OFF) 시에만 Yahoo 최후 fallback.
//   - USD/KRW: KIS 는 FX 미공급(대체불가) → cross-validated macroState(Yahoo+ECOS,
//     ADR-0071 usdKrwSource)를 primary 로(리포트 raw Yahoo 보다 검증된 값), 부재 시 Yahoo.
// 둘 다 표시 전용(executionImpact=NONE) · Yahoo 는 최후 fallback 으로만 잔존.

/** KOSPI 표시 소스 선택 — KIS(L1) 우선, 실패/미가용 시 Yahoo(L3) 최후 fallback. */
export function resolveKospiDisplay(
  kis: { current: number; changePct: number } | null,
  yahoo: { price: number; changePct: number } | null,
): { price: number; changePct: number } | null {
  if (kis && Number.isFinite(kis.current) && kis.current > 0) {
    return { price: kis.current, changePct: kis.changePct };
  }
  return yahoo && Number.isFinite(yahoo.price) && yahoo.price > 0 ? yahoo : null;
}

/** USD/KRW 표시 소스 선택 — cross-validated macroState 우선, 부재 시 Yahoo 최후 fallback. */
export function resolveUsdKrwDisplay(
  macroRate: number | null | undefined,
  macroDayChange: number | null | undefined,
  yahoo: { rate: number; changePct: number } | null,
): { rate: number; changePct: number } | null {
  if (typeof macroRate === 'number' && Number.isFinite(macroRate) && macroRate > 0) {
    return {
      rate: macroRate,
      changePct: typeof macroDayChange === 'number' && Number.isFinite(macroDayChange) ? macroDayChange : 0,
    };
  }
  return yahoo && Number.isFinite(yahoo.rate) && yahoo.rate > 0 ? yahoo : null;
}

async function fetchKospiSnapshot(): Promise<{ price: number; changePct: number } | null> {
  // ADR-0561 KIS Primary: KOSPI 종합지수는 KIS(0001)를 primary. flag OFF 시 함수가 null →
  // Yahoo fallback(기본 byte-equivalent). flag ON 시 KIS 종가/변동률 사용.
  const kis = await fetchKospiCompositeIntradayQuote('LOW').catch(() => null);
  let yahoo: { price: number; changePct: number } | null = null;
  if (!kis) {
    const closes = await fetchCloses('^KS11', '5d').catch(() => null);
    if (closes && closes.length >= 2) {
      const current = closes[closes.length - 1];
      const prev    = closes[closes.length - 2];
      yahoo = { price: current, changePct: safePctChange(current, prev, { label: 'reportGenerator.kospi' }) ?? 0 };
    }
  }
  return resolveKospiDisplay(kis, yahoo);
}

/** USD/KRW 현재 + 전일대비 — cross-validated macroState 우선(ADR-0071), 부재 시 Yahoo(ADR-0059 stale prev→0). */
async function fetchUsdKrwSnapshot(): Promise<{ rate: number; changePct: number } | null> {
  const macro = loadMacroState();
  if (macro && typeof macro.usdKrw === 'number' && Number.isFinite(macro.usdKrw) && macro.usdKrw > 0) {
    return resolveUsdKrwDisplay(macro.usdKrw, macro.usdKrwDayChange, null);
  }
  const closes = await fetchCloses('KRW=X', '5d').catch(() => null);
  let yahoo: { rate: number; changePct: number } | null = null;
  if (closes && closes.length >= 2) {
    const current = closes[closes.length - 1];
    const prev    = closes[closes.length - 2];
    yahoo = { rate: current, changePct: safePctChange(current, prev, { label: 'reportGenerator.usdkrw' }) ?? 0 };
  }
  return resolveUsdKrwDisplay(undefined, undefined, yahoo);
}

type MacroSnapshot = ReturnType<typeof loadMacroState>;
type WatchlistItem = ReturnType<typeof loadWatchlist>[number];
type GlobalScanReportSnapshot = ReturnType<typeof loadGlobalScanReport>;
type GlobalScanSymbol = NonNullable<GlobalScanReportSnapshot>['symbols'][number];
type GlobalScanSectorAlert = NonNullable<GlobalScanReportSnapshot>['sectorAlerts'][number];
type KospiSnapshot = Awaited<ReturnType<typeof fetchKospiSnapshot>>;
type UsdKrwSnapshot = Awaited<ReturnType<typeof fetchUsdKrwSnapshot>>;

interface PreMarketGlobalContext {
  sp500?: GlobalScanSymbol;
  ndx?: GlobalScanSymbol;
  vixData?: GlobalScanSymbol;
  ewy?: GlobalScanSymbol;
}

function buildPreMarketGlobalContext(globalScan: GlobalScanReportSnapshot): PreMarketGlobalContext {
  return {
    sp500:   globalScan?.symbols.find(s => s.symbol === '^GSPC'),
    ndx:     globalScan?.symbols.find(s => s.symbol === '^IXIC'),
    vixData: globalScan?.symbols.find(s => s.symbol === '^VIX'),
    ewy:     globalScan?.symbols.find(s => s.symbol === 'EWY'),
  };
}

function formatPreMarketSectorAlerts(alerts: GlobalScanSectorAlert[] | undefined): string {
  return alerts && alerts.length > 0
    ? alerts.map(a => `  ${a.direction === 'BULLISH' ? '🟢' : '🔴'} ${a.label} ${fmtPct(a.changePct)} → ${a.koreaSectors}`).join('\n')
    : '  없음';
}

function buildPreMarketAiPrompt(
  macro: MacroSnapshot,
  global: PreMarketGlobalContext,
  usdKrw: UsdKrwSnapshot,
): string {
  return (
    `오늘 한국 주식시장 장전 브리핑 (1~2문장).\n` +
    `데이터: S&P500 ${fmtPct(global.sp500?.changePct)}, 나스닥 ${fmtPct(global.ndx?.changePct)}, ` +
    `VIX ${global.vixData?.price ?? 'N/A'}, EWY ${fmtPct(global.ewy?.changePct)}, ` +
    `USD/KRW ${usdKrw?.rate?.toFixed(0) ?? 'N/A'}원(${fmtPct(usdKrw?.changePct)}), ` +
    `MHS ${macro?.mhs ?? 'N/A'}(${macro?.regime ?? 'N/A'}).\n` +
    `KOSPI 예상 방향 + 핵심 근거를 한국어 2문장으로 답하라.`
  );
}

function buildPreMarketPrimingLine(todayKst: string): string {
  const priming = loadTomorrowPriming();
  return priming && priming.forDate === todayKst && priming.oneLineLearning
    ? `\n🌅 <b>오늘의 학습 포인트:</b> ${priming.oneLineLearning}\n`
    : '';
}

interface PreMarketTelegramMessageParams {
  macro: MacroSnapshot;
  watchlist: WatchlistItem[];
  global: PreMarketGlobalContext;
  usdKrw: UsdKrwSnapshot;
  alertLines: string;
  aiOneLiner: string | null;
  primingLine: string;
}

function formatPreMarketGlobalLines(global: PreMarketGlobalContext): string {
  return (
    `<b>🌏 간밤 글로벌</b>\n` +
    `  S&P500: ${global.sp500?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(global.sp500?.changePct)})\n` +
    `  나스닥: ${global.ndx?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(global.ndx?.changePct)})\n` +
    `  VIX: ${global.vixData?.price?.toFixed(1) ?? 'N/A'}\n` +
    `  EWY: ${fmtPct(global.ewy?.changePct)}\n\n`
  );
}

function formatPreMarketMacroLines(macro: MacroSnapshot, usdKrw: UsdKrwSnapshot): string {
  const yieldLine = macro?.yieldCurve10y2y !== undefined ? `  10Y-2Y: ${macro.yieldCurve10y2y.toFixed(2)}%\n` : '';
  const crudeLine = macro?.wtiCrude !== undefined ? `  WTI: $${macro.wtiCrude.toFixed(1)}\n` : '';
  return (
    `<b>📊 거시 지표</b>\n` +
    `  MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n` +
    `  USD/KRW: ${usdKrw?.rate?.toFixed(0) ?? 'N/A'}원 (${fmtPct(usdKrw?.changePct)})\n` +
    yieldLine +
    crudeLine
  );
}

function formatPreMarketWatchlistLine(watchlist: WatchlistItem[]): string {
  const names = watchlist.length > 0
    ? ` (${watchlist.slice(0, 5).map(w => w.name).join(', ')}${watchlist.length > 5 ? ' 외' : ''})`
    : '';
  return `<b>📋 워치리스트</b>: ${watchlist.length}개${names}\n`;
}

function buildPreMarketTelegramMessage(params: PreMarketTelegramMessageParams): string {
  const { macro, watchlist, global, usdKrw, alertLines, aiOneLiner, primingLine } = params;
  return (
    `🌅 <b>[장전 브리핑] ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    primingLine +
    formatPreMarketGlobalLines(global) +
    formatPreMarketMacroLines(macro, usdKrw) +
    `\n<b>🔔 섹터 경보</b>\n${alertLines}\n\n` +
    formatPreMarketWatchlistLine(watchlist) +
    (aiOneLiner ? `\n🤖 <b>AI 전망:</b> ${aiOneLiner}` : '')
  );
}

/**
 * 장전 시장 브리핑 — 평일 08:30 KST
 * 간밤 글로벌 시장 + 거시 지표 + 오늘 주목할 점을 요약하여 Telegram 발송
 */
export async function sendPreMarketReport(): Promise<void> {
  const macro      = loadMacroState();
  const watchlist  = loadWatchlist();
  const globalScan = loadGlobalScanReport();
  const global = buildPreMarketGlobalContext(globalScan);

  // USD/KRW
  const usdKrw = await fetchUsdKrwSnapshot();

  // 섹터 경보
  const alertLines = formatPreMarketSectorAlerts(globalScan?.sectorAlerts);

  // Gemini AI 한줄 브리핑
  const aiPrompt = buildPreMarketAiPrompt(macro, global, usdKrw);
  const aiOneLiner = await callGemini(aiPrompt, 'pre-market-brief').catch(() => null);

  // Nightly Reflection Engine #5 — 어제 반성에서 도출한 1줄 학습 포인트 주입.
  // forDate 가 오늘 KST 와 일치할 때만 표시 (과거 priming 이 누적되어도 stale 노출 방지).
  const todayKst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
  const primingLine = buildPreMarketPrimingLine(todayKst);

  const msg = buildPreMarketTelegramMessage({
    macro,
    watchlist,
    global,
    usdKrw,
    alertLines,
    aiOneLiner,
    primingLine,
  });

  await sendTelegramAlert(msg).catch(console.error);

  // 채널: 구독자 대상 간결 브리핑 (자산/잔고 제외)
  const regime = macro?.regime ?? 'R4_NEUTRAL';
  const focusCodes = watchlist.filter(w => w.isFocus);
  await channelMarketBriefing({
    regime,
    mhs:            macro?.mhs ?? 0,
    vkospi:         global.vixData?.price ?? undefined,
    kospiChange:    macro?.kospiDayReturn,
    usdKrw:         usdKrw?.rate,
    watchlistCount: watchlist.length,
    focusCount:     focusCodes.length,
    aiSummary:      aiOneLiner ?? undefined,
  }).catch(console.error);

  console.log('[MarketReport] 장전 브리핑 발송 완료');
}

/**
 * 장중 시장 현황 레포트 — 평일 12:00 KST
 * KOSPI 실시간 + 활성 포지션 + 오전 거래 요약 + 주목 이벤트
 */
export async function sendIntradayMarketReport(): Promise<void> {
  const macro    = loadMacroState();
  const shadows  = loadShadowTrades();
  const today    = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  // PR-15: signalTime 이 아니라 fill timestamp 기준. 부분매도 익절도 P&L 에 반영.
  const todaySignals = shadows.filter(
    s => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );
  const active   = shadows.filter(s =>
    s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' ||
    s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL'
  );

  // KOSPI 실시간
  const kospi  = await fetchKospiSnapshot();
  const usdKrw = await fetchUsdKrwSnapshot();

  // 활성 포지션 현재가 조회
  const posLines: string[] = [];
  for (const s of active.slice(0, 8)) {
    const cur = await fetchCurrentPrice(s.stockCode).catch(() => null);
    if (cur) {
      // ADR-0059: stale 시 0 fallback — 정오 점검 표시용.
      const ret = safePctChange(cur, s.shadowEntryPrice, {
        label: `reportGenerator.posLine:${s.stockCode}`,
      }) ?? 0;
      posLines.push(`  ${ret >= 0 ? '📈' : '📉'} ${s.stockName} ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`);
    } else {
      posLines.push(`  • ${s.stockName} (시세 없음)`);
    }
  }

  const r = summarizeTodayRealizations(collectTodayRealizations(shadows, today));

  const msg =
    `📡 <b>[장중 시장 현황]</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `<b>📊 KOSPI</b>: ${kospi ? `${kospi.price.toFixed(2)} (${fmtPct(kospi.changePct)})` : 'N/A'}\n` +
    `<b>💱 USD/KRW</b>: ${usdKrw ? `${usdKrw.rate.toFixed(0)}원 (${fmtPct(usdKrw.changePct)})` : 'N/A'}\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n\n` +
    `<b>📈 오전 거래 요약</b>\n` +
    `  오늘 신호: ${todaySignals.length}건\n` +
    `  실현 이벤트: ${r.realizationCount}건 (익 ${r.wins} / 손 ${r.losses})` +
      (r.partialOnlyCount > 0 ? ` · 부분매도 ${r.partialOnlyCount}건` : '') + `\n` +
    `  P&L(가중): ${fmtPct(r.weightedReturnPct !== 0 ? r.weightedReturnPct : null)}` +
      ` | 실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원\n\n` +
    (active.length > 0
      ? `<b>💼 활성 포지션 (${active.length}개)</b>\n${posLines.join('\n')}\n`
      : `<b>💼 활성 포지션</b>: 없음\n`);

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[MarketReport] 장중 시장 현황 발송 완료');
}

function buildPostMarketClosedLines(realizations: TodayRealization[]): string {
  return realizations.length > 0
    ? realizations.map(x => {
        const ret = x.fill.pnlPct ?? 0;
        const icon = ret >= 0 ? '✅' : '❌';
        const kind = x.isFinalClose
          ? formatTradeLifecycleOutcome(classifyTradeLifecycleOutcome(x.trade).tradeLifecycleOutcome)
          : '부분익절';
        const canonical = x.isFinalClose
          ? `\n    canonical=${formatCanonicalOutcomeShort(x.trade)}\n    note=${formatCanonicalOutcomeExplanation(x.trade)}`
          : '';
        return `  ${icon} ${x.trade.stockName} ${kind} ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% · ${x.fill.qty}주${canonical}`;
      }).join('\n')
    : '  (오늘 실현 이벤트 없음)';
}

function buildPostMarketAiPrompt(
  macro: MacroSnapshot,
  kospi: KospiSnapshot,
  usdKrw: UsdKrwSnapshot,
  r: TodayRealizationStats,
): string {
  return (
    `오늘 한국 주식시장 마감 후 요약 + 내일 전망 (2~3문장).\n` +
    `데이터: KOSPI ${kospi ? `${kospi.price.toFixed(2)} (${fmtPct(kospi.changePct)})` : 'N/A'}, ` +
    `USD/KRW ${usdKrw?.rate?.toFixed(0) ?? 'N/A'}원, MHS ${macro?.mhs ?? 'N/A'}(${macro?.regime ?? 'N/A'}), ` +
    `오늘 실현 ${r.realizationCount}건 (익 ${r.wins}/손 ${r.losses}) WIN률 ${r.winRate}% P&L(가중) ${r.weightedReturnPct >= 0 ? '+' : ''}${r.weightedReturnPct.toFixed(2)}%.\n` +
    `주의: "실현" 에는 부분매도 익절도 포함되어 있으니 "손실만 있었다" 고 단정 짓지 말고 P&L 가중치 부호와 각 실현 항목 부호를 그대로 따라 서술하라.\n` +
    `오늘 시장을 1문장으로 요약 + 내일 주의사항 1~2개 bullet으로 한국어 답변하라.`
  );
}

interface PostMarketTelegramMessageParams {
  macro: MacroSnapshot;
  watchlist: WatchlistItem[];
  stats: ReturnType<typeof getMonthlyStats>;
  todaySignalsCount: number;
  activeCount: number;
  kospi: KospiSnapshot;
  usdKrw: UsdKrwSnapshot;
  r: TodayRealizationStats;
  closedLines: string;
  aiOutlook: string | null;
}

function buildPostMarketTelegramMessage(params: PostMarketTelegramMessageParams): string {
  const { macro, watchlist, stats, todaySignalsCount, activeCount, kospi, usdKrw, r, closedLines, aiOutlook } = params;
  return (
    `🌇 <b>[장마감 요약] ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `<b>📊 KOSPI 종가</b>: ${kospi ? `${kospi.price.toFixed(2)} (${fmtPct(kospi.changePct)})${formatQuoteAnomalyTag(kospi.changePct, 'INDEX')}` : 'N/A'}\n` +
    `<b>💱 USD/KRW</b>: ${usdKrw ? `${usdKrw.rate.toFixed(0)}원 (${fmtPct(usdKrw.changePct)})${formatQuoteAnomalyTag(usdKrw.changePct, 'FX')}` : 'N/A'}\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})${formatMacroConfidenceTag(macro)}\n\n` +
    `<b>📈 당일 거래 결과</b>\n` +
    `  신호: ${todaySignalsCount}건 | 실현: ${r.realizationCount}건` +
      (r.partialOnlyCount > 0 ? ` (부분 ${r.partialOnlyCount} · 전량 ${r.fullClosedCount})` : '') + `\n` +
    `  WIN률: ${r.winRate}% | P&L(가중): ${r.weightedReturnPct >= 0 ? '+' : ''}${r.weightedReturnPct.toFixed(2)}% | 실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원\n` +
    `${closedLines}\n\n` +
    `<b>💼 보유 포지션</b>: ${activeCount}개\n` +
    `<b>📋 워치리스트</b>: ${watchlist.length}개\n\n` +
    `<b>📅 월간 (${stats.month})</b>\n` +
    `  전체 ${stats.total}건 | WIN률 ${stats.winRate.toFixed(1)}%\n` +
    `  평균수익 ${stats.avgReturn.toFixed(2)}% | STRONG_BUY ${stats.strongBuyWinRate.toFixed(1)}%\n` +
    (aiOutlook ? `\n🤖 <b>AI 전망:</b>\n${aiOutlook}` : '')
  );
}

/**
 * 장마감 시장 요약 레포트 — 평일 15:35 KST
 * 당일 종합: KOSPI 종가 + 거래 결과 + 포지션 현황 + Gemini AI 내일 전망
 */
export async function sendPostMarketReport(): Promise<void> {
  const macro     = loadMacroState();
  const shadows   = loadShadowTrades();
  const watchlist = loadWatchlist();
  const stats     = getMonthlyStats();
  const today     = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  // PR-15: signalTime 이 아니라 fill timestamp 기준. 부분매도 익절 포함.
  const todaySignals = shadows.filter(
    s => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );
  const active    = shadows.filter(s =>
    s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' ||
    s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL'
  );
  const realizations = collectTodayRealizations(shadows, today);
  const r = summarizeTodayRealizations(realizations);

  // KOSPI 종가
  const kospi  = await fetchKospiSnapshot();
  const usdKrw = await fetchUsdKrwSnapshot();

  // 실현 이벤트 상세 (부분매도 포함)
  const closedLines = buildPostMarketClosedLines(realizations);

  // Gemini AI 내일 전망
  const aiPrompt = buildPostMarketAiPrompt(macro, kospi, usdKrw, r);
  const aiOutlook = await callGemini(aiPrompt, 'post-market-brief').catch(() => null);

  const msg = buildPostMarketTelegramMessage({
    macro,
    watchlist,
    stats,
    todaySignalsCount: todaySignals.length,
    activeCount: active.length,
    kospi,
    usdKrw,
    r,
    closedLines,
    aiOutlook,
  });

  await sendTelegramAlert(msg).catch(console.error);

  // NOTE: 파이프라인 트레이서 요약은 16:40 KST scanReviewReport 로 이관되었다 (IDEA 1).
  // 상위 탈락 이유 Top3 + 내일 후보를 포함한 확장 포맷으로 DM+채널 동시 발송한다.

  console.log('[MarketReport] 장마감 요약 발송 완료');
}

/**
 * 온디맨드 시장 요약 — /market 명령어로 즉시 호출
 * 현재 시간대에 따라 적절한 레포트 유형을 자동 선택
 */
export async function sendMarketSummaryOnDemand(): Promise<void> {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const t   = kst.getUTCHours() * 100 + kst.getUTCMinutes();

  if (t < 900) {
    // 장전
    await sendPreMarketReport();
  } else if (t < 1530) {
    // 장중
    await sendIntradayMarketReport();
  } else {
    // 장마감 이후
    await sendPostMarketReport();
  }
}
