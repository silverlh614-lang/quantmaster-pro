// @responsibility ADR-0485 supply advisory promotion readiness audit; SHADOW_ONLY diagnostic recommendation only.
import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';
import type { OperatorActionQueueReport } from './operatorActionRouterAdr0480.js';
import type { SupplyCoverageRecoveryObservationReportAdr0484, SupplyCoverageRecoveryStatus, SupplyCoverageSnapshotAdr0484 } from './supplyCoverageRecoveryObservationAdr0484.js';

export type SupplyAdvisoryReadinessStatus = 'READY' | 'NOT_READY' | 'OBSERVING' | 'INSUFFICIENT_DATA' | 'DEGRADED' | 'UNKNOWN';
export type SupplyAdvisoryReadinessReason =
  | 'COVERAGE_STABLE'
  | 'COVERAGE_IMPROVING'
  | 'SELECTED_PROVIDER_STABLE'
  | 'SEMANTIC_SAMPLE_AVAILABLE'
  | 'SOURCE_FRESHNESS_OK'
  | 'UNKNOWN_TREATMENT_SAFE'
  | 'OPERATOR_ACTIONS_OBSERVING'
  | 'OBSERVATION_ROWS_SUFFICIENT'
  | 'COVERAGE_TOO_LOW'
  | 'SELECTED_PROVIDER_NONE'
  | 'DATA_UNAVAILABLE_HIGH'
  | 'SEMANTIC_SAMPLE_MISSING'
  | 'SOURCE_STALE'
  | 'UNKNOWN_TREATMENT_UNSAFE'
  | 'INSUFFICIENT_OBSERVATIONS'
  | 'OPERATOR_ACTIONS_OPEN'
  | 'READINESS_DEGRADED';
export type SupplyAdvisoryReadinessWindow = 'LAST_3_SCANS' | 'LAST_5_SCANS' | 'LAST_10_SCANS';

export interface SupplyAdvisoryReadinessCriteriaAdr0485 {
  minObservationRows: number;
  minCoverageRatio: number;
  maxSelectedProviderNoneRate: number;
  maxDataUnavailableRate: number;
  minSemanticSampleAvailabilityRate: number;
  maxStaleSourceRate: number;
  requireUnknownSafety: boolean;
  requireNoP1OpenActions: boolean;
  allowedRecoveryStatuses: Array<'IMPROVING' | 'STABLE' | 'OBSERVING'>;
}

export interface SupplyAdvisoryReadinessEvidenceAdr0485 {
  window: SupplyAdvisoryReadinessWindow;
  observationRows: number;
  coverageRatioAvg: number | null;
  coverageRatioTrend: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
  selectedProviderNoneRate: number | null;
  dataUnavailableRate: number | null;
  semanticSampleAvailabilityRate: number | null;
  staleSourceRate: number | null;
  unknownTreatmentSafe: boolean;
  providerIssueBecameBearishCount: number;
  unknownBecameBullishCount: number;
  recoveryStatusCounts: {
    improving: number;
    stable: number;
    observing: number;
    degraded: number;
    insufficientData: number;
    unknown: number;
  };
  operatorActions: {
    p0Open: number;
    p1Open: number;
    p2Open: number;
    observing: number;
    resolvedCandidate: number;
  };
}

