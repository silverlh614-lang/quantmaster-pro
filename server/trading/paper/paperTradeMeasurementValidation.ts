// @responsibility Validate observed trade measurement integrity.
import { z } from 'zod';
import type { PaperStrategyTrade, PaperTradeMeasurementPoint, PaperTradeMeasurementRow } from '../../../src/types/paperStrategy.js';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_INVENTED_FEATURE_CUTS, paperIndicatorFormulaValue } from '../../../src/types/paperIndicatorFormula.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';

const finite = z.number().finite();
const timestamp = z.string().datetime({ offset: true });
const entryReasons = ['POSITIVE_COHORT_EXPECTANCY', 'ADAPTIVE_FEATURE_SELECTED', 'ADAPTIVE_EXPLORATION_SELECTED'] as const;
const adaptiveExitReasons = ['ADAPTIVE_STOP_LOSS', 'ADAPTIVE_TRAILING_STOP', 'ADAPTIVE_SIGNAL_LOST'] as const;
const pointShape = z.object({ snapshotId: z.string().min(1), kind: z.enum(['ENTRY', 'QUOTE', 'SCHEDULED_CLOSE', 'ADAPTIVE_EXIT']),
  effectiveAt: timestamp, observedAt: timestamp, recordedAt: timestamp, price: finite.positive(), source: z.string().min(1),
  netReturnPct: finite, netPnl: finite, action: z.enum(['BUY', 'HOLD', 'EXIT']),
  reasonCode: z.enum([...entryReasons, ...adaptiveExitReasons, 'HORIZON_PENDING', 'SCHEDULED_CLOSE_UNAVAILABLE', 'SCHEDULED_CLOSE_REACHED',
    'ADAPTIVE_EXIT_HOLD', 'ADAPTIVE_EXIT_QUOTE_UNAVAILABLE']),
  ruleValue: finite.nullable(), ruleMatches: z.boolean().nullable(), ruleConnected: z.boolean().nullable(), featureAsOf: timestamp.nullable() });
export const paperTradeMeasurementSchema = z.object({ version: z.literal('observed-trade-path-v1'),
  startedAt: timestamp, fromEntry: z.boolean(), pointCount: finite.int().positive(),
  latest: pointShape, highest: pointShape, lowest: pointShape });
const rowsSchema = z.array(pointShape.extend({ tradeId: z.string().min(1), entrySnapshotId: z.string().min(1) }));
const ms = Date.parse;
const sameTime = (a: string, b: string) => ms(a) === ms(b);
const samePoint = (a: PaperTradeMeasurementPoint, b: PaperTradeMeasurementPoint) => JSON.stringify(a) === JSON.stringify(b);
function fail(): never { throw new Error('PAPER_TRADE_MEASUREMENT_INVALID: inconsistent observed trade record'); }
function freshIntraday(point: PaperTradeMeasurementPoint): boolean {
  const day = toKstDateKey(point.observedAt), open = ms(`${day}T09:00:00+09:00`), close = ms(`${day}T15:30:00+09:00`);
  return ms(point.observedAt) >= open && ms(point.observedAt) < close && ms(point.recordedAt) < close
    && ms(point.recordedAt) - ms(point.observedAt) <= 5 * 60_000;
}

