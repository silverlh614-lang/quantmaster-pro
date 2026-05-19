// @responsibility Regime-specific Shadow Learning Bank (diagnostic/read-only).
import { loadCounterfactualShadowLearningLedger } from '../persistence/counterfactualShadowLearningRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadGhostPortfolio } from '../persistence/reflectionRepo.js';
import { loadAttributionRecords, type ServerAttributionRecord } from '../persistence/attributionRepo.js';
import { getRegimeDiagnostics } from '../trading/regimeBridge.js';
import { deriveRegimePhase, isRegimePhase, normalizeRegimeContext } from '../shadow/regimeContext.js';
import { shadowCaseLedger, type ShadowCaseLedgerStore } from '../shadow/shadowCaseLedger.js';
import type { ShadowCase } from '../shadow/shadowTypes.js';
import { formatEngineRuntimePolicy, resolveEngineRuntimePolicy } from '../runtime/engineRuntimePolicy.js';
import { loadCounterfactuals, type CounterfactualEntry } from './counterfactualShadow.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { LEARNING_DEFAULT_MAX_HOLDING_MINUTES } from './learningConstants.js';
import { inferLearningCohort, learningEntryPrice } from './learningSampleQuality.js';
import { regimeUnknownRepairDryRun } from './regimeLearningBackfill.js';
import {
  loadRegimeResolvedTransitionState,
  markRegimeAttributionRecalcHandled,
  type RegimeResolvedTransitionState,
} from './regimeResolvedTransitionStore.js';
import type { LearningGhostCase } from './learningTypes.js';
import {
  REGIME_LEARNING_PHASES,
  type CollectRegimeLearningInput,
  type OverfitRisk,
  type RegimeAttributionConfidence,
  type RegimeAttributionRecalcResult,
  type RegimeConditionAttribution,
  type RegimeConditionDirection,
  type RegimeCounterfactualEntry,
  type RegimeExpectancyConfidence,
  type RegimeLearningBank,
  type RegimeLearningConsistency,
  type RegimeLearningQuality,
  type RegimeLearningQualityStatus,
  type RegimeLearningStats,
  type RegimeMaturityByRegime,
  type RegimePhase,
  type RegimeResolvedStatus,
  type RegimeResolvedStatusRow,
  type RegimeSourceFamilyStats,
} from './regimeLearningTypes.js';

export { REGIME_LEARNING_PHASES } from './regimeLearningTypes.js';
export type * from './regimeLearningTypes.js';

const CLOSED_LABELS = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED']);
const RESOLVED_LABELS = new Set([
  ...CLOSED_LABELS,
  'MISSED_WIN',
  'AVOIDED_LOSS',
  'GOOD_BLOCK',
  'BAD_BLOCK',
  'NEUTRAL_BLOCK',
]);
const QUARANTINED_LABELS = new Set(['QUARANTINED', 'DATA_INSUFFICIENT', 'DATA_CORRUPTED', 'INVALID']);
const CF_LABELS = ['MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK', 'DATA_INSUFFICIENT', 'QUARANTINED', 'PENDING_OUTCOME'];
export const R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION = 100;

function round(n: number, digits = 4): number {
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
}

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function pct(n: number, d: number): number {
  return d > 0 ? round(n / d, 4) : 0;
}

function normalizePhaseValue(value: unknown): RegimePhase | undefined {
  return isRegimePhase(value) ? String(value).toUpperCase() as RegimePhase : undefined;
}

function freqTop(map: Map<string, number>, limit = 5): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function returnR(c: ShadowCase): number {
  if (typeof c.returnR === 'number' && Number.isFinite(c.returnR)) return c.returnR;
  if (typeof c.finalReturnPct === 'number' && Number.isFinite(c.finalReturnPct)) return c.finalReturnPct / 100;
  if (typeof c.currentReturnPct === 'number' && Number.isFinite(c.currentReturnPct)) return c.currentReturnPct / 100;
  return 0;
}

function scoreDataQuality(c: ShadowCase): number {
  if (c.dataHealth === 'OK' || c.confidenceLevel === 'VERIFIED') return 1;
  if (c.dataHealth === 'STALE') return 0.65;
  if (c.dataHealth === 'DEGRADED' || c.confidenceLevel === 'FALLBACK') return 0.5;
  if (c.dataHealth === 'EMPTY' || c.dataHealth === 'UNAVAILABLE') return 0.2;
  if (c.dataHealth === 'CORRUPTED' || c.confidenceLevel === 'QUARANTINED') return 0;
  return 0.5;
}

function sourceConfidenceOfCase(c: ShadowCase): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  if (c.regimeRecoveryConfidence) return c.regimeRecoveryConfidence;
  if (phaseForShadowCase(c) === 'UNKNOWN') return 'UNKNOWN';
  if (c.sourceConfidence === 'VERIFIED' || c.sourceConfidence === 'CALCULATED' || c.confidenceLevel === 'VERIFIED') return 'HIGH';
  if (c.sourceConfidence === 'EXTERNAL_API') return 'MEDIUM';
  if (c.sourceConfidence === 'FALLBACK' || c.confidenceLevel === 'LOW' || c.confidenceLevel === 'FALLBACK') return 'LOW';
  return 'UNKNOWN';
}

function sourceConfidenceOfCounterfactual(e: RegimeCounterfactualEntry): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  const row = e as RegimeCounterfactualEntry & { regimeRecoveryConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' };
  if (row.regimeRecoveryConfidence) return row.regimeRecoveryConfidence;
  return phaseForCounterfactual(e) === 'UNKNOWN' ? 'UNKNOWN' : 'HIGH';
}

function phaseForShadowCase(c: ShadowCase): RegimePhase {
  return normalizePhaseValue(c.regimeAtSignal) ?? c.regimePhase ?? deriveRegimePhase({
    rawRegime: c.rawRegime ?? c.regimeTag,
    effectiveRegime: c.effectiveRegime ?? c.regimeTag,
    engineMode: c.engineMode,
    marketSession: c.marketSession,
    sellOnlyActive: c.sellOnlyActive,
    hardBlockActive: c.hardBlockActive,
    blockedReason: c.blockedReason,
    sourceFreshness: c.sourceFreshness,
    regimeConfidence: c.regimeConfidence,
  });
}

function phaseForCounterfactual(e: RegimeCounterfactualEntry): RegimePhase {
  const legacy = e as RegimeCounterfactualEntry & { blockedReason?: string; skipReason?: string };
  const entryPhase = normalizePhaseValue(e.entryRegime)
    ?? normalizePhaseValue(e.regimeAtEntry)
    ?? normalizePhaseValue(e.regimeAtSignal);
  if (entryPhase) return entryPhase;
  const entryRegime = e.entryRegime ?? e.regimeAtEntry?.toString() ?? e.regimeAtSignal?.toString();
  const derivedEntryPhase = entryRegime
    ? deriveRegimePhase({ rawRegime: entryRegime, effectiveRegime: e.entryEffectiveState ?? entryRegime })
    : undefined;
  if (derivedEntryPhase && derivedEntryPhase !== 'UNKNOWN') return derivedEntryPhase;
  return e.regimePhase ?? deriveRegimePhase({
    rawRegime: entryRegime ?? e.rawRegime ?? e.regime,
    effectiveRegime: e.entryEffectiveState ?? entryRegime ?? e.effectiveRegime ?? e.regime,
    engineMode: e.engineMode,
    marketSession: e.marketSession,
    sellOnlyActive: e.sellOnlyActive,
    hardBlockActive: e.hardBlockActive,
    blockedReason: e.blockedBy?.[0] ?? legacy.blockedReason ?? legacy.skipReason,
    sourceFreshness: e.sourceFreshness,
    regimeConfidence: e.regimeConfidence,
  });
}

