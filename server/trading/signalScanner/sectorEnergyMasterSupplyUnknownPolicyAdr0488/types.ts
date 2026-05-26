// @responsibility ADR-0488 SectorEnergy master·supply-unknown 정책 진단 리포트/입력/레지스트리 타입 계약 SSOT; SHADOW_ONLY.
import type { FreshDataSupplyReportAdr0487 } from '../freshDataSupplyLayerAdr0487.js';
import type { FinalGate1CalibrationAuditReport } from '../gate1FinalCalibration.js';
import type { PenaltyDeduplicationReport } from '../gate1PenaltyDeduplication.js';
import type { CandidateSnapshot } from '../entryFilterDecomposition.js';
import type { LeadershipConfidence, SectorEnergySourceTier } from '../../../../src/services/sector/SectorEnergyDiagnostics.js';
import type { SectorIndexMasterCoverageAdr0495 } from '../sectorIndexMasterSeedAdr0495.js';
import type { OfficialSectorIndexMasterCoverageResult } from '../../../sector/SectorIndexVerifier.js';
import type { SectorEnergyCanonicalState } from '../../../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';

export type SectorEnergyMasterStatusAdr0488 =
  | 'FETCH_OK'
  | 'PARTIAL'
  | 'DEGRADED'
  | 'DATA_UNAVAILABLE'
  | 'UNKNOWN';

export type SupplyUnknownPolicyStatusAdr0488 =
  | 'OBSERVING'
  | 'VERIFIED_DISABLED'
  | 'DATA_UNAVAILABLE'
  | 'UNKNOWN';

export type SupplyUnknownRootCauseAdr0488 =
  | 'SUPPLY_PROVIDER_UNKNOWN'
  | 'SUPPLY_DATA_UNAVAILABLE'
  | 'PROVIDER_MISMATCH'
  | 'CACHE_EMPTY'
  | 'NON_TRADING_DAY'
  | 'MARKET_BEARISH_SUPPLY_SIGNAL';

export type SupplyUnknownDryRunVariantAdr0488 =
  | 'UNKNOWN_DIAGNOSTIC_ONLY'
  | 'UNKNOWN_TO_CONFIDENCE_DOWNGRADE'
  | 'UNKNOWN_TO_SIZING_ONLY'
  | 'BEARISH_ONLY_SUPPLY_PENALTY';

export interface SectorEnergyMasterRecordAdr0488 {
  sectorName: string;
  indexCode: string | null;
  market: string;
  source: 'KRX' | 'KIS' | 'CACHE' | 'INTERNAL' | 'UNKNOWN';
  normalized: boolean;
  coverageMetadata: {
    hasIndexCode: boolean;
    aggregateIgnored: boolean;
    aliasCandidate: boolean;
  };
  fetchedAt: string | null;
  observedAt: string;
}

export interface SectorEnergyMasterMappingDiagnosticsAdr0488 {
  sectorToIndexCode: Record<string, string>;
  indexCodeToSectorName: Record<string, string>;
  missingIndexCodeCount: number;
  unresolvedSectorNames: string[];
  aggregateIgnoredCount: number;
  aliasMissingCount: number;
  safeAliasCandidatesCount: number;
  unsafeAliasCandidatesCount: number;
  aliasResolvedCount: number;
  aliasUnsafeCount: number;
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  internalGroupedSnapshotCoverage: number;
  internalGroupedValidSectorCount?: number;
  internalGroupedExpectedSectorCount?: number;
  internalProxyCoverage: number;
  stockDailyFallbackCoverage: number;
  unresolvedSectorCount: number;
  symmetryPassed: boolean;
  topGaps: string[];
}

