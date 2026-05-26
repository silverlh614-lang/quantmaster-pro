/**
 * @responsibility ADR-0474 SectorEnergy indexCode coverage recovery dry-run SSOT.
 *
 * This module reads existing SectorEnergy diagnostics and in-memory master data only.
 * It does not fetch providers, mutate SectorIndexMaster, promote fallbacks, or change
 * live execution.
 */

import { SECTOR_INDEX_MASTER, type SectorIndexMasterEntry } from './sectorEnergyMaster.js';
import type { SectorEnergyQualityDiagnostic } from './sectorEnergyQualityDiagnostic.js';
import {
  classifyMissingReason,
  expandAliasCandidates,
  isNonSectorAggregateRow,
  normalizeIndexNameForLookup,
  type RecoveryRowInput,
  type SectorIndexCodeMissingReason,
  type SectorIndexCodeRecoveryDiagnostic,
} from './sectorEnergyIndexCodeRecoveryDiagnostic.js';

export type SectorEnergyCoverageRecoveryAction =
  | 'REVIEW_ALIAS_CANDIDATES'
  | 'REPAIR_SECTOR_INDEX_MASTER'
  | 'REVIEW_AGGREGATE_IGNORED'
  | 'KEEP_DIAGNOSTIC_ONLY'
  | 'OBSERVE_20D_THEN_PROMOTION_AUDIT'
  | 'NO_ACTION';

export type SectorEnergyAliasCandidateSafety =
  | 'SAFE_EXACT'
  | 'SAFE_NORMALIZED'
  | 'UNSAFE_AMBIGUOUS'
  | 'UNSAFE_AGGREGATE'
  | 'NO_MATCH';

export interface SectorEnergyMissingIndexCodeItem {
  symbol?: string;
  name: string;
  sector?: string;
  reason:
    | 'INDEX_CODE_MISSING'
    | 'ALIAS_MISSING'
    | 'AGGREGATE_IGNORED'
    | 'NAME_LOOKUP_FAILED'
    | 'UNSAFE_ALIAS'
    | 'UNKNOWN';
}

export interface SectorEnergyAliasSuggestion {
  inputName: string;
  normalizedName: string;
  candidateName?: string;
  candidateIndexCode?: string;
  safety: SectorEnergyAliasCandidateSafety;
  reason: string;
  applyAutomatically: false;
}

export interface SectorEnergyCoverageRecoveryReport {
  timestamp: string;
  forDate: string;
  indexCodeCoverageBefore: number;
  indexCodeCoverageAfterNameLookup: number;
  indexCodeCoverageAfterAliasCandidate: number;
  missingIndexCodeCount: number;
  unresolvedCount: number;
  aggregateIgnoredCount: number;
  aliasMissingCount: number;
  nameLookupRecoveredCount: number;
  aliasCandidateCount: number;
  unsafeAliasCandidateCount: number;
  recoveryPotentialPct: number;
  missingItems: SectorEnergyMissingIndexCodeItem[];
  aliasSuggestions: SectorEnergyAliasSuggestion[];
  sourceTier?: string;
  fallbackUsed: 'NONE' | 'STOCK_DAILY' | 'CACHE' | 'UNKNOWN';
  leadershipConfidence: 'OK' | 'READY_FOR_SHADOW' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  executionHardBlock: false;
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  recommendedAction: SectorEnergyCoverageRecoveryAction;
  reason?: string;
}

const MAX_TELEGRAM_ITEMS = 10;

function hasIndexCode(row: RecoveryRowInput): boolean {
  return typeof row.indexCode === 'string' && row.indexCode.trim().length > 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function exactMasterMatches(
  inputName: string,
  masterEntries: ReadonlyArray<SectorIndexMasterEntry> = SECTOR_INDEX_MASTER,
): SectorIndexMasterEntry[] {
  const trimmed = inputName.trim();
  if (!trimmed) return [];
  return masterEntries.filter((entry) =>
    entry.displayName === trimmed || entry.aliases.some((alias) => alias === trimmed));
}

function uniqueByIndexCode(entries: SectorIndexMasterEntry[]): SectorIndexMasterEntry[] {
  const seen = new Set<string>();
  const unique: SectorIndexMasterEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.krxIndexCode)) continue;
    seen.add(entry.krxIndexCode);
    unique.push(entry);
  }
  return unique;
}

