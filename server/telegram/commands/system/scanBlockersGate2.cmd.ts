// @responsibility Compact Gate2 ExternalData/DART/PER slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  loadGate2ExternalCache,
  type Gate2ExternalCacheFile,
  type Gate2ExternalCacheRecord,
} from '../../../trading/gate2/gate2ExternalCache.js';

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(recordOf).filter((item): item is AnyRecord => Boolean(item)) : [];
}

function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function firstRecord(...values: unknown[]): AnyRecord | null {
  for (const value of values) {
    const record = recordOf(value);
    if (record) return record;
  }
  return null;
}

function text(value: unknown, fallback = 'NONE'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'null';
}

function statusOf(record: AnyRecord | null | undefined, fallback: string): string {
  return text(record?.status ?? record?.perStatus, fallback).toUpperCase();
}

function sourceOf(record: AnyRecord | null | undefined, fallback = 'NONE'): string {
  return text(record?.source ?? record?.provider ?? record?.sourceTier, fallback).toUpperCase();
}

function resolveEntryFilter(summary: AnyRecord | null): AnyRecord | null {
  return firstRecord(summary?.entryFilterDecomposition, summary?.entryFilterDecompositionAdr0464);
}

function resolveCandidateTraces(entryFilter: AnyRecord | null): AnyRecord[] {
  return arrayOfRecords(entryFilter?.candidateTraces);
}

function resolveGate2ExternalData(summary: AnyRecord | null, entryFilter: AnyRecord | null): AnyRecord | null {
  const traces = resolveCandidateTraces(entryFilter);
  const traceWithExternal = traces.find((trace) =>
    recordOf(trace.gate2ExternalDataCoverage) || recordOf(getByPath(trace, 'gateLayerSummary.gate2.externalDataCoverage')),
  );
  return firstRecord(
    summary?.gate2ExternalData,
    summary?.gate2ExternalDataCoverage,
    entryFilter?.gate2ExternalData,
    entryFilter?.gate2ExternalDataCoverage,
    traceWithExternal?.gate2ExternalDataCoverage,
    getByPath(traceWithExternal, 'gateLayerSummary.gate2.externalDataCoverage'),
  );
}

function dateMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function resolveSummaryAsOf(summary: AnyRecord | null): string {
  return text(
    summary?.asOf
      ?? summary?.timestamp
      ?? summary?.updatedAt
      ?? summary?.createdAt
      ?? getByPath(summary, 'candidatePool.asOf')
      ?? getByPath(summary, 'scanEvaluationState.asOf'),
  );
}

function latestGate2CacheRecords(cache: Gate2ExternalCacheFile): Gate2ExternalCacheRecord[] {
  const traceSymbols = new Set((cache.lastRefresh?.traces ?? []).map(trace => trace.symbol));
  const records = traceSymbols.size > 0
    ? cache.records.filter(record => traceSymbols.has(record.symbol))
    : cache.records;
  return records;
}

function cacheRecordsToConditionTraces(records: readonly Gate2ExternalCacheRecord[]): AnyRecord[] {
  return records.map(record => ({
    symbol: record.symbol,
    conditionResults: record.projection.conditionResults,
  }));
}

function externalFromGate2Cache(cache: Gate2ExternalCacheFile): AnyRecord | null {
  const records = latestGate2CacheRecords(cache);
  if (records.length === 0) return null;
  const sample = records.find(record => record.projection.financialSnapshot.confidence === 'VERIFIED') ?? records[0];
  const projection = sample.projection;
  const snapshot = projection.financialSnapshot;
  const lastRefresh = cache.lastRefresh;
  return {
    stageStatus: 'CACHE_PROJECTED',
    status: 'CACHE_PROJECTED',
    dart: {
      status: snapshot.confidence,
      source: snapshot.source,
      reason: snapshot.confidence === 'VERIFIED' ? 'NONE' : snapshot.rawStatus,
      fiscalPeriod: snapshot.fiscalPeriod,
      lastUpdated: snapshot.lastUpdated,
    },
    valuation: projection.valuation,
    profitability: projection.profitability,
    stability: projection.stability,
    earningsQuality: projection.earningsQuality,
    highConvictionImpact: projection.highConvictionImpact,
    entryHardBlockImpact: projection.entryHardBlockImpact,
    shadowObservablePreserved: projection.shadowObservablePreserved,
    counterfactualAllowed: projection.counterfactualAllowed,
    blockingDetails: lastRefresh?.blockingDetails ?? lastRefresh?.strongBuyBlockedDetails,
    strongBuyBlockedDetails: lastRefresh?.strongBuyBlockedDetails,
    excludedDetails: lastRefresh?.excludedDetails,
    excludedCount: lastRefresh?.excludedCount,
  };
}

