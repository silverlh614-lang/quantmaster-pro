import { describe, expect, it } from 'vitest';
import { formatYahooHistoricalRefresh, type YahooHistoricalRefreshResult } from './yahooHistoricalRefresh';

describe('yahooHistoricalRefresh', () => {
  it('formats failed refresh without treating it as zero', () => {
    const result: YahooHistoricalRefreshResult = {
      ok: false,
      symbol: '005930.KS',
      price: null,
      changePercent: null,
      return5d: null,
      return20d: null,
      latestAsOf: null,
      base5dAsOf: null,
      base20dAsOf: null,
      closeCount: 0,
      reason: 'FETCH_FAIL',
    };
    expect(formatYahooHistoricalRefresh(result)).toContain('refresh failed: FETCH_FAIL');
    expect(formatYahooHistoricalRefresh(result)).not.toContain('0.00%');
  });

  it('formats successful recomputed return fields', () => {
    const result: YahooHistoricalRefreshResult = {
      ok: true,
      symbol: '005930.KS',
      price: 100,
      changePercent: 1,
      return5d: 5,
      return20d: 10,
      latestAsOf: '2026-05-04T00:00:00.000Z',
      base5dAsOf: '2026-04-27T00:00:00.000Z',
      base20dAsOf: '2026-04-03T00:00:00.000Z',
      closeCount: 60,
    };
    const msg = formatYahooHistoricalRefresh(result);
    expect(msg).toContain('refresh OK');
    expect(msg).toContain('return20d=10.00%');
    expect(msg).toContain('base20d=2026-04-03T00:00:00.000Z');
  });
});
