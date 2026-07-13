// @responsibility Step16 ProviderHealth/MarketSignal isolation SSOT. Pure diagnostics only.

export type ProviderStatus =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'EMPTY_VALID'
  | 'MISSING'
  | 'ERROR'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'NOT_APPLICABLE';

type ProviderIssueType =
  | 'NONE'
  | 'SERVER_ERROR'
  | 'EMPTY_RESPONSE'
  | 'STALE_DATA'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'BUDGET_EXCEEDED'
  | 'PARSER_ERROR'
  | 'UNKNOWN';

export type MarketSignalDirection =
  | 'BULLISH'
  | 'BEARISH'
  | 'NEUTRAL'
  | 'MIXED'
  | 'UNKNOWN'
  | 'NOT_EVALUATED';

export type ProviderName = 'KIS' | 'KRX' | 'DART' | 'YAHOO' | 'INTERNAL' | 'OTHER';

export interface ProviderHealthSnapshot {
  provider: ProviderName;
  status: ProviderStatus;
  issueType: ProviderIssueType;
  rawStatus?: string;
  isProviderIssue: boolean;
  marketSignalImpact: 'NONE';
  executionImpact: 'NONE' | 'DATA_REQUIRED_MISSING';
  confidenceAdjustment: number;
  missingFields: string[];
  asOf: string;
}

export interface MarketSignal {
  source: string;
  direction: MarketSignalDirection;
  confidence: number;
  evidence: string[];
  derivedFromProviderIssue: false;
}

export interface DataVacuumClassification {
  snapshotId?: string;
  symbol?: string;
  missingFields: string[];
  marketSignal: 'NOT_EVALUATED';
  marketSignalImpact: 'NONE';
  executionImpact: 'NONE' | 'DATA_REQUIRED_MISSING';
  shadowLearning: true;
  counterfactualRecorded: true;
}

export interface DiagnosticProviderIssueIsolation {
  priority: string;
  reason: string;
  diagnosticSuppressed: true;
  dataVacuum: false;
  executionImpact: 'NONE';
  marketSignalImpact: 'NONE';
  confidenceAdjustment: 0;
  learningLabel: 'DIAGNOSTIC_SUPPRESSED';
}

const ERROR_STATUSES = new Set([
  'ERROR',
  'HTTP_500',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
  'KIS_500',
  'KIS_SERVER_ERROR',
  'KIS_REALDATA_500',
  'SERVER_ERROR',
  'PROVIDER_ERROR',
  'PROVIDER_UNAVAILABLE',
  'API_ERROR',
]);

const EMPTY_STATUSES = new Set([
  'ACCEPTED_EMPTY',
  'EMPTY_VALID',
  'EMPTY_RESPONSE',
  'NO_DATA',
  'NO_OUTPUT',
  'OK_EMPTY_OUTPUT',
  'OUTPUT_EMPTY',
  'FIELD_MISSING',
]);

const STALE_STATUSES = new Set(['STALE', 'CACHE_STALE', 'STALE_CACHE', 'SOURCE_STALE', 'EXPIRED']);
const RATE_LIMIT_STATUSES = new Set(['RATE_LIMITED', 'RATE_LIMIT', 'THROTTLED', 'HTTP_429', '429']);
const BUDGET_STATUSES = new Set(['BUDGET_EXCEEDED', 'P3_BUDGET_EXCEEDED', 'P4_BUDGET_EXCEEDED']);
const TIMEOUT_STATUSES = new Set(['TIMEOUT', 'ETIMEDOUT', 'REQUEST_TIMEOUT']);
const AUTH_STATUSES = new Set(['AUTH_ERROR', 'UNAUTHORIZED', 'HTTP_401', 'HTTP_403']);
const PARSER_STATUSES = new Set(['PARSER_ERROR', 'PARSE_ERROR', 'PARSE_FAILED', 'INVALID_SCHEMA']);
const VERIFIED_STATUSES = new Set(['OK', 'UP', 'READY', 'VERIFIED', 'SUCCESS', 'HEALTHY', 'API_REPORTED']);