export interface SupplyAdvisoryReadinessReportAdr0485 {
  generatedAt: string;
  status: SupplyAdvisoryReadinessStatus;
  readinessScore: number;
  criteria: SupplyAdvisoryReadinessCriteriaAdr0485;
  evidence: SupplyAdvisoryReadinessEvidenceAdr0485;
  passedReasons: SupplyAdvisoryReadinessReason[];
  failedReasons: SupplyAdvisoryReadinessReason[];
  recommendedNextStep: 'KEEP_SHADOW_ONLY' | 'CONTINUE_OBSERVATION' | 'PREPARE_ADVISORY_DRY_RUN_ADR' | 'FIX_SUPPLY_COVERAGE' | 'FIX_FRESHNESS' | 'FIX_UNKNOWN_SAFETY';
  proposedPromotionMode: 'NONE' | 'ADVISORY_READY';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildSupplyAdvisoryReadinessEvidenceInputAdr0485 {
  window?: SupplyAdvisoryReadinessWindow;
  supplyCoverageRecoveryAdr0484?: SupplyCoverageRecoveryObservationReportAdr0484 | null;
  snapshotsAdr0484?: readonly SupplyCoverageSnapshotAdr0484[] | null;
  gate1DryRunObservationRowsAdr0476?: readonly Gate1DryRunObservationRow[] | null;
  operatorActionQueueAdr0480?: OperatorActionQueueReport | null;
  unknownBecameBullishCount?: number | null;
  providerIssueBecameBearishCount?: number | null;
  diagnostics?: string[];
}

export interface BuildSupplyAdvisoryReadinessReportInputAdr0485 extends BuildSupplyAdvisoryReadinessEvidenceInputAdr0485 {
  criteria?: Partial<SupplyAdvisoryReadinessCriteriaAdr0485>;
  evidence?: SupplyAdvisoryReadinessEvidenceAdr0485 | null;
  generatedAt?: string;
}

export const DEFAULT_SUPPLY_ADVISORY_READINESS_CRITERIA_ADR0485: SupplyAdvisoryReadinessCriteriaAdr0485 = {
  minObservationRows: 3,
  minCoverageRatio: 0.60,
  maxSelectedProviderNoneRate: 0.30,
  maxDataUnavailableRate: 0.40,
  minSemanticSampleAvailabilityRate: 0.50,
  maxStaleSourceRate: 0.30,
  requireUnknownSafety: true,
  requireNoP1OpenActions: true,
  allowedRecoveryStatuses: ['IMPROVING', 'STABLE', 'OBSERVING'],
};

const POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  policyPromotionMode: 'SHADOW_ONLY' as const,
  operatorApprovalRequired: true as const,
};

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function round2(value: number): number { return Math.round(value * 100) / 100; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function rate(count: number, rows: number): number | null { return rows > 0 ? round2(count / rows) : null; }
function avg(values: number[]): number | null { return values.length > 0 ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }

function statusKey(status: SupplyCoverageRecoveryStatus | string | undefined): keyof SupplyAdvisoryReadinessEvidenceAdr0485['recoveryStatusCounts'] {
  if (status === 'IMPROVING') return 'improving';
  if (status === 'STABLE') return 'stable';
  if (status === 'OBSERVING') return 'observing';
  if (status === 'DEGRADED') return 'degraded';
  if (status === 'INSUFFICIENT_DATA') return 'insufficientData';
  return 'unknown';
}

function inferSnapshotStatus(snapshot: SupplyCoverageSnapshotAdr0484): SupplyCoverageRecoveryStatus {
  if (snapshot.investorFlow.coverageRatio <= 0 || snapshot.investorFlow.dataUnavailableCount > snapshot.investorFlow.coverageAvailable) return 'DEGRADED';
  if (snapshot.investorFlow.coverageRatio >= 0.6 && snapshot.semanticNetBuy.sampleAvailableCount > 0) return 'STABLE';
  return 'OBSERVING';
}

function trend(values: number[]): SupplyAdvisoryReadinessEvidenceAdr0485['coverageRatioTrend'] {
  if (values.length < 2) return 'UNKNOWN';
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first + 0.02) return 'UP';
  if (last < first - 0.02) return 'DOWN';
  return 'FLAT';
}

function emptyEvidence(window: SupplyAdvisoryReadinessWindow): SupplyAdvisoryReadinessEvidenceAdr0485 {
  return {
    window,
    observationRows: 0,
    coverageRatioAvg: null,
    coverageRatioTrend: 'UNKNOWN',
    selectedProviderNoneRate: null,
    dataUnavailableRate: null,
    semanticSampleAvailabilityRate: null,
    staleSourceRate: null,
    unknownTreatmentSafe: true,
    providerIssueBecameBearishCount: 0,
    unknownBecameBullishCount: 0,
    recoveryStatusCounts: { improving: 0, stable: 0, observing: 0, degraded: 0, insufficientData: 0, unknown: 0 },
    operatorActions: { p0Open: 0, p1Open: 0, p2Open: 0, observing: 0, resolvedCandidate: 0 },
  };
}

