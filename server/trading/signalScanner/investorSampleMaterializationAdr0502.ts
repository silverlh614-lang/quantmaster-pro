// @responsibility ADR-0502 investor-flow sample materialization diagnostics; SHADOW_ONLY only.

export type InvestorSampleProviderNameAdr0502 =
  | 'NAVER_INVESTOR_TREND'
  | 'SEMANTIC_NETBUY'
  | 'KIS_INVESTOR'
  | 'KRX_INVESTOR_FLOW'
  | 'FSS_PASSIVE_ACTIVE'
  | 'CACHE'
  | 'PLACEHOLDER'
  | 'UNKNOWN';

export type InvestorSampleInputSourceKindAdr0502 =
  | 'RAW_PROVIDER'
  | 'NORMALIZED_PROVIDER'
  | 'SEMANTIC_DERIVED'
  | 'AI_ESTIMATED'
  | 'CACHE_FALLBACK'
  | 'PLACEHOLDER'
  | 'NONE';

export type InvestorSampleConfidenceLevelAdr0502 =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'DEGRADED'
  | 'LOW'
  | 'MISSING';

export type InvestorSampleBlockedReasonAdr0502 =
  | 'NONE'
  | 'NO_RAW_SAMPLE'
  | 'NO_NORMALIZED_SAMPLE'
  | 'NO_MATERIALIZED_SAMPLE'
  | 'NO_REAL_INPUT_SOURCE'
  | 'NO_INPUT_SAMPLE'
  | 'PLACEHOLDER_ONLY'
  | 'INVALID_SYMBOL'
  | 'INVALID_DATE'
  | 'MISSING_INVESTOR_FLOW_FIELDS'
  | 'STALE_SAMPLE'
  | 'HARD_BLOCKED'
  | 'PROVIDER_ERROR'
  | 'NOT_ROUTER_USABLE';

export interface InvestorRawSampleAdr0502 {
  providerName: InvestorSampleProviderNameAdr0502;
  rawFetched: boolean;
  rawCount: number;
  inputSourceKind: InvestorSampleInputSourceKindAdr0502;
  lastSuccessfulSampleAt: string | null;
}

export interface InvestorNormalizedSampleAdr0502 extends InvestorRawSampleAdr0502 {
  normalizedCount: number;
  symbolCoverage: number;
  dateCoverage: string | null;
  fieldCoverage: number;
  placeholderDetected: boolean;
}

export interface InvestorMaterializedSampleAdr0502 extends InvestorNormalizedSampleAdr0502 {
  materializedCount: number;
  sampleMaterialized: boolean;
  confidenceLevel: InvestorSampleConfidenceLevelAdr0502;
  safePreview: Array<Record<string, string | number | null>>;
}

export interface RouterUsabilityDiagnosticsAdr0502 {
  providerName: InvestorSampleProviderNameAdr0502;
  sampleMaterialized: boolean;
  usableForRouter: boolean;
  materializedCount: number;
  symbolCoverage: number;
  dateCoverage: string | null;
  fieldCoverage: number;
  blockedReason: InvestorSampleBlockedReasonAdr0502;
  staleReason: string | null;
  placeholderDetected: boolean;
  inputSourceKind: InvestorSampleInputSourceKindAdr0502;
  lastSuccessfulSampleAt: string | null;
  confidenceLevel: InvestorSampleConfidenceLevelAdr0502;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
}

export interface InvestorSampleDiagnosticsAdr0502 extends InvestorMaterializedSampleAdr0502, RouterUsabilityDiagnosticsAdr0502 {
  rawPayloadPersistenceAllowed: false;
  inputSources: string[];
  diagnostics: string[];
}

