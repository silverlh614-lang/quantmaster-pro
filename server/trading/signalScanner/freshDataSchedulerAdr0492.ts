// @responsibility ADR-0492 Fresh Data Scheduler / Non-Live Cron; diagnostic-only probe orchestration, no live execution.
import {
  buildFreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportInputAdr0487,
} from './freshDataSupplyLayerAdr0487.js';
import {
  buildSupplyCoverageRecoveryObservationReportAdr0484,
  type SupplyCoverageRecoveryObservationReportAdr0484,
} from './supplyCoverageRecoveryObservationAdr0484.js';
import {
  buildSupplyAdvisoryReadinessReportAdr0485,
  type SupplyAdvisoryReadinessReportAdr0485,
} from './supplyAdvisoryReadinessAdr0485.js';
import {
  buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
  type SectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import {
  buildInvestorFlowSampleAcquisitionReportAdr0489,
  type InvestorFlowSampleAcquisitionReportAdr0489,
} from './investorFlowSampleAcquisitionAdr0489.js';
import {
  buildProgramTradingDataLineReportAdr0490,
  type ProgramTradingDataLineReportAdr0490,
} from './programTradingDataLineAdr0490.js';
import {
  recordSupplySnapshotAdr0491,
  type SupplySnapshotReplayResultAdr0491,
} from './supplySnapshotStoreReplayAdr0491.js';

export type FreshDataSchedulerModeAdr0492 = 'DISABLED' | 'OBSERVE_ONLY' | 'SHADOW_ONLY';
export type FreshDataSchedulerSessionAdr0492 = 'PRE_MARKET' | 'REGULAR' | 'LUNCH_BREAK' | 'AFTER_MARKET' | 'NON_TRADING_DAY' | 'UNKNOWN';
export type FreshDataSchedulerJobStatusAdr0492 = 'SKIPPED' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'DATA_UNAVAILABLE' | 'FAILED_PROVIDER' | 'FAILED_INTERNAL';
export type FreshDataSchedulerJobNameAdr0492 =
  | 'SECTOR_ENERGY_MASTER'
  | 'INVESTOR_FLOW_SAMPLE'
  | 'PROGRAM_TRADING_SAMPLE'
  | 'SUPPLY_COVERAGE_RECOVERY'
  | 'SUPPLY_READINESS_AUDIT'
  | 'SNAPSHOT_STORE_WRITE';
export type FreshDataSchedulerHealthAdr0492 = 'OK' | 'DEGRADED' | 'DATA_UNAVAILABLE' | 'PROVIDER_ERROR' | 'DISABLED';
export type FreshDataSchedulerOverallStatusAdr0492 = 'DISABLED' | 'OBSERVING' | 'SKIPPED' | 'PARTIAL' | 'FAILED_PROVIDER' | 'FAILED_INTERNAL';
export type FreshDataSchedulerActionAdr0492 =
  | 'ENABLE_FRESH_DATA_SCHEDULER_OBSERVE'
  | 'CHECK_FRESH_DATA_SCHEDULER_HEALTH'
  | 'COLLECT_AFTER_MARKET_FRESH_DATA_SAMPLES'
  | 'REPAIR_SNAPSHOT_STORE_WRITE'
  | 'PROVIDER_JOB_FAILED_OBSERVE_ONLY'
  | 'WAIT_FOR_NEXT_TRADING_SESSION';

export interface FreshDataSchedulerJobAdr0492 {
  name: FreshDataSchedulerJobNameAdr0492;
  status: FreshDataSchedulerJobStatusAdr0492;
  providerIssue: boolean;
  marketSignal: false;
  diagnostics: string[];
}

export interface FreshDataSchedulerReportAdr0492 {
  adr: 'ADR-0492';
  mode: FreshDataSchedulerModeAdr0492;
  enabled: boolean;
  session: FreshDataSchedulerSessionAdr0492;
  status: FreshDataSchedulerOverallStatusAdr0492;
  health: FreshDataSchedulerHealthAdr0492;
  jobs: FreshDataSchedulerJobAdr0492[];
  plannedJobs: FreshDataSchedulerJobNameAdr0492[];
  lastRunAt: string | null;
  nextRunHint: string;
  providerIssue: boolean;
  marketSignal: false;
  coveragePct: number;
  snapshotWritten: boolean;
  snapshotStoreStatus: string;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  recommendedNextActions: FreshDataSchedulerActionAdr0492[];
  diagnostics: string[];
}

export interface FreshDataSchedulerGateInputAdr0492 {
  mode?: FreshDataSchedulerModeAdr0492;
  session?: FreshDataSchedulerSessionAdr0492;
  enabled?: boolean;
  lastRunAt?: string | null;
  now?: string | Date;
  minIntervalMinutes?: number;
  providerHealth?: FreshDataSchedulerHealthAdr0492;
  operatorOverride?: boolean;
  afterMarketOnly?: boolean;
}

export interface FreshDataSchedulerGateDecisionAdr0492 {
  shouldRun: boolean;
  reason:
    | 'DISABLED'
    | 'MODE_DISABLED'
    | 'UNKNOWN_SESSION'
    | 'NON_TRADING_DAY_REPLAY_ONLY'
    | 'AFTER_MARKET_ONLY'
    | 'MIN_INTERVAL_NOT_ELAPSED'
    | 'OPERATOR_OVERRIDE'
    | 'SCHEDULED';
  plannedJobs: FreshDataSchedulerJobNameAdr0492[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
}

export interface FreshDataSchedulerJobContextAdr0492 {
  generatedAt: string;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null;
  supplyCoverageRecoveryAdr0484?: SupplyCoverageRecoveryObservationReportAdr0484 | null;
  supplyAdvisoryReadinessAdr0485?: SupplyAdvisoryReadinessReportAdr0485 | null;
  investorFlowSampleAdr0489?: InvestorFlowSampleAcquisitionReportAdr0489 | null;
  programTradingAdr0490?: ProgramTradingDataLineReportAdr0490 | null;
}

export type FreshDataSchedulerJobRunnerAdr0492 = (
  context: FreshDataSchedulerJobContextAdr0492,
) => FreshDataSchedulerJobAdr0492 | Promise<FreshDataSchedulerJobAdr0492>;

export interface RunFreshDataSchedulerInputAdr0492 extends FreshDataSchedulerGateInputAdr0492 {
  generatedAt?: string;
  scanId?: string;
  freshDataSupplyInputAdr0487?: FreshDataSupplyReportInputAdr0487;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null;
  supplyCoverageRecoveryAdr0484?: SupplyCoverageRecoveryObservationReportAdr0484 | null;
  supplyAdvisoryReadinessAdr0485?: SupplyAdvisoryReadinessReportAdr0485 | null;
  investorFlowSampleAdr0489?: InvestorFlowSampleAcquisitionReportAdr0489 | null;
  programTradingAdr0490?: ProgramTradingDataLineReportAdr0490 | null;
  jobRunners?: Partial<Record<FreshDataSchedulerJobNameAdr0492, FreshDataSchedulerJobRunnerAdr0492>>;
  snapshotFilePath?: string;
}

const PROVIDER_JOBS: FreshDataSchedulerJobNameAdr0492[] = [
  'SECTOR_ENERGY_MASTER',
  'INVESTOR_FLOW_SAMPLE',
  'PROGRAM_TRADING_SAMPLE',
  'SUPPLY_COVERAGE_RECOVERY',
  'SUPPLY_READINESS_AUDIT',
  'SNAPSHOT_STORE_WRITE',
];
const LIGHTWEIGHT_JOBS: FreshDataSchedulerJobNameAdr0492[] = [
  'INVESTOR_FLOW_SAMPLE',
  'PROGRAM_TRADING_SAMPLE',
  'SNAPSHOT_STORE_WRITE',
];

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function envMode(): FreshDataSchedulerModeAdr0492 {
  const value = process.env.FRESH_DATA_SCHEDULER_MODE;
  return value === 'SHADOW_ONLY' || value === 'DISABLED' ? value : 'OBSERVE_ONLY';
}

function envInterval(): number {
  const value = Number(process.env.FRESH_DATA_SCHEDULER_MIN_INTERVAL_MINUTES);
  return Number.isFinite(value) && value >= 0 ? value : 30;
}

function toDate(value: string | Date | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function minutesSince(lastRunAt: string | null | undefined, now: Date): number | null {
  if (!lastRunAt) return null;
  const previous = new Date(lastRunAt);
  if (Number.isNaN(previous.getTime())) return null;
  return (now.getTime() - previous.getTime()) / 60_000;
}

function plannedJobsForSession(session: FreshDataSchedulerSessionAdr0492): FreshDataSchedulerJobNameAdr0492[] {
  if (session === 'AFTER_MARKET' || session === 'PRE_MARKET') return [...PROVIDER_JOBS];
  if (session === 'REGULAR' || session === 'LUNCH_BREAK') return [...LIGHTWEIGHT_JOBS];
  return [];
}

export function readFreshDataSchedulerConfigAdr0492(): Required<Pick<FreshDataSchedulerGateInputAdr0492, 'enabled' | 'mode' | 'minIntervalMinutes' | 'afterMarketOnly'>> {
  return {
    enabled: envBool('FRESH_DATA_SCHEDULER_ENABLED', false),
    mode: envMode(),
    minIntervalMinutes: envInterval(),
    afterMarketOnly: envBool('FRESH_DATA_SCHEDULER_AFTER_MARKET_ONLY', true),
  };
}

export function shouldRunFreshDataSchedulerAdr0492(
  input: FreshDataSchedulerGateInputAdr0492 = {},
): FreshDataSchedulerGateDecisionAdr0492 {
  const config = readFreshDataSchedulerConfigAdr0492();
  const enabled = input.enabled ?? config.enabled;
  const mode = input.mode ?? config.mode;
  const session = input.session ?? 'UNKNOWN';
  const afterMarketOnly = input.afterMarketOnly ?? config.afterMarketOnly;
  const operatorOverride = input.operatorOverride === true;
  const plannedJobs = plannedJobsForSession(session);
  const base = { plannedJobs, executionImpact: 'NONE' as const, liveExecutionAllowed: false as const };
  if (!enabled) return { shouldRun: false, reason: 'DISABLED', plannedJobs: [], executionImpact: 'NONE', liveExecutionAllowed: false };
  if (mode === 'DISABLED') return { shouldRun: false, reason: 'MODE_DISABLED', plannedJobs: [], executionImpact: 'NONE', liveExecutionAllowed: false };
  if (session === 'UNKNOWN') return { shouldRun: false, reason: 'UNKNOWN_SESSION', plannedJobs: [], executionImpact: 'NONE', liveExecutionAllowed: false };
  if (session === 'NON_TRADING_DAY') return { shouldRun: false, reason: 'NON_TRADING_DAY_REPLAY_ONLY', plannedJobs: [], executionImpact: 'NONE', liveExecutionAllowed: false };
  if (operatorOverride) return { shouldRun: true, reason: 'OPERATOR_OVERRIDE', ...base };
  if (afterMarketOnly && session !== 'AFTER_MARKET') return { shouldRun: false, reason: 'AFTER_MARKET_ONLY', plannedJobs, executionImpact: 'NONE', liveExecutionAllowed: false };
  const elapsed = minutesSince(input.lastRunAt ?? null, toDate(input.now));
  const minInterval = input.minIntervalMinutes ?? config.minIntervalMinutes;
  if (elapsed !== null && elapsed < minInterval) return { shouldRun: false, reason: 'MIN_INTERVAL_NOT_ELAPSED', plannedJobs, executionImpact: 'NONE', liveExecutionAllowed: false };
  return { shouldRun: true, reason: 'SCHEDULED', ...base };
}

function job(name: FreshDataSchedulerJobNameAdr0492, status: FreshDataSchedulerJobStatusAdr0492, diagnostics: string[] = []): FreshDataSchedulerJobAdr0492 {
  return {
    name,
    status,
    providerIssue: status === 'DATA_UNAVAILABLE' || status === 'FAILED_PROVIDER',
    marketSignal: false,
    diagnostics,
  };
}

function statusFromProviderReport(name: FreshDataSchedulerJobNameAdr0492, status: string | undefined): FreshDataSchedulerJobAdr0492 {
  const text = status ?? 'UNKNOWN';
  if (text.includes('PROVIDER_ERROR')) return job(name, 'FAILED_PROVIDER', [`status=${text}`]);
  if (text.includes('DATA_UNAVAILABLE') || text.includes('EMPTY') || text.includes('UNKNOWN') || text.includes('INSUFFICIENT')) return job(name, 'DATA_UNAVAILABLE', [`status=${text}`]);
  return job(name, 'COMPLETED', [`status=${text}`]);
}

function defaultJobRunner(name: FreshDataSchedulerJobNameAdr0492, input: RunFreshDataSchedulerInputAdr0492): FreshDataSchedulerJobRunnerAdr0492 {
  return (context) => {
    if (name === 'SECTOR_ENERGY_MASTER') {
      context.sectorEnergySupplyUnknownAdr0488 = context.sectorEnergySupplyUnknownAdr0488 ?? buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
        generatedAt: context.generatedAt,
        freshDataSupplyAdr0487: context.freshDataSupplyAdr0487 ?? undefined,
        providerIssue: true,
        marketSignal: false,
      });
      return statusFromProviderReport(name, context.sectorEnergySupplyUnknownAdr0488.overallStatus);
    }
    if (name === 'INVESTOR_FLOW_SAMPLE') {
      context.investorFlowSampleAdr0489 = context.investorFlowSampleAdr0489 ?? buildInvestorFlowSampleAcquisitionReportAdr0489({ generatedAt: context.generatedAt });
      return statusFromProviderReport(name, context.investorFlowSampleAdr0489.status);
    }
    if (name === 'PROGRAM_TRADING_SAMPLE') {
      context.programTradingAdr0490 = context.programTradingAdr0490 ?? buildProgramTradingDataLineReportAdr0490({ generatedAt: context.generatedAt });
      return statusFromProviderReport(name, context.programTradingAdr0490.status);
    }
    if (name === 'SUPPLY_COVERAGE_RECOVERY') {
      context.supplyCoverageRecoveryAdr0484 = context.supplyCoverageRecoveryAdr0484 ?? buildSupplyCoverageRecoveryObservationReportAdr0484({ timestamp: context.generatedAt, persist: false });
      return statusFromProviderReport(name, context.supplyCoverageRecoveryAdr0484.status);
    }
    if (name === 'SUPPLY_READINESS_AUDIT') {
      context.supplyAdvisoryReadinessAdr0485 = context.supplyAdvisoryReadinessAdr0485 ?? buildSupplyAdvisoryReadinessReportAdr0485({ generatedAt: context.generatedAt, supplyCoverageRecoveryAdr0484: context.supplyCoverageRecoveryAdr0484 ?? undefined });
      return statusFromProviderReport(name, context.supplyAdvisoryReadinessAdr0485.status);
    }
    if (name === 'SNAPSHOT_STORE_WRITE') {
      const result = recordSupplySnapshotAdr0491({
        filePath: input.snapshotFilePath,
        scanId: input.scanId ?? `ADR-0492-${context.generatedAt}`,
        recordedAt: context.generatedAt,
        tradingDate: context.generatedAt.slice(0, 10),
        freshDataSupplyAdr0487: context.freshDataSupplyAdr0487 ?? undefined,
        sectorEnergySupplyUnknownAdr0488: context.sectorEnergySupplyUnknownAdr0488 ?? undefined,
        investorFlowSampleAdr0489: context.investorFlowSampleAdr0489 ?? undefined,
        programTradingAdr0490: context.programTradingAdr0490 ?? undefined,
        diagnostics: ['ADR-0492 scheduler wrote sanitized snapshot only; replay is diagnostic-only.'],
      });
      return result.status === 'CORRUPT_RECOVERED'
        ? job(name, 'PARTIAL', ['snapshot store recovered corrupt JSON before write'])
        : job(name, 'COMPLETED', [`snapshotStatus=${result.status}`]);
    }
    return job(name, 'SKIPPED', ['unknown job']);
  };
}

function overallStatus(input: { enabled: boolean; jobs: FreshDataSchedulerJobAdr0492[]; skipped: boolean }): FreshDataSchedulerOverallStatusAdr0492 {
  if (!input.enabled) return 'DISABLED';
  if (input.skipped) return 'SKIPPED';
  if (input.jobs.some((row) => row.status === 'FAILED_INTERNAL')) return 'FAILED_INTERNAL';
  if (input.jobs.length > 0 && input.jobs.every((row) => row.status === 'FAILED_PROVIDER')) return 'FAILED_PROVIDER';
  if (input.jobs.some((row) => row.status !== 'COMPLETED')) return 'PARTIAL';
  return 'OBSERVING';
}

function healthFrom(status: FreshDataSchedulerOverallStatusAdr0492, jobs: FreshDataSchedulerJobAdr0492[]): FreshDataSchedulerHealthAdr0492 {
  if (status === 'DISABLED') return 'DISABLED';
  if (status === 'FAILED_PROVIDER') return 'PROVIDER_ERROR';
  if (jobs.some((row) => row.status === 'DATA_UNAVAILABLE')) return 'DATA_UNAVAILABLE';
  if (status === 'PARTIAL' || status === 'FAILED_INTERNAL') return 'DEGRADED';
  return 'OK';
}

function actionsFrom(report: Pick<FreshDataSchedulerReportAdr0492, 'enabled' | 'session' | 'status' | 'jobs' | 'snapshotWritten'>): FreshDataSchedulerActionAdr0492[] {
  const actions = new Set<FreshDataSchedulerActionAdr0492>();
  if (!report.enabled) actions.add('ENABLE_FRESH_DATA_SCHEDULER_OBSERVE');
  if (report.session !== 'AFTER_MARKET') actions.add('WAIT_FOR_NEXT_TRADING_SESSION');
  if (report.status === 'PARTIAL' || report.status === 'FAILED_INTERNAL' || report.status === 'FAILED_PROVIDER') actions.add('CHECK_FRESH_DATA_SCHEDULER_HEALTH');
  if (report.jobs.some((row) => row.status === 'FAILED_PROVIDER' || row.status === 'DATA_UNAVAILABLE')) actions.add('PROVIDER_JOB_FAILED_OBSERVE_ONLY');
  if (report.jobs.some((row) => row.name === 'SNAPSHOT_STORE_WRITE' && row.status !== 'COMPLETED') || !report.snapshotWritten) actions.add('REPAIR_SNAPSHOT_STORE_WRITE');
  actions.add('COLLECT_AFTER_MARKET_FRESH_DATA_SAMPLES');
  return [...actions];
}

export async function runFreshDataSchedulerAdr0492(input: RunFreshDataSchedulerInputAdr0492 = {}): Promise<FreshDataSchedulerReportAdr0492> {
  const config = readFreshDataSchedulerConfigAdr0492();
  const enabled = input.enabled ?? config.enabled;
  const mode = input.mode ?? config.mode;
  const session = input.session ?? 'UNKNOWN';
  const generatedAt = input.generatedAt ?? toDate(input.now).toISOString();
  const gate = shouldRunFreshDataSchedulerAdr0492(input);
  const context: FreshDataSchedulerJobContextAdr0492 = {
    generatedAt,
    freshDataSupplyAdr0487: input.freshDataSupplyAdr0487 ?? buildFreshDataSupplyReportAdr0487({ generatedAt, ...(input.freshDataSupplyInputAdr0487 ?? {}) }),
    sectorEnergySupplyUnknownAdr0488: input.sectorEnergySupplyUnknownAdr0488 ?? null,
    supplyCoverageRecoveryAdr0484: input.supplyCoverageRecoveryAdr0484 ?? null,
    supplyAdvisoryReadinessAdr0485: input.supplyAdvisoryReadinessAdr0485 ?? null,
    investorFlowSampleAdr0489: input.investorFlowSampleAdr0489 ?? null,
    programTradingAdr0490: input.programTradingAdr0490 ?? null,
  };
  const jobs: FreshDataSchedulerJobAdr0492[] = [];
  if (gate.shouldRun) {
    for (const name of gate.plannedJobs) {
      try {
        const runner = input.jobRunners?.[name] ?? defaultJobRunner(name, input);
        jobs.push(await runner(context));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[ADR-0492] Fresh data scheduler job failed diagnostically (${name}); live execution unaffected:`, err);
        jobs.push(job(name, message.toUpperCase().includes('PROVIDER') ? 'FAILED_PROVIDER' : 'FAILED_INTERNAL', [message]));
      }
    }
  }
  const snapshotJob = jobs.find((row) => row.name === 'SNAPSHOT_STORE_WRITE');
  const snapshotWritten = snapshotJob?.status === 'COMPLETED' || snapshotJob?.status === 'PARTIAL';
  const status = overallStatus({ enabled: enabled && mode !== 'DISABLED', jobs, skipped: !gate.shouldRun && enabled && mode !== 'DISABLED' });
  const completed = jobs.filter((row) => row.status === 'COMPLETED' || row.status === 'PARTIAL').length;
  const reportBase = {
    adr: 'ADR-0492' as const,
    mode,
    enabled,
    session,
    status,
    health: healthFrom(status, jobs),
    jobs,
    plannedJobs: gate.plannedJobs,
    lastRunAt: gate.shouldRun ? generatedAt : input.lastRunAt ?? null,
    nextRunHint: gate.shouldRun ? 'NEXT_AFTER_MIN_INTERVAL_OR_AFTER_MARKET' : gate.reason,
    providerIssue: jobs.some((row) => row.providerIssue),
    marketSignal: false as const,
    coveragePct: gate.plannedJobs.length > 0 ? Math.round((completed / gate.plannedJobs.length) * 100) : 0,
    snapshotWritten,
    snapshotStoreStatus: snapshotJob?.status ?? 'not_written',
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: mode === 'SHADOW_ONLY' ? 'SHADOW_ONLY' as const : 'OBSERVE' as const,
    operatorApprovalRequired: true as const,
    diagnostics: [`gate=${gate.reason}`, 'ADR-0492 scheduler is diagnostic-only and never feeds live Gate decisions.'],
  };
  return {
    ...reportBase,
    recommendedNextActions: actionsFrom(reportBase),
  };
}

export function formatFreshDataSchedulerCompactAdr0492(report?: FreshDataSchedulerReportAdr0492 | null): string {
  if (!report) return 'ADR-0492 FreshScheduler: DISABLED | mode=OBSERVE_ONLY | session=UNKNOWN | jobs=0/6 | snapshot=not_written | impact=NONE';
  const completed = report.jobs.filter((row) => row.status === 'COMPLETED' || row.status === 'PARTIAL').length;
  const failed = report.jobs.filter((row) => row.status === 'FAILED_PROVIDER' || row.status === 'FAILED_INTERNAL' || row.status === 'DATA_UNAVAILABLE').map((row) => row.name);
  const failedText = failed.length > 0 ? ` | failed=${failed.join(',')}` : '';
  return `ADR-0492 FreshScheduler: ${report.status} | mode=${report.mode === 'DISABLED' ? 'OBSERVE_ONLY' : report.mode} | session=${report.session} | jobs=${completed}/${report.plannedJobs.length || 6}${failedText} | snapshot=${report.snapshotWritten ? 'written' : 'not_written'} | impact=${report.executionImpact}`;
}

export function formatFreshDataSchedulerDetailAdr0492(report: FreshDataSchedulerReportAdr0492): string {
  const jobLines = report.jobs.length > 0
    ? report.jobs.map((row) => `  - ${row.name}: ${row.status} providerIssue=${row.providerIssue} marketSignal=${row.marketSignal}`).join('\n')
    : '  - none';
  return [
    'ADR-0492 Fresh Data Scheduler / Non-Live Cron',
    `  mode=${report.mode}`,
    `  session=${report.session}`,
    `  enabled=${report.enabled}`,
    `  overallStatus=${report.status}`,
    '  jobs:',
    jobLines,
    `  snapshotWritten=${report.snapshotWritten}`,
    `  executionImpact=${report.executionImpact}`,
    `  liveExecutionAllowed=${report.liveExecutionAllowed}`,
    `  policyPromotionMode=${report.policyPromotionMode}`,
    `  operatorApprovalRequired=${report.operatorApprovalRequired}`,
    `  nextAction=${report.recommendedNextActions[0] ?? 'COLLECT_AFTER_MARKET_FRESH_DATA_SAMPLES'}`,
  ].join('\n');
}

export function buildFreshDataSchedulerObservationRowAdr0492(report: FreshDataSchedulerReportAdr0492) {
  return {
    createdAt: report.lastRunAt ?? new Date().toISOString(),
    forDate: (report.lastRunAt ?? new Date().toISOString()).slice(0, 10),
    source: 'ADR_0492_FRESH_DATA_SCHEDULER' as const,
    symbol: 'ADR-0492',
    actualGate1Passed: false,
    actualLiveEligible: false as const,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY' as const,
    dryRunScenario: 'FRESH_DATA_SCHEDULER_ADR0492',
    requiredScore: 70,
    providerIssue: report.providerIssue,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: true,
    sellOnly: false,
    status: 'PENDING' as const,
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: report.policyPromotionMode,
  };
}

export function collectOperatorActionSourcesFromFreshDataSchedulerAdr0492(report?: FreshDataSchedulerReportAdr0492 | null) {
  if (!report) return [];
  return report.recommendedNextActions.map((action) => ({
    adr: '0492',
    sectionId: 'fresh-data-scheduler',
    code: action,
    diagnosticKey: 'freshDataScheduler',
    diagnosticValue: `status=${report.status} session=${report.session} snapshot=${report.snapshotWritten ? 'written' : 'not_written'}`,
    severity: action === 'REPAIR_SNAPSHOT_STORE_WRITE' || action === 'PROVIDER_JOB_FAILED_OBSERVE_ONLY' ? 'DEGRADED' as const : 'INFO' as const,
  }));
}

export function formatRuntimePipelineFreshDataSchedulerEvidenceLineAdr0492(report?: FreshDataSchedulerReportAdr0492 | null): string {
  if (!report) return 'ADR-0492 status=DISABLED jobs=0/6 snapshot=not_written diagnosticOnly=true executionImpact=NONE';
  return `ADR-0492 status=${report.status} jobs=${report.jobs.length}/${report.plannedJobs.length || 6} snapshot=${report.snapshotWritten ? 'written' : 'not_written'} diagnosticOnly=true executionImpact=${report.executionImpact}`;
}
