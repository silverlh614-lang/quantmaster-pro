import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aggregatePositionSourceResults,
  getPositionSourcePriority,
  type PositionSourceReaderMap,
} from './positionSourceAggregator.js';
import type { NormalizedPosition, PositionSourceName, PositionSourceResult } from './positionSourceTypes.js';

function position(overrides: Partial<NormalizedPosition> = {}): NormalizedPosition {
  return {
    symbol: '005930',
    name: 'Samsung',
    qty: 3,
    avgPrice: 70000,
    sourceTag: 'SHADOW',
    mode: 'SHADOW',
    source: 'ShadowPositionLedger',
    id: 'shadow-1',
    ...overrides,
  };
}

function empty(source: PositionSourceName): PositionSourceResult {
  return { source, kind: 'EMPTY' };
}

function failed(source: PositionSourceName): PositionSourceResult {
  return {
    source,
    kind: 'FAILED',
    reason: `${source} failed`,
    executionImpact: 'POSITION_QUERY_DEGRADED',
  };
}

function success(source: PositionSourceName, positions: NormalizedPosition[]): PositionSourceResult {
  return {
    source,
    kind: 'SUCCESS',
    positions,
  };
}

function readers(overrides: PositionSourceReaderMap = {}): PositionSourceReaderMap {
  const base: PositionSourceReaderMap = {};
  for (const source of getPositionSourcePriority()) {
    base[source] = vi.fn(() => empty(source));
  }
  return { ...base, ...overrides };
}

describe('positionSourceAggregator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Shadow sources before KIS live holdings and skips live fallback when Shadow has positions', async () => {
    const liveReader = vi.fn(() => empty('KISLiveHolding'));
    const aggregate = await aggregatePositionSourceResults({
      mode: 'SHADOW',
      readers: readers({
        ShadowPositionLedger: vi.fn(() => success('ShadowPositionLedger', [position()])),
        KISLiveHolding: liveReader,
      }),
    });

    expect(aggregate.positions).toHaveLength(1);
    expect(aggregate.positions[0]?.sourceTag).toBe('SHADOW');
    expect(liveReader).not.toHaveBeenCalled();
    expect(aggregate.results.at(-1)).toMatchObject({
      source: 'KISLiveHolding',
      kind: 'EMPTY',
      diagnostics: { skipped: 'SHADOW_SOURCE_AVAILABLE' },
    });
  });

  it('keeps Shadow holdings even when live holdings are empty', async () => {
    const aggregate = await aggregatePositionSourceResults({
      mode: 'SHADOW',
      includeLiveFallback: true,
      readers: readers({
        ShadowTradeRepo: vi.fn(() => success('ShadowTradeRepo', [position({ source: 'ShadowTradeRepo', id: 'shadow-2' })])),
        KISLiveHolding: vi.fn(() => empty('KISLiveHolding')),
      }),
    });

    expect(aggregate.positions).toEqual([
      expect.objectContaining({
        id: 'shadow-2',
        sourceTag: 'SHADOW',
      }),
    ]);
    expect(aggregate.allFailed).toBe(false);
  });

  it('records partial source failures without dropping successful positions', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const aggregate = await aggregatePositionSourceResults({
      mode: 'SHADOW',
      readers: readers({
        ShadowPositionLedger: vi.fn(() => failed('ShadowPositionLedger')),
        VirtualAccount: vi.fn(() => success('VirtualAccount', [
          position({
            id: 'virtual-1',
            source: 'VirtualAccount',
            sourceTag: 'VIRTUAL',
          }),
        ])),
      }),
    });

    expect(aggregate.positions).toHaveLength(1);
    expect(aggregate.hasFailure).toBe(true);
    expect(aggregate.allFailed).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_POSITION_QUERY_DEGRADED]'),
      expect.objectContaining({ code: 'P0_POSITION_QUERY_DEGRADED' }),
    );
  });

  it('marks the aggregate as failed only when every source fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const allFailedReaders: PositionSourceReaderMap = {};
    for (const source of getPositionSourcePriority()) {
      allFailedReaders[source] = vi.fn(() => failed(source));
    }

    const aggregate = await aggregatePositionSourceResults({
      mode: 'LIVE',
      readers: allFailedReaders,
    });

    expect(aggregate.positions).toEqual([]);
    expect(aggregate.hasFailure).toBe(true);
    expect(aggregate.allFailed).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_POSITION_QUERY_DEGRADED]'),
      expect.objectContaining({ code: 'P0_POSITION_QUERY_DEGRADED' }),
    );
  });
});