function validPoint(point: PaperTradeMeasurementPoint): boolean {
  const { effectiveAt, observedAt, recordedAt, featureAsOf, kind, action, reasonCode } = point;
  if (ms(effectiveAt) > ms(recordedAt) || ms(observedAt) > ms(recordedAt)
    || (featureAsOf !== null && (ms(featureAsOf) > ms(recordedAt)
      || toKstDateKey(new Date(featureAsOf)) !== toKstDateKey(new Date(recordedAt))))
    || (point.ruleValue === null) !== (point.ruleMatches === null)
    || (point.ruleValue !== null && featureAsOf === null)) return false;
  if (kind === 'ENTRY') return action === 'BUY' && entryReasons.some(reason => reason === reasonCode)
    && sameTime(effectiveAt, recordedAt) && ms(observedAt) <= ms(effectiveAt);
  if (kind === 'QUOTE') return action === 'HOLD' && sameTime(observedAt, effectiveAt)
    && toKstDateKey(new Date(observedAt)) === toKstDateKey(new Date(recordedAt))
    && (reasonCode === 'HORIZON_PENDING' || reasonCode === 'SCHEDULED_CLOSE_UNAVAILABLE'
      || (reasonCode === 'ADAPTIVE_EXIT_HOLD' && freshIntraday(point)));
  if (kind === 'ADAPTIVE_EXIT') return action === 'EXIT' && adaptiveExitReasons.some(reason => reason === reasonCode)
    && sameTime(observedAt, effectiveAt) && freshIntraday(point)
    && toKstDateKey(new Date(observedAt)) === toKstDateKey(new Date(recordedAt));
  return action === 'EXIT' && reasonCode === 'SCHEDULED_CLOSE_REACHED' && ms(effectiveAt) <= ms(observedAt)
    && point.source === 'SCHEDULED_CLOSE_CONFIRMED' && point.ruleValue === null && point.ruleMatches === null
    && point.ruleConnected === null && featureAsOf === null;
}

function validRuleReading(point: PaperTradeMeasurementPoint, trade: PaperStrategyTrade): boolean {
  if (point.kind === 'SCHEDULED_CLOSE') return true;
  const rule = (trade.entryDecision.adaptiveEvidence ?? trade.entryDecision.explorationEvidence)?.candidate.rule;
  if (!rule) return point.ruleValue === null && point.ruleMatches === null && point.ruleConnected === null && point.featureAsOf === null;
  if (point.ruleValue !== null) {
    const cuts: readonly number[] = rule.invention ? PAPER_INVENTED_FEATURE_CUTS : PAPER_FEATURES[rule.feature as PaperFeatureKey].cuts;
    const bucket = cuts.filter(cut => point.ruleValue! >= cut).length;
    if (point.ruleMatches !== (bucket === rule.bucket)) return false;
  }
  if (point.kind !== 'ENTRY') return true;
  const features = trade.entryObservation.features;
  if (!features) return false;
  const expected = rule.invention ? paperIndicatorFormulaValue(rule.invention.formula, features.values)
    : features.values[rule.feature as PaperFeatureKey];
  return expected === point.ruleValue && point.ruleMatches === true && point.ruleConnected === true
    && point.featureAsOf !== null && sameTime(point.featureAsOf, features.asOf);
}

function validTradePoint(point: PaperTradeMeasurementPoint, trade: PaperStrategyTrade, asOf?: string): boolean {
  const result = calculatePaperReturn(trade.entryPrice, point.price, trade.costModel);
  if (!validPoint(point) || !validRuleReading(point, trade)
    || ms(point.effectiveAt) < ms(trade.entryAt)
    || (trade.policy.exitModel === 'SCHEDULED_CLOSE' && ms(point.effectiveAt) > ms(trade.scheduledExitAt))
    || (asOf !== undefined && ms(point.recordedAt) > ms(asOf))
    || Math.abs(point.netPnl - result.netPnl) > 1e-8 || Math.abs(point.netReturnPct - result.netReturnPct) > 1e-8) return false;
  if (point.kind === 'ENTRY') return point.snapshotId === trade.entrySnapshotId && sameTime(point.effectiveAt, trade.entryAt)
    && sameTime(point.observedAt, trade.entryObservation.observedAt) && point.price === trade.entryPrice
    && point.source === trade.entryObservation.source && point.reasonCode === trade.entryDecision.reasonCode;
  if (point.snapshotId === trade.entrySnapshotId) return false;
  if (point.kind === 'QUOTE') return ms(point.effectiveAt) > ms(trade.entryAt)
    && (trade.policy.exitModel === 'SCHEDULED_CLOSE'
      ? point.reasonCode === 'HORIZON_PENDING' || point.reasonCode === 'SCHEDULED_CLOSE_UNAVAILABLE'
      : point.reasonCode === 'ADAPTIVE_EXIT_HOLD' && ms(point.recordedAt) - ms(point.observedAt) <= 5 * 60_000)
    && (!trade.exit || ms(point.recordedAt) <= ms(trade.exit.decisionAt));
  const exit = trade.exit;
  if (point.kind === 'ADAPTIVE_EXIT') {
    const quote = exit?.observedQuote;
    if (trade.policy.exitModel !== 'ADAPTIVE_OBSERVED' || exit?.model !== 'ADAPTIVE_OBSERVED' || !quote
      || ms(point.effectiveAt) <= ms(trade.entryAt) || point.reasonCode !== exit.decision.reasonCode
      || point.source !== quote.source || point.ruleValue !== quote.ruleValue || point.ruleMatches !== quote.ruleMatches
      || point.ruleConnected !== quote.ruleConnected || point.featureAsOf !== quote.featureAsOf) return false;
  } else if (trade.policy.exitModel !== 'SCHEDULED_CLOSE' || exit?.model !== 'SCHEDULED_CLOSE') return false;
  return Boolean(exit && trade.status === 'CLOSED' && point.snapshotId === exit.snapshotId && point.price === exit.price
    && sameTime(point.effectiveAt, exit.effectiveAt) && sameTime(point.observedAt, exit.observedAt)
    && sameTime(point.recordedAt, exit.decisionAt));
}