function counterfactualReturnR(e: RegimeCounterfactualEntry): number | undefined {
  const row = e as RegimeCounterfactualEntry & {
    outcomeR?: number;
    returnR?: number;
    finalReturnR?: number;
    currentReturnR?: number;
  };
  for (const value of [row.outcomeR, row.returnR, row.finalReturnR, row.currentReturnR]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function conditionTags(c: ShadowCase): string[] {
  const tags = c.conditionTags?.filter(Boolean) ?? [];
  if (tags.length > 0) return tags;
  if (c.learningTag) return [c.learningTag];
  return [];
}

function isResolvedLabel(label: string | undefined): boolean {
  return !!label && RESOLVED_LABELS.has(label);
}

function isQuarantinedCase(c: ShadowCase): boolean {
  return c.cohortType === 'QUARANTINED'
    || c.dataHealth === 'CORRUPTED'
    || c.confidenceLevel === 'QUARANTINED'
    || !!c.quarantinedReason
    || QUARANTINED_LABELS.has(c.outcomeLabel ?? '');
}

function isPendingOpenCase(c: ShadowCase): boolean {
  return !c.outcomeLabel
    || c.outcomeLabel === 'ACTIVE'
    || c.state === 'SHADOW_POSITION_OPENED'
    || c.state === 'SHADOW_MONITORING';
}

function isAttributableCase(c: ShadowCase, regimePhase: RegimePhase): boolean {
  if (!CLOSED_LABELS.has(c.outcomeLabel ?? '')) return false;
  if (isQuarantinedCase(c)) return false;
  if (regimePhase !== 'UNKNOWN' && sourceConfidenceOfCase(c) === 'UNKNOWN') return false;
  return true;
}

function qualityStatus(input: {
  totalSampleSize: number;
  resolvedSampleSize: number;
  attributableSampleSize: number;
  pendingRatio: number;
  dataQualityScore: number;
  sourceConfidenceHighRatio: number;
  overfitRisk: OverfitRisk;
}): RegimeLearningQualityStatus {
  if (input.totalSampleSize === 0) return 'NO_SAMPLE';
  if (input.resolvedSampleSize === 0) return 'LOW_RESOLVED_SAMPLE';
  if (input.resolvedSampleSize < 30) return 'LOW_RESOLVED_SAMPLE';
  if (input.attributableSampleSize < 30) return 'ATTRIBUTION_INSUFFICIENT';
  if (input.pendingRatio > 0.5) return 'PENDING_DOMINATED';
  if (input.sourceConfidenceHighRatio < 0.7) return 'LOW_CONFIDENCE';
  if (input.dataQualityScore < 0.8) return 'DATA_QUALITY_LOW';
  if (input.overfitRisk !== 'LOW') return 'OVERFIT_RISK';
  if (input.totalSampleSize < 70) return 'LEARNING';
  if (input.totalSampleSize >= 100 && input.resolvedSampleSize >= 100 && input.sourceConfidenceHighRatio >= 0.8) return 'STABLE_CANDIDATE';
  return 'DIAGNOSTIC_READY';
}

function expectancyConfidence(resolvedReturnSamples: number): RegimeExpectancyConfidence {
  if (resolvedReturnSamples === 0) return 'N/A';
  if (resolvedReturnSamples < 30) return 'VERY_LOW';
  if (resolvedReturnSamples < 70) return 'LOW';
  if (resolvedReturnSamples < 100) return 'MEDIUM';
  return 'HIGH';
}

function attributionConfidence(attributableSampleSize: number): RegimeAttributionConfidence {
  if (attributableSampleSize < 30) return 'INSUFFICIENT';
  if (attributableSampleSize < 70) return 'LOW';
  return 'ENOUGH_FOR_REVIEW';
}

function reliabilityWarning(
  regimePhase: RegimePhase,
  resolvedSampleSize: number,
  pendingCounterfactualCount: number,
  totalSampleSize: number,
): string | undefined {
  if (regimePhase === 'R2_EARLY' && resolvedSampleSize < 30) return '초기장 조건 귀인 불충분';
  if (regimePhase === 'R3_EXPANSION' && pct(pendingCounterfactualCount, totalSampleSize) > 0.5) return '확장장 샘플 대부분 counterfactual maturity 대기';
  if (regimePhase === 'R6_DEFENSE' && resolvedSampleSize === 0) return 'R6 생존 패턴은 아직 라벨링 전';
  if (regimePhase === 'UNKNOWN') return 'UNKNOWN samples are excluded from promotion metrics';
  return undefined;
}

function whyNotReliable(input: {
  regimePhase: RegimePhase;
  resolvedSampleSize: number;
  pendingCounterfactualCount: number;
  attributableSampleSize: number;
  sourceConfidenceHighRatio: number;
  totalSampleSize: number;
}): string {
  if (input.totalSampleSize === 0) return 'No samples yet.';
  if (input.regimePhase === 'UNKNOWN') return 'UNKNOWN samples are excluded from promotion metrics; sourceConfidence=UNKNOWN.';
  if (input.regimePhase === 'R6_DEFENSE' && input.resolvedSampleSize < R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION) {
    return `Only ${input.resolvedSampleSize}/${R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION} resolved R6 samples; ${input.pendingCounterfactualCount} counterfactual cases still pending maturity.`;
  }
  if (input.resolvedSampleSize === 0) return `No resolved ${input.regimePhase} samples yet.`;
  if (input.resolvedSampleSize < 30) {
    return `Only ${input.resolvedSampleSize} resolved samples; ${input.pendingCounterfactualCount} counterfactual cases still pending maturity.`;
  }
  if (input.attributableSampleSize < 30) return `Only ${input.attributableSampleSize} attributable resolved samples; condition attribution is insufficient.`;
  if (pct(input.pendingCounterfactualCount, input.totalSampleSize) > 0.5) return `${input.pendingCounterfactualCount} counterfactual cases dominate the bank; wait for maturity.`;
  if (input.sourceConfidenceHighRatio < 0.7) return `High-confidence source ratio ${input.sourceConfidenceHighRatio} is below 0.7.`;
  return 'Diagnostic sample quality is usable; recommendationOnly remains true.';
}

function nextQualityAction(s: Pick<RegimeLearningStats, 'regimePhase' | 'resolvedSampleSize' | 'pendingCounterfactualCount' | 'totalSampleSize' | 'attributableSampleSize' | 'qualityStatus'>): string {
  if (s.regimePhase === 'UNKNOWN') return 'REDUCE_UNKNOWN';
  if (s.regimePhase === 'R6_DEFENSE' && s.resolvedSampleSize < R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION) {
    return s.pendingCounterfactualCount > 0 ? 'WAIT_R6_COUNTERFACTUAL_MATURITY' : 'COLLECT_R6_COUNTERFACTUAL_ENTRY';
  }
  if (pct(s.pendingCounterfactualCount, s.totalSampleSize) > 0.5) return 'WAIT_COUNTERFACTUAL_MATURITY';
  if (s.attributableSampleSize < 30) return 'COLLECT_RESOLVED_ATTRIBUTABLE_SAMPLES';
  if (s.qualityStatus === 'LOW_CONFIDENCE') return 'IMPROVE_REGIME_SOURCE_CONFIDENCE';
  return 'OBSERVE_DIAGNOSTIC_ONLY';
}

function formatExpectancy(s: Pick<RegimeLearningStats, 'expectancyR' | 'expectancyReason'>): string {
  return s.expectancyReason === 'NO_RESOLVED_SAMPLE' ? 'N/A' : String(s.expectancyR);
}

function patternText(phase: RegimePhase, kind: 'best' | 'worst', seed?: string, sector?: string): string {
  const positive = seed || sector || 'N/A';
  if (phase === 'R2_EARLY') return kind === 'best'
    ? `R2 early leader pattern: ${positive} + volume accumulation / first breakout`
    : 'R2 failure pattern: false start without follow-through accumulation';
  if (phase === 'R6_DEFENSE') return kind === 'best'
    ? `R6 survivor pattern: ${positive} + index drawdown defense / supply retention / next-session recovery`
    : `R6 failure pattern: ${positive} with dead-cat bounce risk and recovery failure`;
  if (phase === 'R3_EXPANSION') return kind === 'best'
    ? `R3 trend continuation pattern: ${positive} + VCP breakout / pullback buy confirmation`
    : 'R3 failure pattern: overheated breakout without supply follow-through';
  if (phase === 'R1_RECOVERY') return kind === 'best'
    ? `R1 reversal pattern: ${positive}`
    : 'R1 failure pattern: weak bounce without accumulation';
  if (phase === 'R4_NEUTRAL') return kind === 'best'
    ? `R4 chop-avoidance pattern: ${positive}`
    : 'R4 failure pattern: chasing directionless breakout';
  return kind === 'best' ? `bestPattern=${positive}` : `worstPattern=${positive}`;
}

function buildConditionAttribution(
  regimePhase: RegimePhase,
  cases: ShadowCase[],
): RegimeConditionAttribution[] {
  const byCondition = new Map<string, ShadowCase[]>();
  const closed = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  for (const c of cases) {
    for (const tag of conditionTags(c)) {
      const rows = byCondition.get(tag) ?? [];
      rows.push(c);
      byCondition.set(tag, rows);
    }
  }
  return [...byCondition.entries()]
    .map(([conditionId, rows]) => {
      const highClosed = rows.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
      const highIds = new Set(rows.map((c) => c.caseId));
      const lowClosed = closed.filter((c) => !highIds.has(c.caseId));
      const highSamples = highClosed.length;
      const lowSamples = lowClosed.length;
      const highReturns = highClosed.map(returnR);
      const lowReturns = lowClosed.map(returnR);
      const avgReturnR = round(avg(highReturns));
      const lowAvg = round(avg(lowReturns));
      const effect: number | 'N/A' = highSamples + lowSamples === 0 ? 'N/A' : round(avgReturnR - lowAvg);
      const samples = rows.length;
      const wins = highClosed.filter((c) => c.outcomeLabel === 'WIN').length;
      const losses = highClosed.filter((c) => c.outcomeLabel === 'LOSS').length;
      const winRate = pct(wins, wins + losses);
      const direction: RegimeConditionDirection =
        samples < 30 ? 'INSUFFICIENT_SAMPLE'
          : effect === 'N/A' ? 'NOISE'
            : avgReturnR > 0 && winRate >= pct(closed.filter((c) => c.outcomeLabel === 'WIN').length, closed.filter((c) => c.outcomeLabel === 'WIN' || c.outcomeLabel === 'LOSS').length) ? 'ALPHA_DRIVER'
              : avgReturnR >= 0 && effect > 0 ? 'RISK_PROTECTOR'
                : avgReturnR < 0 && samples >= 30 ? 'FALSE_COMFORT'
                  : 'NOISE';
      const confidence = samples < 30 ? 'LOW_SAMPLE' as const : samples < 70 ? 'LOW_CONFIDENCE' as const : 'ENOUGH_FOR_REVIEW' as const;
      return {
        conditionId,
        conditionName: conditionId.replace(/^condition:/, ''),
        regimePhase,
        samples,
        highSamples,
        lowSamples,
        winRate,
        expectancyR: avgReturnR,
        effect,
        avgReturnR,
        confidence,
        minSamplePassed: samples >= 30,
        overfitFlag: samples < 30,
        direction,
        recommendation: samples < 30
          ? 'INSUFFICIENT_SAMPLE_NO_WEIGHT_UPDATE'
          : samples < 70
            ? 'LOW_CONFIDENCE_NO_WEIGHT_UPDATE_RECOMMENDATION_ONLY'
            : 'recommendationOnly',
      };
    })
    .sort((a, b) => b.samples - a.samples || b.avgReturnR - a.avgReturnR);
}

function cfLabel(e: RegimeCounterfactualEntry): string {
  if ('outcomeLabel' in e && e.outcomeLabel) return e.outcomeLabel;
  if ('label' in e && e.label && CF_LABELS.includes(e.label)) return e.label;
  if ('outcomeStatus' in e && e.outcomeStatus === 'QUARANTINED') return 'QUARANTINED';
  if ('outcomeStatus' in e && e.outcomeStatus === 'DATA_INSUFFICIENT') return 'DATA_INSUFFICIENT';
  return 'PENDING_OUTCOME';
}

function cfCreatedAt(e: RegimeCounterfactualEntry): string | undefined {
  const row = e as RegimeCounterfactualEntry & {
    signalTime?: string;
    createdAt?: string;
    createdAtKst?: string;
    signalDate?: string;
  };
  return row.signalTime ?? row.createdAt ?? row.createdAtKst ?? (row.signalDate ? `${row.signalDate}T00:00:00.000Z` : undefined);
}

function cfMaxHoldingMinutes(e: RegimeCounterfactualEntry): number {
  const row = e as RegimeCounterfactualEntry & { maxHoldingMinutes?: number };
  return typeof row.maxHoldingMinutes === 'number' && Number.isFinite(row.maxHoldingMinutes) && row.maxHoldingMinutes > 0
    ? row.maxHoldingMinutes
    : LEARNING_DEFAULT_MAX_HOLDING_MINUTES;
}

function addKstDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T03:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toKstDateKey(d);
}

function nextKrxTradingDay(dateKey: string): string | undefined {
  for (let i = 1; i <= 21; i++) {
    const key = addKstDays(dateKey, i);
    if (isKrxTradingDay(key)) return key;
  }
  return undefined;
}

function pendingMaturityAt(e: RegimeCounterfactualEntry): string | undefined {
  const row = e as RegimeCounterfactualEntry & { maturityAt?: string };
  if (row.maturityAt) return row.maturityAt;
  const createdAt = cfCreatedAt(e);
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(createdMs)) return undefined;
  return new Date(createdMs + cfMaxHoldingMinutes(e) * 60_000).toISOString();
}

type RegimeMaturityCounterKey =
  | 'maturedNowCount'
  | 'dueToday'
  | 'dueNextTradingDay'
  | 'dueIn2to3CalendarDays'
  | 'dueIn4to7CalendarDays'
  | 'dueIn8to14CalendarDays'
  | 'dueAfter14CalendarDays';

function maturityBucketFor(iso: string | undefined, now: Date): RegimeMaturityCounterKey | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return undefined;
  if (ms <= now.getTime()) return 'maturedNowCount';
  const nowKey = toKstDateKey(now);
  const maturityKey = toKstDateKey(iso);
  if (maturityKey === nowKey) return 'dueToday';
  const nextTradingDay = nextKrxTradingDay(nowKey);
  if (nextTradingDay && maturityKey === nextTradingDay) return 'dueNextTradingDay';
  const days = Math.ceil((ms - now.getTime()) / 86_400_000);
  if (days <= 3) return 'dueIn2to3CalendarDays';
  if (days <= 7) return 'dueIn4to7CalendarDays';
  if (days <= 14) return 'dueIn8to14CalendarDays';
  return 'dueAfter14CalendarDays';
}

function emptyMaturityRow(regimePhase: RegimePhase): RegimeMaturityByRegime {
  return {
    regimePhase,
    pendingOutcomeCount: 0,
    maturedNowCount: 0,
    dueToday: 0,
    dueNextTradingDay: 0,
    dueIn2to3CalendarDays: 0,
    dueIn4to7CalendarDays: 0,
    dueIn8to14CalendarDays: 0,
    dueAfter14CalendarDays: 0,
    nearestMaturityAt: undefined,
    largestMaturityBucket: 'none',
  };
}

