// @responsibility Validate frozen morning recommendation provenance.
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PaperMorningReport, PaperMorningSource } from '../../../src/types/paperMorning.js';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { adaptiveStateSchema } from './paperAdaptiveValidation.js';
import { adaptiveFeatureValue, adaptiveRuleId, adaptiveRuleMatches } from './paperAdaptiveSelection.js';
import { paperObservationSchema } from './paperStrategyValidation.js';

const finite = z.number().finite(), count = finite.int().nonnegative();
export const paperMorningTimestampSchema = z.string().datetime({ offset: true });
const timestamp = paperMorningTimestampSchema;
export const paperMorningDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
});
const symbol = z.string().regex(/^\d{6}$/);
const dailyClose = z.object({ tradingDate: paperMorningDateSchema, close: finite.positive(), availableAt: timestamp,
  open: finite.positive().optional(), high: finite.positive().optional(), low: finite.positive().optional(), volume: finite.nonnegative().optional() });
const observation = paperObservationSchema.extend({ market: z.enum(['KOSPI', 'KOSDAQ']).optional(), dailyCloses: z.array(dailyClose) });
// Failed provider quotes retain their diagnostic timestamp without disqualifying other symbols.
const sourceObservation = observation.extend({ observedAt: z.string() }).refine(item =>
  timestamp.safeParse(item.observedAt).success || Boolean(item.issue && item.price === null));
const sourceSchema = z.object({ version: z.literal('morning-source-v1'), snapshot: z.object({ id: z.string().min(1),
  asOf: timestamp, tradingDate: paperMorningDateSchema, marketOpen: z.boolean(), observations: z.array(sourceObservation),
  disclosures: z.object({ state: z.enum(['COMPLETE', 'PARTIAL', 'UNAVAILABLE']), checkedAt: timestamp,
    lastSuccessAt: timestamp.nullable(), fromDate: paperMorningDateSchema, toDate: paperMorningDateSchema,
    pages: count, fetchedCount: count, linkedCount: count, unlinkedCount: count, issue: z.string().nullable() }).optional() }),
  adaptive: adaptiveStateSchema, openSymbols: z.array(symbol) });
const candidate = adaptiveStateSchema.shape.candidates.element;
const reportSchema = z.object({ version: z.literal('morning-recommendation-v1'), id: z.string().min(1),
  tradingDate: paperMorningDateSchema, scheduledAt: timestamp, createdAt: timestamp,
  status: z.enum(['READY', 'NO_MATCH', 'DATA_UNAVAILABLE', 'HOLIDAY']), reason: z.string().min(1),
  sourceSnapshotId: z.string().min(1).nullable(), sourceAsOf: timestamp.nullable(),
  adaptiveEvaluatedAt: timestamp.nullable(), adaptiveCutoffAt: timestamp.nullable(),
  consideredCount: count, matchedCount: count, heldCount: count,
  picks: z.array(z.object({ rank: finite.int().min(1).max(3), symbol, name: z.string(), purpose: z.enum(['VALIDATED', 'EXPLORATION']),
    referenceClose: dailyClose, observation, candidate, ruleValue: finite,
    trial: z.object({ id: z.string().min(1), registeredAt: timestamp }).optional() })).max(3),
  message: z.string().min(1), delivery: z.object({ sentAt: timestamp, messageId: finite.int().positive() }).optional() });
const at = Date.parse;
const midnight = (date: string) => at(`${date}T00:00:00+09:00`);
function invalid(): never { throw new Error('PAPER_MORNING_INVALID: inconsistent recommendation provenance'); }

export function isPaperMorningSourceTime(asOf: string): boolean {
  const date = toKstDateKey(asOf), time = at(asOf);
  return Number.isFinite(time) && time >= at(`${date}T07:00:00+09:00`) && time <= at(`${date}T08:30:00+09:00`);
}

function observationKnown(item: PaperObservation, asOf: string, allowInvalidQuote = false): boolean {
  const limit = at(asOf);
  const failedQuote = allowInvalidQuote && Boolean(item.issue && item.price === null);
  if ((!failedQuote && (!Number.isFinite(at(item.observedAt)) || at(item.observedAt) > limit)) || item.dailyCloses.some(bar => at(bar.availableAt) > limit
    || at(bar.availableAt) < at(`${bar.tradingDate}T15:30:00+09:00`))) return false;
  if (item.features && (at(item.features.asOf) > limit
    || (item.features.technicalDate !== null && item.features.technicalDate > toKstDateKey(asOf)))) return false;
  const financials = item.features?.financials;
  if (financials && (!timestamp.safeParse(financials.observedAt).success || at(financials.observedAt) > limit
    || financials.symbol !== item.symbol)) return false;
  if (item.investorFlow?.observedAt && at(item.investorFlow.observedAt) > limit) return false;
  return item.news.every(news => at(news.observedAt) <= limit
    && (!news.assessment || at(news.assessment.assessedAt) <= limit)
    && (!news.facts || (at(news.facts.recordedAt) <= limit && at(news.facts.firstSeenAt) <= limit)));
}

