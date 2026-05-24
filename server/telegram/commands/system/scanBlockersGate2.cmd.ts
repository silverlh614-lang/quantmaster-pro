// @responsibility Compact Gate2 ExternalData/DART/PER slice from the latest scan_blockers snapshot.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';

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

function summarizeCondition(traces: AnyRecord[], key: string, external?: AnyRecord | null): string {
  const projected = firstRecord(
    getByPath(external, `conditionResults.${key}`),
    getByPath(external, `gate2ConditionProjection.${key}`),
  );
  const rows = traces.flatMap(conditionRows).filter((row) => text(row.key, '') === key);
  if (rows.length === 0 && projected) {
    const status = normalizeConditionStatus(projected.status);
    return [
      `${key}:status=${status}`,
      `value=${numberText(projected.value)}`,
      `source=${sourceOf(projected, 'NONE')}`,
      `reason=${text(projected.reason ?? projected.reasonCode, status === 'UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'NONE')}`,
      'count=1',
      `pass=${status === 'PASS' ? 1 : 0}`,
      `fail=${status === 'FAIL' ? 1 : 0}`,
      `unavailable=${status === 'UNAVAILABLE' ? 1 : 0}`,
      'projection=Gate2ExternalData',
    ].join(':');
  }
  if (rows.length === 0) {
    return `${key}:status=UNAVAILABLE:value=null:source=NONE:reason=NOT_PROJECTED count=0`;
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = normalizeConditionStatus(row.status);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const topStatus = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNAVAILABLE';
  const sample = rows.find((row) => normalizeConditionStatus(row.status) === topStatus) ?? rows[0];
  return [
    `${key}:status=${topStatus}`,
    `value=${numberText(sample?.value)}`,
    `source=${sourceOf(sample, 'NONE')}`,
    `reason=${text(sample?.reason ?? sample?.detail, topStatus === 'UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'NONE')}`,
    `count=${rows.length}`,
    `pass=${counts.get('PASS') ?? 0}`,
    `fail=${counts.get('FAIL') ?? 0}`,
    `unavailable=${counts.get('UNAVAILABLE') ?? 0}`,
  ].join(':');
}

function compactGate2ExternalData(summaryRaw: unknown): string {
  const summary = recordOf(summaryRaw);
  const entryFilter = resolveEntryFilter(summary);
  const traces = resolveCandidateTraces(entryFilter);
  const external = resolveGate2ExternalData(summary, entryFilter);
  const dart = firstRecord(external?.dart, external?.dartFinancials, external?.financials);
  const valuation = firstRecord(external?.valuation, external?.per, dart?.valuation);
  const perRecord = firstRecord(valuation?.per, valuation);
  const profitability = firstRecord(external?.profitability, dart?.profitability);
  const stability = firstRecord(external?.stability, dart?.stability);
  const earningsQuality = firstRecord(external?.earningsQuality, external?.earnings_quality, dart?.earningsQuality);
  const dartStatus = statusOf(dart, external ? 'MISSING' : 'STAGE_NOT_FETCHED');
  const valuationStatus = statusOf(perRecord, dartStatus === 'VERIFIED' ? 'DEFERRED' : 'MISSING');
  const earningsStatus = statusOf(earningsQuality, dartStatus === 'VERIFIED' ? 'NEUTRAL' : 'UNAVAILABLE');
  const stageStatus = text(external?.stageStatus ?? external?.status, external ? 'STAGE_OBSERVED' : 'STAGE_NOT_FETCHED');

  return [
    'Gate2ExternalData:',
    `- stageStatus=${stageStatus} sampleTraces=${traces.length}`,
    `- dart: status=${dartStatus} source=${sourceOf(dart, dartStatus === 'VERIFIED' ? 'DART' : 'NONE')} reason=${dartReason(dartStatus, dart)} fiscalPeriod=${text(dart?.fiscalPeriod)} lastUpdated=${text(dart?.lastUpdated ?? dart?.fetchedAt)} affectedConditions=earnings_quality,roe,opm,icr,per scoreImpact=limited_to_high_conviction executionImpact=NONE`,
    `- valuation: perStatus=${valuationStatus} per=${numberText(perRecord?.per ?? perRecord?.value)} source=${sourceOf(perRecord, 'NONE')} reason=${text(perRecord?.reason ?? perRecord?.reasonCode, valuationStatus === 'MISSING' ? 'PER_MISSING' : 'NONE')}`,
    `- profitability: roe=${numberText(profitability?.roe)} opm=${numberText(profitability?.opm)} netMargin=${numberText(profitability?.netMargin)} source=${sourceOf(profitability, sourceOf(dart, 'NONE'))}`,
    `- stability: icr=${numberText(stability?.icr)} debtRatio=${numberText(stability?.debtRatio)} currentRatio=${numberText(stability?.currentRatio)} source=${sourceOf(stability, sourceOf(dart, 'NONE'))}`,
    `- earningsQuality: status=${earningsStatus} score=${numberText(earningsQuality?.score)} reason=${text(earningsQuality?.reason ?? earningsQuality?.reasonCode, earningsStatus === 'UNAVAILABLE' ? 'EARNINGS_QUALITY_UNAVAILABLE' : 'NONE')}`,
    'Gate2ConditionResults:',
    `- ${summarizeCondition(traces, 'earnings_quality', external)}`,
    `- ${summarizeCondition(traces, 'per', external)}`,
    `- ${summarizeCondition(traces, 'roe', external)}`,
    `- ${summarizeCondition(traces, 'opm', external)}`,
    `- ${summarizeCondition(traces, 'icr', external)}`,
    'Gate2FreshDataStatusTargets:',
    '- GATE2_EXTERNAL/DART_FINANCIALS provider=DART status=READY_FOR_SHADOW|OBSERVING promo=BLOCKED_DATA_MISSING|ALLOWED impact=NONE',
    '- GATE2_EXTERNAL/VALUATION_PER provider=KIS|DART|CACHE status=READY_FOR_SHADOW|OBSERVING impact=NONE',
    '- GATE2_EXTERNAL/EARNINGS_QUALITY provider=DART|CACHE status=READY_FOR_SHADOW|OBSERVING impact=NONE',
    'Gate2Safety:',
    `- highConvictionImpact=${text(external?.highConvictionImpact, 'BLOCK_STRONG_BUY_UPGRADE')}`,
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
    const lines = [
      '[scan_blockers_gate2] Gate2 ExternalData / DART PER Earnings Quality',
      `source=${summary ? 'lastScanSummary' : 'none'} executionImpact=NONE`,
      '',
      compactGate2ExternalData(summary),
      '',
      'note: compact diagnostic only; no scan execution, no provider fetch, no broker order, no live promotion.',
    ];
    await replyInChunks(reply, lines.join('\n'));
  },
};

commandRegistry.register(scanBlockersGate2);

export default scanBlockersGate2;
