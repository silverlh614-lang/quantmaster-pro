// @responsibility Yahoo historical snapshot warmup helper tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/egressGuard.js', () => ({
  guardedFetch: vi.fn(),
}));

vi.mock('../persistence/offHoursSnapshotRepo.js', () => ({
  setSnapshot: vi.fn(),
}));

const { fetchAndStoreYahooHistoricalSnapshot } = await import('./yahooHistoricalSnapshotWarmup.js');
const { guardedFetch } = await import('../utils/egressGuard.js');
const { setSnapshot } = await import('../persistence/offHoursSnapshotRepo.js');

const mockedGuardedFetch = vi.mocked(guardedFetch);
const mockedSetSnapshot = vi.mocked(setSnapshot);

function yahooBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chart: {
      result: [{
        meta: { symbol: '005930.KS' },
        timestamp: [1715212800],
        indicators: { quote: [{ close: [70000] }] },
      }],
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

describe('fetchAndStoreYahooHistoricalSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses query2 first and does not call query1 when query2 succeeds', async () => {
    const body = yahooBody();
    mockedGuardedFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchAndStoreYahooHistoricalSnapshot({
      symbol: '005930.KS',
      range: '1y',
      interval: '1d',
      cacheKey: 'custom-key',
    });

    expect(result).toEqual({
      body: JSON.stringify(body),
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
    expect(mockedGuardedFetch).toHaveBeenCalledTimes(1);
    expect(String(mockedGuardedFetch.mock.calls[0][0])).toContain('https://query2.finance.yahoo.com/');
    expect(String(mockedGuardedFetch.mock.calls[0][0])).toContain('/005930.KS?range=1y&interval=1d');
  });

  it('falls back to query1 when query2 fails and returns success', async () => {
    const body = yahooBody();
    mockedGuardedFetch
      .mockResolvedValueOnce(new Response('query2 down', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchAndStoreYahooHistoricalSnapshot({
      symbol: '005930.KS',
      range: '1y',
      interval: '1d',
      cacheKey: 'fallback-key',
    });

    expect(result.status).toBe(200);
    expect(mockedGuardedFetch).toHaveBeenCalledTimes(2);
    expect(String(mockedGuardedFetch.mock.calls[0][0])).toContain('query2.finance.yahoo.com');
    expect(String(mockedGuardedFetch.mock.calls[1][0])).toContain('query1.finance.yahoo.com');
  });

  it('stores a snapshot with body, contentType, and fetchedAt on success', async () => {
    const body = yahooBody();
    mockedGuardedFetch.mockResolvedValueOnce(jsonResponse(body));

    await fetchAndStoreYahooHistoricalSnapshot({
      symbol: '005930.KS',
      range: '1y',
      interval: '1d',
      cacheKey: 'snapshot-key',
    });

    expect(mockedSetSnapshot).toHaveBeenCalledTimes(1);
    expect(mockedSetSnapshot).toHaveBeenCalledWith('snapshot-key', {
      body: JSON.stringify(body),
      contentType: 'application/json; charset=utf-8',
      fetchedAt: expect.any(Number),
    });
  });

  it('does not store a snapshot when Yahoo returns 404', async () => {
    mockedGuardedFetch.mockResolvedValueOnce(jsonResponse({ chart: { error: { code: 'Not Found' } } }, 404));

    const result = await fetchAndStoreYahooHistoricalSnapshot({
      symbol: 'NOPE.KS',
      range: '1y',
      interval: '1d',
      cacheKey: 'missing-key',
    });

    expect(result.status).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Symbol not found', symbol: 'NOPE.KS' });
    expect(mockedSetSnapshot).not.toHaveBeenCalled();
  });

  it('returns 502 when Yahoo has no result and reports chart errors', async () => {
    mockedGuardedFetch
      .mockResolvedValueOnce(jsonResponse({ chart: { error: { description: 'query2 error' } } }))
      .mockResolvedValueOnce(jsonResponse({ chart: { error: { description: 'query1 error' } } }));

    const result = await fetchAndStoreYahooHistoricalSnapshot({
      symbol: '005930.KS',
      range: '1y',
      interval: '1d',
      cacheKey: 'error-key',
    });

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toMatchObject({
      error: 'Failed to fetch data from Yahoo after multiple attempts',
      details: 'Unknown error',
      symbol: '005930.KS',
    });
    expect(mockedSetSnapshot).not.toHaveBeenCalled();
  });

  it('uses symbol, capped range, and interval as the default cache key', async () => {
    const body = yahooBody();
    mockedGuardedFetch.mockResolvedValueOnce(jsonResponse(body));

    await fetchAndStoreYahooHistoricalSnapshot({
      symbol: '005930.KS',
      range: '2y',
      interval: '1d',
    });

    expect(mockedSetSnapshot).toHaveBeenCalledWith('005930.KS:1y:1d', expect.any(Object));
  });
});
