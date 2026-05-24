// @responsibility /gate2_external_refresh DART/KIS/CACHE Gate2 external refresh command.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getLastScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import { refreshGate2ExternalData } from '../../../trading/gate2/gate2ExternalDataProvider.js';

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(recordOf).filter((item): item is AnyRecord => Boolean(item)) : [];
}

function cleanSymbol(value: unknown): string | null {
  const symbol = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 6);
  return symbol.length > 0 ? symbol.padStart(6, '0') : null;
}

function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function symbolsFromLatestScan(): string[] {
  const summary = recordOf(getLastScanSummary());
  const entry = recordOf(summary?.entryFilterDecomposition) ?? recordOf(summary?.entryFilterDecompositionAdr0464);
  const traces = arrayOfRecords(entry?.candidateTraces);
  const candidates = arrayOfRecords(summary?.candidates);
  const all = [
    ...traces.flatMap(trace => [trace.symbol, trace.code, trace.stockCode]),
    ...candidates.flatMap(candidate => [candidate.symbol, candidate.code, candidate.stockCode]),
    ...arrayOfRecords(getByPath(summary, 'candidatePool.candidates')).flatMap(candidate => [candidate.symbol, candidate.code, candidate.stockCode]),
  ];
  return [...new Set(all.map(cleanSymbol).filter((symbol): symbol is string => Boolean(symbol)))];
}

function parseSymbols(args: readonly string[]): string[] {
  const parsed = args
    .join(' ')
    .split(/[,\s]+/)
    .map(cleanSymbol)
    .filter((symbol): symbol is string => Boolean(symbol));
  return [...new Set(parsed)];
}

function compactTrace(trace: NonNullable<Awaited<ReturnType<typeof refreshGate2ExternalData>>['traces'][number]>): string {
  return [
    trace.symbol,
    `corp=${trace.corpCodeResolveStatus}${trace.corpCode ? `(${trace.corpCode})` : ''}`,
    `fiscal=${trace.fiscalPeriodStatus}`,
    `period=${trace.fiscalPeriod ?? 'NONE'}`,
    `dartAttempt=${trace.dartRequestAttempted}`,
    `http=${trace.dartHttpStatus ?? 'NONE'}`,
    `err=${trace.dartErrorCode ?? 'NONE'}`,
    `rawRows=${trace.dartRawRows}`,
    `normalizedRows=${trace.normalizedRows}`,
    `derived=${trace.derivedMetricsComputed}`,
    `per=${trace.perNormalized ?? 'null'}`,
    `confidence=${trace.finalConfidence}`,
    `unavailable=${trace.unavailableConditions.join('/') || 'NONE'}`,
  ].join(':');
}

const gate2ExternalRefresh: TelegramCommand = {
  name: '/gate2_external_refresh',
  aliases: ['/gate2_refresh', '/refresh_gate2_external'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'Refresh Gate2 DART financials/PER projection cache without broker or live promotion impact',
  usage: '/gate2_external_refresh [symbol ...]',
  async execute({ args, reply }) {
    const explicitSymbols = parseSymbols(args);
    const symbols = explicitSymbols.length > 0 ? explicitSymbols : symbolsFromLatestScan();
    if (symbols.length === 0) {
      await reply([
        '[gate2_external_refresh] no symbols',
        'source=latestScanSummary missing',
        'executionImpact=NONE',
        'note: no provider fetch was attempted.',
      ].join('\n'));
      return;
    }
    const limited = symbols.slice(0, 50);
    await reply(`[gate2_external_refresh] starting symbols=${limited.length} mode=OBSERVE executionImpact=NONE`);
    const result = await refreshGate2ExternalData({ symbols: limited });
    const counters = result.counters;
    const health = result.providerHealth;
    const samples = result.records.slice(0, 8).map(record => [
      record.symbol,
      `confidence=${record.financialSnapshot.confidence}`,
      `source=${record.financialSnapshot.source}`,
      `fiscalPeriod=${record.financialSnapshot.fiscalPeriod ?? 'NONE'}`,
      `unavailable=${record.unavailableCount}`,
    ].join(':'));
    const traceSamples = result.traces.slice(0, 8).map(compactTrace);
    await reply([
      '[gate2_external_refresh] completed',
      `requested=${result.requestedSymbols.length}`,
      `refreshed=${result.refreshedCount}`,
      `verified=${result.verifiedCount}`,
      `stale=${result.staleCount}`,
      `missing=${result.missingCount}`,
      `rowsProjected=${result.rowsProjected}`,
      `unavailableCount=${result.unavailableCount}`,
      `strongBuyBlockedReason=${result.strongBuyBlockedReason}`,
      `rootCause=${result.rootCause}`,
      `providerRequestsAttempted=${counters.providerRequestsAttempted}`,
      `corpCodeResolved=${counters.corpCodeResolved}`,
      `corpCodeMissing=${counters.corpCodeMissing}`,
      `fiscalPeriodResolved=${counters.fiscalPeriodResolved}`,
      `fiscalPeriodMissing=${counters.fiscalPeriodMissing}`,
      `dartResponsesOk=${counters.dartResponsesOk}`,
      `dartResponsesError=${counters.dartResponsesError}`,
      `dartRowsFetched=${counters.dartRowsFetched}`,
      `normalizedRowsBuilt=${counters.normalizedRowsBuilt}`,
      `derivedMetricsComputed=${counters.derivedMetricsComputed}`,
      `kisPerAttempted=${counters.kisPerAttempted}`,
      `kisPerAvailable=${counters.kisPerAvailable}`,
      `kisPerUnavailable=${counters.kisPerUnavailable}`,
      `providerHealth=apiKeyPresent:${health.apiKeyPresent}|requestEnabled:${health.requestEnabled}|corpCodeCacheLoaded:${health.corpCodeCacheLoaded}|corpCodeCacheCount:${health.corpCodeCacheCount}|lastHttpStatus:${health.lastHttpStatus ?? 'NONE'}|lastErrorCode:${health.lastErrorCode ?? 'NONE'}|rateLimitState:${health.rateLimitState}|cacheWritable:${health.cacheWritable}`,
      'entryHardBlockImpact=NO',
      'shadowObservablePreserved=true',
      'counterfactualAllowed=true',
      'executionImpact=NONE',
      ...(samples.length > 0 ? ['', 'samples:', ...samples] : []),
      ...(traceSamples.length > 0 ? ['', 'refreshTrace:', ...traceSamples] : []),
      '',
      'note: provider refresh only; no scan execution, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(gate2ExternalRefresh);

export default gate2ExternalRefresh;