function buildMaturityRows(counterfactuals: RegimeCounterfactualEntry[], now: Date): RegimeMaturityByRegime[] {
  const rows = new Map<RegimePhase, RegimeMaturityByRegime>();
  for (const phase of REGIME_LEARNING_PHASES) rows.set(phase, emptyMaturityRow(phase));
  for (const e of counterfactuals) {
    if (cfLabel(e) !== 'PENDING_OUTCOME') continue;
    const phase = phaseForCounterfactual(e);
    const row = rows.get(phase) ?? emptyMaturityRow(phase);
    rows.set(phase, row);
    row.pendingOutcomeCount++;
    const maturityAt = pendingMaturityAt(e);
    const bucket = maturityBucketFor(maturityAt, now);
    if (bucket) row[bucket]++;
    if (maturityAt && (!row.nearestMaturityAt || new Date(maturityAt).getTime() < new Date(row.nearestMaturityAt).getTime())) {
      row.nearestMaturityAt = maturityAt;
    }
  }
  for (const row of rows.values()) {
    const bucketCounts = {
      maturedNowCount: row.maturedNowCount,
      dueToday: row.dueToday,
      dueNextTradingDay: row.dueNextTradingDay,
      dueIn2to3CalendarDays: row.dueIn2to3CalendarDays,
      dueIn4to7CalendarDays: row.dueIn4to7CalendarDays,
      dueIn8to14CalendarDays: row.dueIn8to14CalendarDays,
      dueAfter14CalendarDays: row.dueAfter14CalendarDays,
    };
    const top = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    row.largestMaturityBucket = top && top[1] > 0 ? top[0] : 'none';
  }
  return [...rows.values()].filter((row) => row.pendingOutcomeCount > 0);
}

function dueWithin(row: RegimeMaturityByRegime, days: 1 | 3 | 7): number {
  if (days === 1) return row.maturedNowCount + row.dueToday + row.dueNextTradingDay;
  if (days === 3) return dueWithin(row, 1) + row.dueIn2to3CalendarDays;
  return dueWithin(row, 3) + row.dueIn4to7CalendarDays;
}

function buildStatsForPhase(
  regimePhase: RegimePhase,
  cases: ShadowCase[],
  counterfactuals: RegimeCounterfactualEntry[],
): RegimeLearningStats {
  const closed = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const resolvedCases = cases.filter((c) => isResolvedLabel(c.outcomeLabel));
  const attributableCases = cases.filter((c) => isAttributableCase(c, regimePhase));
  const wins = closed.filter((c) => c.outcomeLabel === 'WIN');
  const losses = closed.filter((c) => c.outcomeLabel === 'LOSS');
  const breakevens = closed.filter((c) => c.outcomeLabel === 'BREAKEVEN');
  const failureReasons = new Map<string, number>();
  const cfLabels = new Map<string, number>(CF_LABELS.map((label) => [label, 0]));
  const sourceConfidenceBreakdown: Record<string, number> = {};

  for (const c of cases) {
    if (c.outcomeLabel === 'LOSS' || (c.finalReturnPct ?? 0) < 0) {
      const reason = c.blockedReason ?? c.learningTag ?? 'UNKNOWN';
      failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
    }
    sourceConfidenceBreakdown[sourceConfidenceOfCase(c)] = (sourceConfidenceBreakdown[sourceConfidenceOfCase(c)] ?? 0) + 1;
  }
  for (const e of counterfactuals) {
    const label = cfLabel(e);
    cfLabels.set(label, (cfLabels.get(label) ?? 0) + 1);
    for (const b of e.blockedBy ?? []) failureReasons.set(b, (failureReasons.get(b) ?? 0) + 1);
    sourceConfidenceBreakdown[sourceConfidenceOfCounterfactual(e)] = (sourceConfidenceBreakdown[sourceConfidenceOfCounterfactual(e)] ?? 0) + 1;
  }

  const counterfactualLabels = counterfactuals.map(cfLabel);
  const pendingCounterfactualCount = counterfactualLabels.filter((label) => label === 'PENDING_OUTCOME').length;
  const resolvedCounterfactualCount = counterfactualLabels.filter(isResolvedLabel).length;
  const resolvedCounterfactualReturns = counterfactuals
    .filter((entry) => isResolvedLabel(cfLabel(entry)))
    .map(counterfactualReturnR)
    .filter((value): value is number => value !== undefined);
  const quarantinedCounterfactualCount = counterfactualLabels.filter((label) => QUARANTINED_LABELS.has(label)).length;
  const pendingOpenCount = cases.filter(isPendingOpenCase).length;
  const quarantinedCaseCount = cases.filter(isQuarantinedCase).length;
  const pendingShadowCount = cases.filter((c) => !isResolvedLabel(c.outcomeLabel) && !isQuarantinedCase(c) && c.cohortType !== 'COUNTERFACTUAL_BLOCKED').length;
  const totalSampleSize = cases.length + counterfactuals.length;
  const sampleSize = totalSampleSize;
  const resolvedSampleSize = resolvedCases.length + resolvedCounterfactualCount;
  const returns = [...closed.map(returnR), ...resolvedCounterfactualReturns];
  const closedOutcomeCount = closed.length;
  const attributableSampleSize = attributableCases.length;
  const unresolvedRatio = pct(totalSampleSize - resolvedSampleSize, totalSampleSize);
  const resolvedRatio = pct(resolvedSampleSize, totalSampleSize);
  const pendingRatio = pct(pendingCounterfactualCount, totalSampleSize);
  const quarantinedCount = quarantinedCaseCount + quarantinedCounterfactualCount;
  const attributionSourceRows = attributableCases.length > 0 ? attributableCases : [];
  const attributionSectorGroups = new Map<string, ShadowCase[]>();
  const attributionTimeWindowGroups = new Map<string, ShadowCase[]>();
  const attributionMarketSessionGroups = new Map<string, ShadowCase[]>();
  for (const c of attributionSourceRows) {
    const sector = c.sectorTag ?? 'UNKNOWN';
    attributionSectorGroups.set(sector, [...(attributionSectorGroups.get(sector) ?? []), c]);
    const timeWindow = c.timeWindowTag ?? 'UNKNOWN';
    attributionTimeWindowGroups.set(timeWindow, [...(attributionTimeWindowGroups.get(timeWindow) ?? []), c]);
    const session = c.marketSession ?? 'UNKNOWN';
    attributionMarketSessionGroups.set(session, [...(attributionMarketSessionGroups.get(session) ?? []), c]);
  }

  const allSectors = [...attributionSectorGroups.entries()]
    .map(([sector, rows]) => ({ sector, samples: rows.length, expectancyR: round(avg(rows.map(returnR))) }))
    .sort((a, b) => b.expectancyR - a.expectancyR || b.samples - a.samples);
  const sortedReturns = [...closed].sort((a, b) => returnR(b) - returnR(a));
  const conditionAttributions = buildConditionAttribution(regimePhase, attributableCases);
  const topPositiveConditions = conditionAttributions
    .filter((c) => c.avgReturnR >= 0 && c.direction !== 'INSUFFICIENT_SAMPLE')
    .sort((a, b) => b.expectancyR - a.expectancyR || b.samples - a.samples)
    .slice(0, 5);
  const topNegativeConditions = conditionAttributions
    .filter((c) => c.avgReturnR < 0 && c.direction !== 'INSUFFICIENT_SAMPLE')
    .sort((a, b) => a.expectancyR - b.expectancyR || b.samples - a.samples)
    .slice(0, 5);
  const lowSampleConditions = conditionAttributions.filter((c) => c.direction === 'INSUFFICIENT_SAMPLE').slice(0, 10);
  const unstableConditions = conditionAttributions.filter((c) => c.confidence === 'LOW_CONFIDENCE' || c.overfitFlag).slice(0, 10);
  const overfitRisk: OverfitRisk = attributableSampleSize < 30 ? 'HIGH' : attributableSampleSize < 70 ? 'MEDIUM' : 'LOW';
  const labelCompletionRate = resolvedRatio;
  const dataQualityScore = cases.length > 0 ? round(avg(cases.map(scoreDataQuality))) : 1;
  const highConfidenceCount = (sourceConfidenceBreakdown.HIGH ?? 0);
  const sourceConfidenceHighRatio = pct(highConfidenceCount, sampleSize);
  const unknownConfidenceCount = (sourceConfidenceBreakdown.UNKNOWN ?? 0);
  const unknownRatio = pct(unknownConfidenceCount, sampleSize);
  const conditionCoverage = pct(conditionAttributions.length, Math.max(sampleSize, 1));
  const counterfactualCoverage = pct(counterfactuals.length + cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded).length, sampleSize);
  const freshShadowCoverage = pct(cases.filter((c) => c.cohortType === 'FRESH_SHADOW').length, sampleSize);
  const status = qualityStatus({
    totalSampleSize,
    resolvedSampleSize,
    attributableSampleSize,
    pendingRatio,
    dataQualityScore,
    sourceConfidenceHighRatio,
    overfitRisk,
  });
  const statExpectancyConfidence = expectancyConfidence(returns.length);
  const statAttributionConfidence = attributionConfidence(attributableSampleSize);
  const statWhyNotReliable = whyNotReliable({
    regimePhase,
    resolvedSampleSize,
    pendingCounterfactualCount,
    attributableSampleSize,
    sourceConfidenceHighRatio,
    totalSampleSize,
  });
  const statReliabilityWarning = reliabilityWarning(regimePhase, resolvedSampleSize, pendingCounterfactualCount, totalSampleSize);
  const expectancyReason = returns.length === 0 ? 'NO_RESOLVED_SAMPLE' as const : undefined;
  const quality: RegimeLearningQuality = {
    regimePhase,
    sampleSize,
    totalSampleSize,
    resolvedSampleSize,
    closedOutcomeCount,
    pendingCounterfactualCount,
    pendingShadowCount,
    pendingOpenCount,
    quarantinedCount,
    attributableSampleSize,
    unresolvedRatio,
    resolvedRatio,
    pendingRatio,
    closedSampleCount: closedOutcomeCount,
    labelCompletionRate,
    sourceConfidenceHighRatio,
    unknownRatio,
    dataQualityScore,
    conditionCoverage,
    counterfactualCoverage,
    freshShadowCoverage,
    overfitRisk,
    qualityStatus: status,
  };
  const bestTimeWindow = [...attributionTimeWindowGroups.entries()].map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) })).sort((a, b) => b.value - a.value)[0]?.key;
  const worstTimeWindow = [...attributionTimeWindowGroups.entries()].map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) })).sort((a, b) => a.value - b.value)[0]?.key;
  const bestMarketSession = [...attributionMarketSessionGroups.entries()].map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) })).sort((a, b) => b.value - a.value)[0]?.key;
  const bestConditionCombo = topPositiveConditions.slice(0, 2).map((c) => c.conditionId).join('+') || undefined;
  const worstConditionCombo = topNegativeConditions.slice(0, 2).map((c) => c.conditionId).join('+') || undefined;
  const bestSector = allSectors[0]?.sector;
  const worstSector = allSectors.at(-1)?.sector;
  const bestPattern = patternText(regimePhase, 'best', bestConditionCombo, bestSector);
  const worstPattern = patternText(regimePhase, 'worst', worstConditionCombo, worstSector);
  const familyStats = (rows: ShadowCase[], extraSampleSize = 0): RegimeSourceFamilyStats => {
    const familyClosed = rows.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
    return {
      sampleSize: rows.length + extraSampleSize,
      closedCount: familyClosed.length,
      expectancyR: round(avg(familyClosed.map(returnR))),
    };
  };
  const freshRows = cases.filter((c) => c.cohortType === 'FRESH_SHADOW');
  const ghostRows = cases.filter((c) => c.cohortType === 'GHOST_REPAIR');
  const counterfactualRows = cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded);
  const outcomeRows = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const attributionRows = cases.filter((c) => c.cohortType === 'BACKLOG_REPAIR' && c.caseId.startsWith('trade:'));

  return {
    regimePhase,
    sampleSize,
    totalSampleSize,
    resolvedSampleSize,
    closedOutcomeCount,
    pendingCounterfactualCount,
    pendingShadowCount,
    pendingOpenCount,
    quarantinedCount,
    attributableSampleSize,
    unresolvedRatio,
    resolvedRatio,
    pendingRatio,
    freshShadowCount: cases.filter((c) => c.cohortType === 'FRESH_SHADOW').length,
    counterfactualCount: cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded).length + counterfactuals.length,
    ghostRepairCount: cases.filter((c) => c.cohortType === 'GHOST_REPAIR').length,
    closedCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakevens.length,
    winRate: pct(wins.length, wins.length + losses.length),
    avgReturnR: round(avg(returns)),
    expectancyR: round(avg(returns)),
    avgMFE: round(avg(cases.map((c) => c.mfe ?? 0))),
    avgMAE: round(avg(cases.map((c) => c.mae ?? 0))),
    avgHoldingMinutes: round(avg(closed.map((c) => c.holdingMinutes ?? 0)), 2),
    labelCompletionRate,
    dataQualityScore,
    sourceConfidenceHighRatio,
    unknownRatio,
    conditionCoverage,
    counterfactualCoverage,
    freshShadowCoverage,
    overfitRisk,
    qualityStatus: status,
    expectancyConfidence: statExpectancyConfidence,
    attributionConfidence: statAttributionConfidence,
    expectancyReason,
    whyNotReliable: statWhyNotReliable,
    reliabilityWarning: statReliabilityWarning,
    quality,
    promotionStage: attributableSampleSize >= 30 && labelCompletionRate > 0 ? 'ADVISORY' : 'SHADOW_SCORE',
    promotionAllowed: false,
    diagnosticOnly: true,
    recommendationOnly: true,
    topCondition: topPositiveConditions[0]?.conditionId,
    worstCondition: topNegativeConditions[0]?.conditionId,
    bestSector,
    worstSector,
    topSector: allSectors[0]?.sector,
    topPositiveConditions,
    topNegativeConditions,
    lowSampleConditions,
    unstableConditions,
    conditionAttributions,
    topSectors: allSectors.slice(0, 5),
    worstSectors: [...allSectors].reverse().slice(0, 5),
    bestSymbols: sortedReturns.slice(0, 5).map((c) => ({ symbol: c.symbol, name: c.symbolName, returnR: round(returnR(c)) })),
    worstSymbols: sortedReturns.slice(-5).reverse().map((c) => ({ symbol: c.symbol, name: c.symbolName, returnR: round(returnR(c)) })),
    commonFailureReasons: freqTop(failureReasons).map(({ key, count }) => ({ reason: key, count })),
    counterfactualLabelBreakdown: Object.fromEntries(cfLabels),
    bestConditionCombo,
    worstConditionCombo,
    bestPattern,
    worstPattern,
    bestTimeWindow,
    worstTimeWindow,
    bestMarketSession,
    commonFailureReason: freqTop(failureReasons, 1)[0]?.key,
    survivorPattern: regimePhase === 'R6_DEFENSE' ? bestPattern : undefined,
    earlyLeaderPattern: regimePhase === 'R2_EARLY' ? bestPattern : undefined,
    volumeAccumulationPattern: regimePhase === 'R2_EARLY' ? `${bestConditionCombo ?? bestSector ?? 'N/A'} + volume accumulation` : undefined,
    firstBreakoutPattern: regimePhase === 'R2_EARLY' ? `${bestConditionCombo ?? 'N/A'} + first breakout` : undefined,
    falseStartRisk: regimePhase === 'R2_EARLY' ? worstPattern : undefined,
    trendContinuationPattern: regimePhase === 'R3_EXPANSION' ? bestPattern : undefined,
    vcpBreakoutPattern: regimePhase === 'R3_EXPANSION' ? `${bestConditionCombo ?? 'N/A'} + VCP breakout` : undefined,
    pullbackBuyPattern: regimePhase === 'R3_EXPANSION' ? `${bestSector ?? 'N/A'} pullback confirmation` : undefined,
    overheatBreakoutRisk: regimePhase === 'R3_EXPANSION' ? worstPattern : undefined,
    breakoutPattern: regimePhase === 'R3_EXPANSION' ? bestPattern : undefined,
    reversalPattern: regimePhase === 'R1_RECOVERY' ? bestPattern : undefined,
    chopAvoidancePattern: regimePhase === 'R4_NEUTRAL' ? bestPattern : undefined,
    drawdownDefensePattern: regimePhase === 'R6_DEFENSE' ? `${bestSector ?? 'N/A'} relative drawdown defense` : undefined,
    recoverySpeedPattern: regimePhase === 'R6_DEFENSE' ? `${bestConditionCombo ?? 'N/A'} next-session recovery` : undefined,
    supplyRetentionPattern: regimePhase === 'R6_DEFENSE' ? `${bestConditionCombo ?? bestSector ?? 'N/A'} supply retention` : undefined,
    deadCatBounceRisk: regimePhase === 'R6_DEFENSE' ? worstPattern : undefined,
    sourceConfidenceBreakdown,
    freshShadowStats: familyStats(freshRows),
    ghostRepairStats: familyStats(ghostRows),
    counterfactualStats: familyStats(counterfactualRows, counterfactuals.length),
    outcomeStats: familyStats(outcomeRows),
    attributionStats: familyStats(attributionRows),
    nextLearningNeed: nextQualityAction({
      regimePhase,
      resolvedSampleSize,
      pendingCounterfactualCount,
      totalSampleSize,
      attributableSampleSize,
      qualityStatus: status,
    }),
    blocker: status === 'STABLE_CANDIDATE' ? undefined : status,
  };
}

