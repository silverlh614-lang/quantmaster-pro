// @responsibility Grade exploration opportunities using completed dated Shadow trade cohorts.
import type { PaperAdaptiveCandidate, PaperAdaptiveRule } from '../../../src/types/paperAdaptive.js';
import { PAPER_AUTONOMY_POLICY, paperAutonomyRuleKey, type PaperAutonomyEntry, type PaperAutonomyState,
  type PaperAutonomyStats } from '../../../src/types/paperAutonomy.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_INVENTED_FEATURE_CUTS, paperIndicatorFormulaId, paperIndicatorFormulaValue } from '../../../src/types/paperIndicatorFormula.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { validSealedPaperFormula } from './paperIndicatorProgram.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';
export { paperAutonomyRuleKey, PAPER_AUTONOMY_REASON_LABELS } from '../../../src/types/paperAutonomy.js';

interface Entry { id: string; symbol: string; date: string; ruleKey: string; net: number | null }
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
function validRule(rule: PaperAdaptiveRule, at: number): boolean {
  const invention = rule.invention;
  const cuts = invention ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey]?.cuts;
  return Boolean(cuts && Number.isInteger(rule.bucket) && rule.bucket >= 0 && rule.bucket <= cuts.length
    && [1, 3, 5].includes(rule.horizon) && (!invention || (invention.id === rule.feature
      && validSealedPaperFormula(invention.formula) && paperIndicatorFormulaId(invention.formula) === rule.feature
      && invention.rule.bucket === rule.bucket && invention.rule.horizon === rule.horizon
      && Date.parse(invention.createdAt) <= at)));
}
function genuineEntry(trade: PaperStrategyTrade, cutoff: number): boolean {
  const evidence = trade.entryDecision.explorationEvidence, observation = trade.entryObservation;
  const entry = Date.parse(trade.entryAt), observed = Date.parse(observation.observedAt);
  if (!evidence || trade.strategyVersion !== 'adaptive-features-v1' || trade.policy.version !== trade.strategyVersion
    || trade.policy.exitModel !== 'ADAPTIVE_OBSERVED' || trade.policy.horizonSelection !== 'FORWARD_VALIDATED_FEATURE'
    || trade.quantity !== 1 || !['OPEN', 'CLOSED'].includes(trade.status) || !Number.isFinite(entry) || !(entry < cutoff)
    || !/^\d{6}$/.test(trade.symbol) || toKstDateKey(new Date(entry)) !== trade.tradingDate
    || trade.id !== `${trade.strategyVersion}:${trade.tradingDate}:${trade.symbol}`
    || observation.symbol !== trade.symbol || observation.price !== trade.entryPrice || observation.issue !== undefined
    || !(observed <= entry) || toKstDateKey(new Date(observed)) !== trade.tradingDate
    || !Number.isFinite(trade.entryPrice) || !(trade.entryPrice > 0)
    || ![trade.costModel.buyFeeRate, trade.costModel.sellFeeRate, trade.costModel.sellTaxRate, trade.costModel.slippageRate]
      .every(rate => Number.isFinite(rate) && rate >= 0)
    || trade.entryDecision.action !== 'BUY' || trade.entryDecision.reasonCode !== 'ADAPTIVE_EXPLORATION_SELECTED'
    || trade.entryDecision.adaptiveEvidence || trade.entryDecision.evidence !== null || trade.entryDecision.cohort !== null
    || trade.entryDecision.tradeId !== trade.id || trade.entryDecision.symbol !== trade.symbol
    || trade.entryDecision.snapshotId !== trade.entrySnapshotId || trade.entryDecision.decisionAt !== trade.entryAt
    || evidence.candidate.active || !validRule(evidence.candidate.rule, entry) || evidence.candidate.rule.horizon !== trade.horizon) return false;
  const rule = evidence.candidate.rule, features = observation.features;
  const registered = Date.parse(evidence.registeredAt), evaluated = Date.parse(evidence.evaluatedAt);
  const midnight = Date.parse(`${trade.tradingDate}T00:00:00+09:00`);
  if (!(midnight <= evaluated && evaluated <= registered && registered < observed)
    || toKstDateKey(new Date(registered)) !== trade.tradingDate || Date.parse(evidence.cutoffAt) !== midnight
    || !features || features.version !== 'observation-features-v1'
    || !(registered < Date.parse(features.asOf) && Date.parse(features.asOf) <= entry)
    || (rule.invention && !(Date.parse(rule.invention.createdAt) <= registered))) return false;
  const value = rule.invention ? paperIndicatorFormulaValue(rule.invention.formula, features.values)
    : features.values[rule.feature as PaperFeatureKey];
  const cuts: readonly number[] = rule.invention ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts;
  return typeof value === 'number' && Number.isFinite(value)
    && value >= (cuts[rule.bucket - 1] ?? -Infinity) && value < (cuts[rule.bucket] ?? Infinity);
}
function closedReturn(trade: PaperStrategyTrade, cutoff: number): number | null {
  const exit = trade.exit;
  if (trade.status !== 'CLOSED' || !exit || exit.model !== trade.policy.exitModel
    || !Number.isFinite(exit.price) || !(exit.price > 0)) return null;
  const effective = Date.parse(exit.effectiveAt), observed = Date.parse(exit.observedAt), decided = Date.parse(exit.decisionAt);
  if (!(Date.parse(trade.entryAt) < effective && effective <= observed && observed <= decided && decided < cutoff)
    || exit.decision.decisionAt !== exit.decisionAt || exit.decision.action !== 'EXIT'
    || exit.decision.tradeId !== trade.id || exit.decision.symbol !== trade.symbol) return null;
  const net = calculatePaperReturn(trade.entryPrice, exit.price, trade.costModel).netReturnPct;
  return Number.isFinite(net) ? net : null;
}
function collectEntries(trades: readonly PaperStrategyTrade[], keys: Set<string>, cutoff: number): Entry[] {
  const entries = new Map<string, Entry>();
  for (const trade of trades) {
    if (!genuineEntry(trade, cutoff)) continue;
    const ruleKey = paperAutonomyRuleKey(trade.entryDecision.explorationEvidence!.candidate.rule);
    if (!keys.has(ruleKey)) continue;
    const next = { id: trade.id, symbol: trade.symbol, date: trade.tradingDate, ruleKey, net: closedReturn(trade, cutoff) };
    const key = `${next.symbol}:${next.date}`, previous = entries.get(key);
    // Conflicting duplicate records cannot supply a winning result; keep their cohort pending.
    if (previous && previous.ruleKey !== next.ruleKey) throw new Error('PAPER_AUTONOMY_INVALID: conflicting trade rules');
    if (previous && previous.net !== next.net) {
      previous.net = null;
    } else if (!previous) entries.set(key, next);
  }
  return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
}
function summarize(entries: Entry[]): PaperAutonomyStats {
  const closed = entries.filter((entry): entry is Entry & { net: number } => entry.net !== null);
  const dates = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!dates.has(entry.date)) dates.set(entry.date, []);
    dates.get(entry.date)!.push(entry);
  }
  const complete = [...dates.values()].filter(rows => rows.every(row => row.net !== null));
  const dateMeans = complete.map(rows => mean(rows.map(row => row.net!)));
  const average = dateMeans.length ? mean(dateMeans) : null;
  const standardError = dateMeans.length > 1
    ? Math.sqrt(dateMeans.reduce((sum, value) => sum + (value - average!) ** 2, 0) / (dateMeans.length - 1) / dateMeans.length) : null;
  return { totalCount: entries.length, closedCount: closed.length, pendingCount: entries.length - closed.length,
    sampleCount: complete.reduce((sum, rows) => sum + rows.length, 0), dateCount: dateMeans.length,
    meanNetReturnPct: closed.length ? mean(closed.map(row => row.net)) : null,
    meanDateNetReturnPct: average, standardErrorPct: standardError, tradeIdsDigest: paperEvidenceDigest(entries.map(row => row.id)) };
}
function grade(stats: PaperAutonomyStats): Pick<PaperAutonomyEntry, 'reason' | 'weight'> {
  if (stats.sampleCount < PAPER_AUTONOMY_POLICY.minimumSamples || stats.dateCount < PAPER_AUTONOMY_POLICY.minimumEntryDates
    || stats.meanDateNetReturnPct === null || stats.standardErrorPct === null) return { reason: 'EXPLORE', weight: 2 };
  const interval = PAPER_AUTONOMY_POLICY.standardErrors * stats.standardErrorPct;
  if (stats.meanDateNetReturnPct - interval > 0) return { reason: 'INCREASE', weight: 3 };
  if (stats.meanDateNetReturnPct + interval < 0) return { reason: 'REDUCE', weight: 1 };
  return { reason: 'MAINTAIN', weight: 2 };
}
/** No I/O or AI calls; the caller owns fallback handling, selection, persistence. */
export function buildPaperAutonomy(candidates: PaperAdaptiveCandidate[], trades: readonly PaperStrategyTrade[],
  previous: PaperAutonomyState | undefined, asOf: string): PaperAutonomyState {
  const evaluated = Date.parse(asOf);
  if (!Number.isFinite(evaluated)) throw new Error('PAPER_AUTONOMY_INVALID: evaluation time');
  const cutoffAt = new Date(`${toKstDateKey(new Date(evaluated))}T00:00:00+09:00`).toISOString();
  if (candidates.some(candidate => !validRule(candidate.rule, evaluated))) throw new Error('PAPER_AUTONOMY_INVALID: candidate rule');
  const keys = new Set(candidates.map(candidate => paperAutonomyRuleKey(candidate.rule)));
  const collected = collectEntries(trades, keys, Date.parse(cutoffAt));
  const dates = new Set([...new Set(collected.map(row => row.date))].sort().slice(-PAPER_AUTONOMY_POLICY.windowEntryDates));
  const rows = collected.filter(row => dates.has(row.date));
  const history = previous?.selectionHistory ?? (previous?.entries ?? []).flatMap(entry =>
    entry.lastSelectedAt ? [{ ruleKey: entry.ruleKey, selectedAt: entry.lastSelectedAt }] : []);
  const selectionHistory = history.filter(item => Date.parse(item.selectedAt) <= Date.parse(cutoffAt))
    .map(item => ({ ...item })).sort((a, b) => a.selectedAt.localeCompare(b.selectedAt) || a.ruleKey.localeCompare(b.ruleKey)).slice(-256);
  const selectedByRule = new Map(selectionHistory.map(item => [item.ruleKey, item.selectedAt]));
  const entries = [...keys].sort().map(ruleKey => {
    const stats = summarize(rows.filter(row => row.ruleKey === ruleKey));
    return { ruleKey, stats, ...grade(stats), lastSelectedAt: selectedByRule.get(ruleKey) ?? null };
  });
  return { version: 'shadow-autonomy-v1', evaluatedAt: asOf, cutoffAt, status: 'READY', entries, selectedRuleKeys: [], selectionHistory };
}