export function buildSupplyAdvisoryReadinessEvidenceAdr0485(input: BuildSupplyAdvisoryReadinessEvidenceInputAdr0485 = {}): SupplyAdvisoryReadinessEvidenceAdr0485 {
  try {
    const window = input.window ?? 'LAST_3_SCANS';
    const snapshots = [
      ...(input.snapshotsAdr0484 ?? []),
      ...(input.supplyCoverageRecoveryAdr0484?.snapshots ?? []),
    ].slice(window === 'LAST_10_SCANS' ? -10 : window === 'LAST_5_SCANS' ? -5 : -3);
    if (snapshots.length === 0 && !(input.gate1DryRunObservationRowsAdr0476?.length)) return emptyEvidence(window);

    const rows = Math.max(snapshots.length, input.gate1DryRunObservationRowsAdr0476?.length ?? 0);
    const coverageValues = snapshots.map((snapshot) => snapshot.investorFlow.coverageRatio).filter(finite);
    const selectedNone = snapshots.filter((snapshot) => !snapshot.investorFlow.selectedProvider || snapshot.investorFlow.selectedProvider === 'NONE').length;
    const dataUnavailable = snapshots.filter((snapshot) => snapshot.investorFlow.dataUnavailableCount > 0).length;
    const semanticAvailable = snapshots.filter((snapshot) => snapshot.semanticNetBuy.sampleAvailableCount > 0 || snapshot.semanticNetBuy.selectedSampleCount > 0).length;
    const staleSource = snapshots.filter((snapshot) => snapshot.freshness.staleSourceCount > 0).length;
    const counts = emptyEvidence(window).recoveryStatusCounts;
    for (const snapshot of snapshots) counts[statusKey(inferSnapshotStatus(snapshot))] += 1;
    const reportStatus = input.supplyCoverageRecoveryAdr0484?.status;
    if (reportStatus) counts[statusKey(reportStatus)] += snapshots.length === 0 ? 1 : 0;

    const allActions = input.operatorActionQueueAdr0480?.allActions ?? [];
    const p0Open = allActions.filter((action) => action.priority === 'P0' && action.status === 'OPEN').length;
    const p1Open = allActions.filter((action) => action.priority === 'P1' && action.status === 'OPEN').length;
    const p2Open = allActions.filter((action) => action.priority === 'P2' && action.status === 'OPEN').length;
    const observing = allActions.filter((action) => action.status === 'OBSERVING').length;
    const resolvedCandidate = allActions.filter((action) => action.status === 'RESOLVED').length;
    const providerIssueBecameBearishCount = Math.max(0, input.providerIssueBecameBearishCount ?? 0);
    const unknownBecameBullishCount = Math.max(0, input.unknownBecameBullishCount ?? 0);

    return {
      window,
      observationRows: rows,
      coverageRatioAvg: avg(coverageValues),
      coverageRatioTrend: trend(coverageValues),
      selectedProviderNoneRate: snapshots.length > 0 ? rate(selectedNone, snapshots.length) : null,
      dataUnavailableRate: snapshots.length > 0 ? rate(dataUnavailable, snapshots.length) : null,
      semanticSampleAvailabilityRate: snapshots.length > 0 ? rate(semanticAvailable, snapshots.length) : null,
      staleSourceRate: snapshots.length > 0 ? rate(staleSource, snapshots.length) : null,
      unknownTreatmentSafe: unknownBecameBullishCount === 0 && providerIssueBecameBearishCount === 0,
      providerIssueBecameBearishCount,
      unknownBecameBullishCount,
      recoveryStatusCounts: counts,
      operatorActions: { p0Open, p1Open, p2Open, observing, resolvedCandidate },
    };
  } catch {
    return emptyEvidence(input.window ?? 'LAST_3_SCANS');
  }
}

function scorePass(value: number | null, threshold: number, higherIsBetter = true): boolean {
  if (value === null) return false;
  return higherIsBetter ? value >= threshold : value <= threshold;
}

