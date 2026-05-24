// @responsibility ADR-0488 SectorEnergy master supply line + supply UNKNOWN policy stabilization; SHADOW_ONLY, no live execution.
import type { OperatorActionSource } from './operatorActionRouterAdr0480.js';
import type { FreshDataSupplyReportAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import type { FinalGate1CalibrationAuditReport, UnknownPenaltyPolicyScenario } from './gate1FinalCalibration.js';
import type { PenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import type { CandidateSnapshot } from './entryFilterDecomposition.js';
import type { LeadershipConfidence, SectorEnergySourceTier } from '../../../src/services/sector/SectorEnergyDiagnostics.js';
import {
  buildSectorEnergyFallbackSeedAdr0495,
  buildSectorIndexCodeMappingsAdr0495,
  buildSectorIndexMasterSeedAdr0495,
  evaluateSectorIndexMasterCoverageAdr0495,
  type SectorIndexMasterCoverageAdr0495,
} from './sectorIndexMasterSeedAdr0495.js';
import type { OfficialSectorIndexMasterCoverageResult } from '../../sector/SectorIndexVerifier.js';

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

const REQUIRED_SCORE_ADR0488 = 70;
const AGGREGATE_SECTOR_NAMES = new Set([
  'KOSPI',
  'KOSDAQ',
  'KONEX',
  'TOTAL',
  'ALL',
  'MARKET',
  'INDEX',
  '코스피',
  '코스닥',
  '코넥스',
  '제조',
  '전체',
  '합계',
  '시장전체',
]);

function nowIso(input?: string): string {
  return input ?? new Date().toISOString();
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number): number {
  return finite(value) ? value : fallback;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundPct(value: number): number {
  return Math.round(value * 1_000) / 10;
}

function ratioPct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return round1((numerator / denominator) * 100);
}

function sectorIndexCoveragePolicyLines(
  master: OfficialSectorIndexMasterCoverageResult,
  context: {
    internalGroupedSectorCount?: number;
    promotionAllowed?: boolean;
  } = {},
): string[] {
  const officialTargetSectorCount = master.coverageDenominator?.officialTargetSectorCount ?? master.targetSectorCount;
  const internalGroupedSectorCount = context.internalGroupedSectorCount ?? master.coverageDenominator?.internalGroupedSectorCount ?? 0;
  const safePromotionEligibleSectorCount = master.coverageDenominator?.safePromotionEligibleSectorCount ?? master.mappedSectorCount;
  const unsafeAliasSectorCount = master.coverageDenominator?.unsafeAliasSectorCount ?? master.unsafeAliasCount;
  const unresolvedSectorCount = master.coverageDenominator?.unresolvedSectorCount ?? master.unresolvedCount ?? master.unresolvedSectorNames.length;
  const verifiedSuccessCount = master.coverageDenominator?.verifiedSuccessCount ?? master.verifySuccessCount;
  const officialIndexCoverageByOfficialTarget = master.coverageMetrics?.officialIndexCoverageByOfficialTarget
    ?? master.officialIndexCoverageByOfficialTarget
    ?? master.officialIndexCoverage;
  const verifiedCoverageByOfficialTarget = master.coverageMetrics?.verifiedCoverageByOfficialTarget
    ?? master.verifiedCoverageByOfficialTarget
    ?? master.verifiedIndexCodeCoverage;
  const verifiedCoverageByInternalGrouped = internalGroupedSectorCount > 0
    ? ratioPct(verifiedSuccessCount, internalGroupedSectorCount)
    : master.coverageMetrics?.verifiedCoverageByInternalGrouped ?? master.verifiedCoverageByInternalGrouped ?? 0;
  const verifiedCoverageExcludingUnsafeAlias = master.coverageMetrics?.verifiedCoverageExcludingUnsafeAlias
    ?? master.verifiedCoverageExcludingUnsafeAlias
    ?? ratioPct(verifiedSuccessCount, safePromotionEligibleSectorCount);
  const policy = master.promotionCoveragePolicy;
  const selectedMetric = policy?.selectedMetric ?? 'officialTargetVerifiedCoverage';
  const selectedNumerator = policy?.numerator ?? verifiedSuccessCount;
  const selectedDenominator = policy?.denominator ?? officialTargetSectorCount;
  const selectedCoverageValue = policy?.selectedCoverageValue ?? ratioPct(selectedNumerator, selectedDenominator);
  const coveragePromotionAllowed = policy?.promotionAllowed ?? selectedCoverageValue >= 80;
  const effectivePromotionAllowed = context.promotionAllowed ?? coveragePromotionAllowed;
  const promotionReason = policy?.reason ?? (
    selectedCoverageValue >= 80 ? 'VERIFIED_INDEX_CODE_COVERAGE_READY' : 'VERIFIED_INDEX_CODE_COVERAGE_LOW'
  );
  const unsafePolicy = master.unsafeAliasPolicy;
  const quality = master.indexValueQuality;
  return [
    `SectorIndexCoverageDenominator: internalGroupedSectorCount=${internalGroupedSectorCount} officialTargetSectorCount=${officialTargetSectorCount} safePromotionEligibleSectorCount=${safePromotionEligibleSectorCount} unsafeAliasSectorCount=${unsafeAliasSectorCount} unresolvedSectorCount=${unresolvedSectorCount} verifiedSuccessCount=${verifiedSuccessCount}`,
    `CoverageMetrics: officialIndexCoverageByOfficialTarget=${pct(officialIndexCoverageByOfficialTarget)} verifiedCoverageByOfficialTarget=${pct(verifiedCoverageByOfficialTarget)} verifiedCoverageByInternalGrouped=${pct(verifiedCoverageByInternalGrouped)} verifiedCoverageExcludingUnsafeAlias=${pct(verifiedCoverageExcludingUnsafeAlias)} promotionVerifiedCoverage=${pct(selectedCoverageValue)}`,
    `UnsafeAliasPolicy: includeInPromotionDenominator=${unsafePolicy?.includeInPromotionDenominator ?? true} includeInPromotionNumerator=${unsafePolicy?.includeInPromotionNumerator ?? false} useForShadowEvidence=${unsafePolicy?.useForShadowEvidence ?? true} reason=${unsafePolicy?.reason ?? 'THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS'}`,
    `PromotionCoveragePolicy: selectedMetric=${selectedMetric} numerator=${selectedNumerator} denominator=${selectedDenominator} required=${pct(policy?.requiredVerifiedCoverage ?? 80)} selectedCoverageValue=${pct(selectedCoverageValue)} coveragePromotionAllowed=${coveragePromotionAllowed} promotionAllowed=${effectivePromotionAllowed} reason=${promotionReason} alternativeInternalGroupedCoverage=${pct(verifiedCoverageByInternalGrouped)} executionImpact=NONE`,
    `IndexValueQuality: zeroCurrentIndexCount=${quality?.zeroCurrentIndexCount ?? 0} currentIndexZeroCount=${quality?.zeroCurrentIndexCount ?? 0} nonZeroCurrentIndexCount=${quality?.nonZeroCurrentIndexCount ?? 0} zeroCurrentIndexSymbols=${quality?.zeroCurrentIndexSymbols.join(',') || 'NONE'} zeroPolicy=${quality?.zeroCurrentIndexPolicy ?? 'OBSERVE_ONLY'}`,
  ];
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizedProvider(value: unknown): SectorEnergyMasterRecordAdr0488['source'] {
  const provider = safeString(value, 'UNKNOWN').toUpperCase();
  if (provider === 'KRX') return 'KRX';
  if (provider === 'KIS') return 'KIS';
  if (provider === 'CACHE') return 'CACHE';
  if (provider === 'INTERNAL') return 'INTERNAL';
  return 'UNKNOWN';
}

function isAggregateSectorName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, '').toUpperCase();
  return AGGREGATE_SECTOR_NAMES.has(normalized) || AGGREGATE_SECTOR_NAMES.has(name.trim());
}

function sanitizeMasterRecord(record: SectorEnergyMasterInputRecordAdr0488, observedAt: string): SectorEnergyMasterRecordAdr0488 | null {
  const sectorName = safeString(record.sectorName);
  if (!sectorName) return null;
  const aggregateIgnored = record.aggregate === true || record.aggregateIgnored === true || isAggregateSectorName(sectorName);
  const indexCode = safeString(record.indexCode) || null;
  return {
    sectorName,
    indexCode: aggregateIgnored ? null : indexCode,
    market: safeString(record.market, 'KR'),
    source: normalizedProvider(record.source),
    normalized: record.normalized === true || Boolean(indexCode && !aggregateIgnored),
    coverageMetadata: {
      hasIndexCode: Boolean(indexCode && !aggregateIgnored),
      aggregateIgnored,
      aliasCandidate: record.aliasCandidate === true,
    },
    fetchedAt: safeString(record.fetchedAt) || null,
    observedAt: safeString(record.observedAt, observedAt),
  };
}

function diagnosticNumber(diag: Record<string, unknown> | null | undefined, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = diag?.[key];
    if (finite(value)) return value;
  }
  return fallback;
}

