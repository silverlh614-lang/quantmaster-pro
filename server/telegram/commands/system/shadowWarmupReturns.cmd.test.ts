// @responsibility shadowWarmupReturns command regression tests.

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShadowLearningOnlySignal } from '../../../trading/shadowLearningOnlyScan.js';

vi.mock('../../../persistence/shadowLearningOnlySignalRepo.js', () => ({
  loadShadowLearningOnlySignals: vi.fn(),
}));

vi.mock('../../../market/yahooHistoricalSnapshotWarmup.js', () => ({
  fetchAndStoreYahooHistoricalSnapshot: vi.fn(),
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

import { loadShadowLearningOnlySignals } from '../../../persistence/shadowLearningOnlySignalRepo.js';
import { fetchAndStoreYahooHistoricalSnapshot } from '../../../market/yahooHistoricalSnapshotWarmup.js';
import shadowWarmupReturns, { parseShadowWarmupReturnsLimit } from './shadowWarmupReturns.cmd.js';

const mockedLoadSignals = vi.mocked(loadShadowLearningOnlySignals);
const mockedFetch = vi.mocked(fetchAndStoreYahooHistoricalSnapshot);

function signal(overrides: Partial<ShadowLearningOnlySignal> = {}): ShadowLearningOnlySignal {
  return {
    symbol: overrides.symbol ?? '005930',
    signalDate: overrides.signalDate ?? '2026-05-08',
    blockedReason: overrides.blockedReason ?? 'DATA_STARVED',
    learningOnly: true,
    executionImpact: 'NONE',
    wouldHaveBought: overrides.wouldHaveBought ?? true,
    hypotheticalEntryPrice: overrides.hypotheticalEntryPrice ?? 10000,
    hypotheticalStopLoss: overrides.hypotheticalStopLoss ?? 9200,
    hypotheticalTargetPrice: overrides.hypotheticalTargetPrice ?? 12000,
    signalGrade: overrides.signalGrade ?? 'BUY',
    gateScore: overrides.gateScore ?? 7,
    regime: overrides.regime ?? 'R2_BULL',
    macroBlockReason: overrides.macroBlockReason ?? 'test',
    dataQualityStatus: overrides.dataQualityStatus ?? 'OK',
    ...overrides,
  };
}

function fullyResolved(symbol = '111111'): ShadowLearningOnlySignal {
  return signal({
    symbol,
    futureReturn1d: 0.01,
    futureReturn3d: 0.02,
    futureReturn5d: 0.03,
    futureReturn20d: 0.04,
  });
}

function makeReply() {
  return vi.fn().mockResolvedValue(undefined);
}

describe('shadowWarmupReturns.cmd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue({
      body: '{}',
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
  });

  it('empty ledger reports zero counts', async () => {
    mockedLoadSignals.mockReturnValue([]);
    const reply = makeReply();

    await shadowWarmupReturns.execute({ args: [], reply });

    expect(mockedFetch).not.toHaveBeenCalled();
    const msg = reply.mock.calls[0][0] as string;
    expect(msg).toContain('Shadow Return Warmup');
    expect(msg).toContain('candidateSignals: 0');
    expect(msg).toContain('targetSymbols: 0');
    expect(msg).toContain('attemptedRequests: 0');
  });

  it('excludes fully resolved signals, dedupes symbols, applies limit, and expands KRX suffix candidates only', async () => {
    mockedLoadSignals.mockReturnValue([
      fullyResolved(),
      signal({ symbol: '336370' }),
      signal({ symbol: '336370', signalDate: '2026-05-09' }),
      signal({ symbol: '061970' }),
      signal({ symbol: '123456' }),
    ]);
    const reply = makeReply();

    await shadowWarmupReturns.execute({ args: ['2'], reply });

    expect(mockedFetch).toHaveBeenCalledTimes(16);
    expect(mockedFetch).toHaveBeenNthCalledWith(1, {
      symbol: '336370.KS',
      range: '5d',
      interval: '1d',
      cacheKey: '336370.KS:5d:1d',
      realtimeTag: 'HISTORICAL',
    });
    expect(mockedFetch).toHaveBeenCalledWith({
      symbol: '336370.KQ',
      range: '1mo',
      interval: '1d',
      cacheKey: '336370.KQ:1mo:1d',
      realtimeTag: 'HISTORICAL',
    });
    expect(mockedFetch).toHaveBeenCalledWith({
      symbol: '061970.KQ',
      range: '1y',
      interval: '1d',
      cacheKey: '061970.KQ:1y:1d',
      realtimeTag: 'HISTORICAL',
    });
    expect(mockedFetch).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: '336370' }));
    expect(mockedFetch).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: '061970' }));
    expect(mockedFetch).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: '123456.KS' }));

    const msg = reply.mock.calls[0][0] as string;
    expect(msg).toContain('candidateSignals: 5');
    expect(msg).toContain('targetSymbols: 3');
    expect(msg).toContain('attemptedSymbols: 2');
    expect(msg).toContain('attemptedRequests: 16');
    expect(msg).toContain('storedSnapshots: 16');
    expect(msg).toContain('skippedAlreadyResolved: 1');
    expect(msg).toContain('336370.KS:5d:1d');
  });

  it('counts status 200, 404, 502 and reports sample failures with compact details', async () => {
    mockedLoadSignals.mockReturnValue([signal({ symbol: '061970' })]);
    let callIndex = 0;
    mockedFetch.mockImplementation(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return { body: '{}', contentType: 'application/json; charset=utf-8', status: 200 };
      }
      if (callIndex === 2) {
        return {
          body: JSON.stringify({ error: 'Symbol not found', details: 'not found detail' }),
          contentType: 'application/json; charset=utf-8',
          status: 404,
        };
      }
      return {
        body: JSON.stringify({ error: 'Failed to fetch data from Yahoo after multiple attempts', details: 'EGRESS_GUARD_BLOCKED sample detail' }),
        contentType: 'application/json; charset=utf-8',
        status: 502,
      };
    });
    const reply = makeReply();

    await shadowWarmupReturns.execute({ args: ['1'], reply });

    const msg = reply.mock.calls[0][0] as string;
    expect(msg).toContain('attemptedRequests: 8');
    expect(msg).toContain('storedSnapshots: 1');
    expect(msg).toContain('notFound: 1');
    expect(msg).toContain('failed: 6');
    expect(msg).toContain('sampleTargets:');
    expect(msg).toContain('sampleFailures:');
    expect(msg).toContain('061970.KS:1mo:1d:404:not found detail');
    expect(msg).toContain('061970.KS:3mo:1d:502:EGRESS_GUARD_BLOCKED sample detail');
  });

  it('keeps suffixed or non-six-digit symbols as-is', async () => {
    mockedLoadSignals.mockReturnValue([
      signal({ symbol: '005930.KS' }),
      signal({ symbol: 'ABC' }),
    ]);
    const reply = makeReply();

    await shadowWarmupReturns.execute({ args: ['2'], reply });

    expect(mockedFetch).toHaveBeenCalledTimes(8);
    expect(mockedFetch).toHaveBeenNthCalledWith(1, {
      symbol: '005930.KS',
      range: '5d',
      interval: '1d',
      cacheKey: '005930.KS:5d:1d',
      realtimeTag: 'HISTORICAL',
    });
    expect(mockedFetch).toHaveBeenCalledWith({
      symbol: 'ABC',
      range: '1y',
      interval: '1d',
      cacheKey: 'ABC:1y:1d',
      realtimeTag: 'HISTORICAL',
    });
  });

  it('parses limit with default and max clamp', () => {
    expect(parseShadowWarmupReturnsLimit([])).toBe(20);
    expect(parseShadowWarmupReturnsLimit(['0'])).toBe(1);
    expect(parseShadowWarmupReturnsLimit(['30'])).toBe(30);
    expect(parseShadowWarmupReturnsLimit(['999'])).toBe(50);
    expect(parseShadowWarmupReturnsLimit(['bad'])).toBe(20);
  });

  it('exposes command metadata and aliases', () => {
    expect(shadowWarmupReturns.name).toBe('/shadow_warmup_returns');
    expect(shadowWarmupReturns.aliases).toEqual(['/warmup_shadow_returns', '/shadow_return_warmup']);
    expect(shadowWarmupReturns.category).toBe('SYS');
    expect(shadowWarmupReturns.visibility).toBe('ADMIN');
    expect(shadowWarmupReturns.riskLevel).toBe(0);
  });

  it('does not import KIS or order paths', () => {
    const files = [
      'server/telegram/commands/system/shadowWarmupReturns.cmd.ts',
      'server/learning/shadowFutureReturnWarmupPlanner.ts',
    ];
    const src = files.map((file) => fs.readFileSync(path.join(process.cwd(), file), 'utf-8')).join('\n');

    expect(src).not.toMatch(/kisClient/);
    expect(src).not.toMatch(/placeKis/i);
    expect(src).not.toMatch(/orderExecutor/i);
    expect(src).not.toMatch(/buyPipeline/i);
  });
});
