// @responsibility Validate persisted empirical Shadow strategy records.
import { z } from 'zod';
import type { PaperStrategyEvidence, PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { paperStrategyCohort } from './paperStrategyEvidence.js';
import { PAPER_FLOW_ISSUE_LABELS, type PaperFlowIssue } from '../../../src/types/paperInvestorFlow.js';
import { PAPER_NEWS_EVENT_LABELS, type PaperNewsEvent } from '../../../src/types/paperNewsFacts.js';

const finite = z.number().finite();
const timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
});
const horizon = z.union([z.literal(1), z.literal(3), z.literal(5)]);
const version = z.enum(['news-trend-v1', 'news-trend-v2']);
const symbol = z.string().regex(/^\d{6}$/);
const investorFlow = z.object({ symbol, source: z.literal('KIS_API'), unit: z.literal('SHARES'), requestedTradingDate: date,
  tradingDate: z.string().nullable(), observedAt: timestamp.nullable(), foreignNetShares: finite.nullable(),
  institutionalNetShares: finite.nullable(), volume: finite.nullable(),
  issue: z.enum(Object.keys(PAPER_FLOW_ISSUE_LABELS) as [PaperFlowIssue, ...PaperFlowIssue[]]).nullable() });
const newsDirection = z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED', 'UNKNOWN']);
const newsFacts = z.object({ version: z.literal('news-facts-v1'), recordedAt: timestamp,
  relationship: z.enum(['DIRECT', 'INDIRECT', 'UNVERIFIED']), event: z.enum(Object.keys(PAPER_NEWS_EVENT_LABELS) as [PaperNewsEvent, ...PaperNewsEvent[]]),
  filingStatus: z.enum(['FILED', 'AMENDED', 'WITHDRAWN', 'UNCONFIRMED']), receiptNo: z.string().nullable(),
  filedDate: date.nullable(), firstSeenAt: timestamp, sourceUrl: z.string().nullable(), linkMethod: z.string() });
const newsAssessment = z.object({ version: z.literal('headline-rules-v1'), method: z.literal('DISCLOSURE_TITLE_RULES'),
  assessedAt: timestamp, direction: newsDirection, reason: z.string().min(1) });
const newsSummary = z.object({ asOf: timestamp, lookbackHours: finite.positive(),
  direction: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED', 'UNKNOWN', 'NO_NEWS']),
  counts: z.object({ POSITIVE: finite.int().nonnegative(), NEGATIVE: finite.int().nonnegative(), NEUTRAL: finite.int().nonnegative(),
    MIXED: finite.int().nonnegative(), UNKNOWN: finite.int().nonnegative() }), totalCount: finite.int().nonnegative(),
  evidence: z.array(z.object({ id: z.string(), headline: z.string(), source: z.string(), observedAt: timestamp,
    direction: newsDirection, reason: z.string(), facts: newsFacts.optional() })).max(5) });
const cohort = z.enum(['NEWS_RECENT_ABOVE_MA20', 'NEWS_RECENT_BELOW_MA20', 'NEWS_ABSENT_ABOVE_MA20', 'NEWS_ABSENT_BELOW_MA20']);
const policy = z.object({ version, newsLookbackHours: finite.positive(), minimumSamples: finite.int().positive(),
  minimumEntryDates: finite.int().positive(), horizonSelection: z.literal('MEAN_NET_RETURN_PER_DAY'), exitModel: z.literal('SCHEDULED_CLOSE') });
const evidence = z.object({
  cutoffAt: timestamp, cohort, sampleCount: finite.int().nonnegative(), entryDateCount: finite.int().nonnegative(),
  experimentIds: z.array(z.string()), selectedHorizon: horizon.nullable(),
  historicalSampleCount: finite.int().nonnegative().optional(), baselineSampleCount: finite.int().nonnegative().optional(),
  horizons: z.array(z.object({ horizon, count: finite.int().nonnegative(), meanNetReturnPct: finite.nullable(),
    meanDailyNetReturnPct: finite.nullable(), winRatePct: finite.min(0).max(100).nullable() })).length(3),
});
const decision = z.object({ snapshotId: z.string(), decisionAt: timestamp, symbol, name: z.string(),
  action: z.enum(['BUY', 'WAIT', 'HOLD', 'EXIT']),
  reasonCode: z.enum(['POSITIVE_COHORT_EXPECTANCY', 'INSUFFICIENT_MATURE_SAMPLES', 'INSUFFICIENT_ENTRY_DATES',
    'NON_POSITIVE_EXPECTANCY', 'TREND_UNKNOWN', 'MARKET_CLOSED', 'CURRENT_PRICE_UNAVAILABLE', 'OBSERVATION_TIME_INVALID',
    'ALREADY_ENTERED_TODAY', 'HORIZON_PENDING', 'SCHEDULED_CLOSE_UNAVAILABLE', 'SCHEDULED_CLOSE_REACHED']),
  reason: z.string(), cohort: cohort.nullable(), evidence: evidence.nullable(), tradeId: z.string().nullable(), newsSummary: newsSummary.optional(), investorFlow: investorFlow.optional() });
