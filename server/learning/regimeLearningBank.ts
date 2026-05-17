// @responsibility Regime-specific Shadow Learning Bank (diagnostic/read-only).
import { loadCounterfactualShadowLearningLedger, type CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getRegimeDiagnostics } from '../trading/regimeBridge.js';
import { deriveRegimePhase, isRegimePhase, normalizeRegimeContext, type RegimePhase } from '../shadow/regimeContext.js';
import { shadowCaseLedger, type ShadowCaseLedgerStore } from '../shadow/shadowCaseLedger.js';
import type { ShadowCase } from '../shadow/shadowTypes.js';
import { formatEngineRuntimePolicy, resolveEngineRuntimePolicy } from '../runtime/engineRuntimePolicy.js';

export { type RegimePhase } from '../shadow/regimeContext.js';

export const REGIME_LEARNING_PHASES: RegimePhase[] = [
  'R1_RECOVERY',
  'R2_EARLY',
  'R3_EXPANSION',
  'R4_NEUTRAL',
  'R5_CAUTION',
  'R6_DEFENSE',
  'SELL_ONLY',
  'HARD_BLOCK',
  'SHADOW_ONLY',
  'OBSERVE_ONLY',
  'MARKET_CLOSED',
  'UNKNOWN',
];

export type OverfitRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type RegimeLearningQualityStatus =
  | 'NO_SAMPLE'
  | 'LOW_SAMPLE'
  | 'LEARNING'
  | 'STABLE'
  | 'OVERFIT_RISK'
  | 'DATA_QUALITY_LOW';

export interface RegimeConditionAttribution {
  conditionId: string;
  regimePhase: RegimePhase;
  samples: number;
  effect: number;
  avgReturnR: number;
  confidence: 'LOW_SAMPLE' | 'WATCHING' | 'ENOUGH_FOR_REVIEW';
  minSamplePassed: boolean;
  overfitFlag: boolean;
  recommendation: string;
}

export interface RegimeLearningStats {
  regimePhase: RegimePhase;
  sampleSize: number;
  freshShadowCount: number;
  counterfactualCount: number;
  ghostRepairCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  avgReturnR: number;
  expectancyR: number;
  avgMFE: number;
  avgMAE: number;
  avgHoldingMinutes: number;
  labelCompletionRate: number;
  dataQualityScore: number;
  overfitRisk: OverfitRisk;
  qualityStatus: RegimeLearningQualityStatus;
  promotionStage: 'SHADOW_SCORE' | 'ADVISORY';
  promotionAllowed: false;
  diagnosticOnly: true;
  recommendationOnly: true;
  topCondition?: string;
  worstCondition?: string;
  bestSector?: string;
  worstSector?: string;
  topSector?: string;
  topPositiveConditions: RegimeConditionAttribution[];
  topNegativeConditions: RegimeConditionAttribution[];
  topSectors: Array<{ sector: string; samples: number; expectancyR: number }>;
  bestSymbols: Array<{ symbol: string; name: string; returnR: number }>;
  worstSymbols: Array<{ symbol: string; name: string; returnR: number }>;
  commonFailureReasons: Array<{ reason: string; count: number }>;
  counterfactualLabelBreakdown: Record<string, number>;
  bestConditionCombo?: string;
  worstConditionCombo?: string;
  bestPattern?: string;
  worstPattern?: string;
  bestTimeWindow?: string;
  worstTimeWindow?: string;
  bestMarketSession?: string;
  commonFailureReason?: string;
  survivorPattern?: string;
  breakoutPattern?: string;
  reversalPattern?: string;
  chopAvoidancePattern?: string;
  nextLearningNeed: string;
  blocker?: string;
}

export interface RegimeLearningBank {
  activeRegime: string;
  rawRegime: string;
  effectiveRegime: string;
  shadowLearningAllowed: true;
  stats: RegimeLearningStats[];
  bestRegimeByExpectancy?: RegimePhase;
  worstRegimeByExpectancy?: RegimePhase;
  activeRegimePhase: RegimePhase;
  activeRegimeSampleSize: number;
  activeRegimeExpectancyR: number;
  activeRegimeTopPattern: string;
  activeRegimeLearningNeed: string;
  recommendationOnly: true;
  promotionAllowed: false;
  executionImpact: 'NONE';
  brokerOrdersCreated: 0;
}