function calculateScore(e: SupplyAdvisoryReadinessEvidenceAdr0485, c: SupplyAdvisoryReadinessCriteriaAdr0485): number {
  let score = 0;
  if (e.coverageRatioAvg !== null) score += 25 * clamp(e.coverageRatioAvg / c.minCoverageRatio, 0, 1);
  if (e.semanticSampleAvailabilityRate !== null) score += 20 * clamp(e.semanticSampleAvailabilityRate / c.minSemanticSampleAvailabilityRate, 0, 1);
  if (e.staleSourceRate !== null) score += 15 * clamp(1 - (e.staleSourceRate / Math.max(c.maxStaleSourceRate, 0.01)), 0, 1);
  if (e.selectedProviderNoneRate !== null) score += 15 * clamp(1 - (e.selectedProviderNoneRate / Math.max(c.maxSelectedProviderNoneRate, 0.01)), 0, 1);
  score += e.unknownTreatmentSafe ? 15 : 0;
  score += e.operatorActions.p0Open === 0 && e.operatorActions.p1Open === 0 ? 10 : e.operatorActions.p0Open === 0 ? 4 : 0;
  const capped = e.unknownTreatmentSafe ? score : Math.min(score, 50);
  return Math.round(clamp(capped, 0, 100));
}

function mostlyAllowedRecovery(e: SupplyAdvisoryReadinessEvidenceAdr0485): boolean {
  const allowed = e.recoveryStatusCounts.improving + e.recoveryStatusCounts.stable + e.recoveryStatusCounts.observing;
  const bad = e.recoveryStatusCounts.degraded + e.recoveryStatusCounts.insufficientData + e.recoveryStatusCounts.unknown;
  return allowed >= bad;
}

function nextStep(status: SupplyAdvisoryReadinessStatus, failed: SupplyAdvisoryReadinessReason[], e: SupplyAdvisoryReadinessEvidenceAdr0485): SupplyAdvisoryReadinessReportAdr0485['recommendedNextStep'] {
  if (!e.unknownTreatmentSafe || failed.includes('UNKNOWN_TREATMENT_UNSAFE')) return 'FIX_UNKNOWN_SAFETY';
  if (status === 'READY') return 'PREPARE_ADVISORY_DRY_RUN_ADR';
  if (status === 'INSUFFICIENT_DATA') return 'CONTINUE_OBSERVATION';
  if (failed.includes('SOURCE_STALE')) return 'FIX_FRESHNESS';
  if (failed.includes('COVERAGE_TOO_LOW') || failed.includes('SELECTED_PROVIDER_NONE') || failed.includes('DATA_UNAVAILABLE_HIGH') || failed.includes('SEMANTIC_SAMPLE_MISSING')) return 'FIX_SUPPLY_COVERAGE';
  if (status === 'OBSERVING') return 'CONTINUE_OBSERVATION';
  return 'KEEP_SHADOW_ONLY';
}