function normalizedMasterMatches(
  normalizedName: string,
  masterEntries: ReadonlyArray<SectorIndexMasterEntry> = SECTOR_INDEX_MASTER,
): SectorIndexMasterEntry[] {
  if (masterEntries === SECTOR_INDEX_MASTER) return expandAliasCandidates(normalizedName);
  return masterEntries.filter((entry) =>
    [entry.displayName, ...entry.aliases].some((candidate) =>
      normalizeIndexNameForLookup(candidate).normalized === normalizedName));
}

export function buildSectorEnergyAliasSuggestion(
  inputName: string,
  masterEntries: ReadonlyArray<SectorIndexMasterEntry> = SECTOR_INDEX_MASTER,
): SectorEnergyAliasSuggestion {
  const normalizedName = normalizeIndexNameForLookup(inputName).normalized;
  if (isNonSectorAggregateRow(inputName)) {
    return {
      inputName,
      normalizedName,
      safety: 'UNSAFE_AGGREGATE',
      reason: 'Aggregate, ETF, theme, market-wide, or non-sector row; never auto-apply as sector alias.',
      applyAutomatically: false,
    };
  }

  const exactMatches = uniqueByIndexCode(exactMasterMatches(inputName, masterEntries));
  if (exactMatches.length === 1) {
    const entry = exactMatches[0]!;
    return {
      inputName,
      normalizedName,
      candidateName: entry.displayName,
      candidateIndexCode: entry.krxIndexCode,
      safety: 'SAFE_EXACT',
      reason: 'Unique exact displayName/alias match in SECTOR_INDEX_MASTER.',
      applyAutomatically: false,
    };
  }
  if (exactMatches.length > 1) {
    return {
      inputName,
      normalizedName,
      safety: 'UNSAFE_AMBIGUOUS',
      reason: 'Exact name maps to multiple SectorIndexMaster candidates.',
      applyAutomatically: false,
    };
  }

  const normalizedMatches = uniqueByIndexCode(normalizedMasterMatches(normalizedName, masterEntries));
  if (normalizedMatches.length === 1) {
    const entry = normalizedMatches[0]!;
    return {
      inputName,
      normalizedName,
      candidateName: entry.displayName,
      candidateIndexCode: entry.krxIndexCode,
      safety: 'SAFE_NORMALIZED',
      reason: 'Unique normalized alias candidate; operator review required before master repair.',
      applyAutomatically: false,
    };
  }
  if (normalizedMatches.length > 1) {
    return {
      inputName,
      normalizedName,
      safety: 'UNSAFE_AMBIGUOUS',
      reason: 'Normalized alias maps to multiple SectorIndexMaster candidates.',
      applyAutomatically: false,
    };
  }

  return {
    inputName,
    normalizedName,
    safety: 'NO_MATCH',
    reason: 'No SectorIndexMaster alias candidate found.',
    applyAutomatically: false,
  };
}

function reasonFromMissingReason(reason: SectorIndexCodeMissingReason): SectorEnergyMissingIndexCodeItem['reason'] {
  switch (reason) {
    case 'ALIAS_NOT_REGISTERED':
    case 'UNKNOWN_INDEX_NAME':
      return 'ALIAS_MISSING';
    case 'NON_SECTOR_AGGREGATE_ROW':
      return 'AGGREGATE_IGNORED';
    case 'AMBIGUOUS_ALIAS':
      return 'UNSAFE_ALIAS';
    case 'NORMALIZATION_MISMATCH':
      return 'NAME_LOOKUP_FAILED';
    case 'EMPTY_INDEX_NAME':
    case 'MARKET_PREFIX_MISMATCH':
    case 'STOCK_DAILY_ROW_NO_INDEX_SOURCE':
    case 'ETF_OR_DERIVED_ROW':
    case 'CACHE_ROW_MISSING_INDEX_CODE':
    case 'DATA_DBG_ROW_MISSING_IDX_IND_CD':
      return 'INDEX_CODE_MISSING';
    default:
      return 'UNKNOWN';
  }
}

