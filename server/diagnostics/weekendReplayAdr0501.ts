// @responsibility ADR-0501 Weekend Replay; diagnostic-only replay verification using GateFailureCause, no live execution wiring.
import type {
  GateFailureAttributionEntryAdr0497,
  GateFailureCauseAdr0497,
} from './diagnosticTaxonomyAdr0497.js';
import {
  buildEmptyScanRootCauseDashboardAdr0500,
  formatEmptyScanRootCauseCompactAdr0500,
  formatEmptyScanRootCauseDetailAdr0500,
  normalizeEmptyScanRootCauseAdr0500,
  type EmptyScanRootCauseDashboardAdr0500,
  type EmptyScanRootCauseEventAdr0500,
  type EmptyScanRootCauseSourceAdr0500,
} from './emptyScanRootCauseDashboardAdr0500.js';

export type WeekendReplaySourceAdr0501 =
  | 'SCAN_SUMMARY'
  | 'SUPPLY_SNAPSHOT'
  | 'EMPTY_SCAN_DASHBOARD'
  | 'GATE_FAILURE_ATTRIBUTION'
  | 'SCAN_BLOCKER_STRING'
  | 'RUNTIME_PIPELINE_AUDIT'
  | 'UNKNOWN';

export type WeekendReplayModeAdr0501 =
  | 'LATEST'
  | 'PREVIOUS_TRADING_DAY'
  | 'WINDOW'
  | 'MANUAL_INPUT';

export interface WeekendReplayRecordAdr0501 {
  source: WeekendReplaySourceAdr0501;
  scanId?: string;
  symbol?: string;
  replayMode: WeekendReplayModeAdr0501;
  originalDecision?: string;
  replayDecision?: string;
  failureCause: GateFailureCauseAdr0497;
  message?: string;
  timestamp?: string;
}

export interface WeekendReplaySummaryAdr0501 {
  generatedAt: string;
  replayMode: WeekendReplayModeAdr0501;
  totalRecords: number;
  totalScans?: number;
  totalSymbols?: number;
  emptyScanDashboard: EmptyScanRootCauseDashboardAdr0500;
  causeCounts: Record<GateFailureCauseAdr0497, number>;
  providerIssueCount: number;
  executionBlockCount: number;
  thresholdOrScoringCount: number;
  marketRiskCount: number;
  unknownCount: number;
  likelyOverBlockedCount: number;
  likelyCorrectBlockCount: number;
  needsMoreDataCount: number;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  operatorSummary: string;
  warnings: string[];
}

const ALL_CAUSES_ADR0501: GateFailureCauseAdr0497[] = [
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
];

const KNOWN_CAUSES_ADR0501 = new Set<GateFailureCauseAdr0497>(ALL_CAUSES_ADR0501);
const PROVIDER_ISSUE_CAUSES_ADR0501 = new Set<GateFailureCauseAdr0497>([
  'DATA_MISSING',
  'DATA_STALE',
  'PROVIDER_ERROR',
  'PROVIDER_EMPTY',
  'SECTOR_ENERGY_UNOBSERVABLE',
  'SUPPLY_CONFLUENCE_UNAVAILABLE',
]);
const EXECUTION_BLOCK_CAUSES_ADR0501 = new Set<GateFailureCauseAdr0497>([
  'MARKET_SESSION_BLOCK',
  'SELL_ONLY_BLOCK',
  'SIZING_BLOCK',
]);
const THRESHOLD_OR_SCORING_CAUSES_ADR0501 = new Set<GateFailureCauseAdr0497>([
  'THRESHOLD_TOO_STRICT',
  'INSUFFICIENT_POSITIVE_SCORE',
  'RISK_PENALTY_DOMINANT',
]);
const MARKET_RISK_CAUSES_ADR0501 = new Set<GateFailureCauseAdr0497>([
  'MACRO_RISK_OFF',
  'SIGNAL_CONFLICT',
]);