export function buildSupplyAdvisoryReadinessReportAdr0485(input: BuildSupplyAdvisoryReadinessReportInputAdr0485 = {}): SupplyAdvisoryReadinessReportAdr0485 {
  try {
    const criteria = { ...DEFAULT_SUPPLY_ADVISORY_READINESS_CRITERIA_ADR0485, ...(input.criteria ?? {}) };
    const evidence = input.evidence ?? buildSupplyAdvisoryReadinessEvidenceAdr0485(input);
    const passedReasons: SupplyAdvisoryReadinessReason[] = [];
    const failedReasons: SupplyAdvisoryReadinessReason[] = [];

    if (evidence.observationRows >= criteria.minObservationRows) passedReasons.push('OBSERVATION_ROWS_SUFFICIENT'); else failedReasons.push('INSUFFICIENT_OBSERVATIONS');
    if (scorePass(evidence.coverageRatioAvg, criteria.minCoverageRatio)) passedReasons.push(evidence.coverageRatioTrend === 'UP' ? 'COVERAGE_IMPROVING' : 'COVERAGE_STABLE'); else failedReasons.push('COVERAGE_TOO_LOW');
    if (scorePass(evidence.selectedProviderNoneRate, criteria.maxSelectedProviderNoneRate, false)) passedReasons.push('SELECTED_PROVIDER_STABLE'); else failedReasons.push('SELECTED_PROVIDER_NONE');
    if (!scorePass(evidence.dataUnavailableRate, criteria.maxDataUnavailableRate, false)) failedReasons.push('DATA_UNAVAILABLE_HIGH');
    if (scorePass(evidence.semanticSampleAvailabilityRate, criteria.minSemanticSampleAvailabilityRate)) passedReasons.push('SEMANTIC_SAMPLE_AVAILABLE'); else failedReasons.push('SEMANTIC_SAMPLE_MISSING');
    if (scorePass(evidence.staleSourceRate, criteria.maxStaleSourceRate, false)) passedReasons.push('SOURCE_FRESHNESS_OK'); else failedReasons.push('SOURCE_STALE');
    if (!criteria.requireUnknownSafety || evidence.unknownTreatmentSafe) passedReasons.push('UNKNOWN_TREATMENT_SAFE'); else failedReasons.push('UNKNOWN_TREATMENT_UNSAFE');
    if (evidence.operatorActions.p0Open === 0 && (!criteria.requireNoP1OpenActions || evidence.operatorActions.p1Open === 0)) passedReasons.push('OPERATOR_ACTIONS_OBSERVING'); else failedReasons.push('OPERATOR_ACTIONS_OPEN');
    if (!mostlyAllowedRecovery(evidence)) failedReasons.push('READINESS_DEGRADED');

    const score = calculateScore(evidence, criteria);
    const noRows = evidence.observationRows === 0;
    const safetyViolation = !evidence.unknownTreatmentSafe || evidence.providerIssueBecameBearishCount > 0 || evidence.unknownBecameBullishCount > 0 || evidence.operatorActions.p0Open > 0;
    const allReady = !noRows && failedReasons.length === 0 && mostlyAllowedRecovery(evidence);
    let status: SupplyAdvisoryReadinessStatus;
    if (noRows) status = 'INSUFFICIENT_DATA';
    else if (evidence.providerIssueBecameBearishCount > 0 || evidence.coverageRatioTrend === 'DOWN' || evidence.operatorActions.p1Open > 0 || failedReasons.includes('SOURCE_STALE') || failedReasons.includes('DATA_UNAVAILABLE_HIGH')) status = 'DEGRADED';
    else if (allReady) status = 'READY';
    else if (evidence.observationRows < criteria.minObservationRows && !safetyViolation) status = 'OBSERVING';
    else status = 'NOT_READY';

    const recommendedNextStep = nextStep(status, failedReasons, evidence);
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      status,
      readinessScore: score,
      criteria,
      evidence,
      passedReasons,
      failedReasons,
      recommendedNextStep,
      proposedPromotionMode: status === 'READY' ? 'ADVISORY_READY' : 'NONE',
      ...POLICY,
      diagnostics: [
        ...(input.diagnostics ?? []),
        'ADR-0485 is a readiness audit only; it does not promote supply data to ADVISORY.',
        'UNKNOWN remains UNKNOWN; provider issues remain separated from bearish market signals.',
        'No raw provider payloads are persisted by ADR-0485.',
      ],
    };
  } catch (error) {
    const evidence = emptyEvidence(input.window ?? 'LAST_3_SCANS');
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      status: 'UNKNOWN',
      readinessScore: 0,
      criteria: { ...DEFAULT_SUPPLY_ADVISORY_READINESS_CRITERIA_ADR0485, ...(input.criteria ?? {}) },
      evidence,
      passedReasons: [],
      failedReasons: ['READINESS_DEGRADED'],
      recommendedNextStep: 'KEEP_SHADOW_ONLY',
      proposedPromotionMode: 'NONE',
      ...POLICY,
      diagnostics: ['ADR-0485 readiness audit failure isolated.', error instanceof Error ? error.message : String(error)],
    };
  }
}