function dartReason(status: string, dart: AnyRecord | null): string {
  const explicit = text(dart?.reason ?? dart?.reasonCode, '');
  if (explicit) return explicit;
  if (status === 'VERIFIED') return 'NONE';
  if (status === 'DEFERRED' || status === 'STAGE_NOT_FETCHED') return 'STAGE_NOT_FETCHED';
  if (status === 'PROVIDER_ERROR' || status === 'ERROR') return 'DART_PROVIDER_ERROR';
  if (status === 'STALE') return 'DART_CACHE_STALE';
  return 'DART_FINANCIALS_MISSING';
}

function normalizeConditionStatus(raw: unknown): string {
  const status = text(raw, 'UNAVAILABLE').toUpperCase();
  if (status === 'PARTIAL' || status === 'MIXED' || status === 'EXCLUDED') return status;
  if (status === 'FIRED' || status === 'PASS' || status === 'OK') return 'PASS';
  if (status === 'FAIL' || status === 'THRESHOLD_NOT_MET') return 'FAIL';
  if (status === 'DATA_UNAVAILABLE' || status === 'ERROR') return 'UNAVAILABLE';
  return status;
}

function conditionRows(trace: AnyRecord): AnyRecord[] {
  const fromTrace = arrayOfRecords(trace.conditionResultsTrace);
  if (fromTrace.length > 0) return fromTrace;
  const conditionResults = recordOf(trace.conditionResults);
  if (!conditionResults) return [];
  return Object.entries(conditionResults).map(([key, value]) => {
    const result = recordOf(value);
    return {
      key,
      status: result?.status ?? (result?.fired === true ? 'FIRED' : undefined),
      value: result?.value,
      score: result?.score,
      source: result?.source,
      reason: result?.reason ?? result?.detail,
    };
  });
}

interface ConditionAggregate {
  status: string;
  sampleStatus: string;
  value: unknown;
  source: string;
  sampleSource: string;
  reason: string;
  sampleReason: string;
  count: number;
  pass: number;
  fail: number;
  unavailable: number;
  projection: boolean;
}

function aggregateReason(key: string, status: string, sampleReason: string): string {
  if (status === 'PARTIAL') {
    if (key === 'earnings_quality') return 'EARNINGS_QUALITY_PARTIAL';
    if (key === 'per') return 'PER_PARTIAL';
    return `${key.toUpperCase()}_PARTIAL`;
  }
  if (status === 'MIXED') {
    if (key === 'earnings_quality') return 'EARNINGS_QUALITY_MIXED';
    if (key === 'per') return 'PER_MIXED';
    return `${key.toUpperCase()}_MIXED`;
  }
  return sampleReason;
}

function preferredConditionSample(rows: AnyRecord[]): AnyRecord | null {
  return rows.find(row => normalizeConditionStatus(row.status) === 'FAIL')
    ?? rows.find(row => normalizeConditionStatus(row.status) === 'PASS')
    ?? rows.find(row => normalizeConditionStatus(row.status) === 'UNAVAILABLE')
    ?? rows[0]
    ?? null;
}