function sanitizeWeekendReplayMessageAdr0501(value: unknown, maxLength = 96): string | undefined {
  if (value === null || value === undefined) return undefined;
  const compact = String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/raw\s*payload\s*[:=][^;|]+/ig, 'raw_payload=[redacted]')
    .replace(/payload\s*[:=][^;|]+/ig, 'payload=[redacted]')
    .replace(/token\s*[:=][^;|]+/ig, 'token=[redacted]')
    .replace(/secret\s*[:=][^;|]+/ig, 'secret=[redacted]')
    .replace(/authorization\s*[:=][^;|]+/ig, 'authorization=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length === 0) return undefined;
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1))}…` : compact;
}

function normalizeCauseAdr0501(value: unknown): GateFailureCauseAdr0497 {
  return KNOWN_CAUSES_ADR0501.has(value as GateFailureCauseAdr0497)
    ? value as GateFailureCauseAdr0497
    : 'UNKNOWN';
}

function normalizeReplayModeAdr0501(value: unknown): WeekendReplayModeAdr0501 {
  return value === 'LATEST' || value === 'PREVIOUS_TRADING_DAY' || value === 'WINDOW' || value === 'MANUAL_INPUT'
    ? value
    : 'MANUAL_INPUT';
}

function normalizeSourceAdr0501(value: unknown): WeekendReplaySourceAdr0501 {
  return value === 'SCAN_SUMMARY'
    || value === 'SUPPLY_SNAPSHOT'
    || value === 'EMPTY_SCAN_DASHBOARD'
    || value === 'GATE_FAILURE_ATTRIBUTION'
    || value === 'SCAN_BLOCKER_STRING'
    || value === 'RUNTIME_PIPELINE_AUDIT'
    ? value
    : 'UNKNOWN';
}

function toEmptyScanSourceAdr0501(source: WeekendReplaySourceAdr0501): EmptyScanRootCauseSourceAdr0500 {
  if (source === 'SUPPLY_SNAPSHOT') return 'SUPPLY_SNAPSHOT';
  if (source === 'GATE_FAILURE_ATTRIBUTION') return 'GATE_FAILURE';
  if (source === 'RUNTIME_PIPELINE_AUDIT') return 'RUNTIME_PIPELINE_AUDIT';
  if (source === 'SCAN_SUMMARY' || source === 'SCAN_BLOCKER_STRING') return 'SCAN_BLOCKER';
  if (source === 'EMPTY_SCAN_DASHBOARD') return 'OPERATOR_ACTION';
  return 'UNKNOWN';
}

function emptyCauseCountsAdr0501(): Record<GateFailureCauseAdr0497, number> {
  return Object.fromEntries(ALL_CAUSES_ADR0501.map((cause) => [cause, 0])) as Record<GateFailureCauseAdr0497, number>;
}

export function normalizeWeekendReplayRecordAdr0501(input: Partial<WeekendReplayRecordAdr0501> & {
  source?: WeekendReplaySourceAdr0501;
  reason?: string | null;
  blockedReason?: string | null;
}): WeekendReplayRecordAdr0501 {
  try {
    const message = sanitizeWeekendReplayMessageAdr0501(input.message ?? input.blockedReason ?? input.reason);
    const fallbackCause = normalizeEmptyScanRootCauseAdr0500({
      cause: input.failureCause,
      blockedReason: input.blockedReason ?? input.reason,
      message,
    });
    return {
      source: normalizeSourceAdr0501(input.source),
      ...(input.scanId === undefined ? {} : { scanId: input.scanId }),
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
      replayMode: normalizeReplayModeAdr0501(input.replayMode),
      ...(input.originalDecision === undefined ? {} : { originalDecision: sanitizeWeekendReplayMessageAdr0501(input.originalDecision) ?? input.originalDecision }),
      ...(input.replayDecision === undefined ? {} : { replayDecision: sanitizeWeekendReplayMessageAdr0501(input.replayDecision) ?? input.replayDecision }),
      failureCause: input.failureCause ? normalizeCauseAdr0501(input.failureCause) : fallbackCause,
      ...(message ? { message } : {}),
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
  } catch {
    return {
      source: 'UNKNOWN',
      replayMode: 'MANUAL_INPUT',
      failureCause: 'UNKNOWN',
      timestamp: new Date().toISOString(),
    };
  }
}

export function buildWeekendReplayRecordsFromGateFailuresAdr0501(
  entries: GateFailureAttributionEntryAdr0497[] | undefined,
  replayMode: WeekendReplayModeAdr0501 = 'MANUAL_INPUT',
): WeekendReplayRecordAdr0501[] {
  try {
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => normalizeWeekendReplayRecordAdr0501({
      source: 'GATE_FAILURE_ATTRIBUTION',
      scanId: entry.scanId,
      symbol: entry.symbol,
      replayMode,
      originalDecision: entry.executionImpact ?? entry.gateName,
      replayDecision: entry.gateName,
      failureCause: entry.failureCause,
      message: entry.gateName,
      timestamp: entry.timestamp,
    }));
  } catch {
    return [];
  }
}

export function buildWeekendReplayRecordsFromStringsAdr0501(
  inputs: Array<{
    source?: WeekendReplaySourceAdr0501;
    reason?: string | null;
    message?: string | null;
    scanId?: string;
    symbol?: string;
    replayMode?: WeekendReplayModeAdr0501;
  }>,
): WeekendReplayRecordAdr0501[] {
  try {
    if (!Array.isArray(inputs)) return [];
    return inputs.map((input) => normalizeWeekendReplayRecordAdr0501({
      source: input.source ?? 'SCAN_BLOCKER_STRING',
      reason: input.reason,
      blockedReason: input.reason,
      message: input.message ?? input.reason ?? undefined,
      scanId: input.scanId,
      symbol: input.symbol,
      replayMode: input.replayMode ?? 'MANUAL_INPUT',
    }));
  } catch {
    return [];
  }
}

export function classifyWeekendReplayOutcomeAdr0501(record: WeekendReplayRecordAdr0501): {
  outcome: 'LIKELY_OVER_BLOCKED' | 'LIKELY_CORRECT_BLOCK' | 'NEEDS_MORE_DATA';
  reason: string;
} {
  const cause = normalizeCauseAdr0501(record.failureCause);
  if (PROVIDER_ISSUE_CAUSES_ADR0501.has(cause)) {
    return { outcome: 'NEEDS_MORE_DATA', reason: `${cause} requires more sanitized replay evidence` };
  }
  if (EXECUTION_BLOCK_CAUSES_ADR0501.has(cause)) {
    return { outcome: 'LIKELY_CORRECT_BLOCK', reason: `${cause} is an execution/session block` };
  }
  if (MARKET_RISK_CAUSES_ADR0501.has(cause)) {
    return { outcome: 'LIKELY_CORRECT_BLOCK', reason: `${cause} is market/risk evidence` };
  }
  if (THRESHOLD_OR_SCORING_CAUSES_ADR0501.has(cause)) {
    return { outcome: 'LIKELY_OVER_BLOCKED', reason: `${cause} indicates threshold/scoring strictness` };
  }
  return { outcome: 'NEEDS_MORE_DATA', reason: 'UNKNOWN requires more evidence' };
}

function buildWeekendReplaySummaryUnsafeAdr0501(input: {
  records?: WeekendReplayRecordAdr0501[];
  replayMode?: WeekendReplayModeAdr0501;
  generatedAt?: string;
  totalScans?: number;
  totalSymbols?: number;
}): WeekendReplaySummaryAdr0501 {
  if (input.generatedAt === '__ADR0501_FORCE_ERROR__') throw new Error('ADR-0501 forced replay error');
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const replayMode = normalizeReplayModeAdr0501(input.replayMode);
  const records = Array.isArray(input.records) ? input.records.map((record) => normalizeWeekendReplayRecordAdr0501(record)) : [];
  const causeCounts = emptyCauseCountsAdr0501();
  let likelyOverBlockedCount = 0;
  let likelyCorrectBlockCount = 0;
  let needsMoreDataCount = 0;

  for (const record of records) {
    const cause = normalizeCauseAdr0501(record.failureCause);
    causeCounts[cause] += 1;
    const outcome = classifyWeekendReplayOutcomeAdr0501(record).outcome;
    if (outcome === 'LIKELY_OVER_BLOCKED') likelyOverBlockedCount += 1;
    if (outcome === 'LIKELY_CORRECT_BLOCK') likelyCorrectBlockCount += 1;
    if (outcome === 'NEEDS_MORE_DATA') needsMoreDataCount += 1;
  }

  const emptyScanDashboard = buildEmptyScanRootCauseDashboardAdr0500({
    at: generatedAt,
    events: records.map((record): EmptyScanRootCauseEventAdr0500 => ({
      source: toEmptyScanSourceAdr0501(record.source),
      cause: normalizeCauseAdr0501(record.failureCause),
      count: 1,
      ...(record.symbol === undefined ? {} : { symbol: record.symbol }),
      ...(record.message === undefined ? {} : { message: record.message }),
      ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
    })),
    totalEmptyScans: records.length > 0 ? undefined : 0,
  });

  const sumCauses = (causes: Set<GateFailureCauseAdr0497>): number => ALL_CAUSES_ADR0501
    .filter((cause) => causes.has(cause))
    .reduce((sum, cause) => sum + causeCounts[cause], 0);
  const providerIssueCount = sumCauses(PROVIDER_ISSUE_CAUSES_ADR0501);
  const executionBlockCount = sumCauses(EXECUTION_BLOCK_CAUSES_ADR0501);
  const thresholdOrScoringCount = sumCauses(THRESHOLD_OR_SCORING_CAUSES_ADR0501);
  const marketRiskCount = sumCauses(MARKET_RISK_CAUSES_ADR0501);
  const unknownCount = causeCounts.UNKNOWN;
  const topCause = ALL_CAUSES_ADR0501
    .filter((cause) => causeCounts[cause] > 0)
    .sort((a, b) => causeCounts[b] - causeCounts[a] || a.localeCompare(b))[0] ?? 'NONE';

  return {
    generatedAt,
    replayMode,
    totalRecords: records.length,
    ...(input.totalScans === undefined ? {} : { totalScans: input.totalScans }),
    ...(input.totalSymbols === undefined ? {} : { totalSymbols: input.totalSymbols }),
    emptyScanDashboard,
    causeCounts,
    providerIssueCount,
    executionBlockCount,
    thresholdOrScoringCount,
    marketRiskCount,
    unknownCount,
    likelyOverBlockedCount,
    likelyCorrectBlockCount,
    needsMoreDataCount,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    operatorSummary: `WeekendReplay total=${records.length} overBlocked=${likelyOverBlockedCount} correctBlock=${likelyCorrectBlockCount} needsMoreData=${needsMoreDataCount} top=${topCause} impact=NONE`,
    warnings: [],
  };
}

function replayErrorSummaryAdr0501(input: {
  replayMode?: WeekendReplayModeAdr0501;
  generatedAt?: string;
  warning?: string;
}): WeekendReplaySummaryAdr0501 {
  const generatedAt = input.generatedAt === '__ADR0501_FORCE_ERROR__' ? new Date().toISOString() : (input.generatedAt ?? new Date().toISOString());
  const causeCounts = emptyCauseCountsAdr0501();
  causeCounts.UNKNOWN = 1;
  const emptyScanDashboard = buildEmptyScanRootCauseDashboardAdr0500({
    at: generatedAt,
    events: [{ source: 'UNKNOWN', cause: 'UNKNOWN', count: 1, message: input.warning ?? 'ADR-0501 replay_error' }],
    totalEmptyScans: 0,
  });
  return {
    generatedAt,
    replayMode: normalizeReplayModeAdr0501(input.replayMode),
    totalRecords: 1,
    emptyScanDashboard,
    causeCounts,
    providerIssueCount: 0,
    executionBlockCount: 0,
    thresholdOrScoringCount: 0,
    marketRiskCount: 0,
    unknownCount: 1,
    likelyOverBlockedCount: 0,
    likelyCorrectBlockCount: 0,
    needsMoreDataCount: 1,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    operatorSummary: 'WeekendReplay total=1 overBlocked=0 correctBlock=0 needsMoreData=1 top=UNKNOWN impact=NONE',
    warnings: [input.warning ?? 'ADR-0501 replay_error'],
  };
}

export function buildWeekendReplaySummaryAdr0501(input: {
  records?: WeekendReplayRecordAdr0501[];
  replayMode?: WeekendReplayModeAdr0501;
  generatedAt?: string;
  totalScans?: number;
  totalSymbols?: number;
}): WeekendReplaySummaryAdr0501 {
  try {
    return buildWeekendReplaySummaryUnsafeAdr0501(input);
  } catch {
    return replayErrorSummaryAdr0501({ replayMode: input.replayMode, generatedAt: input.generatedAt, warning: 'ADR-0501 summary_error' });
  }
}

function topCauseEntriesAdr0501(summary: WeekendReplaySummaryAdr0501): Array<[GateFailureCauseAdr0497, number]> {
  return ALL_CAUSES_ADR0501
    .map((cause): [GateFailureCauseAdr0497, number] => [cause, summary.causeCounts[cause] ?? 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function formatWeekendReplayCompactAdr0501(
  summary: WeekendReplaySummaryAdr0501,
  options?: { maxCauses?: number },
): string {
  const maxCauses = Math.max(0, options?.maxCauses ?? 5);
  const topCauses = topCauseEntriesAdr0501(summary);
  const top = topCauses[0]?.[0] ?? 'NONE';
  const lines = [
    `🔁 ADR-0501 WeekendReplay: mode=${summary.replayMode} total=${summary.totalRecords} overBlocked=${summary.likelyOverBlockedCount} correct=${summary.likelyCorrectBlockCount} needsData=${summary.needsMoreDataCount} top=${top} impact=${summary.executionImpact}`,
  ];
  topCauses.slice(0, maxCauses).forEach(([cause, count], index) => {
    lines.push(`${index + 1}) ${cause} ${count}`);
  });
  return lines.join('\n');
}

export function formatWeekendReplayDetailAdr0501(
  summary: WeekendReplaySummaryAdr0501,
): string {
  const lines = [
    `🔁 ADR-0501 Weekend Replay Detail generatedAt=${summary.generatedAt}`,
    `summary: ${summary.operatorSummary} liveExecutionAllowed=${summary.liveExecutionAllowed}`,
    `categories: provider=${summary.providerIssueCount} execution=${summary.executionBlockCount} threshold=${summary.thresholdOrScoringCount} marketRisk=${summary.marketRiskCount} unknown=${summary.unknownCount}`,
    `outcomes: overBlocked=${summary.likelyOverBlockedCount} correctBlock=${summary.likelyCorrectBlockCount} needsMoreData=${summary.needsMoreDataCount}`,
    formatEmptyScanRootCauseCompactAdr0500(summary.emptyScanDashboard, { maxBuckets: 3 }),
  ];
  if (summary.emptyScanDashboard.totalEvents > 0) {
    lines.push(formatEmptyScanRootCauseDetailAdr0500(summary.emptyScanDashboard));
  }
  if (summary.warnings.length > 0) lines.push(`warnings=${summary.warnings.join(',')}`);
  const text = lines.join('\n');
  return text.length > 3500 ? `${text.slice(0, 3499)}…` : text;
}

export function safeBuildWeekendReplaySummaryAdr0501(input: {
  records?: WeekendReplayRecordAdr0501[];
  replayMode?: WeekendReplayModeAdr0501;
  generatedAt?: string;
  totalScans?: number;
  totalSymbols?: number;
}): WeekendReplaySummaryAdr0501 {
  try {
    return buildWeekendReplaySummaryUnsafeAdr0501(input);
  } catch {
    return replayErrorSummaryAdr0501({ replayMode: input.replayMode, generatedAt: input.generatedAt, warning: 'ADR-0501 replay_error' });
  }
}