const observation = z.object({ symbol, name: z.string(), price: finite.positive().nullable(), observedAt: timestamp, source: z.string(),
  investorFlow: investorFlow.optional(),
  return1dPct: finite.nullable(), return5dPct: finite.nullable(), aboveMa20: z.boolean().nullable(),
  news: z.array(z.object({ id: z.string(), headline: z.string(), observedAt: timestamp, source: z.string(), assessment: newsAssessment.optional(), facts: newsFacts.optional() })),
  dailyCloses: z.array(z.object({ tradingDate: date, close: finite.positive(), availableAt: timestamp })), issue: z.string().optional() });
const cost = z.object({ version: z.string(), buyFeeRate: finite.nonnegative(), sellFeeRate: finite.nonnegative(),
  sellTaxRate: finite.nonnegative(), slippageRate: finite.nonnegative() });
const exit = z.object({ model: z.literal('SCHEDULED_CLOSE'), snapshotId: z.string(), effectiveAt: timestamp,
  observedAt: timestamp, decisionAt: timestamp, price: finite.positive(), grossReturnPct: finite, netReturnPct: finite, netPnl: finite, decision });
const trade = z.object({ id: z.string(), strategyVersion: version, symbol, name: z.string(), status: z.enum(['OPEN', 'CLOSED']),
  entrySnapshotId: z.string(), entryAt: timestamp, tradingDate: date, entryPrice: finite.positive(), quantity: z.literal(1),
  entryObservation: observation, entryDecision: decision, policy, costModel: cost, horizon,
  scheduledExitDate: date, scheduledExitAt: timestamp, exit: exit.nullable() });
const ledgerSchema = z.object({ schemaVersion: z.literal(1), trades: z.array(trade), latestDecisions: z.array(decision),
  lastMarketSession: z.object({ tradingDate: date, snapshotId: z.string(), asOf: timestamp, decisionCount: finite.int().nonnegative(),
    reasonCounts: z.record(z.string(), finite.int().positive()) }).optional(),
  lastRun: z.object({ snapshotId: z.string(), asOf: timestamp, openedCount: finite.int().nonnegative(), closedCount: finite.int().nonnegative(),
    waitingCount: finite.int().nonnegative(), holdingCount: finite.int().nonnegative(), error: z.string().optional() }).nullable() });

function consistentEvidence(value: PaperStrategyEvidence): boolean {
  const { sampleCount, entryDateCount, experimentIds, horizons } = value;
  if (value.historicalSampleCount !== undefined || value.baselineSampleCount !== undefined) {
    if ((value.historicalSampleCount ?? 0) + (value.baselineSampleCount ?? 0) !== sampleCount
      || value.historicalSampleCount !== experimentIds.filter((id) => id.startsWith('historical-close:')).length) return false;
  }
  if (experimentIds.length !== sampleCount || new Set(experimentIds).size !== sampleCount
    || experimentIds.some((id) => !id.trim()) || entryDateCount > sampleCount
    || (sampleCount === 0 ? entryDateCount !== 0 : entryDateCount === 0)
    || new Set(horizons.map((item) => item.horizon)).size !== 3) return false;
  for (const item of horizons) {
    if (item.count !== sampleCount) return false;
    if (sampleCount === 0) {
      if (item.meanNetReturnPct !== null || item.meanDailyNetReturnPct !== null || item.winRatePct !== null) return false;
    } else if (item.meanNetReturnPct === null || item.meanDailyNetReturnPct === null || item.winRatePct === null
      || Math.abs(item.meanDailyNetReturnPct - item.meanNetReturnPct / item.horizon) > 1e-8) return false;
  }
  const selected = sampleCount ? [...horizons].sort((a, b) =>
    b.meanDailyNetReturnPct! - a.meanDailyNetReturnPct! || a.horizon - b.horizon)[0].horizon : null;
  return value.selectedHorizon === selected;
}

