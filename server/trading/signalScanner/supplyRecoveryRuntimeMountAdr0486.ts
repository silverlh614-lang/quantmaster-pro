// @responsibility ADR-0486 supply recovery runtime mount verification; diagnostic-only formatter/evidence audit.
import type { OperatorActionSource } from './operatorActionRouterAdr0480.js';
import { LEGACY_GATE1_REQUIRED_SCORE } from '../gateConfig.js';

export type SupplyRecoveryMountStatus =
  | 'MOUNTED'
  | 'PARTIAL'
  | 'LEGACY_OUTPUT_DETECTED'
  | 'MISSING_EVIDENCE'
  | 'NOT_MOUNTED'
  | 'UNKNOWN';

export type SupplyRecoveryMountCheckId =
  | 'ADR_0481_NAVER_COLLECTOR_MOUNT'
  | 'ADR_0482_SEMANTIC_NETBUY_MOUNT'
  | 'ADR_0483_FRESHNESS_MOUNT'
  | 'ADR_0484_RECOVERY_OBSERVATION_MOUNT'
  | 'ADR_0485_READINESS_AUDIT_MOUNT'
  | 'ADR_0473_WARMUP_FORMATTER_ALIGNMENT'
  | 'ADR_0478_COMPACT_OUTPUT_MOUNT'
  | 'ADR_0479_DETAIL_REGISTRY_MOUNT'
  | 'RUNTIME_PIPELINE_AUDIT_EVIDENCE_MOUNT';

export type SupplyRecoveryLegacyOutputCode =
  | 'NAVER_NOT_WIRED_LEGACY'
  | 'SEMANTIC_NETBUY_COLLECTOR_NOT_WIRED_LEGACY'
  | 'READINESS_AUDIT_EVIDENCE_MISSING'
  | 'SELECTED_PROVIDER_NONE_WITH_WIRED_COLLECTOR'
  | 'FRESHNESS_REPORT_ABSENT'
  | 'RECOVERY_OBSERVATION_ABSENT'
  | 'UNKNOWN_LEGACY_OUTPUT';

