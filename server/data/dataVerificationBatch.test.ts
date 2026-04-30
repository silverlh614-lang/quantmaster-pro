/**
 * @responsibility ADR-0128 dataVerificationBatch 회귀 테스트 — DISABLED skip / 빈 워치리스트 / 혼재 결과 / 텔레그램 dedupe
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _loadWatchlist = vi.fn<() => Array<{ code: string; name?: string }>>(() => []);
const _markDataQuarantine = vi.fn<(...args: unknown[]) => boolean>(() => true);
const _clearDataQuarantineMark = vi.fn<(...args: unknown[]) => boolean>(() => true);
const _recordVerificationFailure = vi.fn<(...args: unknown[]) => unknown>(() => ({ stockCode: '005930', consecutiveFailures: 1 }));
const _recordVerificationSuccess = vi.fn<(...args: unknown[]) => boolean>(() => true);
const _getManualReviewQueue = vi.fn<() => unknown[]>(() => []);
const _fetchKisIntraday = vi.fn<(code: string) => Promise<{ price: number; dayOpen: number; prevClose: number; volume: number } | null>>(
  async () => null,
);
const _sendTelegramAlert = vi.fn<(msg: string, opts?: Record<string, unknown>) => Promise<string>>(async () => 'sent');
const _safePctChangeStrict = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('../persistence/watchlistRepo.js', () => ({
  loadWatchlist: _loadWatchlist,
  markDataQuarantine: _markDataQuarantine,
  clearDataQuarantineMark: _clearDataQuarantineMark,
}));

vi.mock('../persistence/verificationQueueRepo.js', () => ({
  recordVerificationFailure: _recordVerificationFailure,
  recordVerificationSuccess: _recordVerificationSuccess,
  getManualReviewQueue: _getManualReviewQueue,
}));

vi.mock('../screener/adapters/kisQuoteAdapter.js', () => ({
  fetchKisIntraday: _fetchKisIntraday,
}));

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: _sendTelegramAlert,
}));

vi.mock('../utils/safePctChange.js', () => ({
  safePctChangeStrict: _safePctChangeStrict,
}));

const ENV_KEY = 'DATA_VERIFICATION_BATCH_DISABLED';

let runDataVerificationBatch: typeof import('./dataVerificationBatch.js').runDataVerificationBatch;

beforeEach(async () => {
  delete process.env[ENV_KEY];
  vi.resetModules();
  const mod = await import('./dataVerificationBatch.js');
  runDataVerificationBatch = mod.runDataVerificationBatch;

  _loadWatchlist.mockReset();
  _loadWatchlist.mockReturnValue([]);
  _markDataQuarantine.mockReset();
  _markDataQuarantine.mockReturnValue(true);
  _clearDataQuarantineMark.mockReset();
  _clearDataQuarantineMark.mockReturnValue(true);
  _recordVerificationFailure.mockReset();
  _recordVerificationFailure.mockReturnValue({ stockCode: '005930', consecutiveFailures: 1 });
  _recordVerificationSuccess.mockReset();
  _recordVerificationSuccess.mockReturnValue(true);
  _getManualReviewQueue.mockReset();
  _getManualReviewQueue.mockReturnValue([]);
  _fetchKisIntraday.mockReset();
  _sendTelegramAlert.mockReset();
  _sendTelegramAlert.mockResolvedValue('sent');
  _safePctChangeStrict.mockReset();
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('runDataVerificationBatch — ENV / 빈 워치리스트 skip', () => {
  it('DATA_VERIFICATION_BATCH_DISABLED=true → skipped reason=DISABLED, KIS 호출 0건', async () => {
    process.env[ENV_KEY] = 'true';
    const result = await runDataVerificationBatch();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('DISABLED');
    expect(_loadWatchlist).not.toHaveBeenCalled();
    expect(_fetchKisIntraday).not.toHaveBeenCalled();
    expect(_sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('빈 워치리스트 → skipped reason=EMPTY_WATCHLIST', async () => {
    _loadWatchlist.mockReturnValue([]);
    const result = await runDataVerificationBatch();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('EMPTY_WATCHLIST');
    expect(_fetchKisIntraday).not.toHaveBeenCalled();
  });
});

describe('runDataVerificationBatch — OK + 실패 혼재', () => {
  it('OK 1건 + 실패 1건 → success/failure record 호출 + 격리 마커 부착', async () => {
    _loadWatchlist.mockReturnValue([
      { code: '005930', name: '삼성전자' },
      { code: '189300', name: '인텔리안테크' },
    ]);

    // 005930 → KIS 정상 + sanity OK
    // 189300 → KIS 정상 + sanity 위반 (STALE_BASE)
    _fetchKisIntraday
      .mockResolvedValueOnce({ price: 70000, dayOpen: 70100, prevClose: 70200, volume: 1000 })
      .mockResolvedValueOnce({ price: 11500, dayOpen: 11400, prevClose: 28000, volume: 500 });

    _safePctChangeStrict
      .mockReturnValueOnce({
        ok: true, status: 'OK', pct: -0.28, current: 70000, base: 70200, source: 'KIS_DAILY',
        context: 'dataVerificationBatch:005930', reason: '[ctx] OK',
        blockTrading: false, blockDriftUpdate: false, blockSizing: false,
      })
      .mockReturnValueOnce({
        ok: false, status: 'STALE_BASE_OR_SPLIT_ADJUSTMENT', pct: null,
        current: 11500, base: 28000, source: 'KIS_DAILY',
        context: 'dataVerificationBatch:189300',
        reason: '[ctx] sanity violation 58.93%',
        blockTrading: true, blockDriftUpdate: true, blockSizing: true,
      });

    const result = await runDataVerificationBatch();

    expect(result.skipped).toBe(false);
    expect(result.total).toBe(2);
    expect(result.ok).toBe(1);
    expect(result.failed).toBe(1);

    expect(_recordVerificationSuccess).toHaveBeenCalledWith('005930', expect.any(Date));
    expect(_clearDataQuarantineMark).toHaveBeenCalledWith('005930');

    expect(_recordVerificationFailure).toHaveBeenCalledOnce();
    expect(_recordVerificationFailure.mock.calls[0]?.[0]).toBe('189300');
    expect(_markDataQuarantine).toHaveBeenCalledOnce();
    expect(_markDataQuarantine.mock.calls[0]?.[0]).toBe('189300');
  });

  it('KIS quote null → KIS_QUOTE_NULL reason 으로 failure record', async () => {
    _loadWatchlist.mockReturnValue([{ code: '005930', name: '삼성전자' }]);
    _fetchKisIntraday.mockResolvedValueOnce(null);

    const result = await runDataVerificationBatch();
    expect(result.failed).toBe(1);
    expect(_recordVerificationFailure.mock.calls[0]?.[1]).toBe('KIS_QUOTE_NULL');
    // dataQuality 미부착 (markDataQuarantine 미호출)
    expect(_markDataQuarantine).not.toHaveBeenCalled();
  });

  it('KIS throw → KIS_ERROR reason — 다른 종목 차단 안 함', async () => {
    _loadWatchlist.mockReturnValue([
      { code: '005930' },
      { code: '189300' },
    ]);
    _fetchKisIntraday
      .mockRejectedValueOnce(new Error('회로차단'))
      .mockResolvedValueOnce({ price: 100, dayOpen: 100, prevClose: 100, volume: 1 });
    _safePctChangeStrict.mockReturnValueOnce({
      ok: true, status: 'OK', pct: 0, current: 100, base: 100, source: 'KIS_DAILY',
      context: '', reason: '', blockTrading: false, blockDriftUpdate: false, blockSizing: false,
    });

    const result = await runDataVerificationBatch();
    expect(result.total).toBe(2);
    expect(result.ok).toBe(1);
    expect(result.failed).toBe(1);
    expect(_recordVerificationFailure.mock.calls[0]?.[1]).toMatch(/^KIS_ERROR:/);
  });
});

describe('runDataVerificationBatch — 텔레그램 dedupe', () => {
  it('failed≥1 시 텔레그램 발송 + dedupeKey 일자별 24h cooldown', async () => {
    _loadWatchlist.mockReturnValue([{ code: '005930' }]);
    _fetchKisIntraday.mockResolvedValueOnce(null);

    const now = new Date('2026-04-30T07:30:00Z'); // KST 16:30
    await runDataVerificationBatch(now);

    expect(_sendTelegramAlert).toHaveBeenCalledOnce();
    const [msg, opts] = _sendTelegramAlert.mock.calls[0]!;
    expect(msg).toContain('Data Verification Batch');
    expect(msg).toContain('실패 1');
    expect(opts).toMatchObject({
      priority: 'HIGH',
      dedupeKey: expect.stringContaining('data_verification_batch:'),
      cooldownMs: 24 * 60 * 60 * 1000,
      category: 'analysis_meta',
    });
  });

  it('failed=0 시 텔레그램 silent (발송 안 함)', async () => {
    _loadWatchlist.mockReturnValue([{ code: '005930' }]);
    _fetchKisIntraday.mockResolvedValueOnce({ price: 100, dayOpen: 100, prevClose: 100, volume: 1 });
    _safePctChangeStrict.mockReturnValueOnce({
      ok: true, status: 'OK', pct: 0, current: 100, base: 100, source: 'KIS_DAILY',
      context: '', reason: '', blockTrading: false, blockDriftUpdate: false, blockSizing: false,
    });

    await runDataVerificationBatch();
    expect(_sendTelegramAlert).not.toHaveBeenCalled();
  });
});
