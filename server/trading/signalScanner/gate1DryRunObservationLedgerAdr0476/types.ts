// @responsibility ADR-0579 gate1DryRunObservationLedgerAdr0476 type declarations (extracted for ACMA 1500-line limit; type-only, byte-equivalent)
import type { CandidateSnapshot } from '../entryFilterDecomposition.js';
import type { FinalGate1CalibrationAuditReport } from '../gate1FinalCalibration.js';
import type { Gate1PositiveSourceWiringReport } from '../gate1PositiveSourceWiringAdr0475.js';
import type { InvestorFlowProviderRouteResult } from '../investorFlowProviderRouterAdr0477.js';
import type { NaverInvestorTrendCollectorResult } from '../naverInvestorTrendCollectorAdr0481.js';
import type { SemanticNetBuyNormalizationReportAdr0482 } from '../semanticNetBuyNormalizerAdr0482.js';
import type { FreshDataSupplyReportAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { SectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from '../sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import type { SupplyRecoveryRuntimeMountReportAdr0486 } from '../supplyRecoveryRuntimeMountAdr0486.js';
import type { SupplySnapshotReplayResultAdr0491 } from '../supplySnapshotStoreReplayAdr0491.js';
import type { Gate1ScoringAlignmentDryRunGateResult } from '../gate1ScoringAlignmentDryRunGateAdr0520.js';
import type { Gate1RegimeAwareWindowRollup } from '../gate1RegimeAwareWindowAdr0546.js';

export type Gate1DryRunObservationSource =
  | 'ADR_0471_UNKNOWN_DIAGNOSTIC_ONLY'
  | 'ADR_0472_SCORING_ALIGNMENT'
  | 'ADR_0475_POSITIVE_SOURCE_WIRING'
  | 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER'
  | 'ADR_0481_NAVER_INVESTOR_TREND_COLLECTOR'
  | 'ADR_0482_SEMANTIC_NETBUY_NORMALIZER'
  | 'ADR_0484_SUPPLY_COVERAGE_RECOVERY'
  | 'ADR_0485_SUPPLY_ADVISORY_READINESS'
  | 'ADR_0486_SUPPLY_RECOVERY_RUNTIME_MOUNT'
  | 'ADR_0487_FRESH_DATA_SUPPLY_LAYER'
  | 'ADR_0488_SECTOR_ENERGY_MASTER_SUPPLY_LINE'
  | 'ADR_0488_SUPPLY_UNKNOWN_POLICY_STABILIZATION'
  | 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY'
  | 'GATE1_SCORE_OBSERVATION_V2'
  | 'GATE1_NEAR_MISS'
  | 'COUNTERFACTUAL_UNIVERSE';

export type Gate1DryRunObservationStatus =
  | 'PENDING'
  | 'OBSERVING'
  | 'MATURED_1D'
  | 'MATURED_3D'
  | 'MATURED_5D'
  | 'MATURED_10D'
  | 'EXPIRED'
  | 'SKIPPED';

export type Gate1DryRunObservationDecision =
  | 'WOULD_PASS_DRY_RUN'
  | 'NEAR_MISS'
  | 'WOULD_STILL_FAIL'
  | 'PROVIDER_SOFTENED'
  | 'UNKNOWN_DIAGNOSTIC_ONLY'
  | 'POSITIVE_SOURCE_REPAIRED';

export type Gate1ObservationScoreBand = '70+' | '65~70' | '60~65' | '55~60' | 'below55' | 'UNSCORED';
export type Gate1ObservationFeatureCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export type Gate1ThresholdMaturityStatus =
  | 'PENDING'
  | 'MATURED_D1'
  | 'MATURED_D3'
  | 'MATURED_D5'
  | 'MATURED_D10'
  | 'DATA_UNAVAILABLE';

export interface Gate1DryRunObservationRow {
  id: string;
  createdAt: string;
  forDate: string;
  scanId?: string; candidateSetId?: string; tradeDate?: string; marketSessionState?: string;
  rawRegime?: string; effectiveRegime?: string; displayRegime?: string; engineMode?: string; policyView?: string;
  source: Gate1DryRunObservationSource;
  symbol: string;
  name?: string;
  actualGate1Passed: boolean;
  actualLiveEligible: false;
  dryRunDecision: Gate1DryRunObservationDecision;
  dryRunScenario: string;
  actualScore?: number;
  dryRunScore?: number;
  requiredScore: number;
  scoreGap?: number;
  /** 관측 점수 출처 — MIN_SIGNAL_TRACE(canonical 최소신호 점수, requiredScore 와 동일 스케일) vs
   *  LEGACY_GATE_SCORE(27조건 gateScore fallback, 스케일 상이 가능 — 밴드 귀속 신뢰 불가). */
  scoreSource?: 'MIN_SIGNAL_TRACE' | 'LEGACY_GATE_SCORE';
  /** ADR-0597 — 스캔 내 횡단면 percentile shadow 관측 (Gate 판정 미소비, 표시·학습 전용). */
  crossSectionalPercentile?: number;
  marketBlockScore?: number;
  marketBlockPercentile?: number;
  /** ADR-0609 — 상수블록 eligibility shadow 판정 (Phase 0 관측 전용, Gate 판정·정렬·entry 미소비). */
  eligibilityShadowEligible?: boolean;
  eligibilityShadowMarketOnlyPassed?: boolean;
  eligibilityShadowPercentilePassed?: boolean;
  /** ADR-0642 — 5개 default-OFF Gate1 flag force-ON hypothetical carry (minimumSignalScoreTrace stamp 유래).
   *  관측 전용 — Gate 판정·정렬·entry 미소비, executionImpact=NONE. flag flip 0(전부 SHADOW_OFF). */
  ceilingWiringHypotheticalActualScore?: number;  // ADR-0613
  ceilingWiringHypotheticalPassed?: boolean;      // ADR-0613
  rsContinuousHypotheticalActualScore?: number;   // ADR-0627
  rsContinuousHypotheticalPassed?: boolean;       // ADR-0627
  denomNormEffectiveRequiredScore?: number;       // ADR-0640
  denomNormHypotheticalPassed?: boolean;          // ADR-0640
  sectorRsHypotheticalActualScore?: number;       // ADR-0642 (0611 force-ON)
  sectorRsHypotheticalPassed?: boolean;           // ADR-0611
  sectorRsInputPresent?: boolean;                 // ADR-0611 coverage% 분자
  ceilingWiringInputPresent?: boolean;            // ADR-0613 coverage% 분자 (OHLCV/RS hydration)
  rsContinuousInputPresent?: boolean;             // ADR-0627 coverage% 분자 (rsRankPct)
  denomNormDeficitPresent?: boolean;              // ADR-0640 coverage% 분자 (결손 분모 발생)
  denomNormClampBinding?: boolean;                // ADR-0640 0.7× clamp binding 빈도
  sourceSnapshotId?: string; regime?: string; marketSession?: string;
  finalGate1Score?: number; rawPositiveScore?: number; effectivePenaltyScore?: number; diagnosticPenaltyScore?: number;
  scoreBand?: Gate1ObservationScoreBand;
  hardPass?: boolean; softPass?: boolean; liveCandidateAfterGate1?: boolean; shadowObservable?: boolean; counterfactualEligible?: boolean;
  maturityStatus?: Gate1ThresholdMaturityStatus;
  featureCompleteness?: Gate1ObservationFeatureCompleteness;
  supplyGateScoreEligible?: boolean; breakoutPositive?: boolean; rsPercentile?: number; priceMomentumPositive?: boolean;
  observationOnly?: true; thresholdAutoChanged?: false; operatorApprovalRequired?: true;
  shadowObservationEligible?: boolean; shadowBuyAllowed?: boolean; shadowLearningAllowed?: true; counterfactualAllowed?: true;
  minSignalLivePass?: boolean; gate2Evaluated?: boolean; gate2Pass?: boolean; gate2PrimaryBlocker?: string;
  gate3Evaluated?: boolean; gate3Readiness?: string; rrrStatus?: string; volumeConfirmation?: string;
  priceConfirmation?: string; lastTriggerStatus?: string; learningLabel?: string;
  providerIssue: boolean;
  marketSignal: boolean;
  sectorEnergyDiagnosticOnly: boolean;
  sellOnly: boolean;
  watchlistUpstreamScore?: number; priceMomentumScore?: number; relativeStrengthScore?: number; breakoutStructureScore?: number;
  volumeLiquidityScore?: number; watchlistScore?: number; supplyScore?: number; sectorLeadershipScore?: number; technicalTrendScore?: number;
  supplyPenalty?: number; riskPenalty?: number; sectorPenalty?: number;
  entryReferencePrice?: number; stopLossPrice?: number; targetPrice?: number;
  forwardReturn1D?: number; forwardReturn3D?: number; forwardReturn5D?: number; forwardReturn10D?: number;
  forwardReturnD1?: number; forwardReturnD3?: number; forwardReturnD5?: number; forwardReturnD10?: number;
  mfeD1?: number; mfeD3?: number; mfeD5?: number; maeD1?: number; maeD3?: number; maeD5?: number;
  maxFavorableExcursion5D?: number;
  maxAdverseExcursion5D?: number;
  stopLossTouched?: boolean;
  targetTouched?: boolean;
  observationType?: 'INVESTOR_FLOW_PROVIDER_ROUTER_ADR0477' | 'NAVER_INVESTOR_TREND_COLLECTOR_ADR0481' | 'SEMANTIC_NETBUY_NORMALIZER_ADR0482' | 'SUPPLY_COVERAGE_RECOVERY_ADR0484' | 'SUPPLY_ADVISORY_READINESS_ADR0485' | 'SUPPLY_RECOVERY_RUNTIME_MOUNT_ADR0486' | 'FRESH_DATA_SUPPLY_LAYER_ADR0487' | 'SECTOR_ENERGY_MASTER_SUPPLY_LINE_ADR0488' | 'SUPPLY_UNKNOWN_POLICY_STABILIZATION_ADR0488' | 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491';
  beforeCoverage?: number;
  afterCoverage?: number;
  selectedProvider?: string;
  providerTried?: string[];
  routeStatus?: string;
  routeSignal?: string;
  semanticNetBuyStatus?: string;
  sourceAgeTradingDays?: number | null;
  oldestSourceAgeTradingDays?: number | null;
  providerMismatchCount?: number;
  notWiredCount?: number;
  cacheEmptyCount?: number;
  sourceDate?: string | null;
  availableDays?: number;
  requestedDays?: number;
  foreignAvailable?: number;
  institutionAvailable?: number;
  selectedByAdr0477?: boolean;
  provider?: string;
  confidence?: string;
  unit?: string;
  status: Gate1DryRunObservationStatus;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
}

export interface Gate1DryRunObservationSummary {
  rowsCreated: number;
  totalRows: number;
  pending: number;
  observing: number;
  matured1D: number;
  matured3D: number;
  matured5D: number;
  matured10D: number;
  sources: Partial<Record<Gate1DryRunObservationSource, number>>;
  sourceBreakdownCountSum: number;
  unclassifiedSourceRows: number;
  sourceBreakdownInvariant: boolean;
  outcomeUpdateAvailable: boolean;
  outcomeUpdateReason: 'MARKET_CLOSED' | 'PRICE_CACHE_MISSING' | 'NOT_MATURED' | 'UPDATED';
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  nextAction: 'TRACK_1D_3D_5D_10D_FORWARD_RETURNS';
}

export interface Gate1EvidenceMaturityStatus {
  schedulerHealthy: boolean;
  status: 'NOT_YET_DUE' | 'DUE_PENDING_RUN' | 'UP_TO_DATE' | 'NO_ROWS';
  pendingD1: number;
  pendingD3: number;
  pendingD5: number;
  pendingD10: number;
  dueNow: number;
  stalePending: number;
  nextMaturityRunAt: string;
  lastMaturityRunAt: string;
  dataUnavailable: boolean;
  lastErrorSanitized: string;
  executionImpact: 'NONE';
}

export interface Gate1ThresholdEvidenceSummary {
  sampleWindow: '1D/3D/5D/10D';
  totalSamples: number;
  pendingSamples: number;
  ledgerRowsCreated: number;
  scoreBandCountSum: number;
  evidenceLedgerMatch: boolean;
  scoreBandLedgerMatch: boolean;
  maturity: Gate1EvidenceMaturityStatus;
  matureSamplesD1: number;
  matureSamplesD3: number;
  matureSamplesD5: number;
  matureSamplesD10: number;
  bestDryRunThreshold: number; // ADR-0546: default LEGACY_GATE1_REQUIRED_SCORE (70); 65/60 = dry-run relax bands
  recommendedAction: 'OBSERVE_MORE' | 'REVIEW_THRESHOLD_WITH_OPERATOR' | 'KEEP_THRESHOLD' | 'SHADOW_ONLY_ADJUSTMENT_REVIEW';
  confidence: 'INSUFFICIENT_SAMPLE' | 'OBSERVING' | 'READY_FOR_REVIEW';
  reviewReady: boolean;
  reviewBlockers: string[];
  liveRequiredScore: number; // ADR-0546: default LEGACY_GATE1_REQUIRED_SCORE (70)
  shadowObservationMode: 'ON';
  shadowObservationBands: Array<'60~65' | '65~70' | '70+'>;
  liveThresholdAutoChanged: false;
  scoreBandTable: Array<{
    band: '70+' | '65~70' | '60~65' | '55~60' | 'below55';
    count: number;
    matureD1: number;
    matureD3: number;
    matureD5: number;
    avgReturnD1: number | 'N/A';
    avgReturnD3: number | 'N/A';
    avgReturnD5: number | 'N/A';
    winRateD5: number | 'N/A';
    hitPlus3PctRate: number | 'N/A';
    hitMinus3PctRate: number | 'N/A';
    avgMFE: number | 'N/A';
    avgMAE: number | 'N/A';
    expectancyR: number | 'N/A';
    falseNegativeRate: number | 'N/A';
  }>;
  liveExecutionImpact: 'NONE';
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
  /**
   * ADR-0546 Phase2 — regime-aware 완화 창([regimeAwareRequired, legacyRequired)) 의 forward 성과 롤업.
   * "40점 기준이면 통과하지만 70점 기준이라 막힌" 후보들이 실제 D1/D3/D5 에서 어떤 성과를 냈는지
   * scoreBandTable 과 동일 머신으로 추적한다. liveThresholdAutoChanged=false — 관측 전용, operator 검토 근거.
   */
  regimeAwareWindow: Gate1RegimeAwareWindowRollup;
}

export interface Gate1DryRunObservationBuildInput {
  now?: Date;
  forDate: string;
  sourceSnapshotId?: string;
  scanId?: string;
  candidateSetId?: string;
  regime?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  displayRegime?: string;
  engineMode?: string;
  policyView?: string;
  marketSession?: string;
  marketSessionState?: string;
  candidateSnapshots?: readonly CandidateSnapshot[];
  /** per-symbol canonical Gate1 최소신호 점수 (ADR-0541 starvation trace 유래, requiredScore=70 과
   *  동일 스케일). 미주입 시 기존 snapshot.gateScore fallback (27조건 점수 — 스케일 상이) 보존.
   *  percentile/marketBlock 필드는 ADR-0597 횡단면 shadow 관측 (optional additive). */
  minSignalScoreBySymbol?: Readonly<Record<string, {
    actualScore: number;
    requiredScore: number;
    totalPercentile?: number;
    marketBlockScore?: number;
    marketBlockPercentile?: number;
    /** ADR-0609 — 상수블록 eligibility shadow 판정 (관측 전용 additive, Gate 미소비). */
    eligible?: boolean;
    marketOnlyPassed?: boolean;
    percentilePassed?: boolean;
    /** ADR-0642 — 5개 default-OFF Gate1 flag force-ON hypothetical carry (minimumSignalScoreTrace stamp 유래,
     *  관측 전용 additive·Gate 미소비·executionImpact=NONE). flag flip 0. */
    ceilingWiringHypotheticalActualScore?: number;
    ceilingWiringHypotheticalPassed?: boolean;
    rsContinuousHypotheticalActualScore?: number;
    rsContinuousHypotheticalPassed?: boolean;
    denomNormEffectiveRequiredScore?: number;
    denomNormHypotheticalPassed?: boolean;
    sectorRsHypotheticalActualScore?: number;
    sectorRsHypotheticalPassed?: boolean;
    sectorRsInputPresent?: boolean;
    ceilingWiringInputPresent?: boolean;
    rsContinuousInputPresent?: boolean;
    denomNormDeficitPresent?: boolean;
    denomNormClampBinding?: boolean;
  }>>;
  finalGate1Calibration?: FinalGate1CalibrationAuditReport | null;
  gate1PositiveSourceWiring?: Gate1PositiveSourceWiringReport | null;
  investorFlowProviderRouter?: InvestorFlowProviderRouteResult | null;
  naverInvestorTrendAdr0481?: NaverInvestorTrendCollectorResult | null;
  semanticNetBuyNormalizationAdr0482?: SemanticNetBuyNormalizationReportAdr0482 | null;
  supplyRecoveryRuntimeMountAdr0486?: SupplyRecoveryRuntimeMountReportAdr0486 | null;
  /** ADR-0520 — DRY_RUN scoring-alignment gate result (ENV-gated, off by default). */
  scoringAlignmentDryRunAdr0520?: Gate1ScoringAlignmentDryRunGateResult | null;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null;
  supplySnapshotStoreAdr0491?: SupplySnapshotReplayResultAdr0491 | null;
  sellOnly?: boolean;
  sectorEnergyDiagnosticOnly?: boolean;
  providerIssue?: boolean;
  marketSignal?: boolean;
  topN?: number;
}

export interface Gate1DryRunObservationOutcomeUpdateResult {
  updated: number;
  updatedD1: number;
  updatedD3: number;
  updatedD5: number;
  updatedD10: number;
  duplicateSuppressed: number;
  pending: number;
  outcomeUpdateAvailable: boolean;
  reason: 'MARKET_CLOSED' | 'PRICE_CACHE_MISSING' | 'NOT_MATURED' | 'UPDATED';
}

export type Gate1DryRunObservationPriceFetcher = (
  symbol: string,
  asOf: Date,
  row: Gate1DryRunObservationRow,
) => Promise<number | null | undefined> | number | null | undefined;