export interface CollectRegimeLearningInput {
  ledger?: ShadowCaseLedgerStore;
  shadowCases?: ShadowCase[];
  counterfactualEntries?: CounterfactualShadowLearningLedgerEntry[];
  rawRegime?: string;
  effectiveRegime?: string;
}

const CLOSED_LABELS = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED']);

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

function phaseForCounterfactual(e: CounterfactualShadowLearningLedgerEntry): RegimePhase {
  return e.regimePhase ?? deriveRegimePhase({
    rawRegime: e.rawRegime ?? e.regime,
    effectiveRegime: e.effectiveRegime ?? e.regime,
    engineMode: e.engineMode,
    marketSession: e.marketSession,
    sellOnlyActive: e.sellOnlyActive,
    hardBlockActive: e.hardBlockActive,
    blockedReason: e.blockedBy?.[0],
    sourceFreshness: e.sourceFreshness,
    regimeConfidence: e.regimeConfidence,
  });
}

function conditionTags(c: ShadowCase): string[] {
  const tags = c.conditionTags?.filter(Boolean) ?? [];
  if (tags.length > 0) return tags;
  if (c.learningTag) return [c.learningTag];
  return [];
}

function qualityStatus(input: {
  sampleSize: number;
  labelCompletionRate: number;
  dataQualityScore: number;
  overfitRisk: OverfitRisk;
}): RegimeLearningQualityStatus {
  if (input.sampleSize === 0) return 'NO_SAMPLE';
  if (input.dataQualityScore > 0 && input.dataQualityScore < 0.8) return 'DATA_QUALITY_LOW';
  if (input.sampleSize < 30) return 'LOW_SAMPLE';
  if (input.overfitRisk !== 'LOW') return 'OVERFIT_RISK';
  if (input.sampleSize < 70) return 'LEARNING';
  if (input.sampleSize >= 100 && input.labelCompletionRate >= 0.95) return 'STABLE';
  return 'LEARNING';
}

function patternText(phase: RegimePhase, kind: 'best' | 'worst', seed?: string, sector?: string): string {
  const positive = seed || sector || 'N/A';
  if (phase === 'R6_DEFENSE') {
    return kind === 'best'
      ? `충격장 생존 패턴: ${positive} + 상대 낙폭 방어`
      : `충격장 실패 패턴: ${positive} 부재 + 유동성/회복력 부족`;
  }
  if (phase === 'R3_EXPANSION') {
    return kind === 'best'
      ? `확장장 돌파 패턴: ${positive}`
      : `확장장 실패 패턴: 과열/수급 부재 돌파`;
  }
  if (phase === 'R1_RECOVERY') {
    return kind === 'best'
      ? `회복장 반전 패턴: ${positive}`
      : `회복장 실패 패턴: 단순 낙폭과대 반등`;
  }
  if (phase === 'R4_NEUTRAL') {
    return kind === 'best'
      ? `횡보장 회피/생존 패턴: ${positive}`
      : `횡보장 실패 패턴: 방향성 없는 추격`;
  }
  return kind === 'best' ? `bestPattern=${positive}` : `worstPattern=${positive}`;
}

