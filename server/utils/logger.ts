// @responsibility Runtime logger type definitions.
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogVisibility = 'ALWAYS' | 'SUMMARY' | 'DIAGNOSTIC' | 'TRACE' | 'SILENT_BY_DEFAULT';
export type LogVerbosity = 'summary' | 'diagnostic' | 'trace';
export type TraceCategory =
  | 'SUPPLY'
  | 'GATE'
  | 'PROGRAM'
  | 'KIS'
  | 'KRX'
  | 'SCHEDULER'
  | 'BOOT'
  | 'WATCHLIST'
  | 'KELLY';

export interface TraceRecord {
  traceId: string;
  createdAt: string;
  sourceCommand?: string;
  category: TraceCategory;
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
  expiresAt: string;
}

export type NoiseCategory =
  | 'PRE_ENTRY_WAIT'
  | 'PRE_BREAKOUT_PRICE_DISTANCE'
  | 'KIS_WS_DETAIL'
  | 'KIS_MTAS_DETAIL'
  | 'GATE1_DIAGNOSTIC_DRY_RUN'
  | 'KIS_FIRST_LEGACY_DIAGNOSTIC'
  // Patch-009 P1 — 프로덕션 진단 로그 게이트.
  | 'SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC'
  | 'COMMAND_REGISTRY_DIAGNOSTIC'
  // Patch-009 P2 — counterfactual 중복 억제 로그 집계.
  | 'COUNTERFACTUAL_DUPLICATE_SUPPRESSED'
  | 'NONE';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
};

const traceBuffer: TraceRecord[] = [];
const diagnosticDedup = new Map<string, { lastEmittedAtMs: number; suppressed: number }>();

function normalizeLogLevel(value: string | undefined): LogLevel {
  if (value === 'trace' || value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'silent') {
    return value;
  }
  return 'info';
}

function getCurrentLogLevel(): LogLevel {
  return normalizeLogLevel(process.env.LOG_LEVEL);
}

function getLogVerbosity(): LogVerbosity {
  const raw = String(process.env.LOG_VERBOSITY ?? process.env.DEFAULT_COMMAND_VERBOSITY ?? 'summary').toLowerCase();
  if (raw === 'trace') return 'trace';
  if (raw === 'diagnostic' || raw === 'debug' || raw === 'verbose') return 'diagnostic';
  if (getCurrentLogLevel() === 'trace') return 'trace';
  if (getCurrentLogLevel() === 'debug') return 'diagnostic';
  return 'summary';
}

export async function withLogVerbosity<T>(verbosity: LogVerbosity | undefined, fn: () => Promise<T> | T): Promise<T> {
  if (!verbosity) return await fn();
  const previous = process.env.LOG_VERBOSITY;
  process.env.LOG_VERBOSITY = verbosity;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.LOG_VERBOSITY;
    else process.env.LOG_VERBOSITY = previous;
  }
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return !['false', '0', 'no', 'off'].includes(raw.toLowerCase());
}

function getNoiseDedupTtlMs(): number {
  const seconds = Number(process.env.NOISE_DEDUP_TTL_SEC ?? '60');
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 60) * 1000;
}

function getTraceBufferTtlMs(): number {
  const minutes = Number(process.env.TRACE_BUFFER_TTL_MIN ?? '30');
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
}

function pruneTraceBuffer(nowMs = Date.now()): void {
  for (let i = traceBuffer.length - 1; i >= 0; i--) {
    const expiresAtMs = new Date(traceBuffer[i].expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) traceBuffer.splice(i, 1);
  }
}