function conditionAggregate(traces: AnyRecord[], key: string, external?: AnyRecord | null): ConditionAggregate {
  const projected = firstRecord(
    getByPath(external, `conditionResults.${key}`),
    getByPath(external, `gate2ConditionProjection.${key}`),
  );
  const rows = traces.flatMap(conditionRows).filter((row) => text(row.key, '') === key);
  if (rows.length === 0 && projected) {
    const status = normalizeConditionStatus(projected.status);
    const source = sourceOf(projected, 'NONE');
    const reason = text(projected.reason ?? projected.reasonCode, status === 'UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'NONE');
    return {
      status,
      sampleStatus: status,
      value: projected.value,
      source,
      sampleSource: source,
      reason,
      sampleReason: reason,
      count: 1,
      pass: status === 'PASS' ? 1 : 0,
      fail: status === 'FAIL' ? 1 : 0,
      unavailable: status === 'UNAVAILABLE' ? 1 : 0,
      projection: true,
    };
  }
  if (rows.length === 0) {
    return {
      status: 'UNAVAILABLE',
      sampleStatus: 'UNAVAILABLE',
      value: null,
      source: 'NONE',
      sampleSource: 'NONE',
      reason: 'NOT_PROJECTED',
      sampleReason: 'NOT_PROJECTED',
      count: 0,
      pass: 0,
      fail: 0,
      unavailable: 0,
      projection: false,
    };
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = normalizeConditionStatus(row.status);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const pass = counts.get('PASS') ?? 0;
  const fail = counts.get('FAIL') ?? 0;
  const unavailable = counts.get('UNAVAILABLE') ?? 0;
  const resolved = pass + fail;
  const topStatus = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNAVAILABLE';
  const status = resolved > 0 && unavailable > 0
    ? 'PARTIAL'
    : pass > 0 && fail > 0
      ? 'MIXED'
      : topStatus;
  const sample = preferredConditionSample(rows);
  const resolvedRows = rows.filter(row => ['PASS', 'FAIL'].includes(normalizeConditionStatus(row.status)));
  const source = sourceOf(
    resolvedRows.find(row => sourceOf(row, 'NONE') !== 'NONE') ?? sample,
    key === 'per' && resolved > 0 ? 'KIS' : key === 'earnings_quality' && resolved > 0 ? 'DART' : 'NONE',
  );
  const sampleStatus = normalizeConditionStatus(sample?.status);
  const sampleReason = text(sample?.reason ?? sample?.detail, sampleStatus === 'UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'NONE');
  return {
    status,
    sampleStatus,
    value: sample?.value,
    source,
    sampleSource: sourceOf(sample, source),
    reason: aggregateReason(key, status, sampleReason),
    sampleReason,
    count: rows.length,
    pass,
    fail,
    unavailable,
    projection: false,
  };
}

function summarizeCondition(traces: AnyRecord[], key: string, external?: AnyRecord | null): string {
  const aggregate = conditionAggregate(traces, key, external);
  return [
    `${key}:status=${aggregate.status}`,
    `value=${numberText(aggregate.value)}`,
    `source=${aggregate.source}`,
    `reason=${aggregate.reason}`,
    `count=${aggregate.count}`,
    `pass=${aggregate.pass}`,
    `fail=${aggregate.fail}`,
    `unavailable=${aggregate.unavailable}`,
    ...(aggregate.projection ? ['projection=Gate2ExternalData'] : []),
  ].join(':');
}

function compactGate2ExternalData(summaryRaw: unknown, gate2Cache: Gate2ExternalCacheFile = loadGate2ExternalCache()): string {
  const summary = recordOf(summaryRaw);
  const entryFilter = resolveEntryFilter(summary);
  const traces = resolveCandidateTraces(entryFilter);
  const cacheRecords = latestGate2CacheRecords(gate2Cache);
  const cacheTraces = cacheRecordsToConditionTraces(cacheRecords);
  const projectionTraces = cacheTraces.length > 0 ? cacheTraces : traces;
  const scanExternal = resolveGate2ExternalData(summary, entryFilter);
  const cacheExternal = externalFromGate2Cache(gate2Cache);
  const external = cacheExternal ?? scanExternal;
  const gate2CacheAsOf = gate2Cache.lastRefresh?.asOf ?? gate2Cache.updatedAt ?? 'NONE';
  const lastScanSummaryAsOf = resolveSummaryAsOf(summary);
  const cacheMs = dateMs(gate2CacheAsOf);
  const scanMs = dateMs(lastScanSummaryAsOf);
  const projectionStale = cacheMs != null && scanMs != null && scanMs < cacheMs;
  const dart = firstRecord(external?.dart, external?.dartFinancials, external?.financials);
  const valuation = firstRecord(external?.valuation, external?.per, dart?.valuation);
  const perRecord = firstRecord(valuation?.per, valuation);
  const profitability = firstRecord(external?.profitability, dart?.profitability);
  const stability = firstRecord(external?.stability, dart?.stability);
  const earningsQuality = firstRecord(external?.earningsQuality, external?.earnings_quality, dart?.earningsQuality);
  const perAggregate = conditionAggregate(projectionTraces, 'per', external);
  const earningsAggregate = conditionAggregate(projectionTraces, 'earnings_quality', external);
  const dartStatus = statusOf(dart, external ? 'MISSING' : 'STAGE_NOT_FETCHED');
  const valuationStatus = perAggregate.count > 0
    ? perAggregate.sampleStatus
    : statusOf(perRecord, dartStatus === 'VERIFIED' ? 'DEFERRED' : 'MISSING');
  const valuationAggregateStatus = perAggregate.count > 0 ? perAggregate.status : valuationStatus;
  const earningsStatus = earningsAggregate.count > 0
    ? earningsAggregate.sampleStatus
    : statusOf(earningsQuality, dartStatus === 'VERIFIED' ? 'NEUTRAL' : 'UNAVAILABLE');
  const earningsSource = earningsAggregate.count > 0 ? earningsAggregate.sampleSource : sourceOf(earningsQuality, 'NONE');
  const earningsReason = earningsAggregate.count > 0
    ? earningsAggregate.sampleReason
    : text(earningsQuality?.reason ?? earningsQuality?.reasonCode, earningsStatus === 'UNAVAILABLE' ? 'EARNINGS_QUALITY_UNAVAILABLE' : 'NONE');
  const stageStatus = text(external?.stageStatus ?? external?.status, external ? 'STAGE_OBSERVED' : 'STAGE_NOT_FETCHED');

  return [
    'Gate2ExternalData:',
    `- stageStatus=${stageStatus} sampleTraces=${projectionTraces.length}`,
    `- SourceSnapshotConsistency: gate2CacheAsOf=${gate2CacheAsOf} lastScanSummaryAsOf=${lastScanSummaryAsOf} projectionStale=${String(projectionStale)}`,
    ...(projectionStale ? ['- note=SCAN_SUMMARY_OLDER_THAN_GATE2_REFRESH recommendedAction=/scan or next scan cycle'] : []),
    `- dart: status=${dartStatus} source=${sourceOf(dart, dartStatus === 'VERIFIED' ? 'DART' : 'NONE')} reason=${dartReason(dartStatus, dart)} fiscalPeriod=${text(dart?.fiscalPeriod)} lastUpdated=${text(dart?.lastUpdated ?? dart?.fetchedAt)} affectedConditions=earnings_quality,roe,opm,icr,per scoreImpact=limited_to_high_conviction executionImpact=NONE`,
    `- valuation: perStatusSample=${valuationStatus} perStatusAggregate=${valuationAggregateStatus} per=${numberText(perRecord?.per ?? perRecord?.value ?? perAggregate.value)} source=${perAggregate.count > 0 ? perAggregate.source : sourceOf(perRecord, 'NONE')} reason=${perAggregate.count > 0 ? perAggregate.reason : text(perRecord?.reason ?? perRecord?.reasonCode, valuationStatus === 'MISSING' ? 'PER_MISSING' : 'NONE')}`,
    `- profitability: roe=${numberText(profitability?.roe)} opm=${numberText(profitability?.opm)} netMargin=${numberText(profitability?.netMargin)} source=${sourceOf(profitability, sourceOf(dart, 'NONE'))}`,
    `- stability: icr=${numberText(stability?.icr)} debtRatio=${numberText(stability?.debtRatio)} currentRatio=${numberText(stability?.currentRatio)} source=${sourceOf(stability, sourceOf(dart, 'NONE'))}`,
    `- earningsQuality: status=${earningsStatus} score=${numberText(earningsQuality?.score ?? earningsAggregate.value)} source=${earningsSource} reason=${earningsReason}`,
    'Gate2ConditionResults:',
    `- ${summarizeCondition(projectionTraces, 'earnings_quality', external)}`,
    `- ${summarizeCondition(projectionTraces, 'per', external)}`,
    `- ${summarizeCondition(projectionTraces, 'roe', external)}`,
    `- ${summarizeCondition(projectionTraces, 'opm', external)}`,
    `- ${summarizeCondition(projectionTraces, 'icr', external)}`,
    'Gate2FreshDataStatusTargets:',
    '- GATE2_EXTERNAL/DART_FINANCIALS provider=DART status=READY_FOR_SHADOW|OBSERVING promo=BLOCKED_DATA_MISSING|ALLOWED impact=NONE',
    '- GATE2_EXTERNAL/VALUATION_PER provider=KIS|DART|CACHE status=READY_FOR_SHADOW|OBSERVING impact=NONE',
    '- GATE2_EXTERNAL/EARNINGS_QUALITY provider=DART|CACHE status=READY_FOR_SHADOW|OBSERVING impact=NONE',
    'Gate2Safety:',
    `- highConvictionImpact=${text(external?.highConvictionImpact, 'BLOCK_STRONG_BUY_UPGRADE')}`,
    `- strongBuyBlockedDetails=${text(external?.blockingDetails ?? external?.strongBuyBlockedDetails, 'NONE')}`,
    `- excludedDetails=${text(external?.excludedDetails, 'NONE')}`,
    `- excludedCount=${String(external?.excludedCount ?? 0)}`,
    `- entryHardBlockImpact=${text(external?.entryHardBlockImpact, 'NO')}`,
    `- shadowObservablePreserved=${String(external?.shadowObservablePreserved ?? true)}`,
    `- counterfactualAllowed=${String(external?.counterfactualAllowed ?? true)}`,
    '- executionImpact=NONE',
  ].join('\n');
}

async function replyInChunks(reply: (message: string) => Promise<void>, message: string): Promise<void> {
  const maxLen = 3600;
  if (message.length <= maxLen) {
    await reply(message);
    return;
  }
  let chunk = '';
  for (const line of message.split('\n')) {
    if (chunk.length + line.length + 1 > maxLen) {
      await reply(chunk.trimEnd());
      chunk = '';
    }
    chunk += `${line}\n`;
  }
  if (chunk.trim()) await reply(chunk.trimEnd());
}

const scanBlockersGate2: TelegramCommand = {
  name: '/scan_blockers_gate2',
  aliases: ['/scan_blokers_gate2', '/blockers_gate2', '/gate2_blockers', '/gate2_external'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Gate2 ExternalData / DART / PER slice from latest scan blockers',
  usage: '/scan_blockers_gate2',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const gate2Cache = loadGate2ExternalCache();
    const lines = [
      '[scan_blockers_gate2] Gate2 ExternalData / DART PER Earnings Quality',
      `source=${summary ? 'lastScanSummary+gate2ExternalCache' : 'gate2ExternalCache'} executionImpact=NONE`,
      '',
      compactGate2ExternalData(summary, gate2Cache),
      '',
      'note: compact diagnostic only; no scan execution, no provider fetch, no broker order, no live promotion.',
    ];
    await replyInChunks(reply, lines.join('\n'));
  },
};

commandRegistry.register(scanBlockersGate2);

export default scanBlockersGate2;