export interface SupplyRecoveryMountCheckAdr0486 {
  id: SupplyRecoveryMountCheckId;
  status: SupplyRecoveryMountStatus;
  expectedRuntimeSignal: string;
  observedRuntimeSignal: string | null;
  legacyOutputDetected: boolean;
  legacyOutputCode?: SupplyRecoveryLegacyOutputCode;
  evidencePresent: boolean;
  recommendedAction: string;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SupplyRecoveryRuntimeMountReportAdr0486 {
  generatedAt: string;
  overallStatus: SupplyRecoveryMountStatus;
  checks: SupplyRecoveryMountCheckAdr0486[];
  mountedCount: number;
  partialCount: number;
  missingEvidenceCount: number;
  legacyOutputCount: number;
  topMountGaps: string[];
  recommendedNextActions: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SupplyRecoveryRuntimeMountInputAdr0486 {
  generatedAt?: string;
  warmupReport?: {
    naverStatus?: string;
    semanticNetBuyCollectorStatus?: string;
    supplySourceFreshnessAdr0483?: unknown;
  } | null;
  warmupOutput?: string | null;
  investorFlowProviderRouterAdr0477?: {
    selectedProvider?: string;
    providerStatuses?: Record<string, string>;
    status?: string;
  } | null;
  naverInvestorTrendAdr0481?: { status?: string } | null;
  semanticNetBuyNormalizationAdr0482?: { status?: string; selectedSample?: unknown; samples?: readonly unknown[] } | null;
  supplySourceFreshnessAdr0483?: {
    status?: string;
    rows?: readonly unknown[];
    affectedSources?: readonly string[];
    oldestSourceAgeTradingDays?: number | null;
    refreshStatus?: string;
  } | null;
  supplyCoverageRecoveryAdr0484?: {
    status?: string;
    current?: unknown;
    baseline?: unknown;
    snapshots?: readonly unknown[];
  } | null;
  supplyAdvisoryReadinessAdr0485?: {
    status?: string;
    readinessScore?: number;
    evidence?: unknown;
    failedReasons?: readonly string[];
  } | null;
  compactOutput?: string | readonly string[] | null;
  detailRegistryEntries?: readonly {
    adr?: string;
    sectionId?: string;
    commandHint?: string;
    scanBlockersDetailHint?: string;
    adrTraceHint?: string;
  }[] | null;
  runtimePipelineAuditEvidence?: string | null;
  diagnostics?: readonly string[];
  throwForTest?: boolean;
}

const POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  policyPromotionMode: 'SHADOW_ONLY' as const,
  operatorApprovalRequired: true as const,
};

const NAVER_ACCEPTABLE = new Set([
  'WIRED',
  'DATA_AVAILABLE',
  'VERIFIED',
  'DATA_UNAVAILABLE',
  'EMPTY',
  'PARTIAL',
  'STALE',
  'PARSE_ERROR',
  'PROVIDER_ERROR',
  'NON_TRADING_DAY',
]);

const SEMANTIC_ACCEPTABLE = new Set([
  'NORMALIZER_READY',
  'DATA_AVAILABLE',
  'VERIFIED',
  'DATA_UNAVAILABLE',
  'EMPTY',
  'PARTIAL',
  'STALE',
  'PARSE_ERROR',
  'PROVIDER_ERROR',
]);

function asText(value: string | readonly string[] | null | undefined): string {
  if (typeof value === 'string') return value;
  if (!value) return '';
  return value.filter(Boolean).join('\n');
}

function findLine(text: string, pattern: RegExp): string | null {
  return text.split(/\r?\n/).find((line) => pattern.test(line))?.trim() ?? null;
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function mk(input: Omit<SupplyRecoveryMountCheckAdr0486, keyof typeof POLICY>): SupplyRecoveryMountCheckAdr0486 {
  return { ...input, ...POLICY };
}

function mounted(
  id: SupplyRecoveryMountCheckId,
  expectedRuntimeSignal: string,
  observedRuntimeSignal: string | null,
  diagnostics: string[] = [],
): SupplyRecoveryMountCheckAdr0486 {
  return mk({
    id,
    status: 'MOUNTED',
    expectedRuntimeSignal,
    observedRuntimeSignal,
    legacyOutputDetected: false,
    evidencePresent: true,
    recommendedAction: 'Continue observation; no trading policy change.',
    diagnostics,
  });
}

function partial(
  id: SupplyRecoveryMountCheckId,
  expectedRuntimeSignal: string,
  observedRuntimeSignal: string | null,
  recommendedAction: string,
  diagnostics: string[] = [],
): SupplyRecoveryMountCheckAdr0486 {
  return mk({
    id,
    status: 'PARTIAL',
    expectedRuntimeSignal,
    observedRuntimeSignal,
    legacyOutputDetected: false,
    evidencePresent: true,
    recommendedAction,
    diagnostics,
  });
}

function missing(
  id: SupplyRecoveryMountCheckId,
  expectedRuntimeSignal: string,
  observedRuntimeSignal: string | null,
  legacyOutputCode: SupplyRecoveryLegacyOutputCode | undefined,
  recommendedAction: string,
  diagnostics: string[] = [],
): SupplyRecoveryMountCheckAdr0486 {
  return mk({
    id,
    status: 'MISSING_EVIDENCE',
    expectedRuntimeSignal,
    observedRuntimeSignal,
    legacyOutputDetected: false,
    ...(legacyOutputCode ? { legacyOutputCode } : {}),
    evidencePresent: false,
    recommendedAction,
    diagnostics,
  });
}

function legacy(
  id: SupplyRecoveryMountCheckId,
  expectedRuntimeSignal: string,
  observedRuntimeSignal: string | null,
  legacyOutputCode: SupplyRecoveryLegacyOutputCode,
  recommendedAction: string,
  diagnostics: string[] = [],
): SupplyRecoveryMountCheckAdr0486 {
  return mk({
    id,
    status: 'LEGACY_OUTPUT_DETECTED',
    expectedRuntimeSignal,
    observedRuntimeSignal,
    legacyOutputDetected: true,
    legacyOutputCode,
    evidencePresent: false,
    recommendedAction,
    diagnostics,
  });
}

function checkNaver(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): SupplyRecoveryMountCheckAdr0486 {
  const observed = findLine(text, /\bNAVER\s*:/i) ?? input.warmupReport?.naverStatus ?? input.naverInvestorTrendAdr0481?.status ?? null;
  if (/NAVER\s*:\s*NOT_WIRED\b/i.test(text) || upper(input.warmupReport?.naverStatus) === 'NOT_WIRED') {
    return legacy(
      'ADR_0481_NAVER_COLLECTOR_MOUNT',
      'NAVER: WIRED/DATA_AVAILABLE/DATA_UNAVAILABLE/PARTIAL/STALE/PARSE_ERROR/PROVIDER_ERROR/NON_TRADING_DAY',
      observed,
      'NAVER_NOT_WIRED_LEGACY',
      'Align ADR-0473 warmup formatter to consume ADR-0481 collector status.',
      ['ADR-0481 module presence is not enough if ADR-0473 still emits NOT_WIRED.'],
    );
  }
  const status = upper(input.naverInvestorTrendAdr0481?.status) || upper(input.warmupReport?.naverStatus) || upper(input.investorFlowProviderRouterAdr0477?.providerStatuses?.NAVER);
  if (NAVER_ACCEPTABLE.has(status)) {
    return mounted('ADR_0481_NAVER_COLLECTOR_MOUNT', 'ADR-0481 collector status visible in runtime warmup.', observed ?? status);
  }
  return missing(
    'ADR_0481_NAVER_COLLECTOR_MOUNT',
    'ADR-0481 collector status visible in runtime warmup.',
    observed,
    undefined,
    'Pass ADR-0481 collector result into SupplyProviderWarmupReport and /scan_blockers.',
  );
}

function semanticRuntimeStatus(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): string {
  const semanticLine = findLine(text, /Semantic\s+NetBuy\s*:/i);
  if (/NORMALIZER_READY\s*\/\s*DATA_AVAILABLE/i.test(semanticLine ?? '')) return 'DATA_AVAILABLE';
  if (/NORMALIZER_READY/i.test(semanticLine ?? '')) return 'NORMALIZER_READY';
  if (/DATA_UNAVAILABLE|EMPTY|PARTIAL|STALE|PARSE_ERROR|PROVIDER_ERROR|VERIFIED/i.test(semanticLine ?? '')) {
    return upper((semanticLine ?? '').match(/DATA_UNAVAILABLE|EMPTY|PARTIAL|STALE|PARSE_ERROR|PROVIDER_ERROR|VERIFIED/i)?.[0]);
  }
  return upper(input.semanticNetBuyNormalizationAdr0482?.status)
    || (input.warmupReport?.semanticNetBuyCollectorStatus === 'WIRED' ? 'NORMALIZER_READY' : '');
}

function checkSemantic(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): SupplyRecoveryMountCheckAdr0486 {
  const observed = findLine(text, /Semantic\s+NetBuy\s*:/i) ?? input.semanticNetBuyNormalizationAdr0482?.status ?? null;
  if (/Semantic\s+NetBuy\s*:\s*schema\s+ready\s*\/\s*collector\s+not\s+wired/i.test(text)) {
    return legacy(
      'ADR_0482_SEMANTIC_NETBUY_MOUNT',
      'Semantic NetBuy: NORMALIZER_READY / DATA_AVAILABLE or DATA_UNAVAILABLE',
      observed,
      'SEMANTIC_NETBUY_COLLECTOR_NOT_WIRED_LEGACY',
      'Wire ADR-0482 semantic normalizer summary into ADR-0473 runtime formatter.',
    );
  }
  const status = semanticRuntimeStatus(input, text);
  if (SEMANTIC_ACCEPTABLE.has(status)) {
    return mounted('ADR_0482_SEMANTIC_NETBUY_MOUNT', 'ADR-0482 normalizer status visible in runtime warmup.', observed ?? status);
  }
  return missing(
    'ADR_0482_SEMANTIC_NETBUY_MOUNT',
    'ADR-0482 normalizer status visible in runtime warmup.',
    observed,
    undefined,
    'Pass ADR-0482 semantic normalizer report into ADR-0473 runtime formatter.',
  );
}

function checkFreshness(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): SupplyRecoveryMountCheckAdr0486 {
  const observed = findLine(text, /ADR-0483|SupplyFreshness|cacheState|sourceState|oldestSourceAgeTradingDays|affectedSources|refreshRecommendedSources/i);
  const report = input.supplySourceFreshnessAdr0483 ?? input.warmupReport?.supplySourceFreshnessAdr0483 as SupplyRecoveryRuntimeMountInputAdr0486['supplySourceFreshnessAdr0483'];
  if (report || observed) {
    const hasRows = (report?.rows?.length ?? 0) > 0 || observed !== null;
    return hasRows
      ? mounted('ADR_0483_FRESHNESS_MOUNT', 'Dual clock cache/source freshness summary is visible.', observed ?? report?.status ?? null)
      : partial('ADR_0483_FRESHNESS_MOUNT', 'Dual clock cache/source freshness summary is visible.', report?.status ?? observed, 'Collect source freshness rows; keep status diagnostic-only.');
  }
  return missing(
    'ADR_0483_FRESHNESS_MOUNT',
    'cacheState/sourceState/oldestSourceAgeTradingDays/affectedSources/refreshRecommendedSources',
    null,
    'FRESHNESS_REPORT_ABSENT',
    'Pass ADR-0483 freshness report into SupplyProviderWarmupReport and /supply_health_detail.',
  );
}

function checkRecovery(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): SupplyRecoveryMountCheckAdr0486 {
  const observed = findLine(text, /ADR-0484\s+SupplyRecovery|SupplyRecovery:/i);
  const report = input.supplyCoverageRecoveryAdr0484;
  if (report?.current || observed) {
    if (/baseline=pending/i.test(observed ?? '') || !report?.baseline) {
      return partial('ADR_0484_RECOVERY_OBSERVATION_MOUNT', 'ADR-0484 SupplyRecovery line with status, coverage, selectedProvider, baseline/snapshot status.', observed ?? report?.status ?? null, 'Continue collecting ADR-0484 snapshots; baseline pending is acceptable in early runs.');
    }
    return mounted('ADR_0484_RECOVERY_OBSERVATION_MOUNT', 'ADR-0484 SupplyRecovery line with status and coverage evidence.', observed ?? report.status ?? null);
  }
  return missing(
    'ADR_0484_RECOVERY_OBSERVATION_MOUNT',
    'ADR-0484 SupplyRecovery line with status, coverage, selectedProvider, baseline/snapshot status.',
    null,
    'RECOVERY_OBSERVATION_ABSENT',
    'Mount ADR-0484 recovery observation in /scan_blockers and ScanSummary.',
  );
}

function checkReadiness(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): SupplyRecoveryMountCheckAdr0486 {
  const observed = findLine(text, /ADR-0485\s+SupplyReadiness|SupplyReadiness:/i) ?? input.supplyAdvisoryReadinessAdr0485?.status ?? null;
  const auditEvidence = input.runtimePipelineAuditEvidence ?? '';
  const report = input.supplyAdvisoryReadinessAdr0485;
  if (/readinessAuditEvidence=missing/i.test(auditEvidence)) {
    return missing(
      'ADR_0485_READINESS_AUDIT_MOUNT',
      'Runtime Pipeline Audit reads ADR-0485 readiness evidence from ScanSummary.',
      auditEvidence,
      'READINESS_AUDIT_EVIDENCE_MISSING',
      'Ensure ADR-0485 readiness report is persisted into ScanSummary/runtime audit input before Runtime Pipeline Audit formatting.',
      ['ADR-0485 DEGRADED/NOT_READY is acceptable; evidence missing is not acceptable when the report exists.'],
    );
  }
  if (report?.evidence || observed) {
    return mounted('ADR_0485_READINESS_AUDIT_MOUNT', 'ADR-0485 SupplyReadiness line and readiness evidence are visible.', observed);
  }
  return missing(
    'ADR_0485_READINESS_AUDIT_MOUNT',
    'ADR-0485 SupplyReadiness line and readiness evidence are visible.',
    observed,
    undefined,
    'Persist ADR-0485 readiness report into ScanSummary before Runtime Pipeline Audit formatting.',
  );
}

function checkWarmupAlignment(input: SupplyRecoveryRuntimeMountInputAdr0486, text: string): SupplyRecoveryMountCheckAdr0486 {
  const naverLegacy = /NAVER\s*:\s*NOT_WIRED\b/i.test(text);
  const semanticLegacy = /Semantic\s+NetBuy\s*:\s*schema\s+ready\s*\/\s*collector\s+not\s+wired/i.test(text);
  if (naverLegacy || semanticLegacy) {
    return legacy(
      'ADR_0473_WARMUP_FORMATTER_ALIGNMENT',
      'ADR-0473 warmup formatter consumes ADR-0481/0482/0483 statuses.',
      [naverLegacy ? 'NAVER: NOT_WIRED' : '', semanticLegacy ? 'Semantic NetBuy collector not wired' : ''].filter(Boolean).join('; '),
      naverLegacy ? 'NAVER_NOT_WIRED_LEGACY' : 'SEMANTIC_NETBUY_COLLECTOR_NOT_WIRED_LEGACY',
      'Align ADR-0473 warmup formatter with ADR-0481 collector, ADR-0482 normalizer, and ADR-0483 freshness report.',
    );
  }
  if (input.warmupReport || /Supply Provider Warmup|ADR-0473/i.test(text)) {
    return mounted('ADR_0473_WARMUP_FORMATTER_ALIGNMENT', 'ADR-0473 warmup formatter emits modern ADR-0481~0483 states.', findLine(text, /Supply Provider Warmup|ADR-0473/i));
  }
  return missing('ADR_0473_WARMUP_FORMATTER_ALIGNMENT', 'ADR-0473 warmup formatter emits modern ADR-0481~0483 states.', null, undefined, 'Mount ADR-0473 warmup output through the ADR-0486 verifier input.');
}

function checkCompactOutput(text: string): SupplyRecoveryMountCheckAdr0486 {
  const observed = findLine(text, /ADR-0484|ADR-0485|ADR-0486|Supply Provider Warmup|ADR-0477/i);
  const rawDominates = text.split(/\r?\n/).length > 80 || /Raw ADR-0477|Raw ADR-0473|providerTried.*providerStatuses.*semanticNetBuy/is.test(text);
  if (rawDominates) {
    return partial('ADR_0478_COMPACT_OUTPUT_MOUNT', 'Default /scan_blockers uses compact section style; long raw blocks are compressed.', observed, 'Route long raw section through ADR-0478 compact output budget.');
  }
  if (/ADR-0486\s+RuntimeMount|ADR-0484\s+SupplyRecovery|ADR-0485\s+SupplyReadiness/i.test(text)) {
    return mounted('ADR_0478_COMPACT_OUTPUT_MOUNT', 'Default /scan_blockers uses compact section style.', observed);
  }
  return missing('ADR_0478_COMPACT_OUTPUT_MOUNT', 'Default /scan_blockers uses compact section style.', observed, undefined, 'Include ADR-0486 compact mount line in /scan_blockers.');
}

function checkDetailRegistry(input: SupplyRecoveryRuntimeMountInputAdr0486): SupplyRecoveryMountCheckAdr0486 {
  const entries = input.detailRegistryEntries ?? [];
  const text = entries.map((entry) => [entry.adr, entry.sectionId, entry.commandHint, entry.scanBlockersDetailHint, entry.adrTraceHint].filter(Boolean).join(' ')).join('\n');
  const required = ['0481', '0482', '0483', '0484', '0485', '0486'];
  const missingAdrs = required.filter((adr) => !new RegExp(`adr_trace\\s+${adr}|/adr_trace\\s+${adr}|\\b${adr}\\b`, 'i').test(text));
  const hasSupplyDetail = /supply_health_detail/i.test(text);
  if (missingAdrs.length === 0 && hasSupplyDetail) {
    return mounted('ADR_0479_DETAIL_REGISTRY_MOUNT', '/adr_trace 0481~0486 and /supply_health_detail are registered.', text || null);
  }
  return missingAdrs.length >= 3
    ? missing('ADR_0479_DETAIL_REGISTRY_MOUNT', '/adr_trace 0481~0486 and /supply_health_detail are registered.', text || null, undefined, 'Register ADR-0481~0486 in ADR-0479 detail registry.')
    : partial('ADR_0479_DETAIL_REGISTRY_MOUNT', '/adr_trace 0481~0486 and /supply_health_detail are registered.', text || null, 'Register ADR-0481~0486 in ADR-0479 detail registry.', [`missing=${missingAdrs.join(',') || 'supply_health_detail'}`]);
}

function checkRuntimeAudit(input: SupplyRecoveryRuntimeMountInputAdr0486): SupplyRecoveryMountCheckAdr0486 {
  const observed = input.runtimePipelineAuditEvidence ?? null;
  if (/readinessAuditEvidence=missing/i.test(observed ?? '')) {
    return missing(
      'RUNTIME_PIPELINE_AUDIT_EVIDENCE_MOUNT',
      'Runtime Pipeline Audit includes ADR-0485 readiness and ADR-0486 mount evidence.',
      observed,
      'READINESS_AUDIT_EVIDENCE_MISSING',
      'Pass ADR-0485 readiness report and ADR-0486 mount report into Runtime Pipeline Audit input.',
    );
  }
  if (/ADR-0486|supplyRecoveryMount/i.test(observed ?? '')) {
    return mounted('RUNTIME_PIPELINE_AUDIT_EVIDENCE_MOUNT', 'Runtime Pipeline Audit includes ADR-0486 mount evidence.', observed);
  }
  return partial('RUNTIME_PIPELINE_AUDIT_EVIDENCE_MOUNT', 'Runtime Pipeline Audit includes ADR-0486 mount evidence.', observed, 'Append ADR-0486 diagnostic evidence line to Runtime Pipeline Audit.');
}

function overall(checks: SupplyRecoveryMountCheckAdr0486[]): SupplyRecoveryMountStatus {
  if (checks.some((check) => check.legacyOutputDetected)) return 'LEGACY_OUTPUT_DETECTED';
  if (checks.some((check) => check.status === 'MISSING_EVIDENCE' || check.status === 'NOT_MOUNTED')) return 'MISSING_EVIDENCE';
  if (checks.some((check) => check.status === 'PARTIAL')) return 'PARTIAL';
  if (checks.every((check) => check.status === 'MOUNTED')) return 'MOUNTED';
  return 'UNKNOWN';
}

function summarizeActions(checks: SupplyRecoveryMountCheckAdr0486[]): string[] {
  const actions = checks
    .filter((check) => check.status !== 'MOUNTED')
    .map((check) => check.recommendedAction);
  return Array.from(new Set(actions)).slice(0, 5);
}

export function buildSupplyRecoveryRuntimeMountReportAdr0486(
  input: SupplyRecoveryRuntimeMountInputAdr0486 = {},
): SupplyRecoveryRuntimeMountReportAdr0486 {
  if (input.throwForTest) throw new Error('ADR-0486 test failure');
  const compactText = asText(input.compactOutput);
  const warmupText = input.warmupOutput ?? compactText;
  const auditEvidence = input.runtimePipelineAuditEvidence ?? compactText;
  const inputWithAudit = { ...input, runtimePipelineAuditEvidence: auditEvidence };
  const checks = [
    checkNaver(input, warmupText),
    checkSemantic(input, warmupText),
    checkFreshness(input, warmupText),
    checkRecovery(input, compactText),
    checkReadiness(inputWithAudit, compactText),
    checkWarmupAlignment(input, warmupText),
    checkCompactOutput(compactText),
    checkDetailRegistry(input),
    checkRuntimeAudit(inputWithAudit),
  ];
  const mountedCount = checks.filter((check) => check.status === 'MOUNTED').length;
  const partialCount = checks.filter((check) => check.status === 'PARTIAL').length;
  const missingEvidenceCount = checks.filter((check) => check.status === 'MISSING_EVIDENCE').length;
  const legacyOutputCount = checks.filter((check) => check.legacyOutputDetected).length;
  const topMountGaps = checks
    .filter((check) => check.status !== 'MOUNTED')
    .map((check) => check.legacyOutputCode ?? check.id)
    .slice(0, 5);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    overallStatus: overall(checks),
    checks,
    mountedCount,
    partialCount,
    missingEvidenceCount,
    legacyOutputCount,
    topMountGaps,
    recommendedNextActions: summarizeActions(checks),
    ...POLICY,
    diagnostics: [
      ...(input.diagnostics ?? []),
      'ADR-0486 verifies runtime mounting only; it does not change trading policy.',
      'UNKNOWN remains UNKNOWN; provider issue is not bearish.',
      'No raw provider payloads are persisted by ADR-0486.',
    ],
  };
}

export function safeBuildSupplyRecoveryRuntimeMountReportAdr0486(
  input: SupplyRecoveryRuntimeMountInputAdr0486 = {},
): SupplyRecoveryRuntimeMountReportAdr0486 {
  try {
    return buildSupplyRecoveryRuntimeMountReportAdr0486(input);
  } catch (error) {
    const check = missing(
      'RUNTIME_PIPELINE_AUDIT_EVIDENCE_MOUNT',
      'ADR-0486 verification failure is isolated and scan continues.',
      null,
      'UNKNOWN_LEGACY_OUTPUT',
      'Inspect ADR-0486 verifier exception; continue scan and Shadow Learning.',
      [error instanceof Error ? error.message : String(error)],
    );
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      overallStatus: 'UNKNOWN',
      checks: [check],
      mountedCount: 0,
      partialCount: 0,
      missingEvidenceCount: 1,
      legacyOutputCount: 0,
      topMountGaps: ['UNKNOWN_LEGACY_OUTPUT'],
      recommendedNextActions: [check.recommendedAction],
      ...POLICY,
      diagnostics: ['ADR-0486 mount verification failure isolated.', error instanceof Error ? error.message : String(error)],
    };
  }
}