export function createTraceId(prefix = 'trace', now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}_${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

function recordTraceRecord(input: Omit<TraceRecord, 'createdAt' | 'expiresAt'> & { createdAt?: string; expiresAt?: string }): TraceRecord | null {
  if (!envBool('TRACE_BUFFER_ENABLED', true)) return null;
  const now = new Date();
  pruneTraceBuffer(now.getTime());
  const record: TraceRecord = {
    ...input,
    createdAt: input.createdAt ?? now.toISOString(),
    expiresAt: input.expiresAt ?? new Date(now.getTime() + getTraceBufferTtlMs()).toISOString(),
  };
  traceBuffer.push(record);
  if (traceBuffer.length > 500) traceBuffer.splice(0, traceBuffer.length - 500);
  return record;
}

function getRecentTraceRecords(limit = 10): TraceRecord[] {
  pruneTraceBuffer();
  return traceBuffer.slice(-Math.max(0, limit)).reverse();
}

export function getTraceRecord(traceId: string): TraceRecord | undefined {
  pruneTraceBuffer();
  return traceBuffer.find((record) => record.traceId === traceId);
}

export function clearTraceRecords(): number {
  const count = traceBuffer.length;
  traceBuffer.length = 0;
  return count;
}

export function formatTraceRecent(limit = 10): string {
  const records = getRecentTraceRecords(limit);
  if (records.length === 0) return '[TRACE_RECENT] count=0 executionImpact=NONE';
  return [
    `[TRACE_RECENT] count=${records.length} executionImpact=NONE`,
    ...records.map((record) =>
      `traceId=${record.traceId} category=${record.category} createdAt=${record.createdAt} sourceCommand=${record.sourceCommand ?? 'N/A'} summary=${JSON.stringify(record.summary).slice(0, 500)}`,
    ),
  ].join('\n');
}

export function formatTraceRecord(record: TraceRecord | undefined): string {
  if (!record) return '[TRACE_SHOW] found=false executionImpact=NONE';
  return [
    `[TRACE_SHOW] found=true traceId=${record.traceId} category=${record.category} createdAt=${record.createdAt} expiresAt=${record.expiresAt} executionImpact=NONE`,
    `summary=${JSON.stringify(record.summary).slice(0, 1500)}`,
    `details=${JSON.stringify(record.details).slice(0, 2500)}`,
  ].join('\n');
}

function isLogLevelEnabled(level: Exclude<LogLevel, 'silent'>): boolean {
  const current = getCurrentLogLevel();
  if (current === 'silent') return false;
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[current];
}

function shouldEmitByVisibility(
  visibility: LogVisibility,
  options: { dedupKey?: string; nowMs?: number; executionImpact?: unknown } = {},
): boolean {
  if (options.executionImpact !== undefined && options.executionImpact !== 'NONE') return true;
  if (visibility === 'ALWAYS') return true;
  const verbosity = getLogVerbosity();
  if (verbosity === 'trace') return visibility !== 'SILENT_BY_DEFAULT';
  if (visibility === 'SUMMARY') return true;
  if (visibility === 'TRACE' || visibility === 'SILENT_BY_DEFAULT') return false;
  if (visibility === 'DIAGNOSTIC') {
    if (verbosity === 'diagnostic') return true;
    const dedupKey = options.dedupKey;
    if (!dedupKey) return false;
    const nowMs = options.nowMs ?? Date.now();
    const state = diagnosticDedup.get(dedupKey);
    if (!state || nowMs - state.lastEmittedAtMs >= getNoiseDedupTtlMs()) {
      diagnosticDedup.set(dedupKey, { lastEmittedAtMs: nowMs, suppressed: 0 });
      return true;
    }
    state.suppressed++;
    return false;
  }
  return false;
}

export function logVisibilityEvent(input: {
  visibility: LogVisibility;
  message: string;
  category?: TraceCategory;
  sourceCommand?: string;
  traceId?: string;
  summary?: Record<string, unknown>;
  details?: Record<string, unknown>;
  dedupKey?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  executionImpact?: unknown;
  loggerOverride?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  nowMs?: number;
}): { emitted: boolean; traceId?: string } {
  const traceId = input.traceId ?? createTraceId(input.category?.toLowerCase() ?? 'trace');
  if (input.category && (input.details || input.visibility === 'TRACE' || input.visibility === 'SILENT_BY_DEFAULT')) {
    recordTraceRecord({
      traceId,
      sourceCommand: input.sourceCommand,
      category: input.category,
      summary: input.summary ?? { message: input.message },
      details: input.details ?? { message: input.message },
    });
  }
  const emitted = shouldEmitByVisibility(input.visibility, {
    dedupKey: input.dedupKey,
    nowMs: input.nowMs,
    executionImpact: input.executionImpact,
  });
  if (!emitted) return { emitted, traceId };
  const target = input.loggerOverride ?? logger;
  const level = input.level ?? (input.visibility === 'ALWAYS' ? 'warn' : 'info');
  target[level](input.message);
  return { emitted, traceId };
}

export const logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> & { trace: (...args: unknown[]) => void } = {
  trace: (...args: unknown[]) => {
    if (isLogLevelEnabled('trace')) console.debug(...args);
  },
  debug: (...args: unknown[]) => {
    if (isLogLevelEnabled('debug')) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (isLogLevelEnabled('info')) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    if (isLogLevelEnabled('warn')) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (isLogLevelEnabled('error')) console.error(...args);
  },
};


export type OperationalLogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type OperationalExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'RISK_CONTROL_ONLY'
  | 'POSITION_EXIT_BLOCKED'
  | 'LIVE_ORDER_RISK'
  | string;

export type OperationalEvent = {
  tag: string;
  mode?: 'SHADOW' | 'LIVE' | string;
  executionImpact?: OperationalExecutionImpact;
  autoAction?: string;
  engineAlive?: boolean;
  shadowLearning?: boolean;
  positionExitAllowed?: boolean;
  providerIssue?: boolean;
  newBuyBlocked?: boolean;
  dataVacuum?: boolean;
  liveOrderPlaced?: boolean;
  orderFailed?: boolean;
  fillFailed?: boolean;
  closeFailed?: boolean;
  emergencyStop?: boolean;
};

export function classifyOperationalSeverity(event: OperationalEvent): OperationalLogSeverity {
  if (
    event.emergencyStop === true
    || event.engineAlive === false
    || event.positionExitAllowed === false
    || event.executionImpact === 'POSITION_EXIT_BLOCKED'
    || event.executionImpact === 'LIVE_ORDER_RISK'
    || event.orderFailed === true
    || event.fillFailed === true
    || event.closeFailed === true
  ) {
    return 'error';
  }

  if (
    event.executionImpact === 'NEW_BUY_BLOCKED_ONLY'
    || event.executionImpact === 'RISK_CONTROL_ONLY'
    || event.providerIssue === true
  ) {
    return 'warn';
  }

  if (
    event.executionImpact === 'NONE'
    && event.autoAction === 'NONE'
  ) {
    return 'info';
  }

  return 'info';
}

function inferLogClass(tag: string, payload: Record<string, unknown>): string {
  if (tag.includes('SECTOR')) return 'RISK_OBSERVE';
  if (tag.includes('KIS')) return payload.providerIssue === true ? 'PROVIDER_ISOLATED' : 'PROVIDER';
  if (tag.includes('COUNTERFACTUAL')) return 'DIAGNOSTIC';
  if (tag.includes('NOISE')) return 'NOISE';
  if (payload.executionImpact === 'POSITION_EXIT_BLOCKED' || payload.executionImpact === 'LIVE_ORDER_RISK') return 'EXECUTION_ERROR';
  if (payload.executionImpact === 'NONE') return 'TELEMETRY';
  return 'OPERATIONAL';
}

export function formatKeyValue(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}=${value.join(',')}`;
      if (value instanceof Date) return `${key}=${value.toISOString()}`;
      if (value !== null && typeof value === 'object') return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    })
    .join(' ');
}

export function logOperationalEvent(
  tag: string,
  payload: Omit<OperationalEvent, 'tag'> & Record<string, unknown>,
  loggerOverride: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = logger,
): OperationalLogSeverity {
  const severity = classifyOperationalSeverity({ tag, ...payload });
  const normalizedPayload = {
    ...payload,
    tag,
    severity,
    logClass: inferLogClass(tag, payload),
  };
  const message = `[${tag}] ${formatKeyValue(normalizedPayload)}`;

  if (severity === 'error') {
    loggerOverride.error(message);
    return severity;
  }
  if (severity === 'warn') {
    loggerOverride.warn(message);
    return severity;
  }
  if (severity === 'debug') {
    loggerOverride.debug(message);
    return severity;
  }

  loggerOverride.info(message);
  return severity;
}

export function shouldSuppressNoise(category: NoiseCategory): boolean {
  const current = getCurrentLogLevel();
  if (current === 'trace' || current === 'debug') return false;
  if (process.env.LOG_SUPPRESS_NOISE === 'false') return false;

  switch (category) {
    case 'PRE_ENTRY_WAIT':
    case 'PRE_BREAKOUT_PRICE_DISTANCE':
      return process.env.LOG_SUPPRESS_PRE_ENTRY_WAIT !== 'false';
    case 'KIS_WS_DETAIL':
      return process.env.LOG_SUPPRESS_KIS_WS_DETAIL !== 'false';
    case 'KIS_MTAS_DETAIL':
      return process.env.LOG_SUPPRESS_KIS_MTAS_DETAIL !== 'false';
    case 'GATE1_DIAGNOSTIC_DRY_RUN':
      return process.env.LOG_SUPPRESS_GATE_DIAGNOSTIC !== 'false';
    case 'KIS_FIRST_LEGACY_DIAGNOSTIC':
      return process.env.LOG_SUPPRESS_KIS_FIRST_DIAGNOSTIC !== 'false';
    case 'SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC':
      return process.env.LOG_SUPPRESS_SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC !== 'false';
    case 'COMMAND_REGISTRY_DIAGNOSTIC':
      return process.env.LOG_SUPPRESS_COMMAND_REGISTRY_DIAGNOSTIC !== 'false';
    case 'COUNTERFACTUAL_DUPLICATE_SUPPRESSED':
      return process.env.LOG_SUPPRESS_COUNTERFACTUAL_DUPLICATE !== 'false';
    case 'NONE':
    default:
      return false;
  }
}

export interface NoiseCounters {
  preEntryWait: number;
  priceDistance: number;
  kisWsDetail: number;
  kisMtasDetail: number;
  gateDiagnostics: number;
  kisFirstDiagnostics: number;
  supplySemanticWireDiag: number;
  commandRegistryDiag: number;
  counterfactualDuplicate: number;
  suppressed: number;
}

let lastNoiseSummaryEmittedAtMs = 0;

const noiseCounters: NoiseCounters = {
  preEntryWait: 0,
  priceDistance: 0,
  kisWsDetail: 0,
  kisMtasDetail: 0,
  gateDiagnostics: 0,
  kisFirstDiagnostics: 0,
  supplySemanticWireDiag: 0,
  commandRegistryDiag: 0,
  counterfactualDuplicate: 0,
  suppressed: 0,
};

function incrementNoiseCounter(category: NoiseCategory, suppressed: boolean): void {
  switch (category) {
    case 'PRE_ENTRY_WAIT':
      noiseCounters.preEntryWait++;
      break;
    case 'PRE_BREAKOUT_PRICE_DISTANCE':
      noiseCounters.priceDistance++;
      break;
    case 'KIS_WS_DETAIL':
      noiseCounters.kisWsDetail++;
      break;
    case 'KIS_MTAS_DETAIL':
      noiseCounters.kisMtasDetail++;
      break;
    case 'GATE1_DIAGNOSTIC_DRY_RUN':
      noiseCounters.gateDiagnostics++;
      break;
    case 'KIS_FIRST_LEGACY_DIAGNOSTIC':
      noiseCounters.kisFirstDiagnostics++;
      break;
    case 'SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC':
      noiseCounters.supplySemanticWireDiag++;
      break;
    case 'COMMAND_REGISTRY_DIAGNOSTIC':
      noiseCounters.commandRegistryDiag++;
      break;
    case 'COUNTERFACTUAL_DUPLICATE_SUPPRESSED':
      noiseCounters.counterfactualDuplicate++;
      break;
    case 'NONE':
      break;
  }
  if (suppressed) noiseCounters.suppressed++;
}

export function recordNoiseSuppressed(category: NoiseCategory): void {
  incrementNoiseCounter(category, true);
}

export function getNoiseCounters(): NoiseCounters {
  return { ...noiseCounters };
}

export function resetNoiseCountersForTest(): void {
  noiseCounters.preEntryWait = 0;
  noiseCounters.priceDistance = 0;
  noiseCounters.kisWsDetail = 0;
  noiseCounters.kisMtasDetail = 0;
  noiseCounters.gateDiagnostics = 0;
  noiseCounters.kisFirstDiagnostics = 0;
  noiseCounters.supplySemanticWireDiag = 0;
  noiseCounters.commandRegistryDiag = 0;
  noiseCounters.counterfactualDuplicate = 0;
  noiseCounters.suppressed = 0;
  lastNoiseSummaryEmittedAtMs = 0;
}

export function logNoiseDetail(input: {
  category: NoiseCategory;
  message: string;
  payload?: unknown;
  loggerOverride?: Pick<Console, 'debug'>;
}): boolean {
  const suppressed = shouldSuppressNoise(input.category);
  incrementNoiseCounter(input.category, suppressed);
  if (suppressed) return false;

  const target = input.loggerOverride ?? logger;
  if (input.payload === undefined) {
    target.debug(input.message);
  } else {
    target.debug(input.message, input.payload);
  }
  return isLogLevelEnabled('debug');
}

export interface NoiseSummaryInput extends Partial<NoiseCounters> {
  session?: string;
  executionImpact?: 'NONE' | string;
}

function isNoiseSummaryEnabled(): boolean {
  return process.env.NOISE_SUMMARY_ENABLED !== 'false';
}

export function formatNoiseSummary(input: NoiseSummaryInput = getNoiseCounters()): string {
  const counters = { ...getNoiseCounters(), ...input };
  const session = input.session ? ` session=${input.session}` : '';
  const executionImpact = input.executionImpact ? ` executionImpact=${input.executionImpact}` : '';
  const topReasons = Object.fromEntries(
    Object.entries({
      preEntryWait: counters.preEntryWait,
      priceDistance: counters.priceDistance,
      kisWsDetail: counters.kisWsDetail,
      kisMtasDetail: counters.kisMtasDetail,
      gateDiagnostics: counters.gateDiagnostics,
      kisFirstDiagnostics: counters.kisFirstDiagnostics,
      supplySemanticWireDiag: counters.supplySemanticWireDiag,
      commandRegistryDiag: counters.commandRegistryDiag,
      counterfactualDuplicate: counters.counterfactualDuplicate,
    }).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]),
  );
  const traceId = createTraceId('noise');
  return `[NOISE_COMPRESSED]${session} suppressed=${counters.suppressed} topReasons=${JSON.stringify(topReasons)}${executionImpact} traceAvailable=true traceId=${traceId}`;
}

function getNoiseSummaryIntervalMs(): number {
  const minutes = Number(process.env.NOISE_SUMMARY_INTERVAL_MINUTES ?? '5');
  if (!Number.isFinite(minutes) || minutes <= 0) return 5 * 60_000;
  return minutes * 60_000;
}

function shouldEmitNoiseSummary(nowMs = Date.now()): boolean {
  if (!isNoiseSummaryEnabled()) return false;
  if (lastNoiseSummaryEmittedAtMs === 0) return true;
  return nowMs - lastNoiseSummaryEmittedAtMs >= getNoiseSummaryIntervalMs();
}

export function logNoiseSummary(
  input: NoiseSummaryInput = getNoiseCounters(),
  loggerOverride: Pick<Console, 'info'> = logger,
  nowMs = Date.now(),
): void {
  if (!shouldEmitNoiseSummary(nowMs)) return;
  const counters = { ...getNoiseCounters(), ...input };
  if ((counters.suppressed ?? 0) <= 0) return;
  lastNoiseSummaryEmittedAtMs = nowMs;
  const message = formatNoiseSummary(input);
  recordTraceRecord({
    traceId: message.match(/traceId=([^\s]+)/)?.[1] ?? createTraceId('noise'),
    category: 'BOOT',
    summary: { suppressed: counters.suppressed, session: input.session, executionImpact: input.executionImpact },
    details: counters,
  });
  loggerOverride.info(message);
}
