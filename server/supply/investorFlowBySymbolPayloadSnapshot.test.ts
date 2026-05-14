// @responsibility SUPPLY-BYSYMBOL-PAYLOAD-STORE-FIX-001 snapshot persistence regression tests.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSupplyBySymbolPayloadSnapshot,
  clearSupplyBySymbolPayloadSnapshotsForTest,
  lookupSupplyBySymbolPayloadSnapshot,
  rememberSupplyBySymbolPayloadSnapshot,
} from './investorFlowBySymbolPayloadSnapshot.js';

beforeEach(() => {
  clearSupplyBySymbolPayloadSnapshotsForTest();
});

describe('supply by-symbol payload snapshot gateSemanticFlatRow persistence', () => {
  it('stores an entry when only gateSemanticFlatRow is available', () => {
    const snapshot = buildSupplyBySymbolPayloadSnapshot({
      tradeDate: '2026-05-14',
      capturedAt: '2026-05-14T04:30:00.000Z',
      routeResult: {
        selectedProvider: 'KIS_API',
        bySymbol: {
          '005930': {
            code: '005930',
            providerScope: 'SYMBOL_LEVEL',
            gateSemanticFlatRow: {
              foreignNetBuy: 0,
              institutionNetBuy: 1200,
              programNetBuy: null,
            },
          },
        },
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.bySymbol['005930']?.gateSemanticFlatRow).toEqual({
      foreignNetBuy: 0,
      institutionNetBuy: 1200,
      programNetBuy: null,
    });
    expect(snapshot?.bySymbol['005930']?.usableForLive).toBe(false);
    expect(snapshot?.bySymbol['005930']?.executionImpact).toBe('NONE');
  });

  it('treats zero net-buy fields as valid instead of missing', () => {
    const snapshot = buildSupplyBySymbolPayloadSnapshot({
      tradeDate: '2026-05-14',
      capturedAt: '2026-05-14T04:30:00.000Z',
      routeResult: {
        selectedProvider: 'KIS_API',
        bySymbol: {
          '000660': {
            code: '000660',
            providerScope: 'SYMBOL_LEVEL',
            gateSemanticFlatRow: {
              foreignNetBuy: 0,
              institutionNetBuy: 0,
              programNetBuy: 100,
            },
          },
        },
      },
    });

    expect(snapshot?.bySymbol['000660']?.gateSemanticFlatRow).toEqual({
      foreignNetBuy: 0,
      institutionNetBuy: 0,
      programNetBuy: 100,
    });
  });

  it('restores persisted gateSemanticFlatRow through lookup', () => {
    rememberSupplyBySymbolPayloadSnapshot({
      tradeDate: '2026-05-14',
      capturedAt: '2026-05-14T04:30:00.000Z',
      routeResult: {
        selectedProvider: 'KIS_API',
        bySymbol: {
          '123456': {
            code: '123456',
            providerScope: 'SYMBOL_LEVEL',
            gateSemanticFlatRow: {
              foreignNetBuy: 500,
              institutionNetBuy: -100,
              programNetBuy: null,
            },
          },
        },
      },
    });

    const lookup = lookupSupplyBySymbolPayloadSnapshot({
      symbol: '123456',
      tradeDate: '2026-05-14',
      now: '2026-05-14T05:00:00.000Z',
      maxAgeMinutes: 240,
    });

    expect(lookup.reason).toBe('FOUND');
    expect(lookup.payload?.gateSemanticFlatRow).toEqual({
      foreignNetBuy: 500,
      institutionNetBuy: -100,
      programNetBuy: null,
    });
    expect(lookup.liveExecutionAllowed).toBe(false);
    expect(lookup.executionImpact).toBe('NONE');
  });
});
