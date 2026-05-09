// @responsibility ADR-0492 Fresh Data Scheduler non-live cron foundation; collect/validate/record/replay only, no live trading side effects.
import type { FreshDataSourceRegistrationAdr0487, FreshDataSnapshotAdr0487, FreshDataSupplyReportAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import {
  buildFreshDataSnapshotAdr0487,
  buildFreshDataSourceRegistryAdr0487,
  safeBuildFreshDataSupplyReportAdr0487,
} from './freshDataSupplyLayerAdr0487.js';
import type { RecordSupplySnapshotInputAdr0491, SanitizedSupplySnapshotAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';
import { recordSupplySnapshotAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';

export type FreshDataSchedulerRunModeAdr0492 = 'PRE_MARKET' | 'INTRADAY' | 'AFTER_CLOSE' | 'HOLIDAY' | 'MANUAL';
export type FreshDataSchedulerJobStatusAdr0492 = 'SUCCESS' | 'PARTIAL' | 'SKIPPED' | 'FAILED';
export type FreshDataSchedulerProviderHealthStatusAdr0492 = 'UP' | 'DOWN' | 'DELAYED' | 'RATE_LIMITED' | 'UNKNOWN';
export type FreshDataSchedulerFreshnessAdr0492 = 'FRESH' | 'STALE' | 'MISSING' | 'HOLIDAY_VALID' | 'UNKNOWN';
export type FreshDataSchedulerConfidenceAdr0492 = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type FreshDataSchedulerSnapshotTypeAdr0492 = 'FRESH_DATA' | 'PROVIDER_HEALTH' | 'SCHEDULER_RUN' | 'SHADOW_CASE';
export type FreshDataSchedulerEngineModeAdr0492 = 'NON_LIVE_CRON' | 'MANUAL_NON_LIVE';
export type FreshDataSchedulerLearningTagAdr0492 =
  | 'ADR_0492_FRESH_DATA_SCHEDULER'
  | 'PROVIDER_HEALTH_DOWN'
  | 'FRESHNESS_MISSING'
  | 'FRESHNESS_STALE'
  | 'HOLIDAY_SKIPPED_VALID';
export type FreshDataSchedulerJobNameAdr0492 =
  | 'collectFreshData'
  | 'validateProviderHealth'
  | 'classifyFreshness'
  | 'recordSnapshot'
  | 'enqueueReplay'
  | 'recordShadowCase';

export interface FreshDataSchedulerMarketSessionAdr0492 {
  type: FreshDataSchedulerRunModeAdr0492;
  tradingDate: string;
  isTradingDay: boolean;
  label?: string;
}

export interface FreshDataSchedulerProviderInputAdr0492 {
  providerId: string;
  health: FreshDataSchedulerProviderHealthStatusAdr0492;
  sourceDate?: string | null;
  collectedAt?: string;
  sampleCount?: number | null;
  stale?: boolean;
  missing?: boolean;
  rateLimited?: boolean;
  warning?: string;
  error?: string;
}

export interface FreshDataSchedulerJobResultAdr0492 {
  job: FreshDataSchedulerJobNameAdr0492;
  status: FreshDataSchedulerJobStatusAdr0492;
  warnings: string[];
  errors: string[];
  executionImpact: 'NONE';
}

export interface FreshDataSchedulerShadowCaseAdr0492 {
  runId: string;
  timestamp: string;
  marketSession: FreshDataSchedulerMarketSessionAdr0492;
  engineMode: FreshDataSchedulerEngineModeAdr0492;
  providerHealth: Record<string, FreshDataSchedulerProviderHealthStatusAdr0492>;
  freshness: FreshDataSchedulerFreshnessAdr0492;
  confidence: FreshDataSchedulerConfidenceAdr0492;
  snapshotType: FreshDataSchedulerSnapshotTypeAdr0492;
  executionImpact: 'NONE';
  warning: string | null;
  error: string | null;
  learningTag: FreshDataSchedulerLearningTagAdr0492;
  isMarketSignal: false;
}

export interface FreshDataSchedulerReplayQueueItemAdr0492 {
  runId: string;
  enqueuedAt: string;
  snapshotType: FreshDataSchedulerSnapshotTypeAdr0492;
  snapshotScanId: string;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
}

export interface FreshDataSchedulerResultAdr0492 {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: FreshDataSchedulerRunModeAdr0492;
  marketSession: FreshDataSchedulerMarketSessionAdr0492;
  engineMode: FreshDataSchedulerEngineModeAdr0492;
  status: FreshDataSchedulerJobStatusAdr0492;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  providerHealthSummary: Record<string, FreshDataSchedulerProviderHealthStatusAdr0492>;
  freshness: FreshDataSchedulerFreshnessAdr0492;
  confidence: FreshDataSchedulerConfidenceAdr0492;
  snapshotCount: number;
  replayEnqueuedCount: number;
  warnings: string[];
  errors: string[];
  jobs: FreshDataSchedulerJobResultAdr0492[];
  snapshots: FreshDataSnapshotAdr0487[];
  shadowCases: FreshDataSchedulerShadowCaseAdr0492[];
  replayQueue: FreshDataSchedulerReplayQueueItemAdr0492[];
}

export interface FreshDataSchedulerDependenciesAdr0492 {
  collectFreshData?: () => FreshDataSupplyReportAdr0487;
  recordSnapshot?: (input: RecordSupplySnapshotInputAdr0491) => { snapshots: SanitizedSupplySnapshotAdr0491[] };
  enqueueReplay?: (item: FreshDataSchedulerReplayQueueItemAdr0492) => void;
  recordShadowCase?: (shadowCase: FreshDataSchedulerShadowCaseAdr0492) => void;
}

export interface RunFreshDataSchedulerInputAdr0492 {
  runId?: string;
  now?: string;
  mode?: FreshDataSchedulerRunModeAdr0492;
  marketSession?: FreshDataSchedulerMarketSessionAdr0492;
  providerInputs?: readonly FreshDataSchedulerProviderInputAdr0492[];
  registrations?: readonly FreshDataSourceRegistrationAdr0487[];
  filePath?: string;
  dependencies?: FreshDataSchedulerDependenciesAdr0492;
}

export interface FreshDataValueClassificationAdr0492 {
  value: number | null;
  freshness: FreshDataSchedulerFreshnessAdr0492;
  confidence: FreshDataSchedulerConfidenceAdr0492;
  providerHealth: FreshDataSchedulerProviderHealthStatusAdr0492;
  isMarketSignal: false;
  bearishSignal: false;
  executionImpact: 'NONE';
  warnings: string[];
}

const NON_LIVE_POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
};

function defaultSession(nowIso: string, mode: FreshDataSchedulerRunModeAdr0492): FreshDataSchedulerMarketSessionAdr0492 {
  return {
    type: mode,
    tradingDate: nowIso.slice(0, 10),
    isTradingDay: mode !== 'HOLIDAY',
    label: mode === 'HOLIDAY' ? 'HOLIDAY_VALID' : mode,
  };
}

function job(
  name: FreshDataSchedulerJobNameAdr0492,
  status: FreshDataSchedulerJobStatusAdr0492,
  warnings: readonly string[] = [],
  errors: readonly string[] = [],
): FreshDataSchedulerJobResultAdr0492 {
  return { job: name, status, warnings: [...warnings], errors: [...errors], executionImpact: 'NONE' };
}

function deriveProviderHealth(providerInputs: readonly FreshDataSchedulerProviderInputAdr0492[]): Record<string, FreshDataSchedulerProviderHealthStatusAdr0492> {
  const out: Record<string, FreshDataSchedulerProviderHealthStatusAdr0492> = {};
  for (const item of providerInputs) {
    out[item.providerId] = item.rateLimited ? 'RATE_LIMITED' : item.health;
  }
  return out;
}

function overallFreshness(
  marketSession: FreshDataSchedulerMarketSessionAdr0492,
  providerInputs: readonly FreshDataSchedulerProviderInputAdr0492[],
): FreshDataSchedulerFreshnessAdr0492 {
  if (!marketSession.isTradingDay || marketSession.type === 'HOLIDAY') return 'HOLIDAY_VALID';
  if (providerInputs.length === 0) return 'UNKNOWN';
  if (providerInputs.some((item) => item.missing || item.health === 'DOWN')) return 'MISSING';
  if (providerInputs.some((item) => item.stale || item.health === 'DELAYED' || item.rateLimited || item.health === 'RATE_LIMITED')) return 'STALE';
  return 'FRESH';
}

function confidenceForFreshness(freshness: FreshDataSchedulerFreshnessAdr0492): FreshDataSchedulerConfidenceAdr0492 {
  if (freshness === 'FRESH') return 'HIGH';
  if (freshness === 'STALE') return 'LOW';
  if (freshness === 'HOLIDAY_VALID') return 'MEDIUM';
  return 'NONE';
}

function providerWarnings(providerInputs: readonly FreshDataSchedulerProviderInputAdr0492[]): string[] {
  return providerInputs.flatMap((item) => {
    const rows: string[] = [];
    if (item.warning) rows.push(`${item.providerId}: ${item.warning}`);
    if (item.health === 'DOWN') rows.push(`${item.providerId}: providerHealth DOWN; recorded as provider issue, not market bearish signal.`);
    if (item.health === 'DELAYED') rows.push(`${item.providerId}: providerHealth DELAYED; confidence downgraded only.`);
    if (item.rateLimited || item.health === 'RATE_LIMITED') rows.push(`${item.providerId}: providerHealth RATE_LIMITED; confidence downgraded only.`);
    if (item.missing) rows.push(`${item.providerId}: data MISSING; not converted to zero or bearish signal.`);
    if (item.stale) rows.push(`${item.providerId}: data STALE; not converted to bearish signal.`);
    return rows;
  });
}

function providerErrors(providerInputs: readonly FreshDataSchedulerProviderInputAdr0492[]): string[] {
  return providerInputs.flatMap((item) => item.error ? [`${item.providerId}: ${item.error}`] : []);
}

function sourceStateForProvider(item: FreshDataSchedulerProviderInputAdr0492): FreshDataSnapshotAdr0487['sourceState'] {
  if (item.health === 'DOWN') return 'PROVIDER_ERROR';
  if (item.missing) return 'MISSING';
  if (item.stale || item.health === 'DELAYED' || item.rateLimited || item.health === 'RATE_LIMITED') return 'STALE';
  if (item.health === 'UP') return 'FRESH';
  return 'UNKNOWN';
}

function buildSchedulerSnapshots(
  input: RunFreshDataSchedulerInputAdr0492,
  collectedAt: string,
): FreshDataSnapshotAdr0487[] {
  const registrations = [...(input.registrations ?? buildFreshDataSourceRegistryAdr0487())];
  const unknownRegistration = registrations[registrations.length - 1];
  return (input.providerInputs ?? []).map((provider) => {
    const registration = registrations.find((row) => row.provider === provider.providerId || row.id === provider.providerId) ?? unknownRegistration;
    const sourceState = sourceStateForProvider(provider);
    return buildFreshDataSnapshotAdr0487({
      registration,
      sourceId: provider.providerId,
      collectedAt: provider.collectedAt ?? collectedAt,
      sourceDate: provider.sourceDate ?? null,
      cacheState: sourceState === 'FRESH' ? 'FRESH' : sourceState === 'STALE' ? 'STALE' : sourceState === 'MISSING' ? 'MISSING' : 'UNKNOWN',
      sourceState,
      coverageRatio: provider.sampleCount === null || provider.sampleCount === undefined ? null : provider.sampleCount > 0 ? 1 : 0,
      normalized: sourceState === 'FRESH' && (provider.sampleCount ?? 0) > 0,
      confidence: sourceState === 'FRESH' ? 'HIGH' : sourceState === 'STALE' ? 'LOW' : 'NONE',
      diagnostics: ['ADR-0492 scheduler snapshot; non-live diagnostic-only.', ...(provider.warning ? [provider.warning] : []), ...(provider.error ? [provider.error] : [])],
    });
  });
}

function buildShadowCase(args: {
  runId: string;
  timestamp: string;
  marketSession: FreshDataSchedulerMarketSessionAdr0492;
  providerHealth: Record<string, FreshDataSchedulerProviderHealthStatusAdr0492>;
  freshness: FreshDataSchedulerFreshnessAdr0492;
  confidence: FreshDataSchedulerConfidenceAdr0492;
  warning: string | null;
  error: string | null;
  learningTag: FreshDataSchedulerLearningTagAdr0492;
}): FreshDataSchedulerShadowCaseAdr0492 {
  return {
    runId: args.runId,
    timestamp: args.timestamp,
    marketSession: args.marketSession,
    engineMode: args.marketSession.type === 'MANUAL' ? 'MANUAL_NON_LIVE' : 'NON_LIVE_CRON',
    providerHealth: args.providerHealth,
    freshness: args.freshness,
    confidence: args.confidence,
    snapshotType: 'SHADOW_CASE',
    executionImpact: 'NONE',
    warning: args.warning,
    error: args.error,
    learningTag: args.learningTag,
    isMarketSignal: false,
  };
}

function schedulerStatus(
  marketSession: FreshDataSchedulerMarketSessionAdr0492,
  errors: readonly string[],
  warnings: readonly string[],
): FreshDataSchedulerJobStatusAdr0492 {
  if (!marketSession.isTradingDay || marketSession.type === 'HOLIDAY') return 'SKIPPED';
  if (errors.length > 0 || warnings.length > 0) return 'PARTIAL';
  return 'SUCCESS';
}

export function classifyFreshDataValueAdr0492(args: {
  value: number | null | undefined;
  stale?: boolean;
  providerHealth?: FreshDataSchedulerProviderHealthStatusAdr0492;
}): FreshDataValueClassificationAdr0492 {
  const providerHealth = args.providerHealth ?? 'UNKNOWN';
  const warnings: string[] = [];
  if (args.value === null || args.value === undefined) {
    warnings.push('MISSING data preserved as null; not converted to numeric zero or bearish signal.');
    return { value: null, freshness: 'MISSING', confidence: 'NONE', providerHealth, isMarketSignal: false, bearishSignal: false, executionImpact: 'NONE', warnings };
  }
  if (args.stale) {
    warnings.push('STALE data downgrades confidence only; not converted to bearish signal.');
    return { value: args.value, freshness: 'STALE', confidence: 'LOW', providerHealth, isMarketSignal: false, bearishSignal: false, executionImpact: 'NONE', warnings };
  }
  return { value: args.value, freshness: 'FRESH', confidence: 'HIGH', providerHealth, isMarketSignal: false, bearishSignal: false, executionImpact: 'NONE', warnings };
}

export function runFreshDataSchedulerAdr0492(input: RunFreshDataSchedulerInputAdr0492 = {}): FreshDataSchedulerResultAdr0492 {
  const startedAt = input.now ?? new Date().toISOString();
  const mode = input.mode ?? input.marketSession?.type ?? 'MANUAL';
  const marketSession = input.marketSession ?? defaultSession(startedAt, mode);
  const runId = input.runId ?? `adr0492-${startedAt}`;
  const providerInputs = input.providerInputs ?? [];
  const warnings = providerWarnings(providerInputs);
  const errors = providerErrors(providerInputs);
  const providerHealthSummary = deriveProviderHealth(providerInputs);
  const freshness = overallFreshness(marketSession, providerInputs);
  const confidence = confidenceForFreshness(freshness);
  const snapshots = buildSchedulerSnapshots(input, startedAt);
  const shadowCases: FreshDataSchedulerShadowCaseAdr0492[] = [];
  const replayQueue: FreshDataSchedulerReplayQueueItemAdr0492[] = [];
  const jobs: FreshDataSchedulerJobResultAdr0492[] = [];

  const collectFreshData = input.dependencies?.collectFreshData ?? (() => safeBuildFreshDataSupplyReportAdr0487({ generatedAt: startedAt }));
  const recordSnapshot = input.dependencies?.recordSnapshot ?? ((recordInput: RecordSupplySnapshotInputAdr0491) => recordSupplySnapshotAdr0491(recordInput));

  let report: FreshDataSupplyReportAdr0487;
  try {
    report = collectFreshData();
    jobs.push(job('collectFreshData', report.overallStatus === 'UNKNOWN' ? 'PARTIAL' : 'SUCCESS', report.diagnostics.filter((line) => line.includes('failure')), []));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`collectFreshData: ${message}`);
    report = safeBuildFreshDataSupplyReportAdr0487({ generatedAt: startedAt, throwForTest: true });
    jobs.push(job('collectFreshData', 'PARTIAL', ['collectFreshData failure isolated; scheduler remains non-live.'], [message]));
  }
  jobs.push(job('validateProviderHealth', providerInputs.some((item) => item.health !== 'UP') ? 'PARTIAL' : 'SUCCESS', warnings, errors));
  jobs.push(job('classifyFreshness', freshness === 'HOLIDAY_VALID' ? 'SKIPPED' : freshness === 'FRESH' ? 'SUCCESS' : 'PARTIAL', warnings, []));

  let snapshotResult: { snapshots: SanitizedSupplySnapshotAdr0491[] };
  try {
    snapshotResult = recordSnapshot({
      scanId: runId,
      recordedAt: startedAt,
      tradingDate: marketSession.tradingDate,
      freshDataSupplyAdr0487: report,
      diagnostics: ['ADR-0492 non-live scheduler snapshot record.', ...warnings, ...errors],
      filePath: input.filePath,
    });
    jobs.push(job('recordSnapshot', snapshotResult.snapshots.length > 0 ? 'SUCCESS' : 'PARTIAL'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`recordSnapshot: ${message}`);
    snapshotResult = { snapshots: [] };
    jobs.push(job('recordSnapshot', 'PARTIAL', ['Snapshot store failure isolated; Shadow Case recording continues.'], [message]));
  }

  for (const snapshot of snapshotResult.snapshots) {
    const item: FreshDataSchedulerReplayQueueItemAdr0492 = {
      runId,
      enqueuedAt: startedAt,
      snapshotType: 'SCHEDULER_RUN',
      snapshotScanId: snapshot.scanId,
      ...NON_LIVE_POLICY,
    };
    replayQueue.push(item);
    try {
      input.dependencies?.enqueueReplay?.(item);
    } catch (error) {
      errors.push(`enqueueReplay: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  jobs.push(job('enqueueReplay', replayQueue.length > 0 ? 'SUCCESS' : 'SKIPPED'));

  const learningTag: FreshDataSchedulerLearningTagAdr0492 = freshness === 'HOLIDAY_VALID'
    ? 'HOLIDAY_SKIPPED_VALID'
    : providerInputs.some((item) => item.health === 'DOWN')
      ? 'PROVIDER_HEALTH_DOWN'
      : freshness === 'MISSING'
        ? 'FRESHNESS_MISSING'
        : freshness === 'STALE'
          ? 'FRESHNESS_STALE'
          : 'ADR_0492_FRESH_DATA_SCHEDULER';
  const shadowCase = buildShadowCase({
    runId,
    timestamp: startedAt,
    marketSession,
    providerHealth: providerHealthSummary,
    freshness,
    confidence,
    warning: warnings[0] ?? null,
    error: errors[0] ?? null,
    learningTag,
  });
  shadowCases.push(shadowCase);
  try {
    input.dependencies?.recordShadowCase?.(shadowCase);
    jobs.push(job('recordShadowCase', 'SUCCESS', warnings, errors));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`recordShadowCase: ${message}`);
    jobs.push(job('recordShadowCase', 'PARTIAL', ['Shadow recorder failure isolated; result still carries Shadow Case payload.'], [message]));
  }

  const status = schedulerStatus(marketSession, errors, warnings);
  return {
    runId,
    startedAt,
    finishedAt: startedAt,
    mode,
    marketSession,
    engineMode: marketSession.type === 'MANUAL' ? 'MANUAL_NON_LIVE' : 'NON_LIVE_CRON',
    status,
    ...NON_LIVE_POLICY,
    providerHealthSummary,
    freshness,
    confidence,
    snapshotCount: snapshots.length + snapshotResult.snapshots.length,
    replayEnqueuedCount: replayQueue.length,
    warnings,
    errors,
    jobs,
    snapshots,
    shadowCases,
    replayQueue,
  };
}

export function formatFreshDataSchedulerCompactAdr0492(result: FreshDataSchedulerResultAdr0492): string {
  return `ADR-0492 FreshDataScheduler: ${result.status} mode=${result.mode} freshness=${result.freshness} confidence=${result.confidence} snapshots=${result.snapshotCount} replay=${result.replayEnqueuedCount} impact=${result.executionImpact}`;
}
