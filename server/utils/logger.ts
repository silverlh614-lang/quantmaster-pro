export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

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

function normalizeLogLevel(value: string | undefined): LogLevel {
  if (value === 'trace' || value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'silent') {
    return value;
  }
  return 'info';
}

export function getCurrentLogLevel(): LogLevel {
  return normalizeLogLevel(process.env.LOG_LEVEL);
}

export function isLogLevelEnabled(level: Exclude<LogLevel, 'silent'>): boolean {
  const current = getCurrentLogLevel();
  if (current === 'silent') return false;
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[current];
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

export function isNoiseSummaryEnabled(): boolean {
  return process.env.NOISE_SUMMARY_ENABLED !== 'false';
}

export function formatNoiseSummary(input: NoiseSummaryInput = getNoiseCounters()): string {
  const counters = { ...getNoiseCounters(), ...input };
  const session = input.session ? ` session=${input.session}` : '';
  const executionImpact = input.executionImpact ? ` executionImpact=${input.executionImpact}` : '';
  return `[NoiseSummary]${session} suppressed=${counters.suppressed} preEntryWait=${counters.preEntryWait} priceDistance=${counters.priceDistance} kisWsDetail=${counters.kisWsDetail} kisMtasDetail=${counters.kisMtasDetail} gateDiagnostics=${counters.gateDiagnostics} kisFirstDiagnostics=${counters.kisFirstDiagnostics} supplySemanticWireDiag=${counters.supplySemanticWireDiag} commandRegistryDiag=${counters.commandRegistryDiag} counterfactualDuplicate=${counters.counterfactualDuplicate}${executionImpact}`;
}

function getNoiseSummaryIntervalMs(): number {
  const minutes = Number(process.env.NOISE_SUMMARY_INTERVAL_MINUTES ?? '5');
  if (!Number.isFinite(minutes) || minutes <= 0) return 5 * 60_000;
  return minutes * 60_000;
}

export function shouldEmitNoiseSummary(nowMs = Date.now()): boolean {
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
  lastNoiseSummaryEmittedAtMs = nowMs;
  loggerOverride.info(formatNoiseSummary(input));
}
