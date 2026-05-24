// @responsibility 워치리스트 편입 알림 dedup 회귀 — 동일 종목 세트 반복 편입(피엠티 churn) 1일 1회
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchAlert: vi.fn(async () => 1),
}));

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: mocks.dispatchAlert,
}));

const { channelWatchlistAdded } = await import('./channelPipeline.js');

const ENV_KEYS = ['CHANNEL_ENABLED', 'ANALYSIS_CHANNEL_ENABLED'] as const;
const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  mocks.dispatchAlert.mockClear();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.ANALYSIS_CHANNEL_ENABLED = 'true';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const PMT = {
  name: '피엠티',
  code: '147760',
  price: 4745,
  changePercent: 0,
  gateScore: 0,
  entryPrice: 4745,
};

describe('channelWatchlistAdded — 편입 알림 dedup (피엠티 churn 차단)', () => {
  const optsOf = (i: number) => (mocks.dispatchAlert.mock.calls[i] as unknown[])[2] as Record<string, unknown>;

  it('편입 알림에 종목코드+KST일자 dedupeKey + 24h cooldown 부착', async () => {
    await channelWatchlistAdded([PMT], 'GREEN');
    expect(mocks.dispatchAlert).toHaveBeenCalledTimes(1);
    const opts = optsOf(0);
    expect(String(opts.dedupeKey)).toMatch(/^WATCHLIST_ADDED:147760:\d{4}-\d{2}-\d{2}$/);
    expect(opts.cooldownMs).toBe(24 * 60 * 60 * 1000);
  });

  it('동일 종목 세트는 동일 dedupeKey → alertRouter cooldown 이 반복 억제', async () => {
    await channelWatchlistAdded([PMT], 'GREEN');
    await channelWatchlistAdded([PMT], 'GREEN');
    expect(optsOf(0).dedupeKey).toBe(optsOf(1).dedupeKey);
  });

  it('다른 종목 세트는 다른 dedupeKey (정상 신규 편입은 알림 유지)', async () => {
    await channelWatchlistAdded([PMT], 'GREEN');
    await channelWatchlistAdded([{ ...PMT, code: '005930', name: '삼성전자' }], 'GREEN');
    expect(optsOf(0).dedupeKey).not.toBe(optsOf(1).dedupeKey);
    expect(String(optsOf(1).dedupeKey)).toContain('005930');
  });

  it('빈 목록은 발송하지 않음', async () => {
    await channelWatchlistAdded([], 'GREEN');
    expect(mocks.dispatchAlert).not.toHaveBeenCalled();
  });
});
