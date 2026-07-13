// @responsibility Position Source Aggregator for /pos and /pnl.

import { readLiveKisPositions } from './readers/liveKisPositionReader.js';
import { readPaperTradePositions } from './readers/paperTradePositionReader.js';
import { readShadowLedgerPositions } from './readers/shadowLedgerPositionReader.js';
import { readShadowPositionRegistryPositions } from './readers/shadowPositionReader.js';
import { readShadowTradeRepoPositions } from './readers/shadowTradeRepoReader.js';
import { readVirtualAccountPositions } from './readers/virtualAccountPositionReader.js';
import { emitPositionOperationalWarn } from './positionOperationalWarn.js';
import type {
  NormalizedPosition,
  NormalizedPositionMode,
  PositionSourceAggregate,
  PositionSourceName,
  PositionSourceResult,
} from './positionSourceTypes.js';
import { isPositionSourceFailure, isPositionSourceSuccess } from './positionSourceTypes.js';

type PositionSourceReader = () => Promise<PositionSourceResult> | PositionSourceResult;

export type PositionSourceReaderMap = Partial<Record<PositionSourceName, PositionSourceReader>>;

export interface PositionSourceAggregatorOptions {
  mode?: NormalizedPositionMode;
  includeLiveFallback?: boolean;
  readers?: PositionSourceReaderMap;
}

const POSITION_SOURCE_PRIORITY: PositionSourceName[] = [
  'ShadowPositionRegistry',
  'ShadowPositionLedger',
  'ShadowTradeRepo',
  'VirtualAccount',
  'PaperTradeLedger',
  'KISLiveHolding',
];

const DEFAULT_READERS: Record<PositionSourceName, PositionSourceReader> = {
  ShadowPositionRegistry: readShadowPositionRegistryPositions,
  ShadowPositionLedger: readShadowLedgerPositions,
  ShadowTradeRepo: readShadowTradeRepoPositions,
  VirtualAccount: readVirtualAccountPositions,
  PaperTradeLedger: readPaperTradePositions,
  KISLiveHolding: readLiveKisPositions,
};

export async function aggregatePositionSourceResults(
  options: PositionSourceAggregatorOptions = {},
): Promise<PositionSourceAggregate> {
  const mode = options.mode ?? 'SHADOW';
  const readers = { ...DEFAULT_READERS, ...(options.readers ?? {}) };
  const results: PositionSourceResult[] = [];

  for (const source of POSITION_SOURCE_PRIORITY) {
    if (
      source === 'KISLiveHolding' &&
      mode === 'SHADOW' &&
      options.includeLiveFallback !== true &&
      hasNonLivePositions(results)
    ) {
      results.push({
        source,
        kind: 'EMPTY',
        diagnostics: { skipped: 'SHADOW_SOURCE_AVAILABLE' },
      });
      continue;
    }

    const result = await readers[source]();
    results.push(result);
  }

  const failures = results.filter(isPositionSourceFailure);
  if (failures.length > 0) {
    emitPositionOperationalWarn({
      code: 'P0_POSITION_QUERY_DEGRADED',
      message: 'One or more position sources failed',
      context: {
        failedSources: failures.map((failure) => failure.source),
        failureCount: failures.length,
      },
    });
  }

  return {
    positions: dedupePositions(results),
    results,
    diagnostics: results,
    hasFailure: failures.length > 0,
    allFailed: results.length > 0 && results.every(isPositionSourceFailure),
  };
}

export function getPositionSourcePriority(): readonly PositionSourceName[] {
  return POSITION_SOURCE_PRIORITY;
}

function hasNonLivePositions(results: PositionSourceResult[]): boolean {
  return results
    .filter(isPositionSourceSuccess)
    .some((result) => result.positions.some((position) => position.sourceTag !== 'LIVE'));
}

function dedupePositions(results: PositionSourceResult[]): NormalizedPosition[] {
  const positions: NormalizedPosition[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (!isPositionSourceSuccess(result)) {
      continue;
    }

    for (const position of result.positions) {
      const key = position.id
        ? `${position.mode}:${position.id}`
        : `${position.mode}:${position.sourceTag}:${position.symbol}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      positions.push(position);
    }
  }

  return positions;
}