export interface SectorEnergyOfficialIndexMasterRecoveryAdr0488 {
  status: 'OFFICIAL_READY' | 'OFFICIAL_PARTIAL_OBSERVE' | 'OFFICIAL_MISSING_REPAIR_REQUIRED';
  sourceOfTruth: 'KRX_OFFICIAL_INDEX_MASTER' | 'KIS_OFFICIAL_INDEX_MASTER' | 'INTERNAL_PROXY_OR_BASKET' | 'NONE';
  selectedSectorEnergySourceTier: SectorEnergySourceTier;
  selectedPromotionMetric?: string;
  decisionUsesSafeOfficialOnly?: boolean;
  safeOfficialVerifiedCoverage?: number;
  safeOfficialVerifiedCount?: number;
  safeOfficialTargetCount?: number;
  officialTargetVerifiedCoverageDiagnostic?: number;
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  internalGroupedSnapshotCoverage: number;
  internalGroupedValidSectorCount?: number;
  internalGroupedExpectedSectorCount?: number;
  internalProxyCoverage: number;
  stockDailyFallbackCoverage: number;
  requiredVerifiedCoveragePct: 80;
  leadershipConfidence: LeadershipConfidence;
  promotionAllowed: boolean;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  shadowLeadershipAllowed: boolean;
  counterfactualAllowed: true;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  reasonCodes: string[];
  nextAction: string;
}

export interface SectorEnergyMasterSupplyLineReportAdr0488 {
  generatedAt: string;
  status: SectorEnergyMasterStatusAdr0488;
  records: SectorEnergyMasterRecordAdr0488[];
  mappingDiagnostics: SectorEnergyMasterMappingDiagnosticsAdr0488;
  indexCodeCoverageBefore: number;
  indexCodeCoverageAfter: number;
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  selectedPromotionMetric?: string;
  decisionUsesSafeOfficialOnly?: boolean;
  safeOfficialVerifiedCoverage?: number;
  safeOfficialVerifiedCount?: number;
  safeOfficialTargetCount?: number;
  requiredPromotionCoverage?: number;
  promotionCoveragePass?: boolean;
  unsafeExcludedNames?: string[];
  officialTargetVerifiedCoverageDiagnostic?: number;
  officialTargetCoverageIncludesUnsafeAlias?: boolean;
  officialTargetCoverageUsedForDecision?: false;
  internalGroupedSnapshotCoverage: number;
  internalGroupedValidSectorCount?: number;
  internalGroupedExpectedSectorCount?: number;
  internalProxyCoverage: number;
  stockDailyFallbackCoverage: number;
  aliasResolvedCount: number;
  aliasUnsafeCount: number;
  unresolvedSectorCount: number;
  coveragePct: number;
  fresh: number;
  stale: number;
  missing: number;
  providerError: number;
  fallbackUsed: 'STOCK_DAILY' | 'STOCK_DAILY_PROXY' | 'DIAGNOSTIC_PROXY' | 'NONE' | 'UNKNOWN';
  leadershipConfidence: LeadershipConfidence;
  leadershipBlockReason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW' | 'UNSAFE_ALIAS_CANDIDATES' | 'SYMMETRY_VALIDATION_FAILED' | 'STOCK_DAILY_FALLBACK_DIAGNOSTIC_ONLY' | 'SECTOR_INDEX_STALE' | 'NONE';
  promotionAllowed: boolean;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  shadowLeadershipAllowed: boolean;
  counterfactualAllowed: true;
  selectedSectorEnergySourceTier: SectorEnergySourceTier;
  reasonCodes: string[];
  topMissingSectorNames: string[];
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  operatorApprovalRequired: true;
  officialIndexMasterRecovery: SectorEnergyOfficialIndexMasterRecoveryAdr0488;
  officialSectorIndexMaster?: OfficialSectorIndexMasterCoverageResult;
  topGaps: string[];
  recommendedNextActions: string[];
  adr0495Coverage?: SectorIndexMasterCoverageAdr0495;
  diagnostics: string[];
}

export interface SupplyUnknownRootCauseClassificationAdr0488 {
  providerIssue: boolean;
  marketSignal: boolean;
  rootCause: SupplyUnknownRootCauseAdr0488;
  providerVerified: boolean;
  duplicatePenaltyGroupCollapsed: boolean;
  diagnosticOnly: true;
  executionImpact: 'NONE';
}

export interface SupplyUnknownDryRunVariantResultAdr0488 {
  variant: SupplyUnknownDryRunVariantAdr0488;
  active: boolean;
  pointPenaltyAvg: number;
  netScoreAvg: number;
  survivors: number;
  shadowOnly: true;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  operatorApprovalRequired: true;
  reason: 'SUPPLY_UNKNOWN_DIAGNOSTIC_ONLY';
}