function sameEvidence(left: PaperStrategyEvidence, right: PaperStrategyEvidence | null): boolean {
  if (!right) return false;
  const normalized = (value: PaperStrategyEvidence) => ({ ...value,
    experimentIds: [...value.experimentIds].sort(), horizons: [...value.horizons].sort((a, b) => a.horizon - b.horizon) });
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export function assertPaperStrategyLedger(value: unknown): asserts value is PaperStrategyLedger {
  const parsed = ledgerSchema.safeParse(value);
  if (!parsed.success) throw new Error('PAPER_STRATEGY_INVALID: invalid ledger structure');
  const session = parsed.data.lastMarketSession;
  if (session && (!(Date.parse(session.asOf) >= Date.parse(`${session.tradingDate}T09:00:00+09:00`)
    && Date.parse(session.asOf) < Date.parse(`${session.tradingDate}T15:30:00+09:00`))
    || Object.values(session.reasonCounts).reduce((sum, count) => sum + count, 0) !== session.decisionCount
    || Object.keys(session.reasonCounts).some(key => key === 'MARKET_CLOSED' || !decision.shape.reasonCode.safeParse(key).success))) {
    throw new Error('PAPER_STRATEGY_INVALID: inconsistent intraday summary');
  }
  const ids = new Set<string>();
  const openSymbols = new Set<string>();
  const decisions = [...parsed.data.latestDecisions, ...parsed.data.trades.flatMap((item) =>
    item.exit ? [item.entryDecision, item.exit.decision] : [item.entryDecision])];
  if (decisions.some((item) => item.evidence && (!consistentEvidence(item.evidence)
    || item.cohort !== item.evidence.cohort || Date.parse(item.evidence.cutoffAt) > Date.parse(item.decisionAt)))) {
    throw new Error('PAPER_STRATEGY_INVALID: inconsistent decision evidence');
  }
  for (const item of parsed.data.trades) {
    // The schedule was frozen at entry; later holiday-calendar corrections must not rewrite persisted decisions.
    const expectedClose = Date.parse(`${item.scheduledExitDate}T15:30:00+09:00`);
    const entryMs = Date.parse(item.entryAt);
    const entryEvidence = item.entryDecision.evidence;
    const selected = entryEvidence?.horizons.find((row) => row.horizon === item.horizon);
    if (ids.has(item.id) || item.id !== `${item.strategyVersion}:${item.tradingDate}:${item.symbol}`
      || item.entryObservation.symbol !== item.symbol || item.entryObservation.price !== item.entryPrice
      || item.entryObservation.name !== item.name || item.entryObservation.issue !== undefined
      || Date.parse(item.entryObservation.observedAt) > entryMs
      || toKstDateKey(new Date(item.entryObservation.observedAt)) !== item.tradingDate
      || toKstDateKey(new Date(item.entryAt)) !== item.tradingDate
      || item.entryObservation.news.some((news) => Date.parse(news.observedAt) > entryMs)
      || item.entryObservation.dailyCloses.some((close) => Date.parse(close.availableAt) > entryMs)
      || item.entryDecision.action !== 'BUY' || item.entryDecision.reasonCode !== 'POSITIVE_COHORT_EXPECTANCY'
      || item.entryDecision.symbol !== item.symbol || item.entryDecision.name !== item.name || item.entryDecision.tradeId !== item.id
      || item.entryDecision.decisionAt !== item.entryAt || item.entryDecision.snapshotId !== item.entrySnapshotId
      || !entryEvidence || entryEvidence.selectedHorizon !== item.horizon || entryEvidence.cutoffAt !== item.entryAt
      || item.entryDecision.cohort !== paperStrategyCohort(item.entryObservation, item.entryAt, item.policy)
      || entryEvidence.sampleCount < item.policy.minimumSamples || entryEvidence.entryDateCount < item.policy.minimumEntryDates
      || !selected || !(selected.meanNetReturnPct !== null && selected.meanNetReturnPct > 0)
      || item.scheduledExitDate <= item.tradingDate || Date.parse(item.scheduledExitAt) !== expectedClose
      || !(entryMs < expectedClose)
      || (item.status === 'OPEN' ? item.exit !== null || openSymbols.has(item.symbol) : item.exit === null)) {
      throw new Error('PAPER_STRATEGY_INVALID: inconsistent trade lifecycle');
    }
    if (item.exit) {
      const result = calculatePaperReturn(item.entryPrice, item.exit.price, item.costModel);
      if (Date.parse(item.exit.effectiveAt) !== expectedClose
        || !(Date.parse(item.exit.observedAt) >= expectedClose)
        || !(Date.parse(item.exit.decisionAt) >= Date.parse(item.exit.observedAt))
        || item.exit.decision.action !== 'EXIT' || item.exit.decision.reasonCode !== 'SCHEDULED_CLOSE_REACHED'
        || item.exit.decision.tradeId !== item.id || item.exit.decision.symbol !== item.symbol || item.exit.decision.name !== item.name
        || item.exit.decision.snapshotId !== item.exit.snapshotId || item.exit.decision.decisionAt !== item.exit.decisionAt
        || !sameEvidence(entryEvidence, item.exit.decision.evidence)
        || Math.abs(item.exit.netPnl - result.netPnl) > 1e-8
        || Math.abs(item.exit.netReturnPct - result.netReturnPct) > 1e-8
        || Math.abs(item.exit.grossReturnPct - result.grossReturnPct) > 1e-8) {
        throw new Error('PAPER_STRATEGY_INVALID: inconsistent scheduled exit');
      }
    }
    ids.add(item.id);
    if (item.status === 'OPEN') openSymbols.add(item.symbol);
  }
}
