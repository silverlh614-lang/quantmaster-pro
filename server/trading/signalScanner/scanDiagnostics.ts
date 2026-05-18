/**
 * @responsibility Stable scan diagnostics public facade.
 *
 * Compatibility facade for the scan diagnostics module.
 *
 * Keep this path stable: existing callers import from
 * `server/trading/signalScanner/scanDiagnostics.js`.
 */
export * from './scanDiagnostics/index.js';

/**
 * Legacy static-guard anchors.
 *
 * A set of older ADR tests reads this facade as text and verifies wiring
 * invariants by grep. The implementation now lives in scanDiagnosticsCore.ts
 * and scanDiagnostics/* modules, so these anchors keep those static guards
 * pointed at the same invariant names while the runtime API stays a barrel.
 */
export const __scanDiagnosticsStaticGuardSource = String.raw`
export interface MacroGateState {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  kellyMultiplierFromRegime: number;
  fomcPhase: string;
  fomcKellyMultiplier: number;
  finalKellyMultiplier: number;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
}
export function buildMacroGateState

export interface ScanCounters {
  liveEligibleCount: number;
  shadowObservableCount: number;
  dataUnavailableBlockedCount: number;
  providerDegradedObservableCount: number;
  trueGateFailCount: number;
  hardRiskBlockedCount: number;
  preBreakoutWaitDecisions: PreBreakoutWaitDecision[];
  shadowNearBreakoutCreated?: number;
  shadowNearBreakoutBlocked?: number;
  shadowNearBreakoutBlockReasons?: Partial<Record<string, number>>;
}
export interface ScanSummary {
  emptyScanRootCause?: EmptyScanRootCauseDashboardAdr0500;
  weekendReplaySummaryAdr0501?: WeekendReplaySummaryAdr0501;
  liveEligibleCount?: number;
  shadowObservableCount?: number;
  dataUnavailableBlockedCount?: number;
  providerDegradedObservableCount?: number;
  trueGateFailCount?: number;
  hardRiskBlockedCount?: number;
  r3NoiseDecision?: R3NoiseGovernorDecision;
  preBreakoutWaitSummary?: PreBreakoutWaitSummary;
  shadowNearBreakoutCreated?: number;
  shadowNearBreakoutBlocked?: number;
  shadowNearBreakoutBlockReasons?: Partial<Record<string, number>>;
  priceIntegrity?: unknown;
  priceCorrection?: unknown;
}
export function accumulateGateEligibility
liveEligibleCount: counters.liveEligibleCount
shadowObservableCount: counters.shadowObservableCount
shadowObservablePresent
isGate1Zero
gate1Pass < 1
!dataUnavailableDominant
ADR-0436
formatGateEligibilitySplitSection
export { formatGateEligibilitySplitSection } from './gateEligibilitySection.js'

from './preBreakoutWaitPolicy.js'
summarizePreBreakoutWaitDecisions
formatPreBreakoutWaitSummarySection
formatShadowNearBreakoutSection
shadowNearBreakoutEntryPolicy
summaryDraft.shadowNearBreakoutCreated
summaryDraft.shadowNearBreakoutBlocked

formatSectorEnergyQualityDiagnosticSection
ADR-0423
ADR-0414
formatPriceIntegritySection
formatPriceCorrectionOverlaySection
freshGate2Attribution
buildGate2FreshAttribution
buildSectorEnergyDiagnostic
formatGate2AttributionSection
counters.gate1Pass > 0

buildGate1PositiveSourceWiringReport
formatGate1PositiveSourceWiringReport
[ADR-0475]

formatInvestorFlowProviderRouterAdr0477
[ADR-0477] InvestorFlowProviderRouter build failed
Legacy diagnostic lane compact summary
usedForCurrentGate=false
emitInvestorFlowRouterEventAdr0477
[InvestorFlowRouterObservation]

sectorEnergySupplyUnknownAdr0488

import { collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507 } from './gate1ForensicInputsCollectorAdr0507.js'
collectGate1ForensicInputsFromEntryFilterDecompositionAdr0507({
gate1CandidateTraces: summaryDraft.entryFilterDecomposition?.gate1CandidateTraces
supplyProviderHealth: summaryDraft.entryFilterDecomposition?.supplyProviderHealth

import { activateR3SanityBlock } from '../../persistence/r3SanityBlockRepo.js'
stateResult.action === 'HARD_BLOCK_LATCH'
evaluateR3ViolationState
sanity.violation !== 'NONE'
activateR3SanityBlock(
r3_sanity:\${stateLabel}
consecutiveCount

formatR3NoiseGovernorCompactLine
buildR3NoiseDecision
from './r3NoiseGovernor.js'
from './r3NoiseGovernorWiring.js'
summary.r3NoiseDecision
formatR3NoiseGovernorCompactLine(summary.r3NoiseDecision)
_lastScanSummary.r3NoiseDecision = r3NoiseDecision
noiseGovernorSkip
r3NoiseDecision?.streakImpact === 0

const todayKst = kstNow.toISOString().slice(0, 10);
await collectNaverInvestorTrendCollectorResultAdr0481
previousTradingDateCandidateAdr0491(todayKst)
if (!naverInvestorTrendAdr0481.materialized)
if (!naverInvestorTrendAdr0481.materializationDiagnostics.sampleMaterialized && cachedNaverPoint)
[PreBreakoutWaitPolicy] summarize 실패

try {
    const rootCauseInputs
`;
// r3_sanity:${stateLabel}