function cohortForShadowCase(value: string | undefined): ShadowCase['cohortType'] {
  if (value === 'FRESH_SHADOW') return 'FRESH_SHADOW';
  if (value === 'GHOST_REPAIR') return 'GHOST_REPAIR';
  if (value === 'RECOVERED_METADATA') return 'RECOVERED_METADATA';
  if (value === 'QUARANTINED') return 'QUARANTINED';
  if (value === 'COUNTERFACTUAL_BLOCKED' || value === 'COUNTERFACTUAL_MISSED_WIN' || value === 'COUNTERFACTUAL_AVOIDED_LOSS') return 'COUNTERFACTUAL_BLOCKED';
  return 'BACKLOG_REPAIR';
}

function ghostCaseId(g: LearningGhostCase): string {
  const row = g as LearningGhostCase & { tradeId?: string };
  return row.tradeId ? `trade:${row.tradeId}` : `ghost:${g.id ?? `${g.stockCode}:${g.signalDate}`}`;
}

function shadowFromGhost(g: LearningGhostCase): ShadowCase {
  const detectedAt = g.entryAt ?? `${g.signalDate}T00:00:00.000Z`;
  const conditionTags = Object.keys(g.conditionScores ?? {}).map((id) => `condition:${id}`);
  const entry = learningEntryPrice(g);
  return {
    caseId: ghostCaseId(g),
    signalId: ghostCaseId(g),
    symbol: g.stockCode,
    symbolName: g.stockName,
    detectedAt,
    marketSession: g.marketSession ?? 'UNKNOWN',
    engineMode: (g.engineMode === 'SELL_ONLY' || g.engineMode === 'SHADOW_ONLY' || g.engineMode === 'OBSERVE_ONLY' || g.engineMode === 'DEGRADED') ? g.engineMode : 'NORMAL',
    blockedReason: g.rejectionReason ?? g.quarantinedReason ?? g.closeReason,
    dataHealth: g.dataQuality === 'QUARANTINED' ? 'CORRUPTED' : g.dataQuality === 'MISSING' ? 'EMPTY' : g.dataQuality === 'STALE' ? 'STALE' : 'OK',
    providerHealth: 'OK',
    confidenceLevel: g.regimeRecoveryConfidence === 'UNKNOWN' ? 'FALLBACK' : g.dataQuality === 'QUARANTINED' ? 'QUARANTINED' : 'CALCULATED',
    executionImpact: 'NONE',
    entryPriceVirtual: entry,
    stopPriceVirtual: g.stopPrice,
    targetPriceVirtual: g.targetPrice,
    mfe: g.mfe,
    mae: g.mae,
    currentReturnPct: g.currentReturnPct,
    finalReturnPct: g.finalReturnPct,
    holdingMinutes: (g as LearningGhostCase & { holdingMinutes?: number }).holdingMinutes,
    outcomeLabel: g.outcomeLabel,
    learningTag: g.rejectionReason ?? g.closeReason,
    rawRegime: g.rawRegime ?? (g as LearningGhostCase & { regime?: string }).regime,
    effectiveRegime: g.effectiveRegime ?? (g as LearningGhostCase & { regime?: string }).regime,
    regimePhase: g.regimePhase,
    originalRegimePhase: g.originalRegimePhase,
    regimeAtSignal: g.regimeAtSignal,
    regimeAtEntry: g.regimeAtEntry,
    regimeAtExit: g.regimeAtExit,
    regimeAtOutcome: g.regimeAtOutcome,
    r6Trigger: g.r6Trigger,
    sellOnlyActive: g.sellOnlyActive,
    hardBlockActive: g.hardBlockActive,
    sourceFreshness: g.sourceFreshness,
    conditionTags,
    conditionScores: Object.fromEntries(Object.entries(g.conditionScores ?? {}).map(([k, v]) => [String(k), v])),
    sourceConfidence: g.regimeRecoveryConfidence === 'UNKNOWN' ? 'UNKNOWN' : g.regimeRecoveryConfidence === 'LOW' ? 'FALLBACK' : 'CALCULATED',
    createdAt: detectedAt,
    updatedAt: g.lastUpdatedAt ?? g.closedAt ?? detectedAt,
    cohortType: cohortForShadowCase(inferLearningCohort(g)),
    repairRunId: g.repairRunId,
    pendingRetryReason: g.pendingRetryReason,
    quarantinedReason: g.quarantinedReason,
    returnR: g.returnR,
  };
}

function shadowFromAttribution(r: ServerAttributionRecord): ShadowCase {
  const conditionTags = Object.entries(r.conditionScores ?? {})
    .filter(([, score]) => Number(score) >= 7)
    .map(([id]) => `condition:${id}`);
  return {
    caseId: `trade:${r.tradeId}`,
    signalId: `trade:${r.tradeId}`,
    symbol: r.stockCode,
    symbolName: r.stockName,
    detectedAt: r.closedAt,
    marketSession: r.marketSession ?? 'UNKNOWN',
    engineMode: (r.engineMode === 'SELL_ONLY' || r.engineMode === 'SHADOW_ONLY' || r.engineMode === 'OBSERVE_ONLY' || r.engineMode === 'DEGRADED') ? r.engineMode : 'NORMAL',
    blockedReason: r.sellReason,
    dataHealth: 'OK',
    providerHealth: 'OK',
    confidenceLevel: 'CALCULATED',
    executionImpact: 'NONE',
    finalReturnPct: r.returnPct,
    holdingMinutes: r.holdingDays * 24 * 60,
    outcomeLabel: r.returnPct > 0 ? 'WIN' : r.returnPct < 0 ? 'LOSS' : 'BREAKEVEN',
    learningTag: r.sellReason,
    rawRegime: r.rawRegime ?? r.entryRegime,
    effectiveRegime: r.effectiveRegime ?? r.entryRegime,
    regimePhase: r.regimePhase,
    originalRegimePhase: r.originalRegimePhase,
    regimeAtSignal: r.regimeAtSignal,
    regimeAtEntry: r.regimeAtEntry,
    regimeAtExit: r.regimeAtExit,
    regimeAtOutcome: r.regimeAtOutcome,
    r6Trigger: r.r6Trigger,
    sellOnlyActive: r.sellOnlyActive,
    hardBlockActive: r.hardBlockActive,
    sourceFreshness: r.sourceFreshness,
    conditionTags,
    conditionScores: Object.fromEntries(Object.entries(r.conditionScores ?? {}).map(([k, v]) => [String(k), v])),
    sourceConfidence: r.regimeRecoveryConfidence === 'UNKNOWN' ? 'UNKNOWN' : r.regimeRecoveryConfidence === 'LOW' ? 'FALLBACK' : 'CALCULATED',
    createdAt: r.closedAt,
    updatedAt: r.closedAt,
    cohortType: 'BACKLOG_REPAIR',
    returnR: r.returnPct / 100,
  };
}