export function safeBuildSupplyAdvisoryReadinessReportAdr0485(input: BuildSupplyAdvisoryReadinessReportInputAdr0485 = {}): SupplyAdvisoryReadinessReportAdr0485 {
  try { return buildSupplyAdvisoryReadinessReportAdr0485(input); }
  catch { return buildSupplyAdvisoryReadinessReportAdr0485({ evidence: emptyEvidence(input.window ?? 'LAST_3_SCANS') }); }
}

function nextText(step: SupplyAdvisoryReadinessReportAdr0485['recommendedNextStep']): string {
  if (step === 'PREPARE_ADVISORY_DRY_RUN_ADR') return 'prepare ADVISORY dry-run ADR';
  if (step === 'CONTINUE_OBSERVATION') return 'continue observation';
  if (step === 'FIX_FRESHNESS') return 'fix freshness';
  if (step === 'FIX_SUPPLY_COVERAGE') return 'fix supply coverage';
  if (step === 'FIX_UNKNOWN_SAFETY') return 'fix UNKNOWN safety';
  return 'keep SHADOW_ONLY';
}

export function formatSupplyAdvisoryReadinessCompactAdr0485(report: SupplyAdvisoryReadinessReportAdr0485 | null | undefined): string | null {
  if (!report) return null;
  const rows = `${report.evidence.observationRows}/${report.criteria.minObservationRows}`;
  if (report.status === 'INSUFFICIENT_DATA') return `🧭 ADR-0485 SupplyReadiness: INSUFFICIENT_DATA | score=${report.readinessScore} | rows=${rows} | impact=${report.executionImpact}\n   action: collect ADR-0484 observations`;
  if (report.status === 'READY') return `🧭 ADR-0485 SupplyReadiness: READY | score=${report.readinessScore} | next=${nextText(report.recommendedNextStep)} | impact=${report.executionImpact}`;
  if (report.status === 'NOT_READY' || report.status === 'DEGRADED') return `🧭 ADR-0485 SupplyReadiness: ${report.status} | score=${report.readinessScore} | fail=${report.failedReasons.slice(0, 2).join('/') || 'none'} | impact=${report.executionImpact}`;
  return `🧭 ADR-0485 SupplyReadiness: ${report.status} | score=${report.readinessScore} | rows=${rows} | next=${nextText(report.recommendedNextStep)} | impact=${report.executionImpact}`;
}

export function formatSupplyAdvisoryReadinessDetailAdr0485(report: SupplyAdvisoryReadinessReportAdr0485): string {
  const e = report.evidence;
  const c = report.criteria;
  return [
    '🧭 ADR-0485 Supply Advisory Promotion Readiness Audit',
    `status=${report.status} score=${report.readinessScore} proposedPromotionMode=${report.proposedPromotionMode}`,
    `criteria: minRows=${c.minObservationRows} minCoverage=${c.minCoverageRatio} maxProviderNone=${c.maxSelectedProviderNoneRate} maxDataUnavailable=${c.maxDataUnavailableRate} minSemantic=${c.minSemanticSampleAvailabilityRate} maxStale=${c.maxStaleSourceRate}`,
    `evidence: window=${e.window} rows=${e.observationRows} coverageAvg=${e.coverageRatioAvg ?? 'UNKNOWN'} trend=${e.coverageRatioTrend} providerNoneRate=${e.selectedProviderNoneRate ?? 'UNKNOWN'} dataUnavailableRate=${e.dataUnavailableRate ?? 'UNKNOWN'} semanticRate=${e.semanticSampleAvailabilityRate ?? 'UNKNOWN'} staleRate=${e.staleSourceRate ?? 'UNKNOWN'}`,
    `unknownSafety: safe=${e.unknownTreatmentSafe} unknownBecameBullish=${e.unknownBecameBullishCount} providerIssueBecameBearish=${e.providerIssueBecameBearishCount}`,
    `operatorActions: p0Open=${e.operatorActions.p0Open} p1Open=${e.operatorActions.p1Open} p2Open=${e.operatorActions.p2Open} observing=${e.operatorActions.observing} resolvedCandidate=${e.operatorActions.resolvedCandidate}`,
    `recoveryStatusCounts: improving=${e.recoveryStatusCounts.improving} stable=${e.recoveryStatusCounts.stable} observing=${e.recoveryStatusCounts.observing} degraded=${e.recoveryStatusCounts.degraded} insufficientData=${e.recoveryStatusCounts.insufficientData} unknown=${e.recoveryStatusCounts.unknown}`,
    `passedReasons: ${report.passedReasons.join(', ') || 'none'}`,
    `failedReasons: ${report.failedReasons.join(', ') || 'none'}`,
    `recommendedNextStep: ${report.recommendedNextStep}`,
    `guardrails: executionImpact=${report.executionImpact}; liveExecutionAllowed=${report.liveExecutionAllowed}; policyPromotionMode=${report.policyPromotionMode}; operatorApprovalRequired=${report.operatorApprovalRequired}; UNKNOWN remains UNKNOWN; provider issue is not bearish; no Gate/Kelly/requiredScore/KIS order changes; promotion beyond SHADOW_ONLY requires a future ADR.`,
  ].join('\n');
}

