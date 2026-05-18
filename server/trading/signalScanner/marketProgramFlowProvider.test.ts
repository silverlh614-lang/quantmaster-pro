import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logVisibilityEvent: vi.fn(),
}));

const NOW = new Date('2026-05-18T02:00:00.000Z');
let tmpDir: string;
let originalPersistDir: string | undefined;

beforeEach(() => {
  vi.resetModules();
  originalPersistDir = process.env.PERSIST_DATA_DIR;
  tmpDir = mkdtempSync(join(tmpdir(), 'market-program-flow-provider-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (originalPersistDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalPersistDir;
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('resolveMarketProgramFlow diagnostic provider pipeline', () => {
  it('parses KIS alias fields and remains diagnostic-only', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => ({
        programNetBuyQty: null,
        programNetBuyAmount: null,
        programArbitrageNetBuy: 200,
        programNonArbitrageNetBuy: 1300,
        fetchedAt: NOW.toISOString(),
        source: 'KIS_API',
        rawFieldKeys: ['totalProgramNetBuyAmount'],
        totalProgramNetBuyAmount: '1500',
      } as never),
      fetchKrx: async () => { throw new Error('KRX should not be called'); },
    });

    expect(result.available).toBe(true);
    expect(result.source).toBe('KIS_API');
    expect(result.netBuyAmount).toBe(1500);
    expect(result.marketSignal).toBe('BULLISH');
    expect(result.parsedFieldName).toBe('totalProgramNetBuyAmount');
    expect(result.kisStatus).toBe('PARSED');
    expect(result.krxFallbackAttempted).toBe(false);
    expect(result.executionImpact).toBe('NONE');
    expect(result.programFlowUsedForLiveDecision).toBe(false);
    expect(result.passiveProxyUsedForLiveDecision).toBe(false);
    expect(result.programPenaltyApplied).toBe(false);
  }, 15000);

  it('tries KRX and cache after accepted-empty KIS without marking accepted-empty as provider issue', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => null,
      fetchKrx: async () => null,
    });

    expect(result.available).toBe(false);
    expect(result.source).toBe('NONE');
    expect(result.providerIssue).toBe(false);
    expect(result.marketProgramDataStatus).toBe('ACCEPTED_EMPTY');
    expect(result.kisAttempted).toBe(true);
    expect(result.kisStatus).toBe('ACCEPTED_EMPTY');
    expect(result.krxFallbackAttempted).toBe(true);
    expect(result.krxFallbackStatus).toBe('EMPTY');
    expect(result.cacheFallbackAttempted).toBe(true);
    expect(result.cacheStatus).toBe('MISS');
    expect(result.breakPoint).toBe('KIS_ACCEPTED_EMPTY_KRX_EMPTY_CACHE_MISS');
  }, 15000);

  it('uses KRX fallback and saves a reusable cache snapshot', async () => {
    const { resolveMarketProgramFlow } = await import('./marketProgramFlowProvider.js');
    const result = await resolveMarketProgramFlow({
      now: NOW,
      fetchKis: async () => null,
      fetchKrx: async () => ({
        kospi: null,
        kosdaq: null,
        totalProgramNet: -1200,
        arbitrageNet: -300,
        nonArbitrageNet: -900,
        timestamp: NOW.toISOString(),
        confidence: 'PARTIAL',
        fetchedAt: NOW.toISOString(),
        endpoint: 'test',
        bld: 'test',
        marketsAttempted: ['KOSPI'],
        marketsSucceeded: ['KOSPI'],
      }),
    });

    expect(result.available).toBe(true);
    expect(result.source).toBe('KRX_FALLBACK');
    expect(result.netBuyAmount).toBe(-1200);
    expect(result.marketSignal).toBe('BEARISH');
    expect(result.krxFallbackStatus).toBe('SUCCESS');

    const cached = await resolveMarketProgramFlow({
      now: new Date('2026-05-18T02:05:00.000Z'),
      fetchKis: async () => null,
      fetchKrx: async () => null,
    });
    expect(cached.source).toBe('CACHE');
    expect(cached.cacheStatus).toBe('HIT');
    expect(cached.netBuyAmount).toBe(-1200);
  }, 15000);
});