function buildConditionAttribution(
  regimePhase: RegimePhase,
  cases: ShadowCase[],
  positive: boolean,
): RegimeConditionAttribution[] {
  const byCondition = new Map<string, ShadowCase[]>();
  for (const c of cases) {
    for (const tag of conditionTags(c)) {
      const rows = byCondition.get(tag) ?? [];
      rows.push(c);
      byCondition.set(tag, rows);
    }
  }
  return [...byCondition.entries()]
    .map(([conditionId, rows]) => {
      const returns = rows.map(returnR);
      const avgReturnR = round(avg(returns));
      const samples = rows.length;
      return {
        conditionId,
        regimePhase,
        samples,
        effect: avgReturnR,
        avgReturnR,
        confidence: samples < 30 ? 'LOW_SAMPLE' as const : samples < 70 ? 'WATCHING' as const : 'ENOUGH_FOR_REVIEW' as const,
        minSamplePassed: samples >= 30,
        overfitFlag: samples < 30,
        recommendation: samples < 30 ? 'LOW_SAMPLE_NO_WEIGHT_UPDATE' : samples < 70 ? 'NO_WEIGHT_UPDATE_RECOMMENDATION_ONLY' : 'recommendationOnly',
      };
    })
    .filter((r) => positive ? r.avgReturnR >= 0 : r.avgReturnR < 0)
    .sort((a, b) => positive ? b.avgReturnR - a.avgReturnR : a.avgReturnR - b.avgReturnR)
    .slice(0, 5);
}

function buildStatsForPhase(
  regimePhase: RegimePhase,
  cases: ShadowCase[],
  counterfactuals: CounterfactualShadowLearningLedgerEntry[],
): RegimeLearningStats {
  const closed = cases.filter((c) => CLOSED_LABELS.has(c.outcomeLabel ?? ''));
  const wins = closed.filter((c) => c.outcomeLabel === 'WIN');
  const losses = closed.filter((c) => c.outcomeLabel === 'LOSS');
  const breakevens = closed.filter((c) => c.outcomeLabel === 'BREAKEVEN');
  const returns = closed.map(returnR);
  const sectorGroups = new Map<string, ShadowCase[]>();
  const failureReasons = new Map<string, number>();
  const cfLabels = new Map<string, number>();
  for (const label of ['MISSED_WIN', 'AVOIDED_LOSS', 'GOOD_BLOCK', 'BAD_BLOCK', 'NEUTRAL_BLOCK', 'DATA_INSUFFICIENT', 'QUARANTINED', 'PENDING_OUTCOME']) {
    cfLabels.set(label, 0);
  }
  const timeWindowGroups = new Map<string, ShadowCase[]>();
  const marketSessionGroups = new Map<string, ShadowCase[]>();

  for (const c of cases) {
    const sector = c.sectorTag ?? 'UNKNOWN';
    const rows = sectorGroups.get(sector) ?? [];
    rows.push(c);
    sectorGroups.set(sector, rows);
    const timeWindow = c.timeWindowTag ?? 'UNKNOWN';
    const timeRows = timeWindowGroups.get(timeWindow) ?? [];
    timeRows.push(c);
    timeWindowGroups.set(timeWindow, timeRows);
    const sessionRows = marketSessionGroups.get(c.marketSession ?? 'UNKNOWN') ?? [];
    sessionRows.push(c);
    marketSessionGroups.set(c.marketSession ?? 'UNKNOWN', sessionRows);
    if (c.outcomeLabel === 'LOSS' || (c.finalReturnPct ?? 0) < 0) {
      const reason = c.blockedReason ?? c.learningTag ?? 'UNKNOWN';
      failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
    }
  }
  for (const e of counterfactuals) {
    cfLabels.set(e.label, (cfLabels.get(e.label) ?? 0) + 1);
    for (const b of e.blockedBy ?? []) failureReasons.set(b, (failureReasons.get(b) ?? 0) + 1);
  }

  const topSectors = [...sectorGroups.entries()]
    .map(([sector, rows]) => ({ sector, samples: rows.length, expectancyR: round(avg(rows.map(returnR))) }))
    .sort((a, b) => b.expectancyR - a.expectancyR || b.samples - a.samples)
    .slice(0, 5);
  const allSectors = [...sectorGroups.entries()]
    .map(([sector, rows]) => ({ sector, samples: rows.length, expectancyR: round(avg(rows.map(returnR))) }))
    .sort((a, b) => b.expectancyR - a.expectancyR || b.samples - a.samples);
  const sortedReturns = [...closed].sort((a, b) => returnR(b) - returnR(a));
  const topPositiveConditions = buildConditionAttribution(regimePhase, closed, true);
  const topNegativeConditions = buildConditionAttribution(regimePhase, closed, false);
  const closedOrLabeledCount = closed.length + counterfactuals.filter((e) => Boolean(e.label)).length;
  const sampleSize = cases.length + counterfactuals.length;
  const overfitRisk: OverfitRisk = sampleSize < 30 ? 'HIGH' : sampleSize < 70 ? 'MEDIUM' : 'LOW';
  const labelCompletionRate = pct(closedOrLabeledCount, sampleSize);
  const dataQualityScore = round(avg(cases.map(scoreDataQuality)));
  const status = qualityStatus({ sampleSize, labelCompletionRate, dataQualityScore, overfitRisk });
  const bestTimeWindow = [...timeWindowGroups.entries()]
    .map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) }))
    .sort((a, b) => b.value - a.value)[0]?.key;
  const worstTimeWindow = [...timeWindowGroups.entries()]
    .map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) }))
    .sort((a, b) => a.value - b.value)[0]?.key;
  const bestMarketSession = [...marketSessionGroups.entries()]
    .map(([key, rows]) => ({ key, value: avg(rows.map(returnR)) }))
    .sort((a, b) => b.value - a.value)[0]?.key;
  const bestConditionCombo = topPositiveConditions.slice(0, 2).map((c) => c.conditionId).join('+') || undefined;
  const worstConditionCombo = topNegativeConditions.slice(0, 2).map((c) => c.conditionId).join('+') || undefined;
  const bestSector = allSectors[0]?.sector;
  const worstSector = allSectors.at(-1)?.sector;
  const bestPattern = patternText(regimePhase, 'best', bestConditionCombo, bestSector);
  const worstPattern = patternText(regimePhase, 'worst', worstConditionCombo, worstSector);
  return {
    regimePhase,
    sampleSize,
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
    overfitRisk,
    qualityStatus: status,
    promotionStage: sampleSize >= 30 && labelCompletionRate > 0 ? 'ADVISORY' : 'SHADOW_SCORE',
    promotionAllowed: false,
    diagnosticOnly: true,
    recommendationOnly: true,
    topCondition: topPositiveConditions[0]?.conditionId,
    worstCondition: topNegativeConditions[0]?.conditionId,
    bestSector,
    worstSector,
    topSector: topSectors[0]?.sector,
    topPositiveConditions,
    topNegativeConditions,
    topSectors,
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
    breakoutPattern: regimePhase === 'R3_EXPANSION' ? bestPattern : undefined,
    reversalPattern: regimePhase === 'R1_RECOVERY' ? bestPattern : undefined,
    chopAvoidancePattern: regimePhase === 'R4_NEUTRAL' ? bestPattern : undefined,
    nextLearningNeed: sampleSize < 30 ? 'LOW_SAMPLE' : closed.length === 0 ? 'NEEDS_OUTCOME_LABELS' : 'OBSERVE_AND_COMPARE',
    blocker: status === 'STABLE' ? undefined : status,
  };
}