/** Validation never replaces the original source, preserving optional provider fields. */
export function assertPaperMorningSource(value: unknown): asserts value is PaperMorningSource {
  if (!sourceSchema.safeParse(value).success) invalid();
  const { snapshot, adaptive, openSymbols } = value as PaperMorningSource;
  if (toKstDateKey(snapshot.asOf) !== snapshot.tradingDate || adaptive.tradingDate !== snapshot.tradingDate
    || at(adaptive.evaluatedAt) > at(snapshot.asOf) || at(adaptive.cutoffAt) !== midnight(snapshot.tradingDate)
    || !isPaperMorningSourceTime(snapshot.asOf) || snapshot.marketOpen
    || new Set(openSymbols).size !== openSymbols.length
    || snapshot.observations.some(item => !observationKnown(item, snapshot.asOf, true))
    || adaptive.exploration?.rules.some(trial => at(trial.registeredAt) > at(snapshot.asOf))
    || (snapshot.disclosures && (at(snapshot.disclosures.checkedAt) > at(snapshot.asOf)
      || (snapshot.disclosures.lastSuccessAt !== null && at(snapshot.disclosures.lastSuccessAt) > at(snapshot.asOf))))) invalid();
}

function validPick(pick: PaperMorningReport['picks'][number], report: PaperMorningReport): boolean {
  const sourceAt = report.sourceAsOf!, { observation: item, candidate: selected, referenceClose, trial } = pick;
  const rule = selected.rule;
  if (pick.symbol !== item.symbol || pick.name !== item.name || !observationKnown(item, sourceAt)
    || !item.features || item.issue !== undefined || item.price === null
    || toKstDateKey(item.observedAt) !== report.tradingDate
    || toKstDateKey(item.features.asOf) !== report.tradingDate
    || referenceClose.tradingDate >= report.tradingDate || item.features.technicalDate !== referenceClose.tradingDate
    || at(referenceClose.availableAt) > at(sourceAt)
    || at(referenceClose.availableAt) < at(`${referenceClose.tradingDate}T15:30:00+09:00`)
    || item.dailyCloses.filter(bar => bar.tradingDate === referenceClose.tradingDate).length !== 1
    || !item.dailyCloses.some(bar => isDeepStrictEqual(bar, referenceClose))
    || adaptiveFeatureValue(item, rule.feature, sourceAt, rule.invention) !== pick.ruleValue
    || !adaptiveRuleMatches(item, rule, sourceAt)) return false;
  if (pick.purpose === 'VALIDATED') return selected.active && selected.reason === 'ACTIVE' && !trial
    && (!rule.invention || at(rule.invention.createdAt) < at(report.adaptiveCutoffAt!));
  return !selected.active && ['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'FORWARD_OBSERVATION'].includes(selected.reason)
    && Boolean(trial && toKstDateKey(trial.registeredAt) === report.tradingDate && at(trial.registeredAt) < at(item.observedAt)
      && at(trial.registeredAt) < at(item.features!.asOf)
      && /^shadow-exploration-v1:\d{4}-\d{2}-\d{2}:[1-9]\d*:/.test(trial.id)
      && trial.id === `shadow-exploration-v1:${report.tradingDate}:${trial.id.split(':')[2]}:${adaptiveRuleId(rule)}`
      && (!rule.invention || at(rule.invention.createdAt) <= at(trial.registeredAt)));
}

export function assertPaperMorningReport(value: unknown): asserts value is PaperMorningReport {
  if (!reportSchema.safeParse(value).success) invalid();
  const report = value as PaperMorningReport;
  const metadata = [report.sourceSnapshotId, report.sourceAsOf, report.adaptiveEvaluatedAt, report.adaptiveCutoffAt];
  const hasSource = metadata.every(item => item !== null), noSource = metadata.every(item => item === null);
  if (report.id !== `paper:recommendation:${report.tradingDate}`
    || at(report.scheduledAt) !== at(`${report.tradingDate}T08:30:00+09:00`)
    || at(report.createdAt) < at(report.scheduledAt) || toKstDateKey(report.createdAt) !== report.tradingDate
    || (!hasSource && !noSource) || report.heldCount > report.consideredCount
    || report.matchedCount > report.consideredCount - report.heldCount || report.picks.length > report.matchedCount
    || new Set(report.picks.map(pick => pick.symbol)).size !== report.picks.length
    || report.picks.some((pick, index) => pick.rank !== index + 1)
    || (report.status === 'READY' ? !report.picks.length || !hasSource || report.picks.length !== Math.min(3, report.matchedCount) : report.picks.length !== 0)
    || (report.status === 'DATA_UNAVAILABLE' && report.consideredCount !== 0)
    || (report.status === 'NO_MATCH' && (!hasSource || report.matchedCount !== 0))
    || (report.status === 'HOLIDAY' && (!noSource || report.consideredCount !== 0))
    || (noSource && (report.consideredCount !== 0 || report.matchedCount !== 0 || report.heldCount !== 0))
    || (report.delivery && at(report.delivery.sentAt) < at(report.createdAt))) invalid();
  if (hasSource && (!isPaperMorningSourceTime(report.sourceAsOf!) || toKstDateKey(report.sourceAsOf!) !== report.tradingDate
    || toKstDateKey(report.adaptiveEvaluatedAt!) !== report.tradingDate || at(report.adaptiveEvaluatedAt!) > at(report.sourceAsOf!)
    || at(report.adaptiveCutoffAt!) !== midnight(report.tradingDate)
    || report.picks.some(pick => !validPick(pick, report)))) invalid();
}