function diagnosticString(diag: Record<string, unknown> | null | undefined, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = diag?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function diagnosticsEvidencePresent(input: BuildSectorEnergyMasterReportInputAdr0488): boolean {
  return Boolean(input.sectorEnergyDiagnosticAdr0474) || Boolean(input.freshDataSupplyAdr0487) || Boolean(input.sectorMasterRecords?.length);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nestedRecord(source: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  return objectRecord(source?.[key]);
}

function diagnosticNumberDeep(
  diag: Record<string, unknown> | null | undefined,
  keys: string[],
  fallback: number,
): number {
  for (const key of keys) {
    const parts = key.split('.');
    let current: unknown = diag;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (finite(current)) return current;
  }
  return fallback;
}

function deriveInternalGroupedSnapshotCoverage(input: {
  diag: Record<string, unknown> | null | undefined;
  recordCoverage: number;
  adr0495Coverage?: Pick<SectorIndexMasterCoverageAdr0495, 'coveragePartial'>;
  evidencePresent: boolean;
}): {
  coverage: number;
  validSectorCount?: number;
  expectedSectorCount?: number;
} {
  const grouped = nestedRecord(input.diag, 'groupedSectorEnergy');
  const expectedSectorCount = diagnosticNumberDeep(
    input.diag,
    [
      'internalGroupedExpectedSectorCount',
      'groupedExpectedSectorCount',
      'groupedSectorEnergy.expectedSectorCount',
      'expectedSectorCount',
    ],
    12,
  );
  const validSectorCount = diagnosticNumberDeep(
    input.diag,
    [
      'internalGroupedValidSectorCount',
      'groupedValidSectorCount',
      'groupedSectorEnergy.groupedValidSectorCount',
    ],
    Number.NaN,
  );
  const groupedCountCoverage = Number.isFinite(validSectorCount) && expectedSectorCount > 0
    ? (validSectorCount / expectedSectorCount) * 100
    : 0;
  const explicitCoverage = diagnosticNumberDeep(
    input.diag,
    [
      'internalGroupedSnapshotCoverage',
      'groupedSectorEnergy.internalGroupedSnapshotCoverage',
      'groupedSnapshotCoverage',
    ],
    Number.NaN,
  );
  const groupedStatus = safeString(grouped?.groupedStatus ?? grouped?.status).toUpperCase();
  const groupedStatusCoverage =
    groupedStatus === 'GROUPED_ENERGY_OK' && expectedSectorCount > 0 && !Number.isFinite(validSectorCount)
      ? 100
      : 0;
  const adr0495GroupedCoverage = input.evidencePresent ? input.adr0495Coverage?.coveragePartial ?? 0 : 0;
  const coverage = round1(Math.max(
    Number.isFinite(explicitCoverage) ? explicitCoverage : 0,
    groupedCountCoverage,
    groupedStatusCoverage,
    input.recordCoverage,
    adr0495GroupedCoverage,
  ));
  const derivedValidSectorCount = Number.isFinite(validSectorCount)
    ? Math.max(0, Math.round(validSectorCount))
    : coverage > 0 && expectedSectorCount > 0
      ? Math.round((coverage / 100) * expectedSectorCount)
      : undefined;
  const derivedExpectedSectorCount = expectedSectorCount > 0 ? Math.round(expectedSectorCount) : undefined;
  return {
    coverage,
    ...(derivedValidSectorCount !== undefined ? { validSectorCount: derivedValidSectorCount } : {}),
    ...(derivedExpectedSectorCount !== undefined ? { expectedSectorCount: derivedExpectedSectorCount } : {}),
  };
}

function arrayField(source: Record<string, unknown> | null | undefined, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function stringFromKeys(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function sourceFromTier(value: unknown): SectorEnergyMasterInputRecordAdr0488['source'] {
  const source = safeString(value).toUpperCase();
  if (source.includes('OFFICIAL_KRX') || source === 'KRX' || source.includes('KRX_CODE')) return 'KRX';
  if (source.includes('OFFICIAL_KIS') || source === 'KIS') return 'KIS';
  if (source.includes('INTERNAL_GROUPED') || source.includes('INTERNAL')) return 'INTERNAL';
  if (source.includes('CACHE')) return 'CACHE';
  return 'UNKNOWN';
}

function extractSectorRowsFromDiagnostic(
  diag: Record<string, unknown> | null | undefined,
  observedAt: string,
): SectorEnergyMasterInputRecordAdr0488[] {
  const root = objectRecord(diag);
  if (!root) return [];
  const coverageBreakdown = objectRecord(root.coverageBreakdown);
  const selectedTier =
    root.selectedSectorEnergySourceTier ??
    root.sourceTier ??
    coverageBreakdown?.selectedSectorEnergySourceTier ??
    coverageBreakdown?.sourceTier;
  const candidates = [
    ...arrayField(root, ['officialIndexMasterRows', 'sectorIndexMasterRows', 'indexMasterRows', 'sectorRows']),
    ...arrayField(coverageBreakdown, ['officialIndexMasterRows', 'sectorIndexMasterRows', 'indexMasterRows', 'sectorRows']),
  ];
  const records: SectorEnergyMasterInputRecordAdr0488[] = [];
  for (const item of candidates) {
    const row = objectRecord(item);
    if (!row) continue;
    const sectorName = stringFromKeys(row, ['sectorName', 'officialIndexName', 'idxName', 'indexName', 'displayName', 'name']);
    if (!sectorName) continue;
    const indexCode = stringFromKeys(row, ['officialIndexCode', 'indexCode', 'idxCode', 'sectorCode', 'krxIndexCode', 'kisIndexCode']);
    const rowTier = row.sourceTier ?? row.selectedSectorEnergySourceTier ?? row.source ?? row.provider ?? selectedTier;
    records.push({
      sectorName,
      indexCode: indexCode || null,
      market: stringFromKeys(row, ['market', 'idxDiv']) || 'KR',
      source: sourceFromTier(rowTier),
      normalized: row.normalized === true || Boolean(indexCode),
      observedAt,
      aggregate: row.aggregate === true,
      aggregateIgnored: row.aggregateIgnored === true,
      aliasCandidate: row.aliasCandidate === true || row.aliasResolved === true,
    });
  }
  return records;
}

function adr0495SeedRecords(observedAt: string): SectorEnergyMasterInputRecordAdr0488[] {
  return buildSectorIndexMasterSeedAdr0495().map((record) => ({
    sectorName: record.indexNameKo,
    indexCode: record.indexCode,
    market: record.market,
    source: record.provider,
    normalized: true,
    observedAt,
    aggregate: record.isAggregate,
    aggregateIgnored: record.isAggregate,
    aliasCandidate: record.aliases.length > 1,
  }));
}

function buildMappingDiagnostics(
  records: readonly SectorEnergyMasterRecordAdr0488[],
  diag: Record<string, unknown> | null | undefined,
): SectorEnergyMasterMappingDiagnosticsAdr0488 {
  const sectorToIndexCode: Record<string, string> = {};
  const indexCodeToSectorName: Record<string, string> = {};
  const unresolved = new Set<string>();
  let aggregateIgnoredCount = 0;
  let missingIndexCodeCount = 0;

  for (const record of records) {
    if (record.coverageMetadata.aggregateIgnored) {
      aggregateIgnoredCount += 1;
      continue;
    }
    if (!record.indexCode) {
      missingIndexCodeCount += 1;
      unresolved.add(record.sectorName);
      continue;
    }
    sectorToIndexCode[record.sectorName] = record.indexCode;
    indexCodeToSectorName[record.indexCode] = record.sectorName;
  }

  if (records.length === 0) {
    missingIndexCodeCount = diagnosticNumber(diag, ['missingIndexCodeCount'], 0);
    aggregateIgnoredCount = diagnosticNumber(diag, ['aggregateIgnoredCount', 'aggregateIgnored'], 0);
    const unresolvedFromDiag = diag?.unresolvedSectorNames;
    if (Array.isArray(unresolvedFromDiag)) {
      for (const item of unresolvedFromDiag) {
        const value = safeString(item);
        if (value) unresolved.add(value);
      }
    }
  }

  const aliasMissingCount = diagnosticNumber(diag, ['aliasMissingCount', 'aliasMissing'], 0);
  const safeAliasCandidatesCount = diagnosticNumber(diag, ['safeAliasCandidatesCount', 'aliasCandidateCount', 'safeAliasCandidates'], 0);
  const unsafeAliasCandidatesCount = diagnosticNumber(diag, ['unsafeAliasCandidateCount', 'unsafeAliasCandidatesCount', 'unsafeAliasCandidates'], 0);
  const aliasResolvedCount = diagnosticNumber(diag, ['aliasResolvedCount', 'aliasResolved'], Math.max(0, safeAliasCandidatesCount - aliasMissingCount));
  const aliasUnsafeCount = diagnosticNumber(diag, ['aliasUnsafeCount'], unsafeAliasCandidatesCount);
  const nonAggregateRecords = records.filter((record) => !record.coverageMetadata.aggregateIgnored);
  const verifiedRecords = nonAggregateRecords.filter((record) =>
    (record.source === 'KRX' || record.source === 'KIS') &&
    record.coverageMetadata.hasIndexCode &&
    record.normalized,
  );
  const officialRecords = nonAggregateRecords.filter((record) =>
    (record.source === 'KRX' || record.source === 'KIS') &&
    record.coverageMetadata.hasIndexCode,
  );
  const internalProxyRecords = nonAggregateRecords.filter((record) => record.source === 'INTERNAL' && record.coverageMetadata.hasIndexCode);
  const officialIndexCoverage = diagnosticNumber(
    diag,
    ['officialIndexCoverage', 'officialMappedCoverage'],
    nonAggregateRecords.length > 0 ? (officialRecords.length / nonAggregateRecords.length) * 100 : 0,
  );
  const verifiedIndexCodeCoverage = diagnosticNumber(
    diag,
    ['verifiedIndexCodeCoverage', 'verifiedIndexCoverage', 'coverageVerified'],
    nonAggregateRecords.length > 0 ? (verifiedRecords.length / nonAggregateRecords.length) * 100 : 0,
  );
  const internalProxyCoverage = diagnosticNumber(
    diag,
    ['internalProxyCoverage', 'internalProxyIndexCodeCoverage'],
    nonAggregateRecords.length > 0 ? (internalProxyRecords.length / nonAggregateRecords.length) * 100 : 0,
  );
  const internalGroupedEvidence = deriveInternalGroupedSnapshotCoverage({
    diag,
    recordCoverage: internalProxyCoverage,
    evidencePresent: Boolean(diag) || records.length > 0,
  });
  const stockDailyFallbackCoverage = diagnosticNumber(diag, ['stockDailyFallbackCoverage', 'stockDailyProxyCoverage'], 0);
  const duplicateIndexCodes = Object.keys(indexCodeToSectorName).length !== new Set(Object.values(sectorToIndexCode)).size;
  const symmetryPassed = !duplicateIndexCodes && missingIndexCodeCount === 0 && unsafeAliasCandidatesCount === 0;
  const topGaps: string[] = [];
  if (aggregateIgnoredCount > 0) topGaps.push('REPAIR_SECTOR_INDEX_MASTER');
  if (missingIndexCodeCount > 0) topGaps.push('IMPROVE_INDEX_CODE_COVERAGE');
  if (aliasMissingCount > 0) topGaps.push('REDUCE_ALIAS_MISSING');
  if (unsafeAliasCandidatesCount > 0) topGaps.push('BLOCK_UNSAFE_ALIAS_CANDIDATES');

  return {
    sectorToIndexCode,
    indexCodeToSectorName,
    missingIndexCodeCount,
    unresolvedSectorNames: Array.from(unresolved).slice(0, 12),
    aggregateIgnoredCount,
    aliasMissingCount,
    safeAliasCandidatesCount,
    unsafeAliasCandidatesCount,
    aliasResolvedCount,
    aliasUnsafeCount,
    officialIndexCoverage: round1(officialIndexCoverage),
    verifiedIndexCodeCoverage: round1(verifiedIndexCodeCoverage),
    internalGroupedSnapshotCoverage: internalGroupedEvidence.coverage,
    ...(internalGroupedEvidence.validSectorCount !== undefined
      ? { internalGroupedValidSectorCount: internalGroupedEvidence.validSectorCount }
      : {}),
    ...(internalGroupedEvidence.expectedSectorCount !== undefined
      ? { internalGroupedExpectedSectorCount: internalGroupedEvidence.expectedSectorCount }
      : {}),
    internalProxyCoverage: round1(internalProxyCoverage),
    stockDailyFallbackCoverage: round1(stockDailyFallbackCoverage),
    unresolvedSectorCount: unresolved.size,
    symmetryPassed,
    topGaps,
  };
}

function sectorTopGaps(input: {
  status: SectorEnergyMasterStatusAdr0488;
  coveragePct: number;
  verifiedIndexCodeCoverage: number;
  mapping: SectorEnergyMasterMappingDiagnosticsAdr0488;
  fallbackUsed: string;
}): string[] {
  const gaps = new Set<string>();
  if (input.status === 'DATA_UNAVAILABLE') gaps.add('REPAIR_SECTOR_INDEX_MASTER');
  if (input.coveragePct < 80) gaps.add('IMPROVE_INDEX_CODE_COVERAGE');
  if (input.verifiedIndexCodeCoverage < 80) gaps.add('REPAIR_SECTOR_INDEX_MASTER');
  for (const gap of input.mapping.topGaps) gaps.add(gap);
  if (input.fallbackUsed === 'STOCK_DAILY' || input.fallbackUsed === 'STOCK_DAILY_PROXY') gaps.add('DO_NOT_USE_STOCK_DAILY_FOR_LEADERSHIP_CONFIDENCE');
  return Array.from(gaps);
}

function sectorActions(gaps: readonly string[]): string[] {
  if (gaps.length === 0) return ['OBSERVE_SECTOR_MASTER_SUPPLY_LINE'];
  return gaps.map((gap) => {
    if (gap === 'REPAIR_SECTOR_INDEX_MASTER') return 'Repair KRX sector index master before any leadership-confidence use.';
    if (gap === 'IMPROVE_INDEX_CODE_COVERAGE') return 'Improve sectorName/indexCode coverage in OBSERVE mode.';
    if (gap === 'REDUCE_ALIAS_MISSING') return 'Review safe aliases without mapping broad aggregates into sector leadership.';
    if (gap === 'BLOCK_UNSAFE_ALIAS_CANDIDATES') return 'Keep unsafe alias candidates blocked until operator review.';
    if (gap === 'DO_NOT_USE_STOCK_DAILY_FOR_LEADERSHIP_CONFIDENCE') return 'Keep STOCK_DAILY fallback diagnostic-only; do not unlock SectorEnergy boost.';
    return `Observe ${gap} before promotion.`;
  });
}

function selectSectorEnergySourceTier(input: {
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  internalProxyCoverage: number;
  stockDailyFallbackCoverage: number;
  fallbackUsed: SectorEnergyMasterSupplyLineReportAdr0488['fallbackUsed'];
  hasKisOfficialRecord: boolean;
}): SectorEnergySourceTier {
  if (input.verifiedIndexCodeCoverage >= 80) {
    return input.hasKisOfficialRecord ? 'OFFICIAL_KIS_SECTOR_INDEX' : 'OFFICIAL_KRX_SECTOR_INDEX';
  }
  if (input.internalProxyCoverage > 0) return 'INTERNAL_GROUPED_SNAPSHOT';
  if (input.officialIndexCoverage > 0) {
    return input.hasKisOfficialRecord ? 'OFFICIAL_KIS_SECTOR_INDEX' : 'OFFICIAL_KRX_SECTOR_INDEX';
  }
  if (
    input.stockDailyFallbackCoverage > 0 ||
    input.fallbackUsed === 'STOCK_DAILY' ||
    input.fallbackUsed === 'STOCK_DAILY_PROXY'
  ) {
    return 'KIS_STOCK_BASKET_DERIVED';
  }
  return 'NONE';
}

function buildSectorEnergyReasonCodes(input: {
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  internalProxyCoverage: number;
  stockDailyFallbackCoverage: number;
  leadershipConfidence: LeadershipConfidence;
  promotionAllowed: boolean;
  unsafeAliasCount: number;
  sectorDataStale: boolean;
  fallbackUsed: SectorEnergyMasterSupplyLineReportAdr0488['fallbackUsed'];
  hasKisOfficialRecord: boolean;
  hasKrxOfficialRecord: boolean;
  unresolvedSectorCount: number;
}): string[] {
  const reasonCodes = new Set<string>();
  if (input.officialIndexCoverage > 0) reasonCodes.add('OFFICIAL_INDEX_MASTER_LOADED');
  if (input.hasKisOfficialRecord && input.officialIndexCoverage > 0) reasonCodes.add('OFFICIAL_KIS_INDEX_MASTER_LOADED');
  if (input.hasKrxOfficialRecord && input.officialIndexCoverage > 0) reasonCodes.add('OFFICIAL_KRX_INDEX_MASTER_LOADED');
  if (input.officialIndexCoverage === 0) reasonCodes.add('OFFICIAL_INDEX_COVERAGE_ZERO');
  if (input.officialIndexCoverage > 0 && input.verifiedIndexCodeCoverage === 0) reasonCodes.add('OFFICIAL_INDEX_API_VERIFY_FAILED');
  if (input.verifiedIndexCodeCoverage > 0 && input.verifiedIndexCodeCoverage < 80) {
    reasonCodes.add('VERIFIED_INDEX_CODE_COVERAGE_BELOW_THRESHOLD');
  }
  if (input.officialIndexCoverage === 0 && input.unresolvedSectorCount > 0) {
    reasonCodes.add('OFFICIAL_INDEX_MASTER_UNRESOLVED_SECTORS');
  }
  if (input.internalProxyCoverage > 0) reasonCodes.add('INTERNAL_PROXY_AVAILABLE');
  if (
    input.stockDailyFallbackCoverage > 0 ||
    input.fallbackUsed === 'STOCK_DAILY' ||
    input.fallbackUsed === 'STOCK_DAILY_PROXY'
  ) {
    reasonCodes.add('KIS_BASKET_DERIVED_SHADOW_ONLY');
  }
  if (input.unsafeAliasCount > 0) reasonCodes.add('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  if (input.sectorDataStale) reasonCodes.add('SECTOR_INDEX_STALE');
  if (!input.promotionAllowed) reasonCodes.add('PROMOTION_DISABLED_COVERAGE_BELOW_80');
  if (input.leadershipConfidence === 'SHADOW_ONLY') reasonCodes.add('SHADOW_LEADERSHIP_RECORDED');
  reasonCodes.add('EXECUTION_IMPACT_NONE_CONFIRMED');
  return Array.from(reasonCodes);
}

function buildOfficialIndexMasterRecoveryAdr0488(input: {
  status: SectorEnergyMasterStatusAdr0488;
  officialIndexCoverage: number;
  verifiedIndexCodeCoverage: number;
  internalGroupedSnapshotCoverage: number;
  internalGroupedValidSectorCount?: number;
  internalGroupedExpectedSectorCount?: number;
  internalProxyCoverage: number;
  stockDailyFallbackCoverage: number;
  leadershipBlockReason: SectorEnergyMasterSupplyLineReportAdr0488['leadershipBlockReason'];
  selectedSectorEnergySourceTier: SectorEnergySourceTier;
  leadershipConfidence: LeadershipConfidence;
  promotionAllowed: boolean;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  shadowLeadershipAllowed: boolean;
  reasonCodes: string[];
  hasKisOfficialRecord: boolean;
  hasKrxOfficialRecord: boolean;
}): SectorEnergyOfficialIndexMasterRecoveryAdr0488 {
  const officialReady = input.promotionAllowed;
  const partialObserve = !officialReady && (input.officialIndexCoverage > 0 || input.verifiedIndexCodeCoverage > 0);
  const status: SectorEnergyOfficialIndexMasterRecoveryAdr0488['status'] = officialReady
    ? 'OFFICIAL_READY'
    : partialObserve ? 'OFFICIAL_PARTIAL_OBSERVE' : 'OFFICIAL_MISSING_REPAIR_REQUIRED';
  const nextAction = officialReady
    ? 'OBSERVE_OFFICIAL_INDEX_MASTER_BEFORE_PROMOTION'
    : partialObserve
      ? 'COMPLETE_KRX_OFFICIAL_INDEX_MASTER_COVERAGE_IN_OBSERVE_MODE'
      : 'REPAIR_KRX_OFFICIAL_INDEX_MASTER_SUPPLY_LINE';
  const sourceOfTruth: SectorEnergyOfficialIndexMasterRecoveryAdr0488['sourceOfTruth'] =
    input.hasKisOfficialRecord ? 'KIS_OFFICIAL_INDEX_MASTER'
      : input.hasKrxOfficialRecord ? 'KRX_OFFICIAL_INDEX_MASTER'
        : input.selectedSectorEnergySourceTier === 'OFFICIAL_KIS_SECTOR_INDEX' ? 'KIS_OFFICIAL_INDEX_MASTER'
      : input.selectedSectorEnergySourceTier === 'OFFICIAL_KRX_SECTOR_INDEX' ? 'KRX_OFFICIAL_INDEX_MASTER'
        : input.selectedSectorEnergySourceTier === 'INTERNAL_GROUPED_SNAPSHOT' || input.selectedSectorEnergySourceTier === 'KIS_STOCK_BASKET_DERIVED'
          ? 'INTERNAL_PROXY_OR_BASKET'
          : 'NONE';
  return {
    status,
    sourceOfTruth,
    selectedSectorEnergySourceTier: input.selectedSectorEnergySourceTier,
    officialIndexCoverage: input.officialIndexCoverage,
    verifiedIndexCodeCoverage: input.verifiedIndexCodeCoverage,
    internalGroupedSnapshotCoverage: input.internalGroupedSnapshotCoverage,
    ...(input.internalGroupedValidSectorCount !== undefined
      ? { internalGroupedValidSectorCount: input.internalGroupedValidSectorCount }
      : {}),
    ...(input.internalGroupedExpectedSectorCount !== undefined
      ? { internalGroupedExpectedSectorCount: input.internalGroupedExpectedSectorCount }
      : {}),
    internalProxyCoverage: input.internalProxyCoverage,
    stockDailyFallbackCoverage: input.stockDailyFallbackCoverage,
    requiredVerifiedCoveragePct: 80,
    leadershipConfidence: input.leadershipConfidence,
    promotionAllowed: input.promotionAllowed,
    sectorBoostAllowed: input.sectorBoostAllowed,
    strongBuyAllowed: input.strongBuyAllowed,
    shadowLeadershipAllowed: input.shadowLeadershipAllowed,
    counterfactualAllowed: true,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    reasonCodes: input.reasonCodes,
    nextAction,
  };
}

export function buildSectorEnergyMasterReportAdr0488(
  input: BuildSectorEnergyMasterReportInputAdr0488 = {},
): SectorEnergyMasterSupplyLineReportAdr0488 {
  const generatedAt = nowIso(input.generatedAt);
  const diag = input.sectorEnergyDiagnosticAdr0474 ?? null;
  const diagnosticSectorRows = extractSectorRowsFromDiagnostic(diag, generatedAt);
  const useAdr0495Seed = input.useAdr0495Seed === true && !input.sectorMasterRecords?.length && diagnosticSectorRows.length === 0;
  const rawRecords = input.sectorMasterRecords?.length
    ? input.sectorMasterRecords
    : diagnosticSectorRows.length > 0
      ? diagnosticSectorRows
      : (useAdr0495Seed ? adr0495SeedRecords(generatedAt) : []);
  const records = rawRecords
    .map((record) => sanitizeMasterRecord(record, generatedAt))
    .filter((record): record is SectorEnergyMasterRecordAdr0488 => Boolean(record));
  const adr0495Master = buildSectorIndexMasterSeedAdr0495();
  const adr0495Mappings = buildSectorIndexCodeMappingsAdr0495(adr0495Master);
  const adr0495Fallback = buildSectorEnergyFallbackSeedAdr0495(adr0495Master);
  const adr0495Coverage = evaluateSectorIndexMasterCoverageAdr0495({
    masterRecords: adr0495Master,
    mappings: adr0495Mappings,
    fallbackRecords: adr0495Fallback,
    coverageBefore: diagnosticNumber(diag, ['indexCodeCoverageBefore', 'indexCodeCoverage'], 0),
  });
  const officialSectorIndexMaster = input.officialSectorIndexMaster ?? null;
  const mapping = buildMappingDiagnostics(records, diag);
  if (useAdr0495Seed) {
    mapping.missingIndexCodeCount = Math.max(mapping.missingIndexCodeCount, adr0495Coverage.missingIndexCodeCount);
    mapping.aliasMissingCount = Math.max(mapping.aliasMissingCount, adr0495Coverage.aliasMissing.length);
    mapping.safeAliasCandidatesCount = Math.max(mapping.safeAliasCandidatesCount, adr0495Coverage.safeAliasCandidates.length);
    mapping.unsafeAliasCandidatesCount = Math.max(mapping.unsafeAliasCandidatesCount, adr0495Coverage.unsafeAliasCandidates.length);
    mapping.unresolvedSectorNames = Array.from(new Set([...mapping.unresolvedSectorNames, ...adr0495Coverage.unresolvedSectorNames])).slice(0, 12);
    mapping.symmetryPassed = false;
    mapping.topGaps = Array.from(new Set([...mapping.topGaps, ...(adr0495Coverage.missingIndexCodeCount > 0 ? ['IMPROVE_INDEX_CODE_COVERAGE'] : []), ...(adr0495Coverage.unsafeAliasCandidates.length > 0 ? ['BLOCK_UNSAFE_ALIAS_CANDIDATES'] : [])]));
  }
  const nonAggregateRecords = records.filter((record) => !record.coverageMetadata.aggregateIgnored);
  const coveredRecords = nonAggregateRecords.filter((record) => record.coverageMetadata.hasIndexCode);
  const computedCoverage = nonAggregateRecords.length > 0 ? coveredRecords.length / nonAggregateRecords.length : 0;
  const before = useAdr0495Seed ? 0 : clampRatio(diagnosticNumber(diag, ['indexCodeCoverageBefore', 'indexCodeCoverage'], computedCoverage));
  const afterFromDiag = diagnosticNumber(
    diag,
    ['indexCodeCoverageAfter', 'indexCodeCoverageAfterAliasCandidate', 'indexCodeCoverageAfterNameLookup'],
    Number.NaN,
  );
  const after = clampRatio(Number.isFinite(afterFromDiag) ? afterFromDiag : (computedCoverage > 0 ? computedCoverage : before));
  const fallbackUsedRaw = diagnosticString(diag, ['fallbackUsed'], 'UNKNOWN');
  const fallbackUsed: SectorEnergyMasterSupplyLineReportAdr0488['fallbackUsed'] =
    fallbackUsedRaw === 'STOCK_DAILY' ? 'STOCK_DAILY'
      : fallbackUsedRaw === 'STOCK_DAILY_PROXY' ? 'STOCK_DAILY_PROXY'
        : fallbackUsedRaw === 'DIAGNOSTIC_PROXY' ? 'DIAGNOSTIC_PROXY'
          : fallbackUsedRaw === 'NONE' ? 'NONE'
            : adr0495Coverage.fallbackMode === 'STOCK_DAILY_PROXY' ? 'STOCK_DAILY_PROXY' : 'UNKNOWN';
  const recordTotal = nonAggregateRecords.length;
  const officialRecords = nonAggregateRecords.filter((record) =>
    (record.source === 'KRX' || record.source === 'KIS') &&
    record.coverageMetadata.hasIndexCode &&
    record.normalized,
  );
  const hasKisOfficialRecord = officialRecords.some((record) => record.source === 'KIS')
    || officialSectorIndexMaster?.masterSource === 'OFFICIAL_KIS_IDXCODE_MST'
    || officialSectorIndexMaster?.masterSource === 'CACHE'
    || officialSectorIndexMaster?.sourceTier === 'OFFICIAL_KIS_SECTOR_INDEX'
    || officialSectorIndexMaster?.sourceTier === 'CACHE';
  const hasKrxOfficialRecord = officialRecords.some((record) => record.source === 'KRX');
  const verifiedRecordCoverage = recordTotal > 0
    ? (officialRecords.length / recordTotal) * 100
    : 0;
  const officialRecordCoverage = recordTotal > 0
    ? (officialRecords.length / recordTotal) * 100
    : 0;
  const internalProxyRecordCoverage = recordTotal > 0
    ? (nonAggregateRecords.filter((record) => record.source === 'INTERNAL' && record.coverageMetadata.hasIndexCode).length / recordTotal) * 100
    : 0;
  const officialIndexCoverage = round1(
    officialSectorIndexMaster?.officialIndexCoverage
      ?? diagnosticNumber(
        diag,
        ['officialIndexCoverage', 'officialMappedCoverage'],
        recordTotal > 0 ? officialRecordCoverage : adr0495Coverage.coverageVerified,
      ),
  );
  const verifiedIndexCodeCoverage = round1(officialSectorIndexMaster?.verifiedIndexCodeCoverage ?? diagnosticNumber(
    diag,
    ['verifiedIndexCodeCoverage', 'verifiedIndexCoverage', 'coverageVerified'],
    recordTotal > 0 ? verifiedRecordCoverage : adr0495Coverage.coverageVerified,
  ));
  const rawInternalProxyCoverage = round1(diagnosticNumber(
    diag,
    ['internalProxyCoverage', 'internalProxyIndexCodeCoverage'],
    recordTotal > 0 ? internalProxyRecordCoverage : 0,
  ));
  const stockDailyFallbackCoverage = round1(diagnosticNumber(
    diag,
    ['stockDailyFallbackCoverage', 'stockDailyProxyCoverage'],
    fallbackUsed === 'STOCK_DAILY' || fallbackUsed === 'STOCK_DAILY_PROXY' ? Math.max(after * 100, adr0495Coverage.coveragePartial) : 0,
  ));
  const evidencePresent = diagnosticsEvidencePresent(input) || useAdr0495Seed;
  const internalGroupedEvidence = deriveInternalGroupedSnapshotCoverage({
    diag,
    recordCoverage: rawInternalProxyCoverage,
    adr0495Coverage,
    evidencePresent,
  });
  const internalGroupedSnapshotCoverage = internalGroupedEvidence.coverage;
  const internalProxyCoverage = round1(Math.max(rawInternalProxyCoverage, internalGroupedSnapshotCoverage));
  mapping.officialIndexCoverage = Math.max(mapping.officialIndexCoverage, officialIndexCoverage);
  mapping.verifiedIndexCodeCoverage = Math.max(mapping.verifiedIndexCodeCoverage, verifiedIndexCodeCoverage);
  if (officialSectorIndexMaster) {
    mapping.missingIndexCodeCount = Math.max(
      mapping.missingIndexCodeCount,
      Math.max(0, officialSectorIndexMaster.targetSectorCount - officialSectorIndexMaster.mappedSectorCount),
    );
    mapping.unresolvedSectorNames = Array.from(new Set([
      ...mapping.unresolvedSectorNames,
      ...officialSectorIndexMaster.unresolvedSectorNames,
    ])).slice(0, 12);
    mapping.safeAliasCandidatesCount = Math.max(mapping.safeAliasCandidatesCount, officialSectorIndexMaster.safeAliasCount);
    mapping.unsafeAliasCandidatesCount = Math.max(mapping.unsafeAliasCandidatesCount, officialSectorIndexMaster.unsafeAliasCount);
    mapping.aliasResolvedCount = Math.max(mapping.aliasResolvedCount, officialSectorIndexMaster.aliasResolvedCount);
    mapping.aliasUnsafeCount = Math.max(mapping.aliasUnsafeCount, officialSectorIndexMaster.unsafeAliasCount);
  }
  mapping.internalGroupedSnapshotCoverage = Math.max(mapping.internalGroupedSnapshotCoverage, internalGroupedSnapshotCoverage);
  if (internalGroupedEvidence.validSectorCount !== undefined) {
    mapping.internalGroupedValidSectorCount = internalGroupedEvidence.validSectorCount;
  }
  if (internalGroupedEvidence.expectedSectorCount !== undefined) {
    mapping.internalGroupedExpectedSectorCount = internalGroupedEvidence.expectedSectorCount;
  }
  mapping.internalProxyCoverage = Math.max(mapping.internalProxyCoverage, internalProxyCoverage);
  mapping.stockDailyFallbackCoverage = Math.max(mapping.stockDailyFallbackCoverage, stockDailyFallbackCoverage);
  mapping.aliasResolvedCount = Math.max(mapping.aliasResolvedCount, mapping.safeAliasCandidatesCount - mapping.aliasMissingCount, 0);
  mapping.aliasUnsafeCount = Math.max(mapping.aliasUnsafeCount, mapping.unsafeAliasCandidatesCount);
  mapping.unresolvedSectorCount = Math.max(mapping.unresolvedSectorCount, mapping.unresolvedSectorNames.length);
  const sectorDataQuality = diagnosticString(diag, ['dataQuality'], '');
  const sectorDataStale = ['STALE', 'DEGRADED', 'FAILED', 'MISSING'].includes(sectorDataQuality.toUpperCase());
  const rawStatus: SectorEnergyMasterStatusAdr0488 =
    !evidencePresent ? 'DATA_UNAVAILABLE'
      : after <= 0 ? 'DATA_UNAVAILABLE'
        : sectorDataStale || after < 0.4 || !mapping.symmetryPassed ? 'DEGRADED'
          : after < 0.8 ? 'PARTIAL'
            : 'FETCH_OK';
  const hasOfficialVerifiedEvidence = verifiedIndexCodeCoverage >= 80;
  const status: SectorEnergyMasterStatusAdr0488 = useAdr0495Seed && adr0495Coverage.coveragePartial > 0 ? 'PARTIAL' : (!hasOfficialVerifiedEvidence && adr0495Coverage.normalized && adr0495Coverage.coverageVerified < 80 && rawStatus === 'FETCH_OK' ? 'PARTIAL' : rawStatus);
  const topGaps = sectorTopGaps({ status, coveragePct: roundPct(after), verifiedIndexCodeCoverage, mapping, fallbackUsed });
  const leadershipBlockReason: SectorEnergyMasterSupplyLineReportAdr0488['leadershipBlockReason'] =
    verifiedIndexCodeCoverage < 80 ? 'VERIFIED_INDEX_CODE_COVERAGE_LOW'
      : mapping.unsafeAliasCandidatesCount > 0 ? 'UNSAFE_ALIAS_CANDIDATES'
        : !mapping.symmetryPassed ? 'SYMMETRY_VALIDATION_FAILED'
          : fallbackUsed === 'STOCK_DAILY' || fallbackUsed === 'STOCK_DAILY_PROXY' ? 'STOCK_DAILY_FALLBACK_DIAGNOSTIC_ONLY'
            : sectorDataStale ? 'SECTOR_INDEX_STALE'
            : 'NONE';
  const promotionAllowed = status === 'FETCH_OK' && leadershipBlockReason === 'NONE' && verifiedIndexCodeCoverage >= 80;
  const leadershipConfidence: LeadershipConfidence = promotionAllowed
    ? 'VERIFIED'
    : officialIndexCoverage > 0 || verifiedIndexCodeCoverage > 0
      ? 'PARTIAL'
      : internalProxyCoverage > 0 || stockDailyFallbackCoverage > 0 || adr0495Coverage.coveragePartial > 0
        ? 'SHADOW_ONLY'
        : 'BLOCKED';
  const sectorBoostAllowed = promotionAllowed;
  const strongBuyAllowed = promotionAllowed;
  const shadowLeadershipAllowed = leadershipConfidence !== 'BLOCKED';
  const selectedSectorEnergySourceTier = selectSectorEnergySourceTier({
    officialIndexCoverage,
    verifiedIndexCodeCoverage,
    internalProxyCoverage: internalGroupedSnapshotCoverage,
    stockDailyFallbackCoverage,
    fallbackUsed,
    hasKisOfficialRecord,
  });
  const reasonCodes = Array.from(new Set([
    ...buildSectorEnergyReasonCodes({
      officialIndexCoverage,
      verifiedIndexCodeCoverage,
      internalProxyCoverage,
      stockDailyFallbackCoverage,
      leadershipConfidence,
      promotionAllowed,
      unsafeAliasCount: mapping.unsafeAliasCandidatesCount,
      sectorDataStale,
      fallbackUsed,
      hasKisOfficialRecord,
      hasKrxOfficialRecord,
      unresolvedSectorCount: mapping.unresolvedSectorCount,
    }),
    ...(officialSectorIndexMaster?.reasonCodes ?? []),
  ]));
  const diagnostics: string[] = [];
  if (!evidencePresent) diagnostics.push('SectorEnergy master source evidence missing.');
  if (officialSectorIndexMaster) {
    diagnostics.push(`Official Sector Index Master masterSource=${officialSectorIndexMaster.masterSource} masterLoaded=${officialSectorIndexMaster.masterLoaded} masterRowCount=${officialSectorIndexMaster.masterRowCount} idxcodeMstDownloaded=${officialSectorIndexMaster.idxcodeMstDownloaded} cacheFallbackUsed=${officialSectorIndexMaster.cacheFallbackUsed} parseStatus=${officialSectorIndexMaster.parseStatus} mappedSectorCount=${officialSectorIndexMaster.mappedSectorCount}/${officialSectorIndexMaster.targetSectorCount} verifiedIndexCodeCount=${officialSectorIndexMaster.verifiedIndexCodeCount}/${officialSectorIndexMaster.targetSectorCount} verifyApiPath=${officialSectorIndexMaster.verifyApiPath} verifyTrId=${officialSectorIndexMaster.verifyTrId} verifyAttemptCount=${officialSectorIndexMaster.verifyAttemptCount ?? 0} verifyVariantAttemptCount=${officialSectorIndexMaster.verifyVariantAttemptCount ?? 0} verifyVariantTried=${officialSectorIndexMaster.verifyVariantTried === true} verifySuccessCount=${officialSectorIndexMaster.verifySuccessCount} verifyFailCount=${officialSectorIndexMaster.verifyFailCount} executionImpact=${officialSectorIndexMaster.executionImpact}.`);
    diagnostics.push(`Official Sector Index Master rawSampleRows=${(officialSectorIndexMaster.rawSampleRows ?? []).slice(0, 6).map((row) => `${row.idxDiv ?? '-'}:${row.idxCode}:raw=${row.rawIdxName ?? row.idxName}:normalized=${row.normalizedIdxName}:canonical=${row.canonicalOfficialName ?? row.normalizedIdxName}:prefixRemoved=${row.codePrefixRemoved === true}:verifyCandidates=${row.verifyInputCandidates?.join('/') || 'NONE'}`).join('|') || 'NONE'}.`);
    diagnostics.push(`Official Sector Index Master idxNameSampleTop=${(officialSectorIndexMaster.idxNameSampleTop ?? []).slice(0, 12).join(',') || 'NONE'}.`);
    diagnostics.push(`Internal Grouped Sector Input targetSectorCount=${officialSectorIndexMaster.targetSectorCount} internalSectorNames=${(officialSectorIndexMaster.internalSectorNames ?? []).slice(0, 12).join(',') || 'NONE'} normalizedInternalSectorNames=${(officialSectorIndexMaster.normalizedInternalSectorNames ?? []).slice(0, 12).join(',') || 'NONE'}.`);
    diagnostics.push(`EN_KR_AliasDictionaryStatus loaded=${officialSectorIndexMaster.aliasDictionaryStatus?.loaded === true} aliasCount=${officialSectorIndexMaster.aliasDictionaryStatus?.aliasCount ?? 0} safeAliasCount=${officialSectorIndexMaster.aliasDictionaryStatus?.safeAliasCount ?? 0} unsafeAliasCount=${officialSectorIndexMaster.aliasDictionaryStatus?.unsafeAliasCount ?? 0} sampleAliases=${officialSectorIndexMaster.aliasDictionaryStatus?.sampleAliases.slice(0, 5).join('|') || 'NONE'}.`);
    diagnostics.push(`KisIndexQuoteClientStatus enabled=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.enabled === true} verifyMode=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.verifyMode ?? 'OBSERVE'} livePromotionFromVerify=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.livePromotionFromVerify ?? false} authReady=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.authReady === true} tokenPresent=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.tokenPresent === true} tokenExpiresInSec=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.tokenExpiresInSec ?? 'NONE'} tokenProvider=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.tokenProvider ?? 'KIS_SHARED_TOKEN_PROVIDER'} baseUrlKind=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.baseUrlKind ?? 'UNKNOWN'} apiPath=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.apiPath ?? officialSectorIndexMaster.verifyApiPath} method=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.method ?? 'GET'} trId=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.trId ?? officialSectorIndexMaster.verifyTrId} canCall=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.canCall === true} disabledReason=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.disabledReason ?? 'NONE'} lastExceptionClass=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.lastExceptionClass ?? 'NONE'} lastExceptionMessageSanitized=${officialSectorIndexMaster.kisIndexQuoteClientStatus?.lastExceptionMessageSanitized ?? 'NONE'} executionImpact=NONE.`);
    diagnostics.push(`verifyVariantPolicy enabled=${officialSectorIndexMaster.verifyVariantPolicy?.enabled === true} triedVariants=${officialSectorIndexMaster.verifyVariantPolicy?.triedVariants.join(',') || 'NONE'} debugOnlyVariants=${officialSectorIndexMaster.verifyVariantPolicy?.debugOnlyVariants.join(',') || 'NONE'} colonHyphenSent=${officialSectorIndexMaster.verifyVariantPolicy?.colonHyphenSent === true}.`);
    diagnostics.push(`SectorIndexMasterCoverage targetSectorCount=${officialSectorIndexMaster.targetSectorCount} exactMatchCount=${officialSectorIndexMaster.exactMatchCount ?? 0} safeAliasMatchCount=${officialSectorIndexMaster.safeAliasMatchCount ?? 0} safeSynonymMatchCount=${officialSectorIndexMaster.safeSynonymMatchCount ?? 0} unsafeAliasCount=${officialSectorIndexMaster.unsafeAliasCount} unresolvedCount=${officialSectorIndexMaster.unresolvedCount ?? officialSectorIndexMaster.unresolvedSectorNames.length} officialIndexCoverage=${officialSectorIndexMaster.officialIndexCoverage}% verifiedIndexCodeCoverage=${officialSectorIndexMaster.verifiedIndexCodeCoverage}% unsafeAliasSectorNames=${(officialSectorIndexMaster.unsafeAliasSectorNames ?? []).join(',') || 'NONE'} unresolvedSectorNames=${officialSectorIndexMaster.unresolvedSectorNames.join(',') || 'NONE'} mappedSectorPairs=${(officialSectorIndexMaster.mappedSectorPairs ?? []).slice(0, 8).join('|') || 'NONE'}.`);
    diagnostics.push(...sectorIndexCoveragePolicyLines(officialSectorIndexMaster, {
      internalGroupedSectorCount: internalGroupedEvidence.validSectorCount,
      promotionAllowed,
    }).map((line) => `${line}.`));
    diagnostics.push(`SectorIndexMappingAttempt ${(officialSectorIndexMaster.mappingAttempts ?? []).slice(0, 12).map((attempt) => `${attempt.internalSectorName}:normalized=${attempt.normalizedInternalName}:aliasLookupKey=${attempt.aliasLookupKey ?? 'NONE'}:candidateOfficial=${(attempt.candidateOfficialNames ?? []).join('/') || 'NONE'}:rawOfficialCandidates=${(attempt.rawOfficialCandidates ?? []).join('/') || 'NONE'}:normalizedOfficialCandidates=${(attempt.normalizedOfficialCandidates ?? []).join('/') || 'NONE'}:canonicalOfficialCandidates=${(attempt.canonicalOfficialCandidates ?? []).join('/') || 'NONE'}:exact=${attempt.exactMatch}:safeAliasTarget=${attempt.safeAliasTarget ?? 'NONE'}:safe=${attempt.safeAliasMatch ?? 'NONE'}:unsafeTargets=${(attempt.unsafeAliasTargets ?? []).join('/') || 'NONE'}:unsafe=${attempt.unsafeAliasMatch ?? 'NONE'}:idxDiv=${attempt.idxDiv ?? 'NONE'}:idxCode=${attempt.idxCode ?? 'NONE'}:rawIdxName=${attempt.rawIdxName ?? 'NONE'}:selectedRaw=${attempt.selectedOfficialRawName ?? 'NONE'}:selectedCanonical=${attempt.selectedOfficialCanonicalName ?? 'NONE'}:selected=${attempt.selectedOfficialIndexName ?? 'NONE'}(${attempt.selectedOfficialIndexCode ?? '-'}):verifyInputCandidates=${(attempt.verifyInputCandidates ?? []).join('/') || 'NONE'}:prefixRemoved=${attempt.codePrefixRemoved === true}:included=${attempt.includedInOfficialCoverage}:shadowEvidenceOnly=${attempt.shadowEvidenceOnly === true}:verifyAttempted=${attempt.verifyAttempted === true}:verified=${attempt.verified === true}:reason=${attempt.reasonCode}`).join(' | ') || 'NONE'}.`);
    diagnostics.push(`SectorIndexUnresolvedDetails ${(officialSectorIndexMaster.unresolvedSectorDetails ?? []).slice(0, 12).map((detail) => `${detail.sector}:reason=${detail.reason}:aliasTarget=${detail.aliasTarget ?? 'NONE'}:candidateOfficial=${(detail.candidateOfficialNames ?? []).join('/') || 'NONE'}`).join(' | ') || 'NONE'}.`);
    diagnostics.push(`SectorIndexVerify verifyApiPath=${officialSectorIndexMaster.verifyApiPath} verifyTrId=${officialSectorIndexMaster.verifyTrId} verifyAttemptCount=${officialSectorIndexMaster.verifyAttemptCount ?? 0} verifyVariantAttemptCount=${officialSectorIndexMaster.verifyVariantAttemptCount ?? 0} verifyVariantTried=${officialSectorIndexMaster.verifyVariantTried === true} verifySuccessCount=${officialSectorIndexMaster.verifySuccessCount} verifyFailCount=${officialSectorIndexMaster.verifyFailCount} verifyFailureSamples=${(officialSectorIndexMaster.verifyApiFailureSamples ?? []).slice(0, 4).map((sample) => `${sample.sectorName}:rawIdxName=${sample.rawIdxName ?? 'NONE'}:idxDiv=${sample.idxDiv ?? 'NONE'}:idxCode=${sample.idxCode ?? sample.officialIndexCode}:tried=${(sample.triedCandidates ?? []).join('/') || 'NONE'}:selectedFailure=${sample.selectedFailureReason ?? sample.reasonCode}:currentIndex=${sample.currentIndex ?? 'NONE'}:rtCd=${sample.rtCd ?? 'NONE'}:msgCd=${sample.msgCd ?? 'NONE'}:msg1=${sample.msg1 ?? 'NONE'}:outputKeys=${(sample.outputKeys ?? []).join('/') || 'NONE'}`).join('|') || 'NONE'}.`);
    diagnostics.push(`SectorIndexVerifyRequestBuilt ${(officialSectorIndexMaster.verifyAttemptDetails ?? []).slice(0, 20).map((attempt) => `${attempt.sectorName}:method=${attempt.method ?? 'GET'}:apiPath=${attempt.apiPath}:trId=${attempt.trId}:FID_COND_MRKT_DIV_CODE=${attempt.fidCondMrktDivCode}:FID_INPUT_ISCD=${attempt.fidInputIscd}:queryKeys=FID_COND_MRKT_DIV_CODE,FID_INPUT_ISCD:headerKeys=authorization,appkey,appsecret,tr_id,custtype(masked):requestBuilt=${attempt.requestBuilt === true}:requestSent=${attempt.requestSent === true}:transportStage=${attempt.transportStage ?? 'NOT_ATTEMPTED'}`).join(' | ') || 'NONE'}.`);
    diagnostics.push(`SectorIndexVerifyResponse ${(officialSectorIndexMaster.verifyAttemptDetails ?? []).slice(0, 20).map((attempt) => `${attempt.sectorName}:httpStatus=${attempt.httpStatus ?? 'NONE'}:rtCd=${attempt.rtCd ?? 'NONE'}:msgCd=${attempt.msgCd ?? 'NONE'}:msg1=${attempt.msg1 ?? 'NONE'}:rawTopLevelKeys=${(attempt.rawTopLevelKeys ?? []).join('/') || 'NONE'}:outputKeys=${(attempt.outputKeys ?? []).join('/') || 'NONE'}:outputPresent=${attempt.outputPresent}:outputShape=${attempt.outputShape ?? 'NONE'}:indexValueFieldDetected=${attempt.indexValueFieldPresent}:indexValueFieldName=${attempt.indexValueFieldName ?? 'NONE'}:currentIndex=${attempt.currentIndex ?? 'NONE'}:reason=${attempt.reasonCode}`).join(' | ') || 'NONE'}.`);
    diagnostics.push(`SectorIndexVerifyAttempt ${(officialSectorIndexMaster.verifyAttemptDetails ?? []).slice(0, 20).map((attempt) => `${attempt.sectorName}:rawIdxName=${attempt.rawIdxName ?? 'NONE'}:idxDiv=${attempt.idxDiv ?? 'NONE'}:idxCode=${attempt.idxCode ?? 'NONE'}:canonical=${attempt.canonicalOfficialName ?? 'NONE'}:FID_COND_MRKT_DIV_CODE=${attempt.fidCondMrktDivCode}:FID_INPUT_ISCD=${attempt.fidInputIscd}:apiPath=${attempt.apiPath}:method=${attempt.method ?? 'GET'}:trId=${attempt.trId}:baseUrlKind=${attempt.baseUrlKind ?? 'UNKNOWN'}:requestBuilt=${attempt.requestBuilt === true}:requestSent=${attempt.requestSent === true}:httpStatus=${attempt.httpStatus ?? 'NONE'}:rtCd=${attempt.rtCd ?? 'NONE'}:msgCd=${attempt.msgCd ?? 'NONE'}:msg1=${attempt.msg1 ?? 'NONE'}:exceptionClass=${attempt.exceptionClass ?? 'NONE'}:exceptionMessageSanitized=${attempt.exceptionMessageSanitized ?? 'NONE'}:timeoutMs=${attempt.timeoutMs ?? 'NONE'}:retryCount=${attempt.retryCount ?? 0}:transportStage=${attempt.transportStage ?? 'NOT_ATTEMPTED'}:outputPresent=${attempt.outputPresent}:indexValueFieldPresent=${attempt.indexValueFieldPresent}:currentIndex=${attempt.currentIndex ?? 'NONE'}:rawTopLevelKeys=${(attempt.rawTopLevelKeys ?? []).join('/') || 'NONE'}:outputKeys=${(attempt.outputKeys ?? []).join('/') || 'NONE'}:verified=${attempt.verified}:reason=${attempt.reasonCode}`).join(' | ') || 'NONE'}.`);
  }
  if (diagnosticSectorRows.length > 0) diagnostics.push(`SectorEnergy official/index master rows extracted from diagnostic payload: ${diagnosticSectorRows.length}.`);
  if (fallbackUsed === 'STOCK_DAILY' || fallbackUsed === 'STOCK_DAILY_PROXY') diagnostics.push('STOCK_DAILY fallback remains diagnostic-only.');
  diagnostics.push(`ADR-0495 seed coverage verified=${adr0495Coverage.coverageVerified}% partial=${adr0495Coverage.coveragePartial}% unknown=${adr0495Coverage.coverageUnknown}%; guardrails executionImpact=NONE liveExecutionAllowed=false sectorBoostAllowed=false strongBuyAllowed=false rawPayloadPersistenceAllowed=false.`);
  diagnostics.push(`SectorEnergy coverage split officialIndexCoverage=${officialIndexCoverage}% verifiedIndexCodeCoverage=${verifiedIndexCodeCoverage}% internalGroupedSnapshotCoverage=${internalGroupedSnapshotCoverage}% internalProxyCoverageAlias=${internalProxyCoverage}% stockDailyFallbackCoverage=${stockDailyFallbackCoverage}%; selectedSourceTier=${selectedSectorEnergySourceTier}; leadershipConfidence=${leadershipConfidence}; promotionAllowed=${promotionAllowed}; leadershipBlockReason=${leadershipBlockReason}.`);
  const officialIndexMasterRecovery = buildOfficialIndexMasterRecoveryAdr0488({
    status,
    officialIndexCoverage,
    verifiedIndexCodeCoverage,
    internalGroupedSnapshotCoverage,
    ...(internalGroupedEvidence.validSectorCount !== undefined
      ? { internalGroupedValidSectorCount: internalGroupedEvidence.validSectorCount }
      : {}),
    ...(internalGroupedEvidence.expectedSectorCount !== undefined
      ? { internalGroupedExpectedSectorCount: internalGroupedEvidence.expectedSectorCount }
      : {}),
    internalProxyCoverage,
    stockDailyFallbackCoverage,
    leadershipBlockReason,
    selectedSectorEnergySourceTier,
    leadershipConfidence,
    promotionAllowed,
    sectorBoostAllowed,
    strongBuyAllowed,
    shadowLeadershipAllowed,
    reasonCodes,
    hasKisOfficialRecord,
    hasKrxOfficialRecord,
  });
  diagnostics.push(`Official index master recovery status=${officialIndexMasterRecovery.status}; sourceOfTruth=${officialIndexMasterRecovery.sourceOfTruth}; promotionAllowed=${promotionAllowed}; executionImpact=NONE.`);
  if (mapping.unsafeAliasCandidatesCount > 0) diagnostics.push('Unsafe alias candidates do not unlock leadership confidence.');
  if (!mapping.symmetryPassed) diagnostics.push('sectorName/indexCode symmetry is incomplete.');

  return {
    generatedAt,
    status,
    records,
    mappingDiagnostics: mapping,
    indexCodeCoverageBefore: roundPct(before),
    indexCodeCoverageAfter: roundPct(after),
    officialIndexCoverage,
    verifiedIndexCodeCoverage,
    internalGroupedSnapshotCoverage,
    ...(internalGroupedEvidence.validSectorCount !== undefined
      ? { internalGroupedValidSectorCount: internalGroupedEvidence.validSectorCount }
      : {}),
    ...(internalGroupedEvidence.expectedSectorCount !== undefined
      ? { internalGroupedExpectedSectorCount: internalGroupedEvidence.expectedSectorCount }
      : {}),
    internalProxyCoverage,
    stockDailyFallbackCoverage,
    aliasResolvedCount: mapping.aliasResolvedCount,
    aliasUnsafeCount: mapping.aliasUnsafeCount,
    unresolvedSectorCount: mapping.unresolvedSectorCount,
    coveragePct: roundPct(after),
    fresh: status === 'FETCH_OK' || status === 'PARTIAL' ? coveredRecords.length : 0,
    stale: diagnosticString(diag, ['dataQuality'], '') === 'STALE' ? 1 : 0,
    missing: status === 'DATA_UNAVAILABLE' ? 1 : mapping.missingIndexCodeCount,
    providerError: diagnosticString(diag, ['dataQuality'], '') === 'ERROR' ? 1 : 0,
    fallbackUsed,
    leadershipConfidence,
    leadershipBlockReason,
    promotionAllowed,
    sectorBoostAllowed,
    strongBuyAllowed,
    shadowLeadershipAllowed,
    counterfactualAllowed: true,
    selectedSectorEnergySourceTier,
    reasonCodes,
    topMissingSectorNames: mapping.unresolvedSectorNames.slice(0, 12),
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    operatorApprovalRequired: true,
    officialIndexMasterRecovery,
    ...(officialSectorIndexMaster ? { officialSectorIndexMaster } : {}),
    topGaps,
    recommendedNextActions: sectorActions(topGaps),
    adr0495Coverage,
    diagnostics,
  };
}

function candidateProviderIssue(input: BuildSupplyUnknownPolicyReportInputAdr0488): boolean {
  if (typeof input.providerIssue === 'boolean') return input.providerIssue;
  return (input.candidateSnapshots ?? []).some((snapshot) => snapshot.supplyProviderHealth?.providerIssue === true);
}

function candidateMarketSignal(input: BuildSupplyUnknownPolicyReportInputAdr0488): boolean {
  if (typeof input.marketSignal === 'boolean') return input.marketSignal;
  return (input.candidateSnapshots ?? []).some((snapshot) => snapshot.supplyProviderHealth?.marketSignal === true);
}

export function classifySupplyUnknownRootCauseAdr0488(
  input: BuildSupplyUnknownPolicyReportInputAdr0488 = {},
): SupplyUnknownRootCauseClassificationAdr0488 {
  const statusText = [
    input.providerStatus,
    input.currentSupplySignal,
    input.finalGate1CalibrationAdr0471?.providerRecoveryGuard.providerHealth,
  ].filter(Boolean).join(' ').toUpperCase();
  const providerVerified = statusText.includes('VERIFIED');
  const rawMarketSignal = candidateMarketSignal(input);
  const marketSignal = providerVerified ? false : rawMarketSignal;
  const providerIssue = !providerVerified && (candidateProviderIssue(input) || statusText.includes('UNKNOWN') || statusText.includes('UNAVAILABLE') || statusText.includes('EMPTY') || statusText.includes('MISMATCH'));
  let rootCause: SupplyUnknownRootCauseAdr0488 = 'SUPPLY_PROVIDER_UNKNOWN';
  if (marketSignal && !providerIssue) rootCause = 'SUPPLY_PROVIDER_UNKNOWN';
  else if (statusText.includes('MISMATCH')) rootCause = 'PROVIDER_MISMATCH';
  else if (statusText.includes('CACHE_EMPTY') || statusText.includes('EMPTY')) rootCause = 'CACHE_EMPTY';
  else if (statusText.includes('NON_TRADING')) rootCause = 'NON_TRADING_DAY';
  else if (statusText.includes('UNAVAILABLE') || statusText.includes('DATA_UNAVAILABLE')) rootCause = 'SUPPLY_DATA_UNAVAILABLE';
  return {
    providerIssue,
    marketSignal,
    rootCause,
    providerVerified,
    duplicatePenaltyGroupCollapsed: providerIssue && !marketSignal,
    diagnosticOnly: true,
    executionImpact: 'NONE',
  };
}

function scenarioFor(
  report: FinalGate1CalibrationAuditReport | null | undefined,
  scenario: UnknownPenaltyPolicyScenario,
) {
  return report?.unknownPolicyScenarios.find((item) => item.scenario === scenario) ?? null;
}

function currentSurvivors(input: BuildSupplyUnknownPolicyReportInputAdr0488): number {
  if (finite(input.survivorsCurrent)) return input.survivorsCurrent;
  const current = scenarioFor(input.finalGate1CalibrationAdr0471, 'CURRENT_RETAIN_10');
  if (current) return current.gate1Survivors;
  return input.penaltyDeduplicationAdr0469?.survivorsAfterDedup ?? 0;
}

function variantResult(
  input: BuildSupplyUnknownPolicyReportInputAdr0488,
  variant: SupplyUnknownDryRunVariantAdr0488,
  active: boolean,
): SupplyUnknownDryRunVariantResultAdr0488 {
  const scenario = scenarioFor(input.finalGate1CalibrationAdr0471, variant);
  return {
    variant,
    active,
    pointPenaltyAvg: round1(scenario?.pointPenaltyAvg ?? (variant === 'UNKNOWN_DIAGNOSTIC_ONLY' ? 0 : input.penaltyDeduplicationAdr0469?.unknownPenaltyAvg ?? 0)),
    netScoreAvg: round1(scenario?.netScoreAvg ?? input.diagnosticPolicyNetAvg ?? input.finalGate1CalibrationAdr0471?.unknownDiagnosticNetAvg ?? input.penaltyDeduplicationAdr0469?.dedupedNetScoreAvg ?? 0),
    survivors: scenario?.gate1Survivors ?? (variant === 'UNKNOWN_DIAGNOSTIC_ONLY' ? input.survivorsUnknownDiagnosticOnly ?? 0 : 0),
    shadowOnly: true,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    operatorApprovalRequired: true,
    reason: 'SUPPLY_UNKNOWN_DIAGNOSTIC_ONLY',
  };
}

export function buildSupplyUnknownPolicyReportAdr0488(
  input: BuildSupplyUnknownPolicyReportInputAdr0488 = {},
): SupplyUnknownPolicyStabilizationReportAdr0488 {
  const generatedAt = nowIso(input.generatedAt);
  const classification = classifySupplyUnknownRootCauseAdr0488(input);
  const active = classification.providerIssue && !classification.providerVerified;
  const unknownScenario = scenarioFor(input.finalGate1CalibrationAdr0471, 'UNKNOWN_DIAGNOSTIC_ONLY');
  const originalPenaltyAvg = round1(numberOr(input.originalPenaltyAvg, input.penaltyDeduplicationAdr0469?.originalPenaltyAvg ?? 0));
  const dedupedPenaltyAvg = round1(numberOr(input.dedupedPenaltyAvg, input.penaltyDeduplicationAdr0469?.dedupedPenaltyAvg ?? originalPenaltyAvg));
  const originalNetScoreAvg = round1(numberOr(input.originalNetScoreAvg, input.penaltyDeduplicationAdr0469?.originalNetScoreAvg ?? input.finalGate1CalibrationAdr0471?.bestRepairedNetAvg ?? 0));
  const diagnosticPolicyNetAvg = round1(numberOr(input.diagnosticPolicyNetAvg, unknownScenario?.netScoreAvg ?? input.finalGate1CalibrationAdr0471?.unknownDiagnosticNetAvg ?? originalNetScoreAvg));
  const survivorsUnknownDiagnosticOnly = numberOr(input.survivorsUnknownDiagnosticOnly, unknownScenario?.gate1Survivors ?? 0);
  const dryRunVariants = ([
    'UNKNOWN_DIAGNOSTIC_ONLY',
    'UNKNOWN_TO_CONFIDENCE_DOWNGRADE',
    'UNKNOWN_TO_SIZING_ONLY',
    'BEARISH_ONLY_SUPPLY_PENALTY',
  ] as const).map((variant) => variantResult(input, variant, active && variant !== 'BEARISH_ONLY_SUPPLY_PENALTY'));
  const status: SupplyUnknownPolicyStatusAdr0488 =
    classification.providerVerified ? 'VERIFIED_DISABLED'
      : active ? 'OBSERVING'
        : !classification.providerIssue && !classification.marketSignal ? 'DATA_UNAVAILABLE'
          : 'OBSERVING';
  const topGaps = new Set<string>();
  if (active) {
    topGaps.add('SUPPLY_UNKNOWN_POLICY_OBSERVE');
    topGaps.add('COLLECT_SUPPLY_SAMPLE_BEFORE_PROMOTION');
  }
  if (classification.rootCause === 'SUPPLY_DATA_UNAVAILABLE' || classification.rootCause === 'CACHE_EMPTY') {
    topGaps.add('COLLECT_SUPPLY_SAMPLE_BEFORE_PROMOTION');
  }
  const diagnostics: string[] = [];
  if (classification.providerVerified) diagnostics.push('Provider VERIFIED disables supply UNKNOWN diagnostic relaxation.');
  if (classification.providerIssue && !classification.marketSignal) diagnostics.push('Provider issue remains diagnostic-only and is not classified as market signal.');
  if (classification.marketSignal) diagnostics.push('Market signal observed but not promoted to MARKET_BEARISH_SUPPLY_SIGNAL at policy root.');

  return {
    generatedAt,
    status,
    classification,
    providerIssue: classification.providerIssue,
    marketSignal: classification.marketSignal,
    unknownPolicyActive: active,
    originalPenaltyAvg,
    dedupedPenaltyAvg,
    removedPenaltyAvg: round1(numberOr(input.penaltyDeduplicationAdr0469?.removedPenaltyAvg, originalPenaltyAvg - dedupedPenaltyAvg)),
    originalNetScoreAvg,
    diagnosticPolicyNetAvg,
    survivorsCurrent: currentSurvivors(input),
    survivorsUnknownDiagnosticOnly,
    providerVerifiedOverrideWarning: classification.providerVerified,
    autoDisableWhenProviderVerified: true,
    requiredScore: REQUIRED_SCORE_ADR0488,
    dryRunVariants,
    topGaps: Array.from(topGaps),
    recommendedNextActions: active
      ? ['OBSERVE_3D_THEN_OPERATOR_APPROVAL', 'COLLECT_SUPPLY_SAMPLE_BEFORE_PROMOTION']
      : ['WAIT_FOR_PROVIDER_VERIFICATION_OR_SAMPLE_EVIDENCE'],
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    diagnostics,
  };
}

function overallStatus(
  sector: SectorEnergyMasterSupplyLineReportAdr0488,
  supply: SupplyUnknownPolicyStabilizationReportAdr0488,
): SectorEnergyAndSupplyUnknownPolicyReportAdr0488['overallStatus'] {
  if (sector.status === 'DATA_UNAVAILABLE' && supply.status === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  if (sector.status === 'DEGRADED') return 'DEGRADED';
  if (sector.status === 'PARTIAL' || supply.status === 'OBSERVING') return 'PARTIAL';
  if (sector.status === 'FETCH_OK') return 'OBSERVING';
  return 'UNKNOWN';
}

export function buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488(
  input: BuildSectorEnergyAndSupplyUnknownPolicyReportInputAdr0488 = {},
): SectorEnergyAndSupplyUnknownPolicyReportAdr0488 {
  if (input.throwForTest) throw new Error('ADR-0488 test failure');
  const generatedAt = nowIso(input.generatedAt);
  const sectorEnergyMaster = buildSectorEnergyMasterReportAdr0488({ ...input, generatedAt, useAdr0495Seed: input.useAdr0495Seed ?? true });
  const supplyUnknownPolicy = buildSupplyUnknownPolicyReportAdr0488({ ...input, generatedAt });
  const topGaps = Array.from(new Set([...sectorEnergyMaster.topGaps, ...supplyUnknownPolicy.topGaps]));
  const recommendedNextActions = [
    ...sectorEnergyMaster.recommendedNextActions,
    ...supplyUnknownPolicy.recommendedNextActions,
  ].slice(0, 8);
  return {
    generatedAt,
    overallStatus: overallStatus(sectorEnergyMaster, supplyUnknownPolicy),
    sectorEnergyMaster,
    supplyUnknownPolicy,
    topGaps,
    recommendedNextActions,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    diagnostics: [...sectorEnergyMaster.diagnostics, ...supplyUnknownPolicy.diagnostics],
  };
}

export function safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488(
  input: BuildSectorEnergyAndSupplyUnknownPolicyReportInputAdr0488 = {},
): SectorEnergyAndSupplyUnknownPolicyReportAdr0488 {
  try {
    return buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488(input);
  } catch (error) {
    console.warn('[ADR-0488] build failed; returning isolated diagnostic-only fallback:', error);
    const generatedAt = nowIso(input.generatedAt);
    return {
      generatedAt,
      overallStatus: 'UNKNOWN',
      sectorEnergyMaster: buildSectorEnergyMasterReportAdr0488({ generatedAt }),
      supplyUnknownPolicy: buildSupplyUnknownPolicyReportAdr0488({ generatedAt }),
      topGaps: ['REPAIR_SECTOR_INDEX_MASTER', 'SUPPLY_UNKNOWN_POLICY_OBSERVE'],
      recommendedNextActions: ['Retry ADR-0488 diagnostic build; do not change live execution.'],
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      operatorApprovalRequired: true,
      diagnostics: ['ADR-0488 build failure was try/catch isolated.'],
    };
  }
}

function pct(value: number): string {
  return `${round1(value)}%`;
}

export function formatSectorEnergySupplyUnknownCompactAdr0488(report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488): string {
  const sector = report.sectorEnergyMaster;
  const supply = report.supplyUnknownPolicy;
  const official = sector.officialIndexMasterRecovery;
  const master = sector.officialSectorIndexMaster;
  return [
    `ADR-0488 SectorEnergyMaster: ${sector.status} | selectedSourceTier=${sector.selectedSectorEnergySourceTier} | coverageBefore=${pct(sector.indexCodeCoverageBefore)} | coverageAfter=${pct(sector.indexCodeCoverageAfter)} | officialIndexCoverage=${pct(sector.officialIndexCoverage)} | verifiedIndexCodeCoverage=${pct(sector.verifiedIndexCodeCoverage)} | internalGroupedSnapshotCoverage=${pct(sector.internalGroupedSnapshotCoverage)} | internalGroupedValidSectorCount=${sector.internalGroupedValidSectorCount ?? 0}/${sector.internalGroupedExpectedSectorCount ?? 0} | internalProxyCoverage=${pct(sector.internalProxyCoverage)} | stockDailyFallbackCoverage=${pct(sector.stockDailyFallbackCoverage)} | missing=${sector.mappingDiagnostics.missingIndexCodeCount} | leadershipConfidence=${sector.leadershipConfidence} | promotionAllowed=${sector.promotionAllowed} | reason=${sector.leadershipBlockReason} | sectorBoostAllowed=${sector.sectorBoostAllowed} | strongBuyAllowed=${sector.strongBuyAllowed} | shadowLeadershipAllowed=${sector.shadowLeadershipAllowed} | counterfactualAllowed=${sector.counterfactualAllowed} | impact=${sector.executionImpact}`,
    `ADR-0488 OfficialIndexMasterRecovery: ${official.status} | sourceOfTruth=${official.sourceOfTruth} | selectedSourceTier=${official.selectedSectorEnergySourceTier} | officialIndexCoverage=${pct(official.officialIndexCoverage)} | verifiedIndexCodeCoverage=${pct(official.verifiedIndexCodeCoverage)} | requiredVerifiedCoverage=${pct(official.requiredVerifiedCoveragePct)} | promotionAllowed=${official.promotionAllowed} | sectorBoostAllowed=${official.sectorBoostAllowed} | strongBuyAllowed=${official.strongBuyAllowed} | shadowLeadershipAllowed=${official.shadowLeadershipAllowed} | impact=${official.executionImpact}`,
    ...(master ? [
      `Official Sector Index Master Debug: masterSource=${master.masterSource} masterLoaded=${master.masterLoaded} masterRowCount=${master.masterRowCount} parseStatus=${master.parseStatus} idxcodeMstDownloaded=${master.idxcodeMstDownloaded} cacheFallbackUsed=${master.cacheFallbackUsed} rawSampleRows=${(master.rawSampleRows ?? []).slice(0, 5).map((row) => `${row.idxDiv ?? '-'}:${row.idxCode}:raw=${row.rawIdxName ?? row.idxName}:normalized=${row.normalizedIdxName}:canonical=${row.canonicalOfficialName ?? row.normalizedIdxName}:prefixRemoved=${row.codePrefixRemoved === true}:verifyCandidates=${row.verifyInputCandidates?.join('/') || 'NONE'}`).join('|') || 'NONE'} idxNameSampleTop=${(master.idxNameSampleTop ?? []).slice(0, 8).join(',') || 'NONE'}`,
      `Internal Grouped Sector Input: groupedValidSectorCount=${sector.internalGroupedValidSectorCount ?? 0}/${sector.internalGroupedExpectedSectorCount ?? master.targetSectorCount} internalSectorNames=${(master.internalSectorNames ?? []).slice(0, 12).join(',') || 'NONE'} normalizedInternalSectorNames=${(master.normalizedInternalSectorNames ?? []).slice(0, 12).join(',') || 'NONE'}`,
      `EN_KR_AliasDictionaryStatus: loaded=${master.aliasDictionaryStatus?.loaded === true} aliasCount=${master.aliasDictionaryStatus?.aliasCount ?? 0} safeAliasCount=${master.aliasDictionaryStatus?.safeAliasCount ?? 0} unsafeAliasCount=${master.aliasDictionaryStatus?.unsafeAliasCount ?? 0} sampleAliases=${master.aliasDictionaryStatus?.sampleAliases.slice(0, 5).join('|') || 'NONE'}`,
      `KisIndexQuoteClientStatus: enabled=${master.kisIndexQuoteClientStatus?.enabled === true} verifyMode=${master.kisIndexQuoteClientStatus?.verifyMode ?? 'OBSERVE'} livePromotionFromVerify=${master.kisIndexQuoteClientStatus?.livePromotionFromVerify ?? false} authReady=${master.kisIndexQuoteClientStatus?.authReady === true} tokenPresent=${master.kisIndexQuoteClientStatus?.tokenPresent === true} tokenExpiresInSec=${master.kisIndexQuoteClientStatus?.tokenExpiresInSec ?? 'NONE'} tokenProvider=${master.kisIndexQuoteClientStatus?.tokenProvider ?? 'KIS_SHARED_TOKEN_PROVIDER'} baseUrlKind=${master.kisIndexQuoteClientStatus?.baseUrlKind ?? 'UNKNOWN'} apiPath=${master.kisIndexQuoteClientStatus?.apiPath ?? master.verifyApiPath} method=${master.kisIndexQuoteClientStatus?.method ?? 'GET'} trId=${master.kisIndexQuoteClientStatus?.trId ?? master.verifyTrId} canCall=${master.kisIndexQuoteClientStatus?.canCall === true} disabledReason=${master.kisIndexQuoteClientStatus?.disabledReason ?? 'NONE'} lastExceptionClass=${master.kisIndexQuoteClientStatus?.lastExceptionClass ?? 'NONE'} lastExceptionMessageSanitized=${master.kisIndexQuoteClientStatus?.lastExceptionMessageSanitized ?? 'NONE'} executionImpact=NONE`,
      `verifyVariantPolicy: enabled=${master.verifyVariantPolicy?.enabled === true} triedVariants=${master.verifyVariantPolicy?.triedVariants.join(',') || 'NONE'} debugOnlyVariants=${master.verifyVariantPolicy?.debugOnlyVariants.join(',') || 'NONE'} colonHyphenSent=${master.verifyVariantPolicy?.colonHyphenSent === true}`,
      `SectorIndexMasterCoverage: targetSectorCount=${master.targetSectorCount} exactMatchCount=${master.exactMatchCount ?? 0} safeAliasMatchCount=${master.safeAliasMatchCount ?? 0} safeSynonymMatchCount=${master.safeSynonymMatchCount ?? 0} unsafeAliasCount=${master.unsafeAliasCount} unresolvedCount=${master.unresolvedCount ?? master.unresolvedSectorNames.length} officialIndexCoverage=${pct(master.officialIndexCoverage)} verifiedIndexCodeCoverage=${pct(master.verifiedIndexCodeCoverage)} mappedSectorPairs=${(master.mappedSectorPairs ?? []).slice(0, 8).join('|') || 'NONE'} unresolvedSectorNames=${master.unresolvedSectorNames.join(',') || 'NONE'} unsafeAliasSectorNames=${(master.unsafeAliasSectorNames ?? []).join(',') || 'NONE'}`,
      ...sectorIndexCoveragePolicyLines(master, {
        internalGroupedSectorCount: sector.internalGroupedValidSectorCount,
        promotionAllowed: sector.promotionAllowed,
      }),
      `SectorIndexMappingAttempt: ${(master.mappingAttempts ?? []).slice(0, 12).map((attempt) => `${attempt.internalSectorName}:normalized=${attempt.normalizedInternalName}:aliasLookupKey=${attempt.aliasLookupKey ?? 'NONE'}:safeAliasTarget=${attempt.safeAliasTarget ?? 'NONE'}:unsafeAliasTargets=${(attempt.unsafeAliasTargets ?? []).join('/') || 'NONE'}:candidateOfficial=${(attempt.candidateOfficialNames ?? []).join('/') || 'NONE'}:rawOfficialCandidates=${(attempt.rawOfficialCandidates ?? []).join('/') || 'NONE'}:normalizedOfficialCandidates=${(attempt.normalizedOfficialCandidates ?? []).join('/') || 'NONE'}:canonicalOfficialCandidates=${(attempt.canonicalOfficialCandidates ?? []).join('/') || 'NONE'}:idxDiv=${attempt.idxDiv ?? 'NONE'}:idxCode=${attempt.idxCode ?? 'NONE'}:rawIdxName=${attempt.rawIdxName ?? 'NONE'}:selectedRaw=${attempt.selectedOfficialRawName ?? 'NONE'}:selectedCanonical=${attempt.selectedOfficialCanonicalName ?? 'NONE'}:selected=${attempt.selectedOfficialIndexName ?? 'NONE'}(${attempt.selectedOfficialIndexCode ?? '-'}):verifyInputCandidates=${(attempt.verifyInputCandidates ?? []).join('/') || 'NONE'}:prefixRemoved=${attempt.codePrefixRemoved === true}:included=${attempt.includedInOfficialCoverage}:shadowEvidenceOnly=${attempt.shadowEvidenceOnly === true}:verifyAttempted=${attempt.verifyAttempted === true}:verified=${attempt.verified === true}:reason=${attempt.reasonCode}`).join(' | ') || 'NONE'}`,
      `SectorIndexUnresolvedDetails: ${(master.unresolvedSectorDetails ?? []).slice(0, 12).map((detail) => `${detail.sector}:reason=${detail.reason}:aliasTarget=${detail.aliasTarget ?? 'NONE'}:candidateOfficial=${(detail.candidateOfficialNames ?? []).join('/') || 'NONE'}`).join(' | ') || 'NONE'}`,
      `SectorIndexVerify: verifyApiPath=${master.verifyApiPath} verifyTrId=${master.verifyTrId} verifyAttemptCount=${master.verifyAttemptCount ?? 0} verifyVariantAttemptCount=${master.verifyVariantAttemptCount ?? 0} verifyVariantTried=${master.verifyVariantTried === true} verifySuccessCount=${master.verifySuccessCount} verifyFailCount=${master.verifyFailCount} verifyFailureSamples=${(master.verifyApiFailureSamples ?? []).slice(0, 4).map((sample) => `${sample.sectorName}:rawIdxName=${sample.rawIdxName ?? 'NONE'}:idxDiv=${sample.idxDiv ?? 'NONE'}:idxCode=${sample.idxCode ?? sample.officialIndexCode}:tried=${(sample.triedCandidates ?? []).join('/') || 'NONE'}:selectedFailure=${sample.selectedFailureReason ?? sample.reasonCode}:currentIndex=${sample.currentIndex ?? 'NONE'}:rtCd=${sample.rtCd ?? 'NONE'}:msgCd=${sample.msgCd ?? 'NONE'}:msg1=${sample.msg1 ?? 'NONE'}:outputKeys=${(sample.outputKeys ?? []).join('/') || 'NONE'}`).join('|') || 'NONE'}`,
      `SectorIndexVerifyRequestBuilt: ${(master.verifyAttemptDetails ?? []).slice(0, 20).map((attempt) => `${attempt.sectorName}:method=${attempt.method ?? 'GET'}:apiPath=${attempt.apiPath}:trId=${attempt.trId}:FID_COND_MRKT_DIV_CODE=${attempt.fidCondMrktDivCode}:FID_INPUT_ISCD=${attempt.fidInputIscd}:queryKeys=FID_COND_MRKT_DIV_CODE,FID_INPUT_ISCD:headerKeys=authorization,appkey,appsecret,tr_id,custtype(masked):requestBuilt=${attempt.requestBuilt === true}:requestSent=${attempt.requestSent === true}:transportStage=${attempt.transportStage ?? 'NOT_ATTEMPTED'}`).join(' | ') || 'NONE'}`,
      `SectorIndexVerifyResponse: ${(master.verifyAttemptDetails ?? []).slice(0, 20).map((attempt) => `${attempt.sectorName}:httpStatus=${attempt.httpStatus ?? 'NONE'}:rtCd=${attempt.rtCd ?? 'NONE'}:msgCd=${attempt.msgCd ?? 'NONE'}:msg1=${attempt.msg1 ?? 'NONE'}:rawTopLevelKeys=${(attempt.rawTopLevelKeys ?? []).join('/') || 'NONE'}:outputKeys=${(attempt.outputKeys ?? []).join('/') || 'NONE'}:outputPresent=${attempt.outputPresent}:outputShape=${attempt.outputShape ?? 'NONE'}:indexValueFieldDetected=${attempt.indexValueFieldPresent}:indexValueFieldName=${attempt.indexValueFieldName ?? 'NONE'}:currentIndex=${attempt.currentIndex ?? 'NONE'}:reason=${attempt.reasonCode}`).join(' | ') || 'NONE'}`,
      `SectorIndexVerifyAttempt: ${(master.verifyAttemptDetails ?? []).slice(0, 20).map((attempt) => `${attempt.sectorName}:rawIdxName=${attempt.rawIdxName ?? 'NONE'}:idxDiv=${attempt.idxDiv ?? 'NONE'}:idxCode=${attempt.idxCode ?? 'NONE'}:canonical=${attempt.canonicalOfficialName ?? 'NONE'}:FID_COND_MRKT_DIV_CODE=${attempt.fidCondMrktDivCode}:FID_INPUT_ISCD=${attempt.fidInputIscd}:apiPath=${attempt.apiPath}:method=${attempt.method ?? 'GET'}:trId=${attempt.trId}:baseUrlKind=${attempt.baseUrlKind ?? 'UNKNOWN'}:requestBuilt=${attempt.requestBuilt === true}:requestSent=${attempt.requestSent === true}:httpStatus=${attempt.httpStatus ?? 'NONE'}:rtCd=${attempt.rtCd ?? 'NONE'}:msgCd=${attempt.msgCd ?? 'NONE'}:msg1=${attempt.msg1 ?? 'NONE'}:exceptionClass=${attempt.exceptionClass ?? 'NONE'}:exceptionMessageSanitized=${attempt.exceptionMessageSanitized ?? 'NONE'}:timeoutMs=${attempt.timeoutMs ?? 'NONE'}:retryCount=${attempt.retryCount ?? 0}:transportStage=${attempt.transportStage ?? 'NOT_ATTEMPTED'}:outputPresent=${attempt.outputPresent}:indexValueFieldPresent=${attempt.indexValueFieldPresent}:currentIndex=${attempt.currentIndex ?? 'NONE'}:rawTopLevelKeys=${(attempt.rawTopLevelKeys ?? []).join('/') || 'NONE'}:outputKeys=${(attempt.outputKeys ?? []).join('/') || 'NONE'}:verified=${attempt.verified}:reason=${attempt.reasonCode}`).join(' | ') || 'NONE'}`,
    ] : [
      'Official Sector Index Master Debug: masterLoaded=false masterRowCount=0 parseStatus=NOT_ATTEMPTED rawSampleRows=NONE mappingAttempt=NONE',
    ]),
    `ADR-0488 SupplyUnknownPolicy: ${supply.status} | providerIssue=${supply.providerIssue} | marketSignal=${supply.marketSignal} | unknownPolicyActive=${supply.unknownPolicyActive} | diagnosticNet=${round1(supply.diagnosticPolicyNetAvg)} | survivors=${supply.survivorsCurrent}->${supply.survivorsUnknownDiagnosticOnly} | requiredScore=${supply.requiredScore} | impact=${supply.executionImpact}`,
    `   action: ${report.recommendedNextActions[0] ?? 'continue SHADOW_ONLY observation'}`,
  ].join('\n');
}

export function formatSectorEnergySupplyUnknownDetailAdr0488(report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488): string {
  const sector = report.sectorEnergyMaster;
  const supply = report.supplyUnknownPolicy;
  const official = sector.officialIndexMasterRecovery;
  const records = sector.records.length > 0
    ? sector.records.map((record) => `- ${record.sectorName}: indexCode=${record.indexCode ?? 'missing'} market=${record.market} source=${record.source} normalized=${record.normalized} aggregateIgnored=${record.coverageMetadata.aggregateIgnored}`)
    : ['- none'];
  return [
    'ADR-0488 SectorEnergy Master Data Supply Line + Supply UNKNOWN Policy Stabilization',
    `overallStatus=${report.overallStatus} policyPromotionMode=${report.policyPromotionMode}`,
    'SectorEnergyMaster:',
    `- status=${sector.status} coverageBefore=${pct(sector.indexCodeCoverageBefore)} coverageAfter=${pct(sector.indexCodeCoverageAfter)} missingIndexCodeCount=${sector.mappingDiagnostics.missingIndexCodeCount}`,
    `- officialIndexCoverage=${pct(sector.officialIndexCoverage)} verifiedIndexCodeCoverage=${pct(sector.verifiedIndexCodeCoverage)} internalGroupedSnapshotCoverage=${pct(sector.internalGroupedSnapshotCoverage)} internalGroupedValidSectorCount=${sector.internalGroupedValidSectorCount ?? 0}/${sector.internalGroupedExpectedSectorCount ?? 0} internalProxyCoverage=${pct(sector.internalProxyCoverage)} stockDailyFallbackCoverage=${pct(sector.stockDailyFallbackCoverage)} leadershipBlockReason=${sector.leadershipBlockReason}`,
    `- ADR-0495 coverageVerified=${pct(sector.adr0495Coverage?.coverageVerified ?? 0)} coveragePartial=${pct(sector.adr0495Coverage?.coveragePartial ?? 0)} coverageUnknown=${pct(sector.adr0495Coverage?.coverageUnknown ?? 0)} normalized=${sector.adr0495Coverage?.normalized ?? false}`,
    `- aggregateIgnored=${sector.mappingDiagnostics.aggregateIgnoredCount} aliasMissing=${sector.mappingDiagnostics.aliasMissingCount} aliasResolvedCount=${sector.aliasResolvedCount} aliasUnsafeCount=${sector.aliasUnsafeCount} safeAliasCandidates=${sector.mappingDiagnostics.safeAliasCandidatesCount} unsafeAliasCandidates=${sector.mappingDiagnostics.unsafeAliasCandidatesCount} unresolvedSectorCount=${sector.unresolvedSectorCount}`,
    `- ADR-0495 safeAliasCandidates=${sector.adr0495Coverage?.safeAliasCandidates.slice(0, 12).join(',') || 'none'} unsafeAliasCandidates=${sector.adr0495Coverage?.unsafeAliasCandidates.join(',') || 'none'}`,
    `- ADR-0495 fallbackMode=${sector.adr0495Coverage?.fallbackMode ?? 'NONE'} rawPayloadPersistenceAllowed=${sector.adr0495Coverage?.guardrails.rawPayloadPersistenceAllowed ?? false} automaticStagePromotionAllowed=${sector.adr0495Coverage?.guardrails.automaticStagePromotionAllowed ?? false}`,
    `- fallbackUsed=${sector.fallbackUsed} selectedSourceTier=${sector.selectedSectorEnergySourceTier} leadershipConfidence=${sector.leadershipConfidence} promotionAllowed=${sector.promotionAllowed} sectorBoostAllowed=${sector.sectorBoostAllowed} strongBuyAllowed=${sector.strongBuyAllowed} shadowLeadershipAllowed=${sector.shadowLeadershipAllowed} counterfactualAllowed=${sector.counterfactualAllowed}`,
    `- officialIndexMasterRecovery=${official.status} sourceOfTruth=${official.sourceOfTruth} selectedSourceTier=${official.selectedSectorEnergySourceTier} official=${pct(official.officialIndexCoverage)} verified=${pct(official.verifiedIndexCodeCoverage)} internalGroupedSnapshot=${pct(official.internalGroupedSnapshotCoverage)} internalGroupedValidSectorCount=${official.internalGroupedValidSectorCount ?? 0}/${official.internalGroupedExpectedSectorCount ?? 0} internalProxy=${pct(official.internalProxyCoverage)} stockDailyFallback=${pct(official.stockDailyFallbackCoverage)} promotionAllowed=${official.promotionAllowed} nextAction=${official.nextAction}`,
    `- basketEvidence sourceTier=KIS_STOCK_BASKET_DERIVED coverage=${pct(sector.stockDailyFallbackCoverage)} officialEquivalent=false useForPromotion=false useForShadowEvidence=${sector.stockDailyFallbackCoverage > 0}`,
    `- reasonCodes=${sector.reasonCodes.join(',') || 'none'} topMissingSectorNames=${sector.topMissingSectorNames.join(',') || 'none'}`,
    `- unresolvedSectorNames=${sector.mappingDiagnostics.unresolvedSectorNames.join(',') || 'none'}`,
    'sanitizedRecords:',
    ...records,
    'SupplyUnknownPolicy:',
    `- status=${supply.status} providerIssue=${supply.providerIssue} marketSignal=${supply.marketSignal} rootCause=${supply.classification.rootCause} unknownPolicyActive=${supply.unknownPolicyActive}`,
    `- originalPenaltyAvg=${supply.originalPenaltyAvg} dedupedPenaltyAvg=${supply.dedupedPenaltyAvg} removedPenaltyAvg=${supply.removedPenaltyAvg}`,
    `- originalNetScoreAvg=${supply.originalNetScoreAvg} diagnosticPolicyNetAvg=${supply.diagnosticPolicyNetAvg} survivorsCurrent=${supply.survivorsCurrent} survivorsUnknownDiagnosticOnly=${supply.survivorsUnknownDiagnosticOnly}`,
    `- providerVerifiedOverrideWarning=${supply.providerVerifiedOverrideWarning} autoDisableWhenProviderVerified=${supply.autoDisableWhenProviderVerified}`,
    'dryRunVariants:',
    ...supply.dryRunVariants.map((variant) => `- ${variant.variant}: active=${variant.active} netScoreAvg=${variant.netScoreAvg} survivors=${variant.survivors} shadowOnly=${variant.shadowOnly} liveExecutionAllowed=${variant.liveExecutionAllowed}`),
    `topGaps=${report.topGaps.join(',') || 'none'}`,
    `recommendedNextActions=${report.recommendedNextActions.join(' | ') || 'continue observation'}`,
    `guardrails: executionImpact=${report.executionImpact}; liveExecutionAllowed=${report.liveExecutionAllowed}; policyPromotionMode=${report.policyPromotionMode}; operatorApprovalRequired=${report.operatorApprovalRequired}; requiredScore=70; no Gate/Kelly/KIS order changes; official SectorEnergy promotion requires verified coverage; raw provider payloads stay blocked; UNKNOWN remains UNKNOWN; provider issue is not bearish.`,
  ].join('\n');
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

export function getSectorEnergySupplyUnknownDetailRegistryEntryAdr0488(
  report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488,
): SectorEnergySupplyUnknownDetailRegistryEntryAdr0488 {
  return {
    adr: '0488',
    sectionId: 'sector_energy_supply_unknown',
    commandHint: '/fresh_data_status',
    scanBlockersDetailHint: '/scan_blockers_detail sector_energy_supply_unknown',
    adrTraceHint: '/adr_trace 0488',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatSectorEnergySupplyUnknownDetailAdr0488(report),
  };
}

function operatorSourceForGap(gap: string): OperatorActionSource {
  const severity = gap.includes('COLLECT') || gap.includes('REPAIR') ? 'DATA_UNAVAILABLE' : 'DEGRADED';
  return {
    adr: '0488',
    sectionId: 'sector_energy_supply_unknown',
    code: gap,
    diagnosticKey: gap,
    diagnosticValue: 'ADR-0488 SHADOW_ONLY observation gap',
    severity,
  };
}

export function collectOperatorActionSourcesFromAdr0488(
  report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null | undefined,
): OperatorActionSource[] {
  if (!report) return [];
  const gaps = new Set(report.topGaps);
  if (report.sectorEnergyMaster.status !== 'FETCH_OK') gaps.add('REPAIR_SECTOR_INDEX_MASTER');
  if (report.sectorEnergyMaster.coveragePct < 80) gaps.add('IMPROVE_INDEX_CODE_COVERAGE');
  if (report.supplyUnknownPolicy.unknownPolicyActive) gaps.add('SUPPLY_UNKNOWN_POLICY_OBSERVE');
  if (report.supplyUnknownPolicy.providerIssue) gaps.add('COLLECT_SUPPLY_SAMPLE_BEFORE_PROMOTION');
  return Array.from(gaps).map(operatorSourceForGap);
}

export function buildAdr0488ObservationRows(report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488): Record<string, unknown>[] {
  const base = {
    createdAt: report.generatedAt,
    forDate: report.generatedAt.slice(0, 10),
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
    requiredScore: REQUIRED_SCORE_ADR0488,
    marketSignal: false,
    sellOnly: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: report.policyPromotionMode,
    status: 'OBSERVING',
  };
  return [
    {
      ...base,
      id: `adr0488-sector-${report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
      source: 'ADR_0488_SECTOR_ENERGY_MASTER_SUPPLY_LINE',
      symbol: 'SECTOR_ENERGY_MASTER',
      dryRunScenario: 'SECTOR_ENERGY_MASTER_SUPPLY_LINE_ADR0488',
      providerIssue: report.sectorEnergyMaster.status !== 'FETCH_OK',
      sectorEnergyDiagnosticOnly: true,
      observationType: 'SECTOR_ENERGY_MASTER_SUPPLY_LINE_ADR0488',
      overallStatus: report.overallStatus,
      sectorEnergyStatus: report.sectorEnergyMaster.status,
      indexCodeCoverageBefore: report.sectorEnergyMaster.indexCodeCoverageBefore,
      indexCodeCoverageAfter: report.sectorEnergyMaster.indexCodeCoverageAfter,
      internalGroupedSnapshotCoverage: report.sectorEnergyMaster.internalGroupedSnapshotCoverage,
      internalGroupedValidSectorCount: report.sectorEnergyMaster.internalGroupedValidSectorCount,
      internalGroupedExpectedSectorCount: report.sectorEnergyMaster.internalGroupedExpectedSectorCount,
      missingIndexCodeCount: report.sectorEnergyMaster.mappingDiagnostics.missingIndexCodeCount,
      aggregateIgnored: report.sectorEnergyMaster.mappingDiagnostics.aggregateIgnoredCount,
      aliasMissing: report.sectorEnergyMaster.mappingDiagnostics.aliasMissingCount,
      safeAliasCandidates: report.sectorEnergyMaster.mappingDiagnostics.safeAliasCandidatesCount,
      unsafeAliasCandidates: report.sectorEnergyMaster.mappingDiagnostics.unsafeAliasCandidatesCount,
      fallbackUsed: report.sectorEnergyMaster.fallbackUsed,
      leadershipConfidence: report.sectorEnergyMaster.leadershipConfidence,
      selectedSectorEnergySourceTier: report.sectorEnergyMaster.selectedSectorEnergySourceTier,
      promotionAllowed: report.sectorEnergyMaster.promotionAllowed,
      sectorBoostAllowed: report.sectorEnergyMaster.sectorBoostAllowed,
      strongBuyAllowed: report.sectorEnergyMaster.strongBuyAllowed,
      shadowLeadershipAllowed: report.sectorEnergyMaster.shadowLeadershipAllowed,
      counterfactualAllowed: report.sectorEnergyMaster.counterfactualAllowed,
      reasonCodes: report.sectorEnergyMaster.reasonCodes,
      topGaps: report.sectorEnergyMaster.topGaps,
    },
    {
      ...base,
      id: `adr0488-supply-${report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
      source: 'ADR_0488_SUPPLY_UNKNOWN_POLICY_STABILIZATION',
      symbol: 'SUPPLY_UNKNOWN_POLICY',
      dryRunScenario: 'SUPPLY_UNKNOWN_POLICY_STABILIZATION_ADR0488',
      providerIssue: report.supplyUnknownPolicy.providerIssue,
      sectorEnergyDiagnosticOnly: false,
      observationType: 'SUPPLY_UNKNOWN_POLICY_STABILIZATION_ADR0488',
      supplyUnknownStatus: report.supplyUnknownPolicy.status,
      rootCause: report.supplyUnknownPolicy.classification.rootCause,
      unknownPolicyActive: report.supplyUnknownPolicy.unknownPolicyActive,
      originalPenaltyAvg: report.supplyUnknownPolicy.originalPenaltyAvg,
      dedupedPenaltyAvg: report.supplyUnknownPolicy.dedupedPenaltyAvg,
      diagnosticPolicyNetAvg: report.supplyUnknownPolicy.diagnosticPolicyNetAvg,
      survivorsCurrent: report.supplyUnknownPolicy.survivorsCurrent,
      survivorsUnknownDiagnosticOnly: report.supplyUnknownPolicy.survivorsUnknownDiagnosticOnly,
      providerVerifiedOverrideWarning: report.supplyUnknownPolicy.providerVerifiedOverrideWarning,
      autoDisableWhenProviderVerified: true,
      topGaps: report.supplyUnknownPolicy.topGaps,
    },
  ];
}

export function formatRuntimePipelineAdr0488EvidenceLine(
  report: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null | undefined,
): string {
  if (!report) return 'ADR-0488 status=missing diagnosticOnly=true executionImpact=NONE';
  return `ADR-0488 status=${report.overallStatus} sectorEnergyMaster=${report.sectorEnergyMaster.status} supplyUnknownPolicy=${report.supplyUnknownPolicy.status} diagnosticOnly=true executionImpact=${report.executionImpact}`;
}