function compactAction(report: SupplyRecoveryRuntimeMountReportAdr0486): string | null {
  if (report.legacyOutputCount > 0) return 'align ADR-0473 warmup formatter + Runtime Pipeline Audit input';
  if (report.missingEvidenceCount > 0) return report.recommendedNextActions[0] ?? 'wire missing runtime evidence';
  if (report.partialCount > 0) return report.recommendedNextActions[0] ?? 'continue observation';
  return null;
}

export function formatSupplyRecoveryRuntimeMountCompactAdr0486(report: SupplyRecoveryRuntimeMountReportAdr0486 | null | undefined): string | null {
  if (!report) return null;
  const legacyCodes = Array.from(new Set(report.checks.filter((check) => check.legacyOutputDetected).map((check) => check.legacyOutputCode).filter(Boolean)));
  const statusText = report.overallStatus === 'LEGACY_OUTPUT_DETECTED' && legacyCodes.length > 0
    ? `${report.overallStatus} | ${legacyCodes.map((code) => code?.replace(/_LEGACY$/, '').replace(/SEMANTIC_NETBUY_COLLECTOR_NOT_WIRED/, 'SemanticNetBuy old text')).join('/')}`
    : `${report.overallStatus} | legacy=${report.legacyOutputCount} | missingEvidence=${report.missingEvidenceCount}`;
  const lines = [`ADR-0486 RuntimeMount: ${statusText} | impact=${report.executionImpact}`];
  const action = compactAction(report);
  if (action) lines.push(`   action: ${action}`);
  return lines.join('\n');
}