export function assertPaperTradeMeasurement(trade: PaperStrategyTrade, asOf?: string): void {
  if (trade.measurement === undefined) return;
  const parsed = paperTradeMeasurementSchema.safeParse(trade.measurement);
  if (!parsed.success || (asOf !== undefined && !Number.isFinite(ms(asOf)))) fail();
  const value = parsed.data;
  const { latest, highest, lowest } = value;
  const points = [latest, highest, lowest];
  if (ms(value.startedAt) < ms(trade.entryAt) || ms(value.startedAt) > ms(latest.recordedAt)
    || (value.fromEntry ? !sameTime(value.startedAt, trade.entryAt) : ms(value.startedAt) <= ms(trade.entryAt))
    || points.some(point => !validTradePoint(point, trade, asOf) || ms(point.recordedAt) < ms(value.startedAt)
      || ms(point.recordedAt) > ms(latest.recordedAt) || ms(point.effectiveAt) > ms(latest.effectiveAt)
      || (!value.fromEntry && point.kind === 'ENTRY'))
    || highest.price < latest.price || lowest.price > latest.price || highest.price < lowest.price
    || (value.fromEntry && (highest.price < trade.entryPrice || lowest.price > trade.entryPrice
      || (highest.price === trade.entryPrice && highest.kind !== 'ENTRY')
      || (lowest.price === trade.entryPrice && lowest.kind !== 'ENTRY')))) fail();
  const distinct = new Map<string, PaperTradeMeasurementPoint>();
  for (const point of points) {
    const existing = distinct.get(point.snapshotId);
    if (existing && !samePoint(existing, point)) fail();
    distinct.set(point.snapshotId, point);
  }
  const representedStart = points.some(point => sameTime(point.recordedAt, value.startedAt));
  if (value.pointCount < distinct.size + (representedStart ? 0 : 1)
    || (value.pointCount === 1 && (!samePoint(latest, highest) || !samePoint(latest, lowest)))
    || (value.pointCount === 1 && value.fromEntry && latest.kind !== 'ENTRY')
    || (latest.kind === 'ENTRY' && value.pointCount !== 1)
    || (highest.price === lowest.price && !samePoint(highest, lowest))) fail();
}

/** Full trade context verifies frozen costs; standalone reads still validate row chronology. */
export function assertPaperTradeMeasurementRows(value: unknown, trades?: readonly PaperStrategyTrade[]): asserts value is PaperTradeMeasurementRow[] {
  const parsed = rowsSchema.safeParse(value);
  if (!parsed.success) fail();
  const byId = trades ? new Map(trades.map(trade => [trade.id, trade])) : null;
  const seen = new Set<string>();
  for (const row of parsed.data) {
    const key = `${row.tradeId}:${row.snapshotId}`;
    const trade = byId?.get(row.tradeId);
    if (!validPoint(row) || seen.has(key)
      || (row.kind === 'ENTRY' ? row.snapshotId !== row.entrySnapshotId : row.snapshotId === row.entrySnapshotId)
      || (byId && (!trade || row.entrySnapshotId !== trade.entrySnapshotId || !validTradePoint(row, trade)))) fail();
    seen.add(key);
  }
}