export interface SupplyAdvisoryReadinessDetailRegistryEntryAdr0485 {
  adr: '0485';
  sectionId: 'supply_advisory_readiness';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail supply_advisory_readiness';
  adrTraceHint: '/adr_trace 0485';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getSupplyAdvisoryReadinessDetailRegistryEntryAdr0485(report: SupplyAdvisoryReadinessReportAdr0485): SupplyAdvisoryReadinessDetailRegistryEntryAdr0485 {
  return { adr: '0485', sectionId: 'supply_advisory_readiness', commandHint: '/supply_health_detail', scanBlockersDetailHint: '/scan_blockers_detail supply_advisory_readiness', adrTraceHint: '/adr_trace 0485', executionImpact: 'NONE', liveExecutionAllowed: false, render: () => formatSupplyAdvisoryReadinessDetailAdr0485(report) };
}

export function buildSupplyAdvisoryReadinessObservationRowAdr0485(report: SupplyAdvisoryReadinessReportAdr0485): Partial<Gate1DryRunObservationRow> & Record<string, unknown> {
  return {
    id: `adr0485-${report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
    createdAt: report.generatedAt,
    forDate: report.generatedAt.slice(0, 10),
    source: 'ADR_0485_SUPPLY_ADVISORY_READINESS',
    symbol: 'SUPPLY_READINESS',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
    dryRunScenario: 'SUPPLY_ADVISORY_READINESS_ADR0485',
    requiredScore: 70,
    providerIssue: report.failedReasons.length > 0,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    observationType: 'SUPPLY_ADVISORY_READINESS_ADR0485',
    status: 'OBSERVING',
    readinessStatus: report.status,
    readinessScore: report.readinessScore,
    proposedPromotionMode: report.proposedPromotionMode,
    observationRows: report.evidence.observationRows,
    coverageRatioAvg: report.evidence.coverageRatioAvg,
    semanticSampleAvailabilityRate: report.evidence.semanticSampleAvailabilityRate,
    staleSourceRate: report.evidence.staleSourceRate,
    selectedProviderNoneRate: report.evidence.selectedProviderNoneRate,
    dataUnavailableRate: report.evidence.dataUnavailableRate,
    unknownTreatmentSafe: report.evidence.unknownTreatmentSafe,
    p1Open: report.evidence.operatorActions.p1Open,
    recommendedNextStep: report.recommendedNextStep,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

export function formatRuntimePipelineReadinessEvidenceLineAdr0485(report: SupplyAdvisoryReadinessReportAdr0485 | null | undefined): string {
  if (!report) return 'ADR-0485 readinessAuditEvidence=missing diagnosticOnly=true rolloutInstalled=false supplyAdvisoryModeInstalled=false executionImpact=NONE';
  return `ADR-0485 readinessAuditEvidence=${report.status} score=${report.readinessScore} diagnosticOnly=true rolloutInstalled=false supplyAdvisoryModeInstalled=false executionImpact=${report.executionImpact}`;
}