export function formatSupplyRecoveryRuntimeMountDetailAdr0486(report: SupplyRecoveryRuntimeMountReportAdr0486): string {
  const lines = [
    'ADR-0486 Supply Recovery Runtime Mount Verification',
    `overallStatus=${report.overallStatus} mounted=${report.mountedCount} partial=${report.partialCount} missingEvidence=${report.missingEvidenceCount} legacy=${report.legacyOutputCount}`,
  ];
  report.checks.forEach((check, index) => {
    lines.push(`${index + 1}. ${check.id}: ${check.status}`);
    lines.push(`   expected: ${check.expectedRuntimeSignal}`);
    lines.push(`   observed: ${check.observedRuntimeSignal ?? 'none'}`);
    lines.push(`   legacyOutputCode: ${check.legacyOutputCode ?? 'none'}`);
    lines.push(`   evidencePresent: ${check.evidencePresent}`);
    lines.push(`   action: ${check.recommendedAction}`);
  });
  lines.push(`guardrails: executionImpact=${report.executionImpact}; liveExecutionAllowed=${report.liveExecutionAllowed}; policyPromotionMode=${report.policyPromotionMode}; operatorApprovalRequired=${report.operatorApprovalRequired}; requiredScore unchanged at 70; no Gate/Kelly/KIS order changes; UNKNOWN remains UNKNOWN; provider issue is not bearish.`);
  return lines.join('\n');
}