function legacyCounterfactual(e: CounterfactualEntry): RegimeCounterfactualEntry {
  return {
    id: e.id,
    counterfactualKey: e.counterfactualKey,
    symbol: e.symbol ?? e.stockCode,
    stockCode: e.stockCode,
    stockName: e.stockName,
    regime: e.regime,
    rawRegime: e.rawRegime,
    effectiveRegime: e.effectiveRegime,
    regimePhase: e.regimePhase,
    originalRegimePhase: e.originalRegimePhase,
    regimeAtSignal: e.regimeAtSignal,
    regimeAtEntry: e.regimeAtEntry,
    regimeAtExit: e.regimeAtExit,
    regimeAtOutcome: e.regimeAtOutcome,
    entryRegime: e.entryRegime,
    entryEffectiveState: e.entryEffectiveState,
    exitRegime: e.exitRegime,
    resolvedAfterRegimeTransition: e.resolvedAfterRegimeTransition,
    transitionPath: e.transitionPath,
    r6LatchDecayAtEntry: e.r6LatchDecayAtEntry,
    mhsAtEntry: e.mhsAtEntry,
    biasAtEntry: e.biasAtEntry,
    supplyScoreAtEntry: e.supplyScoreAtEntry,
    programFlowAtEntry: e.programFlowAtEntry,
    engineMode: e.engineMode,
    marketSession: e.marketSession,
    sellOnlyActive: e.sellOnlyActive,
    hardBlockActive: e.hardBlockActive,
    blockedReason: e.blockedReason,
    skipReason: e.skipReason,
    blockedBy: [e.blockedReason ?? e.skipReason].filter(Boolean) as string[],
    outcomeLabel: e.outcomeLabel,
    outcomeStatus: e.outcomeStatus,
    outcomeR: e.outcomeR,
    maturityWindow: e.maturityWindow,
    resolvedAt: e.resolvedAt ?? e.outcomeResolvedAt,
    regimeRecoveryConfidence: e.regimeRecoveryConfidence,
    regimeRecoverySource: e.regimeRecoverySource,
  };
}

function shouldReadPersisted(input: CollectRegimeLearningInput): boolean {
  return input.includePersistedSources ?? (
    input.shadowCases === undefined
    && input.counterfactualEntries === undefined
    && input.legacyCounterfactualEntries === undefined
    && input.ghostCases === undefined
    && input.attributionRecords === undefined
  );
}

function sourceLaneForCase(c: ShadowCase): string {
  const row = c as ShadowCase & { sourceType?: string };
  return String(c.cohortType ?? (c.counterfactualRecorded ? 'COUNTERFACTUAL_BLOCKED' : row.sourceType ?? 'UNKNOWN'));
}

function normalizedCaseTimestamp(iso: string | undefined): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : (iso ? 'INVALID_TIMESTAMP' : 'MISSING_TIMESTAMP');
}

function entryPriceForIdempotency(c: ShadowCase): string {
  const row = c as ShadowCase & { entryPrice?: number; hypotheticalEntryPrice?: number; priceAtSignal?: number };
  const value = c.entryPriceVirtual ?? row.hypotheticalEntryPrice ?? row.entryPrice ?? row.priceAtSignal;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NO_ENTRY_PRICE';
}

function regimeBankIdempotencyKey(c: ShadowCase): string {
  return [
    c.symbol ?? 'NO_SYMBOL',
    sourceLaneForCase(c),
    normalizedCaseTimestamp(c.detectedAt ?? c.createdAt ?? c.updatedAt),
    entryPriceForIdempotency(c),
    c.caseId,
  ].join('|');
}

function collectCases(input: CollectRegimeLearningInput, ledger: ShadowCaseLedgerStore) {
  const includePersisted = shouldReadPersisted(input);
  const explicitCases = input.shadowCases ?? ledger.listCases();
  const cases: ShadowCase[] = [...explicitCases];
  const seen = new Set(cases.map((c) => c.caseId));
  const seenIdempotencyKeys = new Set(cases.map(regimeBankIdempotencyKey));
  let duplicateCaseCount = 0;
  let duplicatePreventedAtSource = 0;
  let duplicateSuppressedAfterInsert = 0;
  let attributionCaseCount = 0;
  const duplicateSource = new Map<string, number>();
  const duplicateKeySample = new Set<string>();

  const addCase = (c: ShadowCase, fromAttribution = false) => {
    const source = sourceLaneForCase(c);
    const idempotencyKey = regimeBankIdempotencyKey(c);
    if (seenIdempotencyKeys.has(idempotencyKey)) {
      duplicateCaseCount++;
      duplicatePreventedAtSource++;
      duplicateSource.set(source, (duplicateSource.get(source) ?? 0) + 1);
      if (duplicateKeySample.size < 5) duplicateKeySample.add(idempotencyKey);
      return;
    }
    if (seen.has(c.caseId)) {
      duplicateCaseCount++;
      duplicateSuppressedAfterInsert++;
      duplicateSource.set(source, (duplicateSource.get(source) ?? 0) + 1);
      if (duplicateKeySample.size < 5) {
        duplicateKeySample.add(idempotencyKey);
      }
      return;
    }
    seen.add(c.caseId);
    seenIdempotencyKeys.add(idempotencyKey);
    cases.push(c);
    if (fromAttribution) attributionCaseCount++;
  };

  const ghosts = input.ghostCases ?? (includePersisted ? (loadGhostPortfolio() as LearningGhostCase[]) : []);
  for (const g of ghosts) addCase(shadowFromGhost(g));

  const attribution = input.attributionRecords ?? (includePersisted ? loadAttributionRecords() : []);
  for (const r of attribution) addCase(shadowFromAttribution(r), true);

  const ledgerCounterfactuals = input.counterfactualEntries ?? (includePersisted ? loadCounterfactualShadowLearningLedger() : []);
  const legacyCounterfactuals = input.legacyCounterfactualEntries ?? (includePersisted ? loadCounterfactuals() : []);
  const counterfactuals: RegimeCounterfactualEntry[] = [
    ...ledgerCounterfactuals,
    ...legacyCounterfactuals.map(legacyCounterfactual),
  ];

  return {
    cases,
    counterfactuals,
    duplicateCaseCount,
    duplicatePreventedAtSource,
    duplicateSuppressedAfterInsert,
    attributionCaseCount,
    duplicateSource,
    duplicateKeySample: [...duplicateKeySample],
  };
}

