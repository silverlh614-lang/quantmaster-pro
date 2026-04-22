import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function abortError(message = 'This operation was aborted'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fredClient regression', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    process.env.FRED_API_KEY = 'test-key';
    delete process.env.FRED_API_DISABLED;
    delete process.env.FRED_API_BASE;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.FRED_API_KEY;
    delete process.env.FRED_API_DISABLED;
    delete process.env.FRED_API_BASE;
  });

  it('retries once after timeout and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(
        jsonResponse({
          observations: [{ value: '4.25' }],
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchFredLatest } = await import('./fredClient.js');

    const promise = fetchFredLatest('SOFR');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(4.25);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[FRED-TIMEOUT] SOFR: This operation was aborted (retrying)'),
    );
  });

  it('caches null responses and avoids refetch within ttl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        observations: [{ value: '.' }, { value: '.' }],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const { fetchFredLatest } = await import('./fredClient.js');

    await expect(fetchFredLatest('STLFSI4')).resolves.toBeNull();
    await expect(fetchFredLatest('STLFSI4')).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses cached series values across snapshot calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        observations: [{ value: '1.23' }],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const { fetchFredSnapshot } = await import('./fredClient.js');

    await expect(fetchFredSnapshot()).resolves.toMatchObject({
      yieldCurve10y2y: 1.23,
      hySpreadPct: 1.23,
      sofrPct: 1.23,
      financialStress: 1.23,
      wtiCrude: 1.23,
    });
    await expect(fetchFredSnapshot()).resolves.toMatchObject({
      yieldCurve10y2y: 1.23,
      hySpreadPct: 1.23,
      sofrPct: 1.23,
      financialStress: 1.23,
      wtiCrude: 1.23,
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
