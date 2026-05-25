// @responsibility Regime Shadow Learning Bank 순수 분석/품질/포맷 헬퍼 + 라벨 상수 (diagnostic/read-only).
import { deriveRegimePhase, isRegimePhase } from '../../shadow/regimeContext.js';
import type { ShadowCase } from '../../shadow/shadowTypes.js';
import type {
  OverfitRisk,
  RegimeAttributionConfidence,
  RegimeCounterfactualEntry,
  RegimeExpectancyConfidence,
  RegimeLearningQualityStatus,
  RegimeLearningStats,
  RegimePhase,
} from '../regimeLearningTypes.js';

export const CLOSED_LABELS = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED']);
export const RESOLVED_LABELS = new Set([
  ...CLOSED_LABELS,
  'MISSED_WIN',
  'AVOIDED_LOSS',
  'GOOD_BLOCK',
  'BAD_BLOCK',
  'NEUTRAL_BLOCK',
]);
export const QUARANTINED_LABELS = new Set(['QUARANTINED', 'DATA_INSUFFICIENT', 'DATA_CORRUPTED', 'INVALID']);
export const CF_LABELS = ['MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK', 'DATA_INSUFFICIENT', 'QUARANTINED', 'PENDING_OUTCOME'];
export const R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION = 100;

export function round(n: number, digits = 4): number {
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
}

export function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function pct(n: number, d: number): number {
  return d > 0 ? round(n / d, 4) : 0;
}

function normalizePhaseValue(value: unknown): RegimePhase | undefined {
  return isRegimePhase(value) ? String(value).toUpperCase() as RegimePhase : undefined;
}

export function freqTop(map: Map<string, number>, limit = 5): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export function returnR(c: ShadowCase): number {
  if (typeof c.returnR === 'number' && Number.isFinite(c.returnR)) return c.returnR;
  if (typeof c.finalReturnPct === 'number' && Number.isFinite(c.finalReturnPct)) return c.finalReturnPct / 100;
  if (typeof c.currentReturnPct === 'number' && Number.isFinite(c.currentReturnPct)) return c.currentReturnPct / 100;
  return 0;
}

export function scoreDataQuality(c: ShadowCase): number {
  if (c.dataHealth === 'OK' || c.confidenceLevel === 'VERIFIED') return 1;
  if (c.dataHealth === 'STALE') return 0.65;
  if (c.dataHealth === 'DEGRADED' || c.confidenceLevel === 'FALLBACK') return 0.5;
  if (c.dataHealth === 'EMPTY' || c.dataHealth === 'UNAVAILABLE') return 0.2;
  if (c.dataHealth === 'CORRUPTED' || c.confidenceLevel === 'QUARANTINED') return 0;
  return 0.5;
}

export function sourceConfidenceOfCase(c: ShadowCase): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  if (c.regimeRecoveryConfidence) return c.regimeRecoveryConfidence;
  if (phaseForShadowCase(c) === 'UNKNOWN') return 'UNKNOWN';
  if (c.sourceConfidence === 'VERIFIED' || c.sourceConfidence === 'CALCULATED' || c.confidenceLevel === 'VERIFIED') return 'HIGH';
  if (c.sourceConfidence === 'EXTERNAL_API') return 'MEDIUM';
  if (c.sourceConfidence === 'FALLBACK' || c.confidenceLevel === 'LOW' || c.confidenceLevel === 'FALLBACK') return 'LOW';
  return 'UNKNOWN';
}

export function sourceConfidenceOfCounterfactual(e: RegimeCounterfactualEntry): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  const row = e as RegimeCounterfactualEntry & { regimeRecoveryConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' };
  if (row.regimeRecoveryConfidence) return row.regimeRecoveryConfidence;
  return phaseForCounterfactual(e) === 'UNKNOWN' ? 'UNKNOWN' : 'HIGH';
}