export function collectRegimeLearningBank(input: CollectRegimeLearningInput = {}): RegimeLearningBank {
  const now = input.now ?? new Date();
  const ledger = input.ledger ?? shadowCaseLedger;
  const {
    cases,
    counterfactuals,
    duplicateCaseCount,
    duplicatePreventedAtSource,
    duplicateSuppressedAfterInsert,
    attributionCaseCount,
    duplicateSource,
    duplicateKeySample,
  } = collectCases(input, ledger);
  const diagnostics = input.rawRegime && input.effectiveRegime
    ? undefined
    : getRegimeDiagnostics(loadMacroState());
  const rawRegime = input.rawRegime ?? diagnostics?.rawRegime ?? 'UNKNOWN';
  const effectiveRegime = input.effectiveRegime ?? diagnostics?.effectiveRegime ?? rawRegime;
  const activeContext = normalizeRegimeContext({
    rawRegime,
    effectiveRegime,
    sourceFreshness: diagnostics?.sourceFreshness,
    regimeConfidence: diagnostics?.sourceFreshness === 'FRESH' ? 'VERIFIED' : diagnostics?.sourceFreshness,
  });

  const byPhase = new Map<RegimePhase, { cases: ShadowCase[]; counterfactuals: RegimeCounterfactualEntry[] }>();
  for (const phase of REGIME_LEARNING_PHASES) byPhase.set(phase, { cases: [], counterfactuals: [] });
  for (const c of cases) byPhase.get(phaseForShadowCase(c))?.cases.push(c);
  for (const e of counterfactuals) byPhase.get(phaseForCounterfactual(e))?.counterfactuals.push(e);

  const stats = REGIME_LEARNING_PHASES
    .map((phase) => {
      const group = byPhase.get(phase)!;
      return buildStatsForPhase(phase, group.cases, group.counterfactuals);
    })
    .filter((s) => s.sampleSize > 0 || s.regimePhase === activeContext.regimePhase);
  const nonEmpty = stats.filter((s) => s.closedCount > 0 && s.regimePhase !== 'UNKNOWN');
  const best = [...nonEmpty].sort((a, b) => b.expectancyR - a.expectancyR)[0];
  const worst = [...nonEmpty].sort((a, b) => a.expectancyR - b.expectancyR)[0];
  const active = stats.find((s) => s.regimePhase === activeContext.regimePhase) ?? buildStatsForPhase(activeContext.regimePhase, [], []);
  const regimeLearningSampleSize = stats.reduce((sum, row) => sum + row.sampleSize, 0);
  const unknownRegimeCount = stats.find((row) => row.regimePhase === 'UNKNOWN')?.sampleSize ?? 0;
  const recoveredLowConfidenceRegimeCount = stats.reduce((sum, row) => sum + (row.sourceConfidenceBreakdown.LOW ?? 0), 0);

  const backfillDryRun = regimeUnknownRepairDryRun({
    shadowCases: cases as any,
    counterfactuals: counterfactuals as any,
    ghosts: [],
    attributionRecords: [],
    now,
  } as any);
  const regimeBackfillTargetUnknownCount = unknownRegimeCount;
  const regimeBackfillAttemptedTotal = backfillDryRun.scannedUnknown;
  const regimeBackfillAttemptedUnique = backfillDryRun.attemptedUnique;
  const regimeBackfillAttemptedDuplicates = backfillDryRun.attemptedDuplicates;
  const regimeBackfillAttempted = regimeBackfillAttemptedTotal;
  const regimeBackfillRecovered = backfillDryRun.repaired;
  const regimeBackfillFailed = backfillDryRun.stillUnknown;
  const regimeBackfillWindowMinutes = regimeBackfillRecovered > 0 ? 60 : 180;
  const regimeBackfillFailureTopReasons = Object.entries(backfillDryRun.failureReasonBreakdown ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${reason}:${count}`);
  if (regimeBackfillFailed > 0 && regimeBackfillFailureTopReasons.length === 0) {
    regimeBackfillFailureTopReasons.push(`UNKNOWN_ERROR:${regimeBackfillFailed}`);
  }
  const regimeBackfillFailureBySourceLane = backfillDryRun.failureBySourceLane ?? {};
  const regimeBackfillFailureByTimestampSource = backfillDryRun.failureByTimestampSource ?? {};
  const regimeBackfillFailureSampleKeys = backfillDryRun.failureSampleKeys ?? [];
  const recoveredLowConfidenceRegimeCountAdjusted = Math.max(recoveredLowConfidenceRegimeCount, regimeBackfillRecovered);
  const trueUnknownRegimeCount = Math.max(0, unknownRegimeCount - recoveredLowConfidenceRegimeCountAdjusted);
  const attemptedOverTargetReason = regimeBackfillAttemptedTotal > regimeBackfillTargetUnknownCount
    ? regimeBackfillAttemptedDuplicates > 0
      ? 'INCLUDES_DUPLICATE_OR_REPLAYED_CASES'
      : ['GHOST_REPAIR', 'BACKLOG_REPAIR', 'QUARANTINED', 'OPEN_UNRESOLVED'].some((lane) => (regimeBackfillFailureBySourceLane[lane] ?? 0) > 0)
        ? 'INCLUDES_GHOST_BACKLOG_QUARANTINED'
        : 'INCLUDES_DUPLICATE_OR_REPLAYED_CASES'
    : 'NONE';

  const regimeAssignedCount = regimeLearningSampleSize - unknownRegimeCount;
  const unknownRatio = pct(unknownRegimeCount, regimeLearningSampleSize);
  const unknownRatioRaw = unknownRatio;
  const recoveredLowConfidenceRegimeRatio = pct(recoveredLowConfidenceRegimeCountAdjusted, regimeLearningSampleSize);
  const trueUnknownRatio = pct(trueUnknownRegimeCount, regimeLearningSampleSize);
  const byConfidence = stats.reduce<Record<string, number>>((acc, row) => {
    for (const [key, count] of Object.entries(row.sourceConfidenceBreakdown)) {
      acc[key] = (acc[key] ?? 0) + count;
    }
    return acc;
  }, {});
  const r1 = stats.find((row) => row.regimePhase === 'R1_RECOVERY') ?? buildStatsForPhase('R1_RECOVERY', [], []);
  const r2 = stats.find((row) => row.regimePhase === 'R2_EARLY') ?? buildStatsForPhase('R2_EARLY', [], []);
  const r3 = stats.find((row) => row.regimePhase === 'R3_EXPANSION') ?? buildStatsForPhase('R3_EXPANSION', [], []);
  const r4 = stats.find((row) => row.regimePhase === 'R4_NEUTRAL') ?? buildStatsForPhase('R4_NEUTRAL', [], []);
  const r5 = stats.find((row) => row.regimePhase === 'R5_CAUTION') ?? buildStatsForPhase('R5_CAUTION', [], []);
  const r6 = stats.find((row) => row.regimePhase === 'R6_DEFENSE') ?? buildStatsForPhase('R6_DEFENSE', [], []);
  const maturityRows = buildMaturityRows(counterfactuals, now);
  const nextRegimeMaturityAt = maturityRows
    .map((row) => row.nearestMaturityAt)
    .filter((iso): iso is string => !!iso)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  const transitionState = loadRegimeResolvedTransitionState();
  const regimesNeedingAttributionRecalc = transitionState.attributionRecalcNeeded
    ? Object.entries(transitionState.lastResolvedByRegime)
        .filter(([, count]) => count > 0)
        .map(([phase]) => phase)
    : [];
  const sourceCounts = {
    freshShadow: cases.filter((c) => c.cohortType === 'FRESH_SHADOW').length,
    ghostRepair: cases.filter((c) => c.cohortType === 'GHOST_REPAIR').length,
    counterfactual: cases.filter((c) => c.cohortType === 'COUNTERFACTUAL_BLOCKED' || c.counterfactualRecorded).length + counterfactuals.length,
    outcome: cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? '')).length,
    attribution: attributionCaseCount,
  };
  const phaseSum = stats.reduce((sum, row) => sum + row.sampleSize, 0);

  return {
    activeRegime: activeContext.regimePhase,
    rawRegime,
    effectiveRegime,
    shadowLearningAllowed: true,
    stats,
    bestRegimeByExpectancy: best?.regimePhase,
    worstRegimeByExpectancy: worst?.regimePhase,
    activeRegimePhase: activeContext.regimePhase,
    activeRegimeSampleSize: active.sampleSize,
    activeRegimeTotalSampleSize: active.totalSampleSize,
    activeRegimeResolvedSampleSize: active.resolvedSampleSize,
    activeRegimePendingCounterfactualCount: active.pendingCounterfactualCount,
    activeRegimeAttributableSampleSize: active.attributableSampleSize,
    activeRegimeExpectancyR: active.expectancyR,
    activeRegimeTopPattern: active.bestPattern ?? active.bestConditionCombo ?? active.topSector ?? 'N/A',
    activeRegimeLearningNeed: active.nextLearningNeed,
    activeRegimeWhyNotReliable: active.whyNotReliable,
    regimeLearningSampleSize,
    regimeAssignedCount,
    unknownRegimeCount,
    recoveredLowConfidenceRegimeCount: recoveredLowConfidenceRegimeCountAdjusted,
    trueUnknownRegimeCount,
    unknownRatio,
    unknownRatioRaw,
    recoveredLowConfidenceRegimeRatio,
    trueUnknownRatio,
    regimeRatioDenominator: 'regimeLearningSampleSize',
    regimeRatioDenominatorValue: regimeLearningSampleSize,
    activeRegimeQualityStatus: active.qualityStatus,
    regimeBankConsistency: phaseSum === regimeLearningSampleSize ? 'OK' : 'MISMATCH',
    duplicateCaseCount,
    regimeDuplicateCandidates: duplicateCaseCount,
    regimeDuplicateSuppressed: duplicateCaseCount,
    regimeDuplicatePreventedAtSource: duplicatePreventedAtSource,
    regimeDuplicateSuppressedAfterInsert: duplicateSuppressedAfterInsert,
    regimeDedupStatus: duplicateCaseCount > 0 ? 'ACTIVE' : 'NONE',
    regimeBackfillTargetUnknownCount,
    regimeBackfillAttemptedTotal,
    regimeBackfillAttemptedUnique,
    regimeBackfillAttemptedDuplicates,
    attemptedOverTargetReason,
    regimeBackfillAttempted,
    regimeBackfillRecovered,
    regimeBackfillFailed,
    regimeBackfillWindowMinutes,
    regimeBackfillFailureTopReasons,
    regimeBackfillFailureBySourceLane,
    regimeBackfillFailureByTimestampSource,
    regimeBackfillFailureSampleKeys,
    regimeDuplicateSourceTop3: [...duplicateSource.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}:${v}`),
    regimeDuplicateKeySample: duplicateKeySample,
    regimeDuplicateRootCause: duplicateCaseCount > 0 ? 'CASE_ID_REPLAY_OR_MULTI_SOURCE_DUPLICATION' : 'NONE',
    sourceCounts,
    byConfidence,
    R1QualityStatus: r1.qualityStatus,
    R2QualityStatus: r2.qualityStatus,
    R3QualityStatus: r3.qualityStatus,
    R4QualityStatus: r4.qualityStatus,
    R5QualityStatus: r5.qualityStatus,
    R6QualityStatus: r6.qualityStatus,
    R2ResolvedSampleSize: r2.resolvedSampleSize,
    R3ResolvedSampleSize: r3.resolvedSampleSize,
    R6ResolvedSampleSize: r6.resolvedSampleSize,
    R6ResolvedPromotionMin: R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION,
    R6PromotionGateSatisfied: r6.resolvedSampleSize >= R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION,
    R6PromotionBlocker: r6.resolvedSampleSize >= R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION ? 'NONE' : 'R6_RESOLVED_SAMPLE_LT_100',
    R2PendingCounterfactualCount: r2.pendingCounterfactualCount,
    R3PendingCounterfactualCount: r3.pendingCounterfactualCount,
    R6PendingCounterfactualCount: r6.pendingCounterfactualCount,
    nextRegimeMaturityAt,
    regimesNeedingAttributionRecalc,
    regimeLearningNextAction: active.nextLearningNeed,
    nextRegimeLearningAction: active.nextLearningNeed,
    unknownReductionNeeded: unknownRegimeCount > 0,
    recommendationOnly: true,
    promotionAllowed: false,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
  };
}

export function collectRegimeLearningConsistency(bank: RegimeLearningBank = collectRegimeLearningBank()): RegimeLearningConsistency {
  const regimeBankSampleCount = bank.stats.reduce((sum, row) => sum + row.sampleSize, 0);
  const regimeSumMatchesTotal = regimeBankSampleCount === bank.regimeLearningSampleSize;
  const byRegime = Object.fromEntries(bank.stats.map((row) => [row.regimePhase, row.sampleSize]));
  const metricWarnings = regimeSumMatchesTotal ? [] : ['REGIME_BANK_SAMPLE_SUM_MISMATCH'];
  if (bank.unknownRatio >= 0.25) metricWarnings.push('UNKNOWN_RATIO_HIGH');
  if (bank.trueUnknownRatio >= 0.20) metricWarnings.push('REGIME_PROMOTION_BLOCKED_TRUE_UNKNOWN_RATIO_HIGH');
  if ((bank.byConfidence.LOW ?? 0) + (bank.byConfidence.UNKNOWN ?? 0) > 0) metricWarnings.push('LOW_CONFIDENCE_REGIME_BACKFILL');
  if (bank.duplicateCaseCount > 0) metricWarnings.push('REGIME_SAMPLE_DUPLICATION_SUSPECT');
  if (bank.sourceCounts.freshShadow === 0) metricWarnings.push('FRESH_SHADOW_ZERO');
  const r6 = bank.stats.find((row) => row.regimePhase === 'R6_DEFENSE');
  if (r6 && r6.sampleSize > 0 && r6.sampleSize < 30) metricWarnings.push('R6_LOW_SAMPLE');
  const nextAction = bank.unknownRatio >= 0.25
    ? 'RUN_REGIME_UNKNOWN_ANALYSIS'
    : r6 && r6.sampleSize < 30
      ? 'COLLECT_R6_SURVIVOR_SAMPLES'
      : 'OBSERVE_DIAGNOSTIC_ONLY';
  return {
    totalLearningCases: bank.regimeLearningSampleSize,
    regimeLearningSampleSize: bank.regimeLearningSampleSize,
    regimeAssignedCount: bank.regimeAssignedCount,
    unknownRegimeCount: bank.unknownRegimeCount,
    unknownRatio: bank.unknownRatio,
    trueUnknownRatio: bank.trueUnknownRatio,
    regimeBankSampleCount,
    ghostRepairCountInBank: bank.sourceCounts.ghostRepair,
    counterfactualCountInBank: bank.sourceCounts.counterfactual,
    outcomeCountInBank: bank.sourceCounts.outcome,
    attributionCountInBank: bank.sourceCounts.attribution,
    duplicateCaseCount: bank.duplicateCaseCount,
    regimeSumMatchesTotal,
    byRegime,
    byConfidence: bank.byConfidence,
    metricWarnings,
    nextAction,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
  };
}