function missingItemsFromRows(rows: RecoveryRowInput[]): SectorEnergyMissingIndexCodeItem[] {
  return rows
    .filter((row) => !hasIndexCode(row))
    .map((row) => {
      const name = typeof row.indexName === 'string' && row.indexName.trim()
        ? row.indexName.trim()
        : '<empty>';
      return {
        name,
        reason: reasonFromMissingReason(classifyMissingReason(row)),
      };
    });
}

function missingItemsFromDiagnostic(
  diag: SectorIndexCodeRecoveryDiagnostic | undefined,
): SectorEnergyMissingIndexCodeItem[] {
  if (!diag) return [];
  return diag.topMissingIndexNames.map((item) => ({
    name: item.rawName || '<empty>',
    reason: reasonFromMissingReason(item.reason),
  }));
}

function aliasMissingFromBreakdown(diag: SectorIndexCodeRecoveryDiagnostic | undefined): number {
  if (!diag) return 0;
  return (
    (diag.missingReasonBreakdown.ALIAS_NOT_REGISTERED ?? 0) +
    (diag.missingReasonBreakdown.AMBIGUOUS_ALIAS ?? 0) +
    (diag.missingReasonBreakdown.UNKNOWN_INDEX_NAME ?? 0)
  );
}

function fallbackFromQuality(
  quality: SectorEnergyQualityDiagnostic | undefined,
  recovery: SectorIndexCodeRecoveryDiagnostic | undefined,
): SectorEnergyCoverageRecoveryReport['fallbackUsed'] {
  const fallback = recovery?.fallbackUsed ?? quality?.fallbackUsed ?? 'NONE';
  if (fallback === 'ETF') return 'UNKNOWN';
  if (fallback === 'NONE' || fallback === 'STOCK_DAILY' || fallback === 'CACHE') return fallback;
  return 'UNKNOWN';
}

function leadershipFromQuality(
  quality: SectorEnergyQualityDiagnostic | undefined,
  recovery: SectorIndexCodeRecoveryDiagnostic | undefined,
  fallbackUsed: SectorEnergyCoverageRecoveryReport['fallbackUsed'],
): SectorEnergyCoverageRecoveryReport['leadershipConfidence'] {
  if (fallbackUsed === 'STOCK_DAILY') return 'BLOCKED';
  if (recovery?.leadershipConfidence) return recovery.leadershipConfidence;
  if (quality?.shouldBlockLeadershipConfidence) return 'BLOCKED';
  if (quality?.dataQuality === 'OK') return 'OK';
  if (quality?.dataQuality === 'DEGRADED' || quality?.dataQuality === 'STALE') return 'DEGRADED';
  return 'UNKNOWN';
}

function chooseAction(input: {
  safeAliasCount: number;
  unsafeAliasCount: number;
  aggregateIgnoredCount: number;
  unresolvedCount: number;
}): SectorEnergyCoverageRecoveryAction {
  if (input.safeAliasCount > 0) return 'REVIEW_ALIAS_CANDIDATES';
  if (input.unsafeAliasCount > 0) return 'REPAIR_SECTOR_INDEX_MASTER';
  if (input.aggregateIgnoredCount > 0) return 'REVIEW_AGGREGATE_IGNORED';
  if (input.unresolvedCount > 0) return 'KEEP_DIAGNOSTIC_ONLY';
  return 'NO_ACTION';
}