export function phaseForShadowCase(c: ShadowCase): RegimePhase {
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

export function phaseForCounterfactual(e: RegimeCounterfactualEntry): RegimePhase {
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

export function counterfactualReturnR(e: RegimeCounterfactualEntry): number | undefined {
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

export function conditionTags(c: ShadowCase): string[] {
  const tags = c.conditionTags?.filter(Boolean) ?? [];
  if (tags.length > 0) return tags;
  if (c.learningTag) return [c.learningTag];
  return [];
}

export function isResolvedLabel(label: string | undefined): boolean {
  return !!label && RESOLVED_LABELS.has(label);
}

export function isQuarantinedCase(c: ShadowCase): boolean {
  return c.cohortType === 'QUARANTINED'
    || c.dataHealth === 'CORRUPTED'
    || c.confidenceLevel === 'QUARANTINED'
    || !!c.quarantinedReason
    || QUARANTINED_LABELS.has(c.outcomeLabel ?? '');
}

export function isPendingOpenCase(c: ShadowCase): boolean {
  return !c.outcomeLabel
    || c.outcomeLabel === 'ACTIVE'
    || c.state === 'SHADOW_POSITION_OPENED'
    || c.state === 'SHADOW_MONITORING';
}

export function isAttributableCase(c: ShadowCase, regimePhase: RegimePhase): boolean {
  if (!CLOSED_LABELS.has(c.outcomeLabel ?? '')) return false;
  if (isQuarantinedCase(c)) return false;
  if (regimePhase !== 'UNKNOWN' && sourceConfidenceOfCase(c) === 'UNKNOWN') return false;
  return true;
}

export function qualityStatus(input: {
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

export function expectancyConfidence(resolvedReturnSamples: number): RegimeExpectancyConfidence {
  if (resolvedReturnSamples === 0) return 'N/A';
  if (resolvedReturnSamples < 30) return 'VERY_LOW';
  if (resolvedReturnSamples < 70) return 'LOW';
  if (resolvedReturnSamples < 100) return 'MEDIUM';
  return 'HIGH';
}

export function attributionConfidence(attributableSampleSize: number): RegimeAttributionConfidence {
  if (attributableSampleSize < 30) return 'INSUFFICIENT';
  if (attributableSampleSize < 70) return 'LOW';
  return 'ENOUGH_FOR_REVIEW';
}

export function reliabilityWarning(
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

export function whyNotReliable(input: {
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

export function nextQualityAction(s: Pick<RegimeLearningStats, 'regimePhase' | 'resolvedSampleSize' | 'pendingCounterfactualCount' | 'totalSampleSize' | 'attributableSampleSize' | 'qualityStatus'>): string {
  if (s.regimePhase === 'UNKNOWN') return 'REDUCE_UNKNOWN';
  if (s.regimePhase === 'R6_DEFENSE' && s.resolvedSampleSize < R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION) {
    return s.pendingCounterfactualCount > 0 ? 'WAIT_R6_COUNTERFACTUAL_MATURITY' : 'COLLECT_R6_COUNTERFACTUAL_ENTRY';
  }
  if (pct(s.pendingCounterfactualCount, s.totalSampleSize) > 0.5) return 'WAIT_COUNTERFACTUAL_MATURITY';
  if (s.attributableSampleSize < 30) return 'COLLECT_RESOLVED_ATTRIBUTABLE_SAMPLES';
  if (s.qualityStatus === 'LOW_CONFIDENCE') return 'IMPROVE_REGIME_SOURCE_CONFIDENCE';
  return 'OBSERVE_DIAGNOSTIC_ONLY';
}

export function formatExpectancy(s: Pick<RegimeLearningStats, 'expectancyR' | 'expectancyReason'>): string {
  return s.expectancyReason === 'NO_RESOLVED_SAMPLE' ? 'N/A' : String(s.expectancyR);
}

export function patternText(phase: RegimePhase, kind: 'best' | 'worst', seed?: string, sector?: string): string {
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