export function collectRegimeLearningBank(input: CollectRegimeLearningInput = {}): RegimeLearningBank {
  const ledger = input.ledger ?? shadowCaseLedger;
  const shadowCases = input.shadowCases ?? ledger.listCases();
  const counterfactualEntries = input.counterfactualEntries ?? loadCounterfactualShadowLearningLedger();
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

  const byPhase = new Map<RegimePhase, { cases: ShadowCase[]; counterfactuals: CounterfactualShadowLearningLedgerEntry[] }>();
  for (const phase of REGIME_LEARNING_PHASES) byPhase.set(phase, { cases: [], counterfactuals: [] });
  for (const c of shadowCases) byPhase.get(phaseForShadowCase(c))?.cases.push(c);
  for (const e of counterfactualEntries) byPhase.get(phaseForCounterfactual(e))?.counterfactuals.push(e);

  const stats = REGIME_LEARNING_PHASES
    .map((phase) => {
      const group = byPhase.get(phase)!;
      return buildStatsForPhase(phase, group.cases, group.counterfactuals);
    })
    .filter((s) => s.sampleSize > 0 || s.regimePhase === activeContext.regimePhase);
  const nonEmpty = stats.filter((s) => s.closedCount > 0);
  const best = [...nonEmpty].sort((a, b) => b.expectancyR - a.expectancyR)[0];
  const worst = [...nonEmpty].sort((a, b) => a.expectancyR - b.expectancyR)[0];
  const active = stats.find((s) => s.regimePhase === activeContext.regimePhase) ?? buildStatsForPhase(activeContext.regimePhase, [], []);
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
    activeRegimeExpectancyR: active.expectancyR,
    activeRegimeTopPattern: active.bestConditionCombo ?? active.topSector ?? 'N/A',
    activeRegimeLearningNeed: active.nextLearningNeed,
    recommendationOnly: true,
    promotionAllowed: false,
    executionImpact: 'NONE',
    brokerOrdersCreated: 0,
  };
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
    ...rows.map((s) => `${s.regimePhase}: sample=${s.sampleSize} fresh=${s.freshShadowCount} counterfactual=${s.counterfactualCount} closed=${s.closedCount} winRate=${round(s.winRate * 100, 1)}% expectancyR=${s.expectancyR} labelCompletionRate=${s.labelCompletionRate} dataQualityScore=${s.dataQualityScore} qualityStatus=${s.qualityStatus} topCondition=${s.topCondition ?? 'N/A'} topSector=${s.topSector ?? 'N/A'} blocker=${s.blocker ?? 'NONE'}`),
  ].join('\n');
}