export interface BuildInvestorSampleDiagnosticsInputAdr0502 {
  providerName: InvestorSampleProviderNameAdr0502;
  rawFetched?: boolean;
  rawCount?: number | null;
  normalizedCount?: number | null;
  materializedCount?: number | null;
  symbolCoverage?: number | null;
  dateCoverage?: string | null;
  fieldCoverage?: number | null;
  placeholderDetected?: boolean;
  inputSourceKind?: InvestorSampleInputSourceKindAdr0502;
  inputSources?: readonly string[];
  lastSuccessfulSampleAt?: string | null;
  confidenceLevel?: InvestorSampleConfidenceLevelAdr0502;
  blockedReason?: InvestorSampleBlockedReasonAdr0502;
  staleReason?: string | null;
  hardBlocked?: boolean;
  safePreview?: Array<Record<string, string | number | null>>;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampPct(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const ratio = value > 1 ? value / 100 : value;
  return Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10;
}

function inferBlockedReason(input: {
  hardBlocked: boolean;
  rawFetched: boolean;
  rawCount: number;
  normalizedCount: number;
  materializedCount: number;
  symbolCoverage: number;
  dateCoverage: string | null;
  fieldCoverage: number;
  placeholderDetected: boolean;
  inputSourceKind: InvestorSampleInputSourceKindAdr0502;
  confidenceLevel: InvestorSampleConfidenceLevelAdr0502;
  staleReason: string | null;
}): InvestorSampleBlockedReasonAdr0502 {
  if (input.hardBlocked) return 'HARD_BLOCKED';
  if (input.inputSourceKind === 'NONE') return 'NO_INPUT_SAMPLE';
  if (input.inputSourceKind === 'PLACEHOLDER' || input.placeholderDetected) return 'PLACEHOLDER_ONLY';
  if (!input.rawFetched || input.rawCount <= 0) return 'NO_RAW_SAMPLE';
  if (input.normalizedCount <= 0) return 'NO_NORMALIZED_SAMPLE';
  if (input.materializedCount <= 0) return 'NO_MATERIALIZED_SAMPLE';
  if (input.symbolCoverage <= 0) return 'INVALID_SYMBOL';
  if (!input.dateCoverage) return 'INVALID_DATE';
  if (input.fieldCoverage <= 0) return 'MISSING_INVESTOR_FLOW_FIELDS';
  if (input.staleReason) return 'STALE_SAMPLE';
  if (input.confidenceLevel === 'MISSING') return 'NOT_ROUTER_USABLE';
  return 'NONE';
}

export function buildInvestorSampleDiagnosticsAdr0502(
  input: BuildInvestorSampleDiagnosticsInputAdr0502,
): InvestorSampleDiagnosticsAdr0502 {
  const rawCount = finiteOrZero(input.rawCount);
  const normalizedCount = finiteOrZero(input.normalizedCount);
  const materializedCount = finiteOrZero(input.materializedCount);
  const symbolCoverage = clampPct(input.symbolCoverage);
  const fieldCoverage = clampPct(input.fieldCoverage);
  const inputSourceKind = input.inputSourceKind ?? 'NONE';
  const placeholderDetected = input.placeholderDetected ?? inputSourceKind === 'PLACEHOLDER';
  const confidenceLevel = input.confidenceLevel ?? (materializedCount > 0 ? 'PARTIAL' : 'MISSING');
  const rawFetched = input.rawFetched ?? rawCount > 0;
  const staleReason = input.staleReason ?? null;
  const dateCoverage = input.dateCoverage ?? null;
  const blockedReason = input.blockedReason ?? inferBlockedReason({
    hardBlocked: input.hardBlocked === true,
    rawFetched,
    rawCount,
    normalizedCount,
    materializedCount,
    symbolCoverage,
    dateCoverage,
    fieldCoverage,
    placeholderDetected,
    inputSourceKind,
    confidenceLevel,
    staleReason,
  });
  const sampleMaterialized = materializedCount > 0 && !placeholderDetected;
  const usableForRouter = sampleMaterialized
    && materializedCount > 0
    && symbolCoverage > 0
    && Boolean(dateCoverage)
    && fieldCoverage > 0
    && confidenceLevel !== 'MISSING'
    && blockedReason === 'NONE';
  return {
    providerName: input.providerName,
    rawFetched,
    rawCount,
    normalizedCount,
    materializedCount,
    symbolCoverage,
    dateCoverage,
    fieldCoverage,
    sampleMaterialized,
    usableForRouter,
    blockedReason,
    staleReason,
    placeholderDetected,
    inputSourceKind,
    inputSources: [...(input.inputSources ?? [])],
    lastSuccessfulSampleAt: input.lastSuccessfulSampleAt ?? dateCoverage,
    confidenceLevel,
    safePreview: (input.safePreview ?? []).slice(0, 3),
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    rawPayloadPersistenceAllowed: false,
    diagnostics: [
      `providerName=${input.providerName}`,
      `rawFetched=${String(rawFetched)}`,
      `rawCount=${rawCount}`,
      `normalizedCount=${normalizedCount}`,
      `materializedCount=${materializedCount}`,
      `symbolCoverage=${symbolCoverage}`,
      `dateCoverage=${dateCoverage ?? 'NONE'}`,
      `fieldCoverage=${fieldCoverage}`,
      `sampleMaterialized=${String(sampleMaterialized)}`,
      `usableForRouter=${String(usableForRouter)}`,
      `blockedReason=${blockedReason}`,
      `placeholderDetected=${String(placeholderDetected)}`,
      `inputSourceKind=${inputSourceKind}`,
      `confidenceLevel=${confidenceLevel}`,
      'executionImpact=NONE',
      'liveExecutionAllowed=false',
      'rawPayloadPersistenceAllowed=false',
    ],
  };
}

export function formatInvestorSampleDiagnosticsAdr0502(
  diag: InvestorSampleDiagnosticsAdr0502 | null | undefined,
): string {
  if (!diag) return 'materializationDiagnostics=NONE';
  return [
    `${diag.providerName}:`,
    `sampleMaterialized=${diag.sampleMaterialized}`,
    `usableForRouter=${diag.usableForRouter}`,
    `rawCount=${diag.rawCount}`,
    `normalizedCount=${diag.normalizedCount}`,
    `materializedCount=${diag.materializedCount}`,
    `symbolCoverage=${diag.symbolCoverage}`,
    `dateCoverage=${diag.dateCoverage ?? 'NONE'}`,
    `fieldCoverage=${diag.fieldCoverage}`,
    `blockedReason=${diag.blockedReason}`,
    `placeholderDetected=${diag.placeholderDetected}`,
    `inputSourceKind=${diag.inputSourceKind}`,
    `confidenceLevel=${diag.confidenceLevel}`,
    `executionImpact=${diag.executionImpact}`,
  ].join(' ');
}
