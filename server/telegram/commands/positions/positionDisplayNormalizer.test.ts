import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizePositionDisplay, sourceTagForPositionSource } from './positionDisplayNormalizer.js';

describe('positionDisplayNormalizer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assigns SHADOW/LIVE/VIRTUAL/PAPER tags from source names', () => {
    expect(sourceTagForPositionSource('ShadowPositionRegistry')).toBe('SHADOW');
    expect(sourceTagForPositionSource('ShadowPositionLedger')).toBe('SHADOW');
    expect(sourceTagForPositionSource('ShadowTradeRepo')).toBe('SHADOW');
    expect(sourceTagForPositionSource('KISLiveHolding')).toBe('LIVE');
    expect(sourceTagForPositionSource('VirtualAccount')).toBe('VIRTUAL');
    expect(sourceTagForPositionSource('PaperTradeLedger')).toBe('PAPER');
  });

  it('normalizes a raw holding into a display-safe position', () => {
    const position = normalizePositionDisplay({
      source: 'KISLiveHolding',
      symbol: '5930',
      name: 'Samsung',
      qty: '3',
      avgPrice: '71000',
      currentPrice: '72500',
      unrealizedPnl: '4500',
      unrealizedPnlPct: '2.11',
    });

    expect(position).toMatchObject({
      symbol: '005930',
      name: 'Samsung',
      qty: 3,
      avgPrice: 71000,
      currentPrice: 72500,
      unrealizedPnl: 4500,
      unrealizedPnlPct: 2.11,
      sourceTag: 'LIVE',
      mode: 'LIVE',
      source: 'KISLiveHolding',
    });
  });

  it('emits P0_POSITION_DISPLAY_NORMALIZE_FAILED for invalid display input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(normalizePositionDisplay({
      source: 'ShadowPositionLedger',
      symbol: '',
      qty: 0,
    })).toBeNull();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_POSITION_DISPLAY_NORMALIZE_FAILED]'),
      expect.objectContaining({
        code: 'P0_POSITION_DISPLAY_NORMALIZE_FAILED',
      }),
    );
  });
});
