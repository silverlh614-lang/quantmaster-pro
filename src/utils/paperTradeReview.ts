// @responsibility Derive performance summaries from frozen trade evidence.
import type { PaperStrategyTrade } from '../types/paperStrategy';
import { paperAdaptiveRuleLabel } from '../types/paperAdaptive';

export type TradePurpose = 'VALIDATED' | 'EXPLORATION' | 'LEGACY';
export const tradePurposeLabels: Record<TradePurpose, string> = { VALIDATED: '검증 매수', EXPLORATION: '탐색 매수', LEGACY: '구전략' };
export function tradePurpose(trade: PaperStrategyTrade): TradePurpose {
  return trade.strategyVersion !== 'adaptive-features-v1' ? 'LEGACY'
    : trade.entryDecision.explorationEvidence ? 'EXPLORATION' : 'VALIDATED';
}
/** Group by the entry's actual rule, formula generation and frozen exit settings, never today's selected rule. */
export function tradeRuleIdentity(trade: PaperStrategyTrade) {
  const rule = (trade.entryDecision.explorationEvidence ?? trade.entryDecision.adaptiveEvidence)?.candidate.rule;
  const profile = trade.exitPolicy?.profile;
  const key = JSON.stringify([trade.strategyVersion, tradePurpose(trade), rule?.feature ?? trade.entryDecision.cohort,
    rule?.bucket, trade.horizon, rule?.invention?.createdAt, trade.policy.exitModel, trade.exitPolicy?.version,
    profile && [profile.id, profile.stopLossPct, profile.trailingArmPct, profile.trailingDrawdownPct,
      profile.signalFailureCount, profile.signalFailureMinutes], trade.costModel.version,
    trade.costModel.buyFeeRate, trade.costModel.sellFeeRate, trade.costModel.sellTaxRate, trade.costModel.slippageRate]);
  return { key, label: rule ? paperAdaptiveRuleLabel(rule) : `${trade.entryDecision.cohort ?? '과거 조건'} · D${trade.horizon}`,
    version: trade.strategyVersion, bornAt: rule?.invention?.createdAt,
    exitLabel: profile ? `${trade.exitPolicy!.version} · ${profile.id} · 손실 ${profile.stopLossPct}% / 수익 ${profile.trailingArmPct}%부터 반납 ${profile.trailingDrawdownPct}%p / 근거 약화 ${profile.signalFailureCount}회·${profile.signalFailureMinutes}분`
      : trade.policy.exitModel === 'SCHEDULED_CLOSE' ? '예약 종가 매도' : '매도 기준 미기록',
    costLabel: `${trade.costModel.version} · 매수 ${(trade.costModel.buyFeeRate * 100).toFixed(4)}% / 매도 ${(trade.costModel.sellFeeRate * 100).toFixed(4)}% / 세금 ${(trade.costModel.sellTaxRate * 100).toFixed(4)}% / 편도 슬리피지 ${(trade.costModel.slippageRate * 100).toFixed(4)}%`,
    purpose: tradePurpose(trade) };
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function summarizeTradeRecords(trades: readonly PaperStrategyTrade[]) {
  const closed = trades.filter(trade => trade.status === 'CLOSED' && trade.exit && Number.isFinite(trade.exit.netReturnPct));
  const returns = closed.map(trade => trade.exit!.netReturnPct);
  const wins = returns.filter(value => value > 0), losses = returns.filter(value => value < 0);
  const pairs = closed.filter(trade => trade.exitResearch?.baseline && Number.isFinite(trade.exitResearch.baseline.netReturnPct));
  const openCount = trades.filter(trade => trade.status === 'OPEN').length;
  const unknownCount = trades.length - openCount - closed.length;
  return { totalCount: trades.length, openCount, closedCount: closed.length, unknownCount,
    dateCount: new Set(trades.map(trade => trade.tradingDate)).size,
    complete: trades.length > 0 && openCount === 0 && unknownCount === 0,
    winCount: wins.length, lossCount: losses.length, flatCount: returns.length - wins.length - losses.length,
    winRatePct: returns.length ? wins.length / returns.length * 100 : null,
    meanNetReturnPct: mean(returns), meanWinPct: mean(wins), meanLossPct: mean(losses),
    missingPathCount: trades.filter(trade => !trade.measurement).length,
    partialPathCount: trades.filter(trade => trade.measurement && !trade.measurement.fromEntry).length,
    d5Count: pairs.length, d5DifferencePct: mean(pairs.map(trade => trade.exit!.netReturnPct - trade.exitResearch!.baseline!.netReturnPct)) };
}
export function buildTradeReview(trades: readonly PaperStrategyTrade[]) {
  const dates = new Map<string, PaperStrategyTrade[]>(), rules = new Map<string, PaperStrategyTrade[]>();
  for (const trade of trades) {
    const key = tradeRuleIdentity(trade).key;
    if (!dates.has(trade.tradingDate)) dates.set(trade.tradingDate, []);
    if (!rules.has(key)) rules.set(key, []);
    dates.get(trade.tradingDate)!.push(trade); rules.get(key)!.push(trade);
  }
  return { summary: summarizeTradeRecords(trades),
    dates: [...dates].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, ...summarizeTradeRecords(rows) })),
    rules: [...rules].map(([key, rows]) => ({ ...tradeRuleIdentity(rows[0]), key, ...summarizeTradeRecords(rows) }))
      .sort((a, b) => b.totalCount - a.totalCount || a.key.localeCompare(b.key)) };
}