function kv(key: string, value: unknown): string {
  if (Array.isArray(value)) return `${key}=[${value.join(',') || 'none'}]`;
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function token(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function inferProviderName(source: string | undefined): ProviderName {
  const normalized = token(source);
  if (normalized.includes('KIS')) return 'KIS';
  if (normalized.includes('KRX')) return 'KRX';
  if (normalized.includes('DART')) return 'DART';
  if (normalized.includes('YAHOO')) return 'YAHOO';
  if (normalized.includes('INTERNAL')) return 'INTERNAL';
  return 'OTHER';
}

function normalizeProviderStatus(rawStatus: string | undefined): ProviderStatus {
  const normalized = token(rawStatus);
  if (!normalized) return 'MISSING';
  if (VERIFIED_STATUSES.has(normalized)) return 'VERIFIED';
  if (ERROR_STATUSES.has(normalized)) return 'ERROR';
  if (EMPTY_STATUSES.has(normalized)) return 'EMPTY_VALID';
  if (STALE_STATUSES.has(normalized)) return 'STALE';
  if (RATE_LIMIT_STATUSES.has(normalized)) return 'RATE_LIMITED';
  if (BUDGET_STATUSES.has(normalized)) return 'BUDGET_EXCEEDED';
  if (TIMEOUT_STATUSES.has(normalized)) return 'DEGRADED';
  if (AUTH_STATUSES.has(normalized)) return 'ERROR';
  if (PARSER_STATUSES.has(normalized)) return 'ERROR';
  if (normalized === 'NOT_APPLICABLE' || normalized === 'N_A') return 'NOT_APPLICABLE';
  return 'DEGRADED';
}

function providerIssueTypeFromStatus(rawStatus: string | undefined, status: ProviderStatus): ProviderIssueType {
  const normalized = token(rawStatus);
  if (status === 'VERIFIED' || status === 'NOT_APPLICABLE') return 'NONE';
  if (status === 'EMPTY_VALID') return 'EMPTY_RESPONSE';
  if (status === 'STALE') return 'STALE_DATA';
  if (status === 'RATE_LIMITED') return 'RATE_LIMIT';
  if (status === 'BUDGET_EXCEEDED') return 'BUDGET_EXCEEDED';
  if (TIMEOUT_STATUSES.has(normalized)) return 'TIMEOUT';
  if (AUTH_STATUSES.has(normalized)) return 'AUTH_ERROR';
  if (PARSER_STATUSES.has(normalized)) return 'PARSER_ERROR';
  if (status === 'ERROR') return 'SERVER_ERROR';
  if (status === 'MISSING') return 'UNKNOWN';
  return 'UNKNOWN';
}

function confidenceAdjustmentFor(status: ProviderStatus): number {
  switch (status) {
    case 'VERIFIED':
    case 'EMPTY_VALID':
    case 'NOT_APPLICABLE':
      return 0;
    case 'DEGRADED':
    case 'STALE':
    case 'RATE_LIMITED':
    case 'BUDGET_EXCEEDED':
      return -0.05;
    case 'MISSING':
    case 'ERROR':
      return -0.1;
  }
}

function isProviderIssue(status: ProviderStatus): boolean {
  return status === 'DEGRADED'
    || status === 'STALE'
    || status === 'MISSING'
    || status === 'ERROR'
    || status === 'RATE_LIMITED'
    || status === 'BUDGET_EXCEEDED';
}

export function classifyProviderHealthSnapshot(input: {
  provider?: ProviderName | string;
  rawStatus?: string;
  status?: ProviderStatus;
  missingFields?: string[];
  requiredDataMissing?: boolean;
  asOf?: string;
}): ProviderHealthSnapshot {
  const status = input.status ?? normalizeProviderStatus(input.rawStatus);
  return {
    provider: typeof input.provider === 'string' ? inferProviderName(input.provider) : input.provider ?? 'OTHER',
    status,
    issueType: providerIssueTypeFromStatus(input.rawStatus, status),
    rawStatus: input.rawStatus,
    isProviderIssue: isProviderIssue(status),
    marketSignalImpact: 'NONE',
    executionImpact: input.requiredDataMissing === true ? 'DATA_REQUIRED_MISSING' : 'NONE',
    confidenceAdjustment: confidenceAdjustmentFor(status),
    missingFields: [...(input.missingFields ?? [])],
    asOf: input.asOf ?? new Date().toISOString(),
  };
}

export function buildMarketSignal(input: {
  source: string;
  requestedDirection?: MarketSignalDirection;
  providerHealth?: ProviderHealthSnapshot;
  confidence?: number;
  evidence?: string[];
}): MarketSignal {
  const providerHealth = input.providerHealth;
  if (!providerHealth || providerHealth.isProviderIssue || providerHealth.status !== 'VERIFIED') {
    return {
      source: input.source,
      direction: 'NOT_EVALUATED',
      confidence: 0,
      evidence: input.evidence ?? [],
      derivedFromProviderIssue: false,
    };
  }
  return {
    source: input.source,
    direction: input.requestedDirection ?? 'UNKNOWN',
    confidence: input.confidence ?? 1,
    evidence: input.evidence ?? [],
    derivedFromProviderIssue: false,
  };
}

export function classifyDataVacuumAsDataGap(input: {
  snapshotId?: string;
  symbol?: string;
  missingFields: string[];
  requiredDataMissing?: boolean;
}): DataVacuumClassification {
  return {
    snapshotId: input.snapshotId,
    symbol: input.symbol,
    missingFields: [...input.missingFields],
    marketSignal: 'NOT_EVALUATED',
    marketSignalImpact: 'NONE',
    executionImpact: input.requiredDataMissing === false ? 'NONE' : 'DATA_REQUIRED_MISSING',
    shadowLearning: true,
    counterfactualRecorded: true,
  };
}

export function isolateDiagnosticProviderIssue(input: {
  priority: string;
  reason: string;
}): DiagnosticProviderIssueIsolation {
  return {
    priority: input.priority,
    reason: input.reason,
    diagnosticSuppressed: true,
    dataVacuum: false,
    executionImpact: 'NONE',
    marketSignalImpact: 'NONE',
    confidenceAdjustment: 0,
    learningLabel: 'DIAGNOSTIC_SUPPRESSED',
  };
}

export function formatProviderIssueIsolatedFromMarketSignalLog(input: {
  snapshotId?: string;
  symbol?: string;
  health: ProviderHealthSnapshot;
  learningLabel?: string;
}): string {
  return [
    '[PROVIDER_ISSUE_ISOLATED_FROM_MARKET_SIGNAL]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    kv('provider', input.health.provider),
    kv('status', input.health.status),
    kv('issueType', input.health.issueType),
    kv('rawStatus', input.health.rawStatus),
    "marketSignalImpact='NONE'",
    kv('executionImpact', input.health.executionImpact),
    kv('confidenceAdjustment', input.health.confidenceAdjustment),
    kv('missingFields', input.health.missingFields),
    kv('learningLabel', input.learningLabel ?? 'PROVIDER_ISSUE_OBSERVED'),
  ].join(' ');
}

export function formatEmptyResponseClassifiedAsNoDataLog(input: {
  snapshotId?: string;
  provider: ProviderName | string;
  rawStatus?: string;
}): string {
  return [
    '[EMPTY_RESPONSE_CLASSIFIED_AS_NO_DATA]',
    kv('snapshotId', input.snapshotId),
    kv('provider', input.provider),
    kv('rawStatus', input.rawStatus),
    "newStatus='EMPTY_VALID'",
    "marketSignalImpact='NONE'",
    'bearishSignalCreated=false',
  ].join(' ');
}

export function formatDataVacuumClassifiedAsDataGapLog(input: DataVacuumClassification): string {
  return [
    '[DATA_VACUUM_CLASSIFIED_AS_DATA_GAP]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    kv('missingFields', input.missingFields),
    "marketSignal='NOT_EVALUATED'",
    "marketSignalImpact='NONE'",
    'shadowLearning=true',
    'counterfactualRecorded=true',
  ].join(' ');
}

export function formatDiagnosticProviderIssueIsolatedLog(input: DiagnosticProviderIssueIsolation): string {
  return [
    '[DIAGNOSTIC_PROVIDER_ISSUE_ISOLATED]',
    kv('priority', input.priority),
    kv('reason', input.reason),
    "executionImpact='NONE'",
    "marketSignalImpact='NONE'",
  ].join(' ');
}
