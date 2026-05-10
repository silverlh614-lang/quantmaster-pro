// @responsibility ADR-0500 Empty Scan Root Cause Dashboard; diagnostic-only aggregation with no live execution wiring.
import type {
  GateFailureAttributionEntryAdr0497,
  GateFailureCauseAdr0497,
} from './diagnosticTaxonomyAdr0497.js';

export type EmptyScanRootCauseSourceAdr0500 =
  | 'SCAN_BLOCKER'
  | 'GATE_FAILURE'
  | 'FRESH_DATA_STATUS'
  | 'PROVIDER_MARKET_MIGRATION'
  | 'ENTRY_FILTER_DECOMPOSITION'
  | 'RUNTIME_PIPELINE_AUDIT'
  | 'SUPPLY_SNAPSHOT'
  | 'OPERATOR_ACTION'
  | 'UNKNOWN';

export interface EmptyScanRootCauseEventAdr0500 {
  source: EmptyScanRootCauseSourceAdr0500;
  cause: GateFailureCauseAdr0497;
  count?: number;
  symbol?: string;
  gateName?: string;
  dataLineId?: string;
  providerHealth?: string;
  dataConfidence?: string;
  marketSignal?: string;
  message?: string;
  timestamp?: string;
}

export interface EmptyScanRootCauseBucketAdr0500 {
  cause: GateFailureCauseAdr0497;
  count: number;
  pct: number;
  sources: EmptyScanRootCauseSourceAdr0500[];
  sampleMessages: string[];
}

export interface EmptyScanRootCauseDashboardAdr0500 {
  generatedAt: string;
  scanId?: string;
  totalEvents: number;
  totalEmptyScans?: number;
  buckets: EmptyScanRootCauseBucketAdr0500[];
  topCause: GateFailureCauseAdr0497 | 'NONE';
  providerIssueCount: number;
  marketSignalIssueCount: number;
  executionBlockCount: number;
  thresholdOrScoringCount: number;
  unknownCount: number;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  operatorSummary: string;
  warnings: string[];
}

const KNOWN_CAUSES_ADR0500 = new Set<GateFailureCauseAdr0497>([
  'DATA_MISSING',
  'DATA_STALE',
  'PROVIDER_ERROR',
  'PROVIDER_EMPTY',
  'MARKET_SESSION_BLOCK',
  'SELL_ONLY_BLOCK',
  'MACRO_RISK_OFF',
  'SECTOR_ENERGY_UNOBSERVABLE',
  'SUPPLY_CONFLUENCE_UNAVAILABLE',
  'THRESHOLD_TOO_STRICT',
  'SIGNAL_CONFLICT',
  'INSUFFICIENT_POSITIVE_SCORE',
  'RISK_PENALTY_DOMINANT',
  'SIZING_BLOCK',
  'UNKNOWN',
]);

const PROVIDER_ISSUE_CAUSES_ADR0500 = new Set<GateFailureCauseAdr0497>([
  'DATA_MISSING',
  'DATA_STALE',
  'PROVIDER_ERROR',
  'PROVIDER_EMPTY',
  'SECTOR_ENERGY_UNOBSERVABLE',
  'SUPPLY_CONFLUENCE_UNAVAILABLE',
]);

const MARKET_SIGNAL_CAUSES_ADR0500 = new Set<GateFailureCauseAdr0497>([
  'MACRO_RISK_OFF',
  'SIGNAL_CONFLICT',
]);

const EXECUTION_BLOCK_CAUSES_ADR0500 = new Set<GateFailureCauseAdr0497>([
  'MARKET_SESSION_BLOCK',
  'SELL_ONLY_BLOCK',
  'SIZING_BLOCK',
]);

const THRESHOLD_OR_SCORING_CAUSES_ADR0500 = new Set<GateFailureCauseAdr0497>([
  'THRESHOLD_TOO_STRICT',
  'INSUFFICIENT_POSITIVE_SCORE',
  'RISK_PENALTY_DOMINANT',
]);

function normalizeTokenAdr0500(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/[\s-]+/g, '_').replace(/_+/g, '_').toUpperCase();
}