export function buildSectorEnergyCoverageRecoveryReport(input: {
  timestamp?: string;
  forDate?: string;
  qualityDiagnostic?: SectorEnergyQualityDiagnostic;
  rowsBeforeNameLookup?: RecoveryRowInput[];
  rowsAfterNameLookup?: RecoveryRowInput[];
} = {}): SectorEnergyCoverageRecoveryReport {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const forDate = input.forDate ?? timestamp.slice(0, 10);
  const quality = input.qualityDiagnostic;
  const recovery = quality?.sectorIndexRecovery;
  const beforeRows = input.rowsBeforeNameLookup ?? [];
  const afterRows = input.rowsAfterNameLookup ?? [];

  const beforeCoverage = beforeRows.length > 0
    ? beforeRows.filter(hasIndexCode).length / beforeRows.length
    : recovery?.beforeIndexCodeCoverage ?? quality?.indexCodeCoverage ?? 0;
  const afterNameLookupCoverage = afterRows.length > 0
    ? afterRows.filter(hasIndexCode).length / afterRows.length
    : recovery?.afterIndexCodeCoverage ?? quality?.indexCodeCoverage ?? beforeCoverage;

  const missingItems = afterRows.length > 0
    ? missingItemsFromRows(afterRows)
    : missingItemsFromDiagnostic(recovery);
  const aliasSourceNames = [...new Set(
    missingItems
      .filter((item) => item.name && item.name !== '<empty>')
      .filter((item) => item.reason === 'ALIAS_MISSING' || item.reason === 'UNSAFE_ALIAS' || item.reason === 'NAME_LOOKUP_FAILED')
      .map((item) => item.name),
  )];
  const aliasSuggestions = aliasSourceNames.map((name) => buildSectorEnergyAliasSuggestion(name));
  const safeAliasCount = aliasSuggestions.filter((item) =>
    item.safety === 'SAFE_EXACT' || item.safety === 'SAFE_NORMALIZED').length;
  const unsafeAliasCandidateCount = aliasSuggestions.filter((item) =>
    item.safety === 'UNSAFE_AMBIGUOUS' || item.safety === 'UNSAFE_AGGREGATE' || item.safety === 'NO_MATCH').length;
  const denominator = afterRows.length || recovery?.totalRows || quality?.totalSectorRows || 0;
  const afterAliasCandidateCoverage = denominator > 0
    ? clamp01(afterNameLookupCoverage + safeAliasCount / denominator)
    : afterNameLookupCoverage;

  const aggregateIgnoredCount = recovery?.nonSectorAggregateIgnored
    ?? recovery?.missingReasonBreakdown.NON_SECTOR_AGGREGATE_ROW
    ?? missingItems.filter((item) => item.reason === 'AGGREGATE_IGNORED').length;
  const aliasMissingCount = aliasMissingFromBreakdown(recovery)
    || missingItems.filter((item) => item.reason === 'ALIAS_MISSING' || item.reason === 'UNSAFE_ALIAS').length;
  const missingIndexCodeCount = quality?.missingIndexCodeCount
    ?? recovery?.rowsMissingIndexCode
    ?? missingItems.length;
  const unresolvedCount = Math.max(0, missingIndexCodeCount - safeAliasCount);
  const sourceTier = quality?.sourceTier;
  const isKisBasketDerived = sourceTier === 'KIS_STOCK_BASKET_DERIVED';
  const fallbackUsed = fallbackFromQuality(quality, recovery);
  const leadershipConfidence = isKisBasketDerived
    ? 'READY_FOR_SHADOW'
    : leadershipFromQuality(quality, recovery, fallbackUsed);
  const fallbackContaminated = fallbackUsed === 'STOCK_DAILY' || leadershipConfidence === 'BLOCKED';
  const sectorBoostAllowed = isKisBasketDerived ? false : !fallbackContaminated && leadershipConfidence === 'OK';
  const strongBuyAllowed = isKisBasketDerived ? false : !fallbackContaminated && leadershipConfidence === 'OK';
  const recommendedAction = isKisBasketDerived
    ? 'OBSERVE_20D_THEN_PROMOTION_AUDIT'
    : chooseAction({
      safeAliasCount,
      unsafeAliasCount: unsafeAliasCandidateCount,
      aggregateIgnoredCount,
      unresolvedCount,
    });
  const reason = isKisBasketDerived
    ? 'KIS basket is derived representative basket, not official sector index.'
    : undefined;

  return {
    timestamp,
    forDate,
    indexCodeCoverageBefore: clamp01(beforeCoverage),
    indexCodeCoverageAfterNameLookup: clamp01(afterNameLookupCoverage),
    indexCodeCoverageAfterAliasCandidate: clamp01(afterAliasCandidateCoverage),
    missingIndexCodeCount,
    unresolvedCount,
    aggregateIgnoredCount,
    aliasMissingCount,
    nameLookupRecoveredCount: afterRows.length > 0
      ? afterRows.filter((row) => hasIndexCode(row) && row.indexCodeSource === 'NAME_LOOKUP').length
      : recovery?.backfilledByNameLookup ?? quality?.indexCodeBackfilledCount ?? 0,
    aliasCandidateCount: safeAliasCount,
    unsafeAliasCandidateCount,
    recoveryPotentialPct: (clamp01(afterAliasCandidateCoverage) - clamp01(beforeCoverage)) * 100,
    missingItems,
    aliasSuggestions,
    ...(sourceTier ? { sourceTier } : {}),
    fallbackUsed,
    leadershipConfidence,
    sectorBoostAllowed,
    strongBuyAllowed,
    executionHardBlock: false,
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    recommendedAction,
    ...(reason ? { reason } : {}),
  };
}