export function formatRegimeLearningDetail(regime: string, bank: RegimeLearningBank = collectRegimeLearningBank()): string {
  const phase = deriveRegimePhase({ regimePhase: regime, effectiveRegime: regime });
  const s = bank.stats.find((row) => row.regimePhase === phase) ?? buildStatsForPhase(phase, [], []);
  return [
    `<b>[Regime Learning Detail: ${phase}]</b>`,
    `sampleSize=${s.sampleSize}`,
    `freshShadowCount=${s.freshShadowCount}`,
    `counterfactualCount=${s.counterfactualCount}`,
    `ghostRepairCount=${s.ghostRepairCount}`,
    `closedCount=${s.closedCount}`,
    `labelBreakdown=${JSON.stringify({ WIN: s.winCount, LOSS: s.lossCount, BREAKEVEN: s.breakevenCount, ...s.counterfactualLabelBreakdown })}`,
    `expectancyR=${s.expectancyR}`,
    `winRate=${round(s.winRate * 100, 1)}%`,
    `avgReturnR=${s.avgReturnR}`,
    `qualityStatus=${s.qualityStatus}`,
    `promotionStage=${s.promotionStage}`,
    `topPositiveConditions=${s.topPositiveConditions.map((c) => `${c.conditionId}:${c.avgReturnR}:${c.confidence}`).join(',') || 'N/A'}`,
    `topNegativeConditions=${s.topNegativeConditions.map((c) => `${c.conditionId}:${c.avgReturnR}:${c.confidence}`).join(',') || 'N/A'}`,
    `topSectors=${s.topSectors.map((x) => `${x.sector}:${x.expectancyR}`).join(',') || 'N/A'}`,
    `bestPattern=${s.bestPattern ?? 'N/A'}`,
    `worstPattern=${s.worstPattern ?? 'N/A'}`,
    `survivorPattern=${s.survivorPattern ?? 'N/A'}`,
    `breakoutPattern=${s.breakoutPattern ?? 'N/A'}`,
    `reversalPattern=${s.reversalPattern ?? 'N/A'}`,
    `chopAvoidancePattern=${s.chopAvoidancePattern ?? 'N/A'}`,
    `bestSymbols=${s.bestSymbols.map((x) => `${x.name}:${x.returnR}`).join(',') || 'N/A'}`,
    `worstSymbols=${s.worstSymbols.map((x) => `${x.name}:${x.returnR}`).join(',') || 'N/A'}`,
    `commonFailureReasons=${s.commonFailureReasons.map((x) => `${x.reason}:${x.count}`).join(',') || 'N/A'}`,
    `nextLearningNeed=${s.nextLearningNeed}`,
    'recommendationOnly=true',
    'promotionAllowed=false',
  ].join('\n');
}
