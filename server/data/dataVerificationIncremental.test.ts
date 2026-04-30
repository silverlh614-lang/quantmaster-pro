/**
 * @responsibility ADR-0128 verifyStockIncremental 회귀 테스트 — 6 분기 (QUEUED/DROPPED/cooldown/FRESH OK/FRESH FAIL/KIS throw)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _loadVerificationQueue = vi.fn<() => Array<{
  stockCode: string;
  consecutiveFailures: number;
  firstFailedAt: string;
  lastFailedAt: string;
  lastFailureReason: string;
  nextRetryAt: string;
  manualReviewState: 'NONE' | 'QUEUED' | 'APPROVED' | 'DROPPED';
  manualReviewedAt?: string;
  manualReviewedBy?: string;
}>>(() => []);
const _recordVerificationFailure = vi.fn();
const _recordVerificationSuccess = vi.fn();
const _fetchKisIntraday = vi.fn();
const _safePctChangeStrict = vi.fn();

vi.mock('../persistence/verificationQueueRepo.js', () => ({
  loadVerificationQueue: _loadVerificationQueue,
  recordVerificationFailure: _recordVerificationFailure,
  recordVerificationSuccess: _recordVerificationSuccess,
}));

vi.mock('../screener/adapters/kisQuoteAdapter.js', () => ({
  fetchKisIntraday: _fetchKisIntraday,
}));

vi.mock('../utils/safePctChange.js', () => ({
  safePctChangeStrict: _safePctChangeStrict,
}));

const ENV_KEY = 'VERIFICATION_QUEUE_DISABLED';

let verifyStockIncremental: typeof import('./dataVerificationIncremental.js').verifyStockIncremental;

beforeEach(async () => {
  delete process.env[ENV_KEY];
  vi.resetModules();
  const mod = await import('./dataVerificationIncremental.js');
  verifyStockIncremental = mod.verifyStockIncremental;

  _loadVerificationQueue.mockReset();
  _loadVerificationQueue.mockReturnValue([]);
  _recordVerificationFailure.mockReset();
  _recordVerificationSuccess.mockReset();
  _fetchKisIntraday.mockReset();
  _safePctChangeStrict.mockReset();
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('verifyStockIncremental — 캐시 분기', () => {
  it('manualReviewState=QUEUED → CACHE_MANUAL_REVIEW + DataHoldAction (KIS 호출 0건)', async () => {
    _loadVerificationQueue.mockReturnValueOnce([{
      stockCode: '005930',
      consecutiveFailures: 3,
      firstFailedAt: '2026-04-28T16:30:00Z',
      lastFailedAt: '2026-04-30T16:30:00Z',
      lastFailureReason: 'STALE_BASE',
      nextRetryAt: '2026-05-01T16:30:00Z',
      manualReviewState: 'QUEUED',
    }]);

    const result = await verifyStockIncremental('005930');
    expect(result.verified).toBe(false);
    expect(result.source).toBe('CACHE_MANUAL_REVIEW');
    expect(result.reason).toBe('manual_review_pending');
    expect(result.action?.blockBuy).toBe(true);
    expect(result.action?.blockSell).toBe(false); // BUY_CANDIDATE — exit 보존
    expect(_fetchKisIntraday).not.toHaveBeenCalled();
  });

  it('manualReviewState=DROPPED → CACHE_MANUAL_REVIEW + reason=manually_dropped', async () => {
    _loadVerificationQueue.mockReturnValueOnce([{
      stockCode: '005930',
      consecutiveFailures: 5,
      firstFailedAt: '2026-04-25T16:30:00Z',
      lastFailedAt: '2026-04-30T16:30:00Z',
      lastFailureReason: 'STALE_BASE',
      nextRetryAt: '2026-05-01T16:30:00Z',
      manualReviewState: 'DROPPED',
    }]);

    const result = await verifyStockIncremental('005930', 'WATCHLIST');
    expect(result.verified).toBe(false);
    expect(result.source).toBe('CACHE_MANUAL_REVIEW');
    expect(result.reason).toBe('manually_dropped');
    // WATCHLIST 역할 → uiMarker=PENDING_VERIFICATION
    expect(result.action?.uiMarker).toBe('PENDING_VERIFICATION');
    expect(_fetchKisIntraday).not.toHaveBeenCalled();
  });

  it('nextRetryAt > now (cooldown 중) → CACHE_RETRY_PENDING', async () => {
    const now = new Date('2026-04-30T16:30:00Z');
    _loadVerificationQueue.mockReturnValueOnce([{
      stockCode: '005930',
      consecutiveFailures: 1,
      firstFailedAt: '2026-04-30T16:00:00Z',
      lastFailedAt: '2026-04-30T16:00:00Z',
      lastFailureReason: 'STALE_BASE',
      nextRetryAt: '2026-05-01T16:00:00Z', // future
      manualReviewState: 'NONE',
    }]);

    const result = await verifyStockIncremental('005930', 'BUY_CANDIDATE', now);
    expect(result.verified).toBe(false);
    expect(result.source).toBe('CACHE_RETRY_PENDING');
    expect(result.reason).toContain('retry_cooldown');
    expect(_fetchKisIntraday).not.toHaveBeenCalled();
  });
});

describe('verifyStockIncremental — FRESH 분기', () => {
  it('FRESH OK — KIS 정상 + sanity OK → recordVerificationSuccess + verified=true', async () => {
    _loadVerificationQueue.mockReturnValueOnce([]);
    _fetchKisIntraday.mockResolvedValueOnce({ price: 70000, dayOpen: 70100, prevClose: 70200, volume: 1000 });
    _safePctChangeStrict.mockReturnValueOnce({
      ok: true, status: 'OK', pct: -0.28, current: 70000, base: 70200, source: 'KIS_DAILY',
      context: 'dataVerificationIncremental:005930', reason: '[ctx] OK',
      blockTrading: false, blockDriftUpdate: false, blockSizing: false,
    });

    const result = await verifyStockIncremental('005930');
    expect(result.verified).toBe(true);
    expect(result.source).toBe('FRESH_OK');
    expect(_recordVerificationSuccess).toHaveBeenCalledWith('005930', expect.any(Date));
    expect(_recordVerificationFailure).not.toHaveBeenCalled();
  });

  it('FRESH FAIL — sanity 위반 → recordVerificationFailure + DataHoldAction + dataQuality', async () => {
    _loadVerificationQueue.mockReturnValueOnce([]);
    _fetchKisIntraday.mockResolvedValueOnce({ price: 11500, dayOpen: 11400, prevClose: 28000, volume: 500 });
    _safePctChangeStrict.mockReturnValueOnce({
      ok: false, status: 'STALE_BASE_OR_SPLIT_ADJUSTMENT', pct: null,
      current: 11500, base: 28000, source: 'KIS_DAILY',
      context: 'dataVerificationIncremental:189300',
      reason: '[ctx] sanity violation 58.93%',
      blockTrading: true, blockDriftUpdate: true, blockSizing: true,
    });

    const result = await verifyStockIncremental('189300');
    expect(result.verified).toBe(false);
    expect(result.source).toBe('FRESH_KIS');
    expect(result.reason).toMatch(/^kis_strict_fail:/);
    expect(result.action?.blockBuy).toBe(true);
    expect(result.action?.blockSell).toBe(false); // 절대 규칙
    expect(result.dataQuality?.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(_recordVerificationFailure).toHaveBeenCalledOnce();
  });
});

describe('verifyStockIncremental — 안전 분기', () => {
  it('KIS throw → ERROR + DataHoldAction (안전 차단, throw 흡수)', async () => {
    _loadVerificationQueue.mockReturnValueOnce([]);
    _fetchKisIntraday.mockRejectedValueOnce(new Error('회로차단'));

    const result = await verifyStockIncremental('005930');
    expect(result.verified).toBe(false);
    expect(result.source).toBe('ERROR');
    expect(result.reason).toMatch(/kis_error:/);
    expect(result.action?.blockBuy).toBe(true);
    // throw 가 호출자에게 전파되지 않음 (안전 차단)
  });
});