export function collectRegimeResolvedStatus(input: CollectRegimeLearningInput = {}): RegimeResolvedStatus {
  const now = input.now ?? new Date();
  const bank = collectRegimeLearningBank(input);
  const ledger = input.ledger ?? shadowCaseLedger;
  const { counterfactuals } = collectCases(input, ledger);
  const maturityRows = buildMaturityRows(counterfactuals, now);
  const maturityByPhase = new Map(maturityRows.map((row) => [row.regimePhase, row]));
  const rows = bank.stats
    .filter((stat) => stat.totalSampleSize > 0 || ['R2_EARLY', 'R3_EXPANSION', 'R6_DEFENSE'].includes(stat.regimePhase))
    .map((stat) => {
      const maturity = maturityByPhase.get(stat.regimePhase) ?? emptyMaturityRow(stat.regimePhase);
      const nextResolveAt = maturity.maturedNowCount > 0 ? now.toISOString() : maturity.nearestMaturityAt;
      return {
        regimePhase: stat.regimePhase,
        totalSampleSize: stat.totalSampleSize,
        resolvedSampleSize: stat.resolvedSampleSize,
        pendingCounterfactualCount: stat.pendingCounterfactualCount,
        pendingMaturityCount: maturity.pendingOutcomeCount,
        dueWithin1d: dueWithin(maturity, 1),
        dueWithin3d: dueWithin(maturity, 3),
        dueWithin7d: dueWithin(maturity, 7),
        nextMaturityAt: maturity.nearestMaturityAt,
        nextResolveAt,
        attributableSampleSize: stat.attributableSampleSize,
        qualityStatus: stat.qualityStatus,
        nextAction: nextQualityAction(stat),
      } satisfies RegimeResolvedStatusRow;
    });
  const nextRegimeMaturityAt = maturityRows
    .map((row) => row.nearestMaturityAt)
    .filter((iso): iso is string => !!iso)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
  return {
    rows,
    maturityByRegime: maturityRows,
    nextRegimeMaturityAt,
    nextResolveAt: maturityRows.some((row) => row.maturedNowCount > 0) ? now.toISOString() : nextRegimeMaturityAt,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
    recommendationOnly: true,
  };
}

function collectRegimeAttributionRecalc(
  input: CollectRegimeLearningInput & { transitionState?: RegimeResolvedTransitionState; run?: boolean; persist?: boolean } = {},
): RegimeAttributionRecalcResult {
  const now = input.now ?? new Date();
  const bank = collectRegimeLearningBank(input);
  const transitionState = input.transitionState ?? loadRegimeResolvedTransitionState();
  const regimesNeedingRecalc = transitionState.attributionRecalcNeeded
    ? Object.entries(transitionState.lastResolvedByRegime)
        .filter(([, count]) => count > 0)
        .map(([phase]) => phase)
    : [];
  const attributableSampleSizeByRegime: Record<string, number> = {};
  for (const stat of bank.stats) attributableSampleSizeByRegime[stat.regimePhase] = stat.attributableSampleSize;
  const stillInsufficientRegimes = regimesNeedingRecalc.filter((phase) => (attributableSampleSizeByRegime[phase] ?? 0) < 30);
  const recalculatedRegimes = regimesNeedingRecalc.filter((phase) => (attributableSampleSizeByRegime[phase] ?? 0) >= 30);
  const expectedConditionUpdates = bank.stats
    .filter((stat) => recalculatedRegimes.includes(stat.regimePhase))
    .reduce((sum, stat) => sum + stat.conditionAttributions.length, 0);
  if (input.run && input.persist !== false) {
    markRegimeAttributionRecalcHandled({
      now,
      recalculatedRegimes,
      skippedLowSampleRegimes: stillInsufficientRegimes,
    });
  }
  return {
    regimesNeedingRecalc,
    resolvedDeltaByRegime: transitionState.lastResolvedByRegime,
    attributableSampleSizeByRegime: Object.fromEntries(
      regimesNeedingRecalc.map((phase) => [phase, attributableSampleSizeByRegime[phase] ?? 0]),
    ),
    stillInsufficientRegimes,
    expectedConditionUpdates,
    ...(input.run ? {
      recalculatedRegimes,
      skippedLowSampleRegimes: stillInsufficientRegimes,
      conditionAttributionUpdated: expectedConditionUpdates,
      noWeightUpdate: true as const,
    } : {}),
    recommendationOnly: true,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
    promotionAllowed: false,
  };
}

export function regimeAttributionRecalcDryRun(
  input: CollectRegimeLearningInput & { transitionState?: RegimeResolvedTransitionState } = {},
): RegimeAttributionRecalcResult {
  return collectRegimeAttributionRecalc(input);
}

export function regimeAttributionRecalcRun(
  input: CollectRegimeLearningInput & { transitionState?: RegimeResolvedTransitionState; persist?: boolean } = {},
): RegimeAttributionRecalcResult {
  return collectRegimeAttributionRecalc({ ...input, run: true });
}

export function formatRegimeResolvedStatus(s: RegimeResolvedStatus = collectRegimeResolvedStatus()): string {
  return [
    '<b>[Regime Resolved Status]</b>',
    ...s.rows.map((row) => [
      `regimePhase=${row.regimePhase}`,
      `totalSampleSize=${row.totalSampleSize}`,
      `resolvedSampleSize=${row.resolvedSampleSize}`,
      `pendingCounterfactualCount=${row.pendingCounterfactualCount}`,
      `pendingMaturityCount=${row.pendingMaturityCount}`,
      `dueWithin1d=${row.dueWithin1d}`,
      `dueWithin3d=${row.dueWithin3d}`,
      `dueWithin7d=${row.dueWithin7d}`,
      `nextMaturityAt=${row.nextMaturityAt ?? 'N/A'}`,
      `nextResolveAt=${row.nextResolveAt ?? 'N/A'}`,
      `attributableSampleSize=${row.attributableSampleSize}`,
      `qualityStatus=${row.qualityStatus}`,
      `nextAction=${row.nextAction}`,
    ].join(' / ')),
    '<b>[Maturity By Regime]</b>',
    ...s.maturityByRegime.map((row) => [
      `regimePhase=${row.regimePhase}`,
      `pendingOutcomeCount=${row.pendingOutcomeCount}`,
      `maturedNowCount=${row.maturedNowCount}`,
      `dueToday=${row.dueToday}`,
      `dueNextTradingDay=${row.dueNextTradingDay}`,
      `dueIn2to3CalendarDays=${row.dueIn2to3CalendarDays}`,
      `dueIn4to7CalendarDays=${row.dueIn4to7CalendarDays}`,
      `dueIn8to14CalendarDays=${row.dueIn8to14CalendarDays}`,
      `dueAfter14CalendarDays=${row.dueAfter14CalendarDays}`,
      `nearestMaturityAt=${row.nearestMaturityAt ?? 'N/A'}`,
      `largestMaturityBucket=${row.largestMaturityBucket}`,
    ].join(' / ')),
    `nextRegimeMaturityAt=${s.nextRegimeMaturityAt ?? 'N/A'} nextResolveAt=${s.nextResolveAt ?? 'N/A'}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed} recommendationOnly=${s.recommendationOnly}`,
  ].join('\n');
}

