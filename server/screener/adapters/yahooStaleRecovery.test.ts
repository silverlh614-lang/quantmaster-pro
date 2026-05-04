import { describe, expect, it, vi } from 'vitest';
import {
  recoverYahooStaleQuoteWithKis,
  resolveYahooStaleRecoveryState,
  shouldExcludeFromMomentumByYahooStale,
} from './yahooStaleRecovery';
import type { YahooQuoteExtended } from './yahooQuoteAdapter';

function quote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 10000,
    dayOpen: 9900,
    prevClose: 9800,
    changePercent: 2,
    volume: 100000,
    avgVolume: 90000,
    ma5: 10000,
    ma20: 9800,
    ma60: 9500,
    high5d: 10500,
    high20d: 11000,
    high60d: 12000,
    atr: 100,
    atr20avg: 120,
    per: 10,
    rsi14: 55,
    macd: 1,
    macdSignal: 0.5,
    macdHistogram: 0.5,
    rsi5dAgo: 50,
    weeklyRSI: 55,
    ma60TrendUp: true,
    macd5dHistAgo: 0.1,
    return5d: 3,
    return20d: 7,
    bbWidthCurrent: 0.1,
    bbWidth20dAvg: 0.12,
    vol5dAvg: 80000,
    vol20dAvg: 90000,
    atr5d: 90,
    monthlyAboveEMA12: true,
    monthlyEMARising: true,
    weeklyAboveCloud: true,
    weeklyLaggingSpanUp: true,
    dailyVolumeDrying: false,
    isHighRisk: false,
    dataQuality: 'OK',
    ...overrides,
  };
}

describe('yahooStaleRecovery', () => {
  it('keeps OK quotes unchanged', () => {
    const q = quote();
    const result = resolveYahooStaleRecoveryState(q);
    expect(result.status).toBe('OK');
    expect(result.quote).toBe(q);
    expect(shouldExcludeFromMomentumByYahooStale(result)).toBe(false);
  });

  it('marks null quote as FETCH_FAIL and excludes it', () => {
    const result = resolveYahooStaleRecoveryState(null);
    expect(result.status).toBe('FETCH_FAIL');
    expect(shouldExcludeFromMomentumByYahooStale(result)).toBe(true);
  });

  it('does not KIS-recover return20d stale because intraday KIS cannot repair momentum history', async () => {
    const q = quote({ dataQuality: 'STALE_BASE', dataQualityIssues: ['return20d'], return20d: 0 });
    const result = await recoverYahooStaleQuoteWithKis('005930', q, {
      fetchKis: vi.fn(async () => ({ price: 10100, prevClose: 10000 } as never)),
    });
    expect(result.status).toBe('STALE_UNRECOVERED');
    expect(result.unrecoveredIssues).toEqual(['return20d']);
    expect(shouldExcludeFromMomentumByYahooStale(result)).toBe(true);
  });

  it('recovers only stale changePercent from KIS intraday when sane', async () => {
    const q = quote({ dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'], changePercent: 0 });
    const result = await recoverYahooStaleQuoteWithKis('005930', q, {
      fetchKis: vi.fn(async () => ({ price: 10300, prevClose: 10000 } as never)),
    });
    expect(result.status).toBe('KIS_CHANGE_PERCENT_RECOVERED');
    expect(result.quote?.changePercent).toBe(3);
    expect(result.quote?.dataQuality).toBe('OK');
    expect(result.recoveredFields).toEqual(['changePercent']);
    expect(shouldExcludeFromMomentumByYahooStale(result)).toBe(false);
  });

  it('rejects KIS fallback if intraday change exceeds sanity', async () => {
    const q = quote({ dataQuality: 'STALE_BASE', dataQualityIssues: ['changePercent'], changePercent: 0 });
    const result = await recoverYahooStaleQuoteWithKis('005930', q, {
      fetchKis: vi.fn(async () => ({ price: 15000, prevClose: 10000 } as never)),
    });
    expect(result.status).toBe('STALE_UNRECOVERED');
    expect(result.note).toContain('±30%');
    expect(shouldExcludeFromMomentumByYahooStale(result)).toBe(true);
  });
});