export function formatSectorEnergyCoverageRecoverySection(
  report: SectorEnergyCoverageRecoveryReport | null | undefined,
): string | null {
  if (!report) return null;
  const safeAlias = report.aliasCandidateCount;
  const topMissing = report.missingItems.slice(0, MAX_TELEGRAM_ITEMS);
  const lines = [
    '🧩 SectorEnergy Coverage Recovery (ADR-0474)',
    `  coverageBefore: ${(report.indexCodeCoverageBefore * 100).toFixed(1)}%`,
    `  afterNameLookup: ${(report.indexCodeCoverageAfterNameLookup * 100).toFixed(1)}%`,
    `  afterAliasCandidate: ${(report.indexCodeCoverageAfterAliasCandidate * 100).toFixed(1)}%`,
    `  missingIndexCode: ${report.missingIndexCodeCount}`,
    `  aliasMissing: ${report.aliasMissingCount}`,
    `  aggregateIgnored: ${report.aggregateIgnoredCount}`,
    `  safeAliasCandidates: ${safeAlias}`,
    `  unsafeAliasCandidates: ${report.unsafeAliasCandidateCount}`,
    `  unresolved: ${report.unresolvedCount}`,
    ...(report.sourceTier ? [`  legacySourceTierDiagnosticOnly: ${report.sourceTier}`] : []),
    `  fallbackUsed: ${report.fallbackUsed}`,
    `  legacyLeadershipConfidenceDiagnosticOnly: ${report.leadershipConfidence}`,
    `  legacySectorBoostAllowedDiagnosticOnly: ${String(report.sectorBoostAllowed)}`,
    `  legacyStrongBuyAllowedDiagnosticOnly: ${String(report.strongBuyAllowed)}`,
    `  executionHardBlock: ${String(report.executionHardBlock)}`,
    `  executionImpact: ${report.executionImpact}`,
    ...(report.reason ? [`  reason: ${report.reason}`] : []),
    `  nextAction: ${report.recommendedAction}`,
  ];
  if (topMissing.length > 0) {
    lines.push(`  topMissing: ${topMissing.map((item) => `${item.name}:${item.reason}`).join(', ')}`);
  }
  return lines.join('\n');
}