export interface SupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486 {
  adr: '0486';
  sectionId: 'supply_recovery_runtime_mount';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail supply_recovery_runtime_mount';
  adrTraceHint: '/adr_trace 0486';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getSupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486(
  report: SupplyRecoveryRuntimeMountReportAdr0486,
): SupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486 {
  return {
    adr: '0486',
    sectionId: 'supply_recovery_runtime_mount',
    commandHint: '/supply_health_detail',
    scanBlockersDetailHint: '/scan_blockers_detail supply_recovery_runtime_mount',
    adrTraceHint: '/adr_trace 0486',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatSupplyRecoveryRuntimeMountDetailAdr0486(report),
  };
}

export function collectOperatorActionSourcesFromSupplyRecoveryRuntimeMountAdr0486(
  report: SupplyRecoveryRuntimeMountReportAdr0486 | null | undefined,
): OperatorActionSource[] {
  if (!report) return [];
  const sources: OperatorActionSource[] = [];
  if (report.legacyOutputCount > 0) {
    sources.push({
      adr: '0486',
      sectionId: 'supply_recovery_runtime_mount',
      code: 'SUPPLY_RECOVERY_RUNTIME_MOUNT_GAP',
      diagnosticKey: 'RuntimeMount',
      diagnosticValue: report.topMountGaps.join(',') || 'legacy output detected',
      severity: 'ERROR',
    });
  }
  if (report.checks.some((check) => check.legacyOutputCode === 'READINESS_AUDIT_EVIDENCE_MISSING')) {
    sources.push({
      adr: '0486',
      sectionId: 'runtime_pipeline_audit',
      code: 'SUPPLY_READINESS_EVIDENCE_MISSING',
      diagnosticKey: 'readinessAuditEvidence',
      diagnosticValue: 'missing',
      severity: 'ERROR',
    });
  }
  return sources;
}

export function buildSupplyRecoveryRuntimeMountObservationRowAdr0486(
  report: SupplyRecoveryRuntimeMountReportAdr0486,
): Record<string, unknown> {
  const legacyOutputCodes = Array.from(new Set(report.checks.map((check) => check.legacyOutputCode).filter(Boolean)));
  return {
    id: `adr0486-${report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
    createdAt: report.generatedAt,
    forDate: report.generatedAt.slice(0, 10),
    source: 'ADR_0486_SUPPLY_RECOVERY_RUNTIME_MOUNT',
    symbol: 'SUPPLY_RUNTIME_MOUNT',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
    dryRunScenario: 'SUPPLY_RECOVERY_RUNTIME_MOUNT_ADR0486',
    requiredScore: LEGACY_GATE1_REQUIRED_SCORE,
    providerIssue: report.missingEvidenceCount > 0 || report.legacyOutputCount > 0,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    observationType: 'SUPPLY_RECOVERY_RUNTIME_MOUNT_ADR0486',
    overallStatus: report.overallStatus,
    mountedCount: report.mountedCount,
    partialCount: report.partialCount,
    missingEvidenceCount: report.missingEvidenceCount,
    legacyOutputCount: report.legacyOutputCount,
    legacyOutputCodes,
    topMountGaps: report.topMountGaps,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    status: 'OBSERVING',
  };
}

export function formatRuntimePipelineMountEvidenceLineAdr0486(report: SupplyRecoveryRuntimeMountReportAdr0486 | null | undefined): string {
  if (!report) return 'ADR-0486 status=missing diagnosticOnly=true executionImpact=NONE';
  return `ADR-0486 status=${report.overallStatus} legacy=${report.legacyOutputCount} missingEvidence=${report.missingEvidenceCount} diagnosticOnly=true executionImpact=${report.executionImpact}`;
}