function sanitizeMessageAdr0500(value: unknown, maxLength = 96): string | undefined {
  if (value === null || value === undefined) return undefined;
  const compact = String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/raw\s*payload\s*[:=][^;|]+/ig, 'raw_payload=[redacted]')
    .replace(/payload\s*[:=][^;|]+/ig, 'payload=[redacted]')
    .replace(/token\s*[:=][^;|]+/ig, 'token=[redacted]')
    .replace(/secret\s*[:=][^;|]+/ig, 'secret=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length === 0) return undefined;
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1))}…` : compact;
}

function isGateFailureCauseAdr0500(value: string): value is GateFailureCauseAdr0497 {
  return KNOWN_CAUSES_ADR0500.has(value as GateFailureCauseAdr0497);
}

function safeCountAdr0500(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
}

function mapTextToCauseAdr0500(text: string): GateFailureCauseAdr0497 | null {
  if (!text) return null;
  if (text.includes('SELL_ONLY')) return 'SELL_ONLY_BLOCK';
  if (/(SESSION|MARKET_CLOSED|NON_TRADING_DAY|HOLIDAY)/.test(text)) return 'MARKET_SESSION_BLOCK';
  if (/(SECTOR_ENERGY|SECTOR_UNOBSERVABLE|MISSING_INDEX_CODE)/.test(text)) return 'SECTOR_ENERGY_UNOBSERVABLE';
  if (/(SUPPLY_CONFLUENCE|INVESTOR_FLOW_UNAVAILABLE)/.test(text)) return 'SUPPLY_CONFLUENCE_UNAVAILABLE';
  if (/(DATA_MISSING|MISSING|NO_DATA)/.test(text)) return 'DATA_MISSING';
  if (/(DATA_STALE|STALE|EXPIRED)/.test(text)) return 'DATA_STALE';
  if (/(PROVIDER_ERROR|API_ERROR|HTTP_ERROR|FAILED)/.test(text)) return 'PROVIDER_ERROR';
  if (/(PROVIDER_EMPTY|EMPTY|NO_ROWS|NO_SAMPLE)/.test(text)) return 'PROVIDER_EMPTY';
  if (/(MACRO_RISK_OFF|RISK_OFF|CRISIS)/.test(text)) return 'MACRO_RISK_OFF';
  if (/(THRESHOLD|REQUIRED_SCORE|TOO_STRICT)/.test(text)) return 'THRESHOLD_TOO_STRICT';
  if (/(SIGNAL_CONFLICT|CONFLICT)/.test(text)) return 'SIGNAL_CONFLICT';
  if (/(INSUFFICIENT_POSITIVE|POSITIVE_SCORE|SCORE_STARVATION)/.test(text)) return 'INSUFFICIENT_POSITIVE_SCORE';
  if (/(RISK_PENALTY|PENALTY_DOMINANT)/.test(text)) return 'RISK_PENALTY_DOMINANT';
  if (/(SIZING|KELLY_ZERO|POSITION_SIZE)/.test(text)) return 'SIZING_BLOCK';
  return null;
}

export function normalizeEmptyScanRootCauseAdr0500(input: {
  cause?: string | null;
  blockedReason?: string | null;
  message?: string | null;
  providerHealth?: string | null;
  marketSession?: string | null;
  engineMode?: string | null;
  gateName?: string | null;
}): GateFailureCauseAdr0497 {
  const directCause = normalizeTokenAdr0500(input.cause);
  if (isGateFailureCauseAdr0500(directCause)) return directCause;

  const providerHealth = normalizeTokenAdr0500(input.providerHealth);
  if (/(DOWN|DELAYED|RATE_LIMITED|PARSE_ERROR)/.test(providerHealth)) return 'PROVIDER_ERROR';
  if (providerHealth === 'EMPTY') return 'PROVIDER_EMPTY';
  if (providerHealth === 'STALE') return 'DATA_STALE';

  if (normalizeTokenAdr0500(input.engineMode) === 'SELL_ONLY') return 'SELL_ONLY_BLOCK';
  if (/(CLOSED|HOLIDAY|NON_TRADING_DAY)/.test(normalizeTokenAdr0500(input.marketSession))) return 'MARKET_SESSION_BLOCK';

  const text = [input.cause, input.blockedReason, input.message, input.gateName]
    .map(normalizeTokenAdr0500)
    .filter(Boolean)
    .join(' ');
  return mapTextToCauseAdr0500(text) ?? 'UNKNOWN';
}

function emptyDashboardAdr0500(input: {
  generatedAt: string;
  scanId?: string;
  totalEmptyScans?: number;
  warnings?: string[];
}): EmptyScanRootCauseDashboardAdr0500 {
  return {
    generatedAt: input.generatedAt,
    ...(input.scanId === undefined ? {} : { scanId: input.scanId }),
    totalEvents: 0,
    ...(input.totalEmptyScans === undefined ? {} : { totalEmptyScans: input.totalEmptyScans }),
    buckets: [],
    topCause: 'NONE',
    providerIssueCount: 0,
    marketSignalIssueCount: 0,
    executionBlockCount: 0,
    thresholdOrScoringCount: 0,
    unknownCount: 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    operatorSummary: 'EmptyScan rootCause=NONE total=0 provider=0 execution=0 threshold=0 unknown=0',
    warnings: input.warnings ?? [],
  };
}

function buildEmptyScanRootCauseDashboardUnsafeAdr0500(input: {
  scanId?: string;
  events?: EmptyScanRootCauseEventAdr0500[];
  at?: string;
  totalEmptyScans?: number;
}): EmptyScanRootCauseDashboardAdr0500 {
  if (input.at === '__ADR0500_FORCE_ERROR__') throw new Error('ADR-0500 forced dashboard error');
  const generatedAt = input.at ?? new Date().toISOString();
  const events = Array.isArray(input.events) ? input.events : [];
  if (events.length === 0) {
    return emptyDashboardAdr0500({ generatedAt, scanId: input.scanId, totalEmptyScans: input.totalEmptyScans });
  }

  const bucketsByCause = new Map<GateFailureCauseAdr0497, {
    count: number;
    sources: Set<EmptyScanRootCauseSourceAdr0500>;
    sampleMessages: string[];
  }>();

  for (const event of events) {
    const cause = KNOWN_CAUSES_ADR0500.has(event.cause) ? event.cause : 'UNKNOWN';
    const count = safeCountAdr0500(event.count);
    const current = bucketsByCause.get(cause) ?? { count: 0, sources: new Set<EmptyScanRootCauseSourceAdr0500>(), sampleMessages: [] };
    current.count += count;
    current.sources.add(event.source ?? 'UNKNOWN');
    const message = sanitizeMessageAdr0500(event.message);
    if (message && current.sampleMessages.length < 3 && !current.sampleMessages.includes(message)) {
      current.sampleMessages.push(message);
    }
    bucketsByCause.set(cause, current);
  }

  const totalEvents = Array.from(bucketsByCause.values()).reduce((sum, bucket) => sum + bucket.count, 0);
  if (totalEvents <= 0) {
    return emptyDashboardAdr0500({ generatedAt, scanId: input.scanId, totalEmptyScans: input.totalEmptyScans });
  }

  const buckets = Array.from(bucketsByCause.entries())
    .map(([cause, bucket]) => ({
      cause,
      count: bucket.count,
      pct: Math.round((bucket.count / totalEvents) * 1000) / 10,
      sources: Array.from(bucket.sources).sort(),
      sampleMessages: bucket.sampleMessages,
    }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));

  const sumCauses = (causes: Set<GateFailureCauseAdr0497>): number => buckets
    .filter((bucket) => causes.has(bucket.cause))
    .reduce((sum, bucket) => sum + bucket.count, 0);

  const providerIssueCount = sumCauses(PROVIDER_ISSUE_CAUSES_ADR0500);
  const executionBlockCount = sumCauses(EXECUTION_BLOCK_CAUSES_ADR0500);
  const thresholdOrScoringCount = sumCauses(THRESHOLD_OR_SCORING_CAUSES_ADR0500);
  const unknownCount = bucketsByCause.get('UNKNOWN')?.count ?? 0;
  const topCause = buckets[0]?.cause ?? 'NONE';

  return {
    generatedAt,
    ...(input.scanId === undefined ? {} : { scanId: input.scanId }),
    totalEvents,
    ...(input.totalEmptyScans === undefined ? {} : { totalEmptyScans: input.totalEmptyScans }),
    buckets,
    topCause,
    providerIssueCount,
    marketSignalIssueCount: sumCauses(MARKET_SIGNAL_CAUSES_ADR0500),
    executionBlockCount,
    thresholdOrScoringCount,
    unknownCount,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    operatorSummary: `EmptyScan rootCause=${topCause} total=${totalEvents} provider=${providerIssueCount} execution=${executionBlockCount} threshold=${thresholdOrScoringCount} unknown=${unknownCount}`,
    warnings: [],
  };
}

export function buildEmptyScanRootCauseDashboardAdr0500(input: {
  scanId?: string;
  events?: EmptyScanRootCauseEventAdr0500[];
  at?: string;
  totalEmptyScans?: number;
}): EmptyScanRootCauseDashboardAdr0500 {
  try {
    return buildEmptyScanRootCauseDashboardUnsafeAdr0500(input);
  } catch {
    return emptyDashboardAdr0500({
      generatedAt: input.at === '__ADR0500_FORCE_ERROR__' ? new Date().toISOString() : (input.at ?? new Date().toISOString()),
      scanId: input.scanId,
      totalEmptyScans: input.totalEmptyScans,
      warnings: ['ADR-0500 dashboard_error'],
    });
  }
}

export function buildEmptyScanRootCauseEventsFromGateFailuresAdr0500(
  entries: GateFailureAttributionEntryAdr0497[] | undefined,
): EmptyScanRootCauseEventAdr0500[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    source: 'GATE_FAILURE',
    cause: entry.failureCause ?? 'UNKNOWN',
    count: 1,
    ...(entry.symbol === undefined ? {} : { symbol: entry.symbol }),
    ...(entry.gateName === undefined ? {} : { gateName: entry.gateName }),
    ...(entry.providerHealth === undefined ? {} : { providerHealth: entry.providerHealth }),
    ...(entry.dataConfidence === undefined ? {} : { dataConfidence: entry.dataConfidence }),
    ...(entry.marketSignal === undefined ? {} : { marketSignal: entry.marketSignal }),
    timestamp: entry.timestamp,
  }));
}

export function buildEmptyScanRootCauseEventsFromStringsAdr0500(
  inputs: Array<{ source?: EmptyScanRootCauseSourceAdr0500; reason?: string | null; message?: string | null; count?: number }>,
): EmptyScanRootCauseEventAdr0500[] {
  if (!Array.isArray(inputs)) return [];
  return inputs.map((input) => ({
    source: input.source ?? 'UNKNOWN',
    cause: normalizeEmptyScanRootCauseAdr0500({ blockedReason: input.reason, message: input.message }),
    count: safeCountAdr0500(input.count),
    ...(sanitizeMessageAdr0500(input.message ?? input.reason) ? { message: sanitizeMessageAdr0500(input.message ?? input.reason) } : {}),
  }));
}

export function formatEmptyScanRootCauseCompactAdr0500(
  dashboard: EmptyScanRootCauseDashboardAdr0500,
  options?: { maxBuckets?: number },
): string {
  const maxBuckets = Math.max(0, options?.maxBuckets ?? 5);
  const lines = [
    `🧭 ADR-0500 EmptyScan: total=${dashboard.totalEvents} top=${dashboard.topCause} provider=${dashboard.providerIssueCount} execution=${dashboard.executionBlockCount} threshold=${dashboard.thresholdOrScoringCount} unknown=${dashboard.unknownCount} impact=${dashboard.executionImpact}`,
  ];
  dashboard.buckets.slice(0, maxBuckets).forEach((bucket, index) => {
    lines.push(`${index + 1}) ${bucket.cause} ${bucket.count} (${bucket.pct.toFixed(1)}%)`);
  });
  return lines.join('\n');
}

export function formatEmptyScanRootCauseDetailAdr0500(
  dashboard: EmptyScanRootCauseDashboardAdr0500,
): string {
  const lines = [
    `🧭 ADR-0500 Empty Scan Root Cause Detail generatedAt=${dashboard.generatedAt}`,
    `summary: ${dashboard.operatorSummary} impact=${dashboard.executionImpact} liveExecutionAllowed=${dashboard.liveExecutionAllowed}`,
  ];
  for (const bucket of dashboard.buckets) {
    lines.push(`- ${bucket.cause}: count=${bucket.count} pct=${bucket.pct.toFixed(1)} sources=${bucket.sources.join(',') || 'UNKNOWN'}`);
    if (bucket.sampleMessages.length > 0) {
      lines.push(`  samples=${bucket.sampleMessages.map((message) => sanitizeMessageAdr0500(message, 72) ?? '').filter(Boolean).join(' | ')}`);
    }
  }
  if (dashboard.warnings.length > 0) lines.push(`warnings=${dashboard.warnings.join(',')}`);
  return lines.join('\n');
}

export function safeBuildEmptyScanRootCauseDashboardAdr0500(input: {
  scanId?: string;
  events?: EmptyScanRootCauseEventAdr0500[];
  at?: string;
  totalEmptyScans?: number;
}): EmptyScanRootCauseDashboardAdr0500 {
  try {
    return buildEmptyScanRootCauseDashboardUnsafeAdr0500(input);
  } catch {
    const generatedAt = input.at === '__ADR0500_FORCE_ERROR__' ? new Date().toISOString() : (input.at ?? new Date().toISOString());
    return {
      generatedAt,
      ...(input.scanId === undefined ? {} : { scanId: input.scanId }),
      totalEvents: 1,
      ...(input.totalEmptyScans === undefined ? {} : { totalEmptyScans: input.totalEmptyScans }),
      buckets: [{ cause: 'UNKNOWN', count: 1, pct: 100, sources: ['UNKNOWN'], sampleMessages: [] }],
      topCause: 'UNKNOWN',
      providerIssueCount: 0,
      marketSignalIssueCount: 0,
      executionBlockCount: 0,
      thresholdOrScoringCount: 0,
      unknownCount: 1,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      operatorSummary: 'EmptyScan rootCause=UNKNOWN total=1 provider=0 execution=0 threshold=0 unknown=1',
      warnings: ['ADR-0500 dashboard_error'],
    };
  }
}