export function formatRegimeAttributionRecalc(s: RegimeAttributionRecalcResult, title = 'regime_attribution_recalc'): string {
  return [
    `<b>[${title}]</b>`,
    `regimesNeedingRecalc=${JSON.stringify(s.regimesNeedingRecalc)}`,
    `resolvedDeltaByRegime=${JSON.stringify(s.resolvedDeltaByRegime)}`,
    `attributableSampleSizeByRegime=${JSON.stringify(s.attributableSampleSizeByRegime)}`,
    `stillInsufficientRegimes=${JSON.stringify(s.stillInsufficientRegimes)}`,
    `expectedConditionUpdates=${s.expectedConditionUpdates}`,
    s.recalculatedRegimes ? `recalculatedRegimes=${JSON.stringify(s.recalculatedRegimes)}` : '',
    s.skippedLowSampleRegimes ? `skippedLowSampleRegimes=${JSON.stringify(s.skippedLowSampleRegimes)}` : '',
    s.conditionAttributionUpdated !== undefined ? `conditionAttributionUpdated=${s.conditionAttributionUpdated}` : '',
    s.noWeightUpdate ? 'noWeightUpdate=true' : '',
    `recommendationOnly=${s.recommendationOnly}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].filter(Boolean).join('\n');
}

export function formatRegimeLearningQuality(bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const rows = [...bank.stats].sort((a, b) => b.totalSampleSize - a.totalSampleSize);
  return [
    '<b>[Regime Learning Quality]</b>',
    ...rows.map((s) => [
      `regimePhase=${s.regimePhase}`,
      `totalSampleSize=${s.totalSampleSize}`,
      `resolvedSampleSize=${s.resolvedSampleSize}`,
      `pendingCounterfactualCount=${s.pendingCounterfactualCount}`,
      `attributableSampleSize=${s.attributableSampleSize}`,
      `unknownCount=${s.regimePhase === 'UNKNOWN' ? s.totalSampleSize : 0}`,
      `sourceConfidenceHighRatio=${s.sourceConfidenceHighRatio}`,
      `resolvedRatio=${s.resolvedRatio}`,
      `pendingRatio=${s.pendingRatio}`,
      `qualityStatus=${s.qualityStatus}`,
      `expectancyConfidence=${s.expectancyConfidence}`,
      `whyNotReliable=${s.whyNotReliable}`,
      `nextAction=${nextQualityAction(s)}`,
    ].join(' / ')),
    'UNKNOWNPromotionIsolation=UNKNOWN samples are excluded from promotion metrics; UNKNOWN condition attribution is diagnostic-only; UNKNOWN expectancyR is not used for regime learning recommendation; sourceConfidence=UNKNOWN',
    `executionImpact=${bank.executionImpact} brokerOrdersCreated=${bank.brokerOrdersCreated} recommendationOnly=${bank.recommendationOnly} promotionAllowed=${bank.promotionAllowed}`,
  ].join('\n');
}

export function formatRegimeLearningSummary(bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const rows = [...bank.stats].sort((a, b) => b.sampleSize - a.sampleSize);
  return [
    '<b>[Regime Learning Bank]</b>',
    `activeRegime=${bank.activeRegime} rawRegime=${bank.rawRegime} effectiveRegime=${bank.effectiveRegime}`,
    formatEngineRuntimePolicy(resolveEngineRuntimePolicy({
      engineMode: bank.activeRegime === 'SELL_ONLY' ? 'SELL_ONLY' : bank.activeRegime === 'SHADOW_ONLY' ? 'SHADOW_ONLY' : bank.activeRegime === 'OBSERVE_ONLY' ? 'OBSERVE_ONLY' : 'NORMAL',
      macroRegime: bank.effectiveRegime,
      liveBuyGateAllowed: false,
      reasonCodes: ['REGIME_LEARNING_DIAGNOSTIC'],
    })),
    `shadowLearningAllowed=${bank.shadowLearningAllowed} recommendationOnly=${bank.recommendationOnly} promotionAllowed=${bank.promotionAllowed} executionImpact=${bank.executionImpact} brokerOrdersCreated=${bank.brokerOrdersCreated}`,
    `regimeLearningSampleSize=${bank.regimeLearningSampleSize} regimeAssignedCount=${bank.regimeAssignedCount} unknownRegimeCount=${bank.unknownRegimeCount} unknownRatioRaw=${bank.unknownRatioRaw} recoveredLowConfidenceRegimeCount=${bank.recoveredLowConfidenceRegimeCount} recoveredLowConfidenceRegimeRatio=${bank.recoveredLowConfidenceRegimeRatio} trueUnknownRegimeCount=${bank.trueUnknownRegimeCount} trueUnknownRatio=${bank.trueUnknownRatio} regimeRatioDenominator=${bank.regimeRatioDenominator} regimeRatioDenominatorValue=${bank.regimeRatioDenominatorValue} regimeBankConsistency=${bank.regimeBankConsistency}`,
    `regimeBackfillTargetUnknownCount=${bank.regimeBackfillTargetUnknownCount} regimeBackfillAttemptedTotal=${bank.regimeBackfillAttemptedTotal} regimeBackfillAttemptedUnique=${bank.regimeBackfillAttemptedUnique} regimeBackfillAttemptedDuplicates=${bank.regimeBackfillAttemptedDuplicates} attemptedOverTargetReason=${bank.attemptedOverTargetReason} regimeBackfillRecovered=${bank.regimeBackfillRecovered} regimeBackfillFailed=${bank.regimeBackfillFailed} regimeBackfillFailureTopReasons=${JSON.stringify(bank.regimeBackfillFailureTopReasons)} regimeBackfillFailureBySourceLane=${JSON.stringify(bank.regimeBackfillFailureBySourceLane)} regimeBackfillFailureByTimestampSource=${JSON.stringify(bank.regimeBackfillFailureByTimestampSource)} regimeBackfillFailureSampleKeys=${JSON.stringify(bank.regimeBackfillFailureSampleKeys)}`,
    `regimeDuplicatePreventedAtSource=${bank.regimeDuplicatePreventedAtSource} regimeDuplicateSuppressedAfterInsert=${bank.regimeDuplicateSuppressedAfterInsert} regimeDuplicateRootCause=${bank.regimeDuplicateRootCause}`,
    `R2ResolvedSampleSize=${bank.R2ResolvedSampleSize} R2PendingCounterfactual=${bank.R2PendingCounterfactualCount} R3ResolvedSampleSize=${bank.R3ResolvedSampleSize} R3PendingCounterfactual=${bank.R3PendingCounterfactualCount} R6ResolvedSampleSize=${bank.R6ResolvedSampleSize} R6PendingCounterfactual=${bank.R6PendingCounterfactualCount} nextRegimeMaturityAt=${bank.nextRegimeMaturityAt ?? 'N/A'} regimesNeedingAttributionRecalc=${JSON.stringify(bank.regimesNeedingAttributionRecalc)} regimeLearningNextAction=${bank.regimeLearningNextAction}`,
    ...rows.map((s) => `${s.regimePhase}: totalSampleSize=${s.totalSampleSize} resolvedSampleSize=${s.resolvedSampleSize} pendingCounterfactualCount=${s.pendingCounterfactualCount} attributableSampleSize=${s.attributableSampleSize} fresh=${s.freshShadowCount} ghostRepair=${s.ghostRepairCount} counterfactual=${s.counterfactualCount} closed=${s.closedCount} winRate=${round(s.winRate * 100, 1)}% expectancyR=${formatExpectancy(s)} expectancyConfidence=${s.expectancyConfidence} resolvedRatio=${s.resolvedRatio} qualityStatus=${s.qualityStatus} topCondition=${s.topCondition ?? 'N/A'} topSector=${s.topSector ?? 'N/A'} blocker=${s.blocker ?? 'NONE'}`),
  ].join('\n');
}

export function formatRegimeLearningDetail(regime: string, bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const phase = deriveRegimePhase({ regimePhase: regime, effectiveRegime: regime });
  const s = bank.stats.find((row) => row.regimePhase === phase) ?? buildStatsForPhase(phase, [], []);
  return [
    `<b>[Regime Learning Detail: ${phase}]</b>`,
    `sampleSize=${s.sampleSize}`,
    `totalSampleSize=${s.totalSampleSize}`,
    `resolvedSampleSize=${s.resolvedSampleSize}`,
    `closedOutcomeCount=${s.closedOutcomeCount}`,
    `pendingCounterfactualCount=${s.pendingCounterfactualCount}`,
    `pendingShadowCount=${s.pendingShadowCount}`,
    `pendingOpenCount=${s.pendingOpenCount}`,
    `quarantinedCount=${s.quarantinedCount}`,
    `attributableSampleSize=${s.attributableSampleSize}`,
    `unresolvedRatio=${s.unresolvedRatio}`,
    `resolvedRatio=${s.resolvedRatio}`,
    `freshShadowCount=${s.freshShadowCount}`,
    `counterfactualCount=${s.counterfactualCount}`,
    `ghostRepairCount=${s.ghostRepairCount}`,
    `closedCount=${s.closedCount}`,
    `labelBreakdown=${JSON.stringify({ WIN: s.winCount, LOSS: s.lossCount, BREAKEVEN: s.breakevenCount, ...s.counterfactualLabelBreakdown })}`,
    `expectancyR=${formatExpectancy(s)}`,
    `expectancyReason=${s.expectancyReason ?? 'OK'}`,
    `expectancyConfidence=${s.expectancyConfidence}`,
    `attributionConfidence=${s.attributionConfidence}`,
    `winRate=${round(s.winRate * 100, 1)}%`,
    `avgReturnR=${s.avgReturnR}`,
    `qualityStatus=${s.qualityStatus}`,
    `whyNotReliable=${s.whyNotReliable}`,
    `reliabilityWarning=${s.reliabilityWarning ?? 'N/A'}`,
    `sourceConfidenceBreakdown=${JSON.stringify(s.sourceConfidenceBreakdown)}`,
    phase === 'UNKNOWN'
      ? 'UNKNOWNPromotionIsolation=UNKNOWN samples are excluded from promotion metrics; UNKNOWN condition attribution is diagnostic-only; UNKNOWN expectancyR is not used for regime learning recommendation; sourceConfidence=UNKNOWN'
      : '',
    `promotionStage=${s.promotionStage}`,
    `topPositiveConditions=${s.topPositiveConditions.map((c) => `${c.conditionId}:${c.expectancyR}:${c.direction}:${c.confidence}`).join(',') || 'N/A'}`,
    `topNegativeConditions=${s.topNegativeConditions.map((c) => `${c.conditionId}:${c.expectancyR}:${c.direction}:${c.confidence}`).join(',') || 'N/A'}`,
    `lowSampleConditions=${s.lowSampleConditions.map((c) => `${c.conditionId}:${c.samples}`).join(',') || 'N/A'}`,
    `unstableConditions=${s.unstableConditions.map((c) => `${c.conditionId}:${c.confidence}`).join(',') || 'N/A'}`,
    `topSectors=${s.topSectors.map((x) => `${x.sector}:${x.expectancyR}`).join(',') || 'N/A'}`,
    `worstSectors=${s.worstSectors.map((x) => `${x.sector}:${x.expectancyR}`).join(',') || 'N/A'}`,
    `bestTimeWindow=${s.bestTimeWindow ?? 'N/A'}`,
    `worstTimeWindow=${s.worstTimeWindow ?? 'N/A'}`,
    `bestMarketSession=${s.bestMarketSession ?? 'N/A'}`,
    `bestPattern=${s.bestPattern ?? 'N/A'}`,
    `worstPattern=${s.worstPattern ?? 'N/A'}`,
    `earlyLeaderPattern=${s.earlyLeaderPattern ?? 'N/A'}`,
    `volumeAccumulationPattern=${s.volumeAccumulationPattern ?? 'N/A'}`,
    `firstBreakoutPattern=${s.firstBreakoutPattern ?? 'N/A'}`,
    `falseStartRisk=${s.falseStartRisk ?? 'N/A'}`,
    `trendContinuationPattern=${s.trendContinuationPattern ?? 'N/A'}`,
    `vcpBreakoutPattern=${s.vcpBreakoutPattern ?? 'N/A'}`,
    `pullbackBuyPattern=${s.pullbackBuyPattern ?? 'N/A'}`,
    `overheatBreakoutRisk=${s.overheatBreakoutRisk ?? 'N/A'}`,
    `survivorPattern=${s.survivorPattern ?? 'N/A'}`,
    `drawdownDefensePattern=${s.drawdownDefensePattern ?? 'N/A'}`,
    `recoverySpeedPattern=${s.recoverySpeedPattern ?? 'N/A'}`,
    `supplyRetentionPattern=${s.supplyRetentionPattern ?? 'N/A'}`,
    `deadCatBounceRisk=${s.deadCatBounceRisk ?? 'N/A'}`,
    `breakoutPattern=${s.breakoutPattern ?? 'N/A'}`,
    `reversalPattern=${s.reversalPattern ?? 'N/A'}`,
    `chopAvoidancePattern=${s.chopAvoidancePattern ?? 'N/A'}`,
    `bestSymbols=${s.bestSymbols.map((x) => `${x.name}:${x.returnR}`).join(',') || 'N/A'}`,
    `worstSymbols=${s.worstSymbols.map((x) => `${x.name}:${x.returnR}`).join(',') || 'N/A'}`,
    `commonFailureReasons=${s.commonFailureReasons.map((x) => `${x.reason}:${x.count}`).join(',') || 'N/A'}`,
    `nextLearningNeed=${s.nextLearningNeed}`,
    'recommendationOnly=true',
    'promotionAllowed=false',
  ].filter(Boolean).join('\n');
}

export function formatRegimeConditionAttribution(regime?: string, bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const phase = regime ? deriveRegimePhase({ regimePhase: regime, effectiveRegime: regime }) : undefined;
  const selectedStats = bank.stats.filter((stat) => !phase || stat.regimePhase === phase);
  const rows = bank.stats
    .filter((stat) => !phase || stat.regimePhase === phase)
    .flatMap((stat) => stat.conditionAttributions.map((condition) => ({ stat, condition })))
    .sort((a, b) => b.condition.samples - a.condition.samples || b.condition.expectancyR - a.condition.expectancyR)
    .slice(0, phase ? 30 : 60);
  return [
    `<b>[Regime Condition Attribution${phase ? `: ${phase}` : ''}]</b>`,
    ...selectedStats.map((stat) => `regimePhase=${stat.regimePhase} totalSampleSize=${stat.totalSampleSize} resolvedSampleSize=${stat.resolvedSampleSize} attributableSampleSize=${stat.attributableSampleSize} pendingCounterfactualCount=${stat.pendingCounterfactualCount} attributionConfidence=${stat.attributionConfidence} conditionAttributionInput=RESOLVED_ONLY qualityStatus=${stat.qualityStatus}`),
    rows.length === 0 ? 'conditionRows=N/A reason=NO_ATTRIBUTABLE_RESOLVED_CONDITIONS' : '',
    ...rows.map(({ condition }) => [
      `regimePhase=${condition.regimePhase}`,
      `conditionId=${condition.conditionId}`,
      `conditionName=${condition.conditionName}`,
      `samples=${condition.samples}`,
      `highSamples=${condition.highSamples}`,
      `lowSamples=${condition.lowSamples}`,
      `expectancyR=${condition.expectancyR}`,
      `winRate=${round(condition.winRate * 100, 1)}%`,
      `effect=${condition.effect}`,
      `direction=${condition.direction}`,
      `confidence=${condition.confidence}`,
      `minSamplePassed=${condition.minSamplePassed}`,
      `overfitFlag=${condition.overfitFlag}`,
      `recommendation=${condition.recommendation}`,
    ].join(' / ')),
    'recommendationOnly=true',
    'promotionAllowed=false',
  ].filter(Boolean).join('\n');
}

export function formatRegimeLearningConsistency(s: RegimeLearningConsistency = collectRegimeLearningConsistency()): string {
  return [
    '<b>[Regime Learning Consistency]</b>',
    `totalLearningCases=${s.totalLearningCases} regimeLearningSampleSize=${s.regimeLearningSampleSize} regimeAssignedCount=${s.regimeAssignedCount} unknownRegimeCount=${s.unknownRegimeCount} unknownRatio=${s.unknownRatio} trueUnknownRatio=${s.trueUnknownRatio}`,
    `regimeBankSampleCount=${s.regimeBankSampleCount} ghostRepairCountInBank=${s.ghostRepairCountInBank} counterfactualCountInBank=${s.counterfactualCountInBank} outcomeCountInBank=${s.outcomeCountInBank} attributionCountInBank=${s.attributionCountInBank}`,
    `duplicateCaseCount=${s.duplicateCaseCount} regimeSumMatchesTotal=${s.regimeSumMatchesTotal}`,
    `byRegime=${JSON.stringify(s.byRegime)}`,
    `byConfidence=${JSON.stringify(s.byConfidence)}`,
    `metricWarnings=${JSON.stringify(s.metricWarnings)} nextAction=${s.nextAction}`,
    `executionImpact=${s.executionImpact} brokerOrdersCreated=${s.brokerOrdersCreated} promotionAllowed=${s.promotionAllowed}`,
  ].join('\n');
}