export interface SupplyUnknownPolicyStabilizationReportAdr0488 {
  generatedAt: string;
  status: SupplyUnknownPolicyStatusAdr0488;
  classification: SupplyUnknownRootCauseClassificationAdr0488;
  providerIssue: boolean;
  marketSignal: boolean;
  unknownPolicyActive: boolean;
  originalPenaltyAvg: number;
  dedupedPenaltyAvg: number;
  removedPenaltyAvg: number;
  originalNetScoreAvg: number;
  diagnosticPolicyNetAvg: number;
  survivorsCurrent: number;
  survivorsUnknownDiagnosticOnly: number;
  providerVerifiedOverrideWarning: boolean;
  autoDisableWhenProviderVerified: true;
  requiredScore: 70;
  dryRunVariants: SupplyUnknownDryRunVariantResultAdr0488[];
  topGaps: string[];
  recommendedNextActions: string[];
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SectorEnergyAndSupplyUnknownPolicyReportAdr0488 {
  generatedAt: string;
  overallStatus: 'OBSERVING' | 'PARTIAL' | 'DEGRADED' | 'DATA_UNAVAILABLE' | 'UNKNOWN';
  /**
   * ADR-0534: SectorEnergy 최종 판단 단일 SSOT. 모든 promotion/sectorBoost/strongBuy 출력은
   * 이 값만 읽는다. sectorEnergyMaster 의 동일 필드는 진단 입력으로 강등된다.
   */
  sectorEnergyCanonicalState: SectorEnergyCanonicalState;
  sectorEnergyMaster: SectorEnergyMasterSupplyLineReportAdr0488;
  supplyUnknownPolicy: SupplyUnknownPolicyStabilizationReportAdr0488;
  topGaps: string[];
  recommendedNextActions: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SectorEnergyMasterInputRecordAdr0488 {
  sectorName?: string | null;
  indexCode?: string | null;
  market?: string | null;
  source?: string | null;
  normalized?: boolean | null;
  fetchedAt?: string | null;
  observedAt?: string | null;
  aggregate?: boolean | null;
  aggregateIgnored?: boolean | null;
  aliasCandidate?: boolean | null;
  rawPayload?: unknown;
  payload?: unknown;
}

export interface BuildSectorEnergyMasterReportInputAdr0488 {
  generatedAt?: string;
  sectorMasterRecords?: readonly SectorEnergyMasterInputRecordAdr0488[] | null;
  sectorEnergyDiagnosticAdr0474?: Record<string, unknown> | null;
  officialSectorIndexMaster?: OfficialSectorIndexMasterCoverageResult | null;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  useAdr0495Seed?: boolean;
}

export interface BuildSupplyUnknownPolicyReportInputAdr0488 {
  generatedAt?: string;
  providerIssue?: boolean | null;
  marketSignal?: boolean | null;
  providerStatus?: string | null;
  currentSupplySignal?: string | null;
  finalGate1CalibrationAdr0471?: FinalGate1CalibrationAuditReport | null;
  penaltyDeduplicationAdr0469?: PenaltyDeduplicationReport | null;
  candidateSnapshots?: readonly CandidateSnapshot[] | null;
  originalPenaltyAvg?: number | null;
  dedupedPenaltyAvg?: number | null;
  originalNetScoreAvg?: number | null;
  diagnosticPolicyNetAvg?: number | null;
  survivorsCurrent?: number | null;
  survivorsUnknownDiagnosticOnly?: number | null;
}

export interface BuildSectorEnergyAndSupplyUnknownPolicyReportInputAdr0488
  extends BuildSectorEnergyMasterReportInputAdr0488, BuildSupplyUnknownPolicyReportInputAdr0488 {
  throwForTest?: boolean;
}

export interface SectorEnergySupplyUnknownDetailRegistryEntryAdr0488 {
  adr: '0488';
  sectionId: 'sector_energy_supply_unknown';
  commandHint: '/fresh_data_status';
  scanBlockersDetailHint: '/scan_blockers_detail sector_energy_supply_unknown';
  adrTraceHint: '/adr_trace 0488';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}
