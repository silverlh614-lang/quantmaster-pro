/**
 * @responsibility ADR-0516 — getPrice() Watchlist Tier 정책 REST 차단 회귀 테스트
 *
 * 핵심 불변식:
 *   - ctx.allowRestFallback === false 시 fetchCurrentPrice 호출 안 함 + null 반환
 *   - ctx.allowRestFallback === true / undefined 시 fetchCurrentPrice 호출 (기존 동작 보존)
 *   - getPrice(stockCode) — ctx 없는 기존 호출자는 REST fallback 그대로
 *   - WS subscription (requestKisWsSubscription) 은 REST 차단과 무관하게 항상 호출
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchCurrentPrice = vi.fn<(code: string) => Promise<number | null>>();
const getRealtimePrice = vi.fn<(code: string) => number | null>();
const subscribeStock = vi.fn<(code: string) => void>();
const requestKisWsSubscription = vi.fn();
const isKisWsSubscriptionPriorityDisabled = vi.fn<() => boolean>();

vi.mock('../../../clients/kisClient.js', () => ({
  fetchCurrentPrice: (code: string) => fetchCurrentPrice(code),
}));
vi.mock('../../../clients/kisStreamClient.js', () => ({
  getRealtimePrice: (code: string) => getRealtimePrice(code),
  subscribeStock: (code: string) => subscribeStock(code),
}));
vi.mock('../../../clients/kisWebSocketSubscriptionManager.js', () => ({
  requestKisWsSubscription: (...args: unknown[]) => requestKisWsSubscription(...args),
  isKisWsSubscriptionPriorityDisabled: () => isKisWsSubscriptionPriorityDisabled(),
}));

import { getPrice } from './helpers.js';

beforeEach(() => {
  fetchCurrentPrice.mockReset();
  getRealtimePrice.mockReset();
  subscribeStock.mockReset();
  requestKisWsSubscription.mockReset();
  isKisWsSubscriptionPriorityDisabled.mockReset();
  // 기본: WS 우선순위 큐 활성 (default ON), 실시간 가격 맵 미보유, REST 는 가격 반환.
  isKisWsSubscriptionPriorityDisabled.mockReturnValue(false);
  getRealtimePrice.mockReturnValue(null);
  fetchCurrentPrice.mockResolvedValue(70_000);
});

afterEach(() => {
  delete process.env.WATCHLIST_KIS_TIER_DEBUG;
});

describe('getPrice — allowRestFallback === false (MOMENTUM_PASSIVE / KIS RED)', () => {
  it('fetchCurrentPrice 호출 안 함 + null 반환', async () => {
    const price = await getPrice('005930', {
      section: 'MOMENTUM',
      allowRestFallback: false,
      restTtlMs: 180_000,
      pricePurpose: 'BUY_EVAL',
    });
    expect(price).toBeNull();
    expect(fetchCurrentPrice).not.toHaveBeenCalled();
  });

  it('REST 차단이어도 WS subscription (requestKisWsSubscription) 은 호출', async () => {
    await getPrice('005930', { section: 'MOMENTUM', allowRestFallback: false });
    expect(requestKisWsSubscription).toHaveBeenCalledTimes(1);
    expect(requestKisWsSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ code: '005930' }),
    );
  });

  it('WS 실시간 가격이 있으면 REST 차단과 무관하게 그 값 반환', async () => {
    getRealtimePrice.mockReturnValue(71_500);
    const price = await getPrice('005930', { section: 'MOMENTUM', allowRestFallback: false });
    expect(price).toBe(71_500);
    expect(fetchCurrentPrice).not.toHaveBeenCalled();
  });

  it('WATCHLIST_KIS_TIER_DEBUG=true 시 [KIS_REST_SUPPRESSED_BY_TIER] DEBUG 로그', async () => {
    process.env.WATCHLIST_KIS_TIER_DEBUG = 'true';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await getPrice('005930', { section: 'MOMENTUM', allowRestFallback: false });
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[KIS_REST_SUPPRESSED_BY_TIER]'),
    );
    expect(debugSpy.mock.calls[0][0]).toContain('executionImpact=NONE');
    expect(debugSpy.mock.calls[0][0]).toContain('marketSignal=false');
    debugSpy.mockRestore();
  });

  it('WATCHLIST_KIS_TIER_DEBUG 미설정 시 DEBUG 로그 없음 (minimal logging)', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await getPrice('005930', { section: 'MOMENTUM', allowRestFallback: false });
    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});

describe('getPrice — allowRestFallback === true (SWING / CATALYST / MOMENTUM_ACTIVE)', () => {
  it('fetchCurrentPrice fallback 호출 + 가격 반환', async () => {
    const price = await getPrice('005930', {
      section: 'SWING',
      allowRestFallback: true,
      pricePurpose: 'BUY_EVAL',
    });
    expect(price).toBe(70_000);
    expect(fetchCurrentPrice).toHaveBeenCalledWith('005930');
  });

  it('ENTRY_CANDIDATE 컨텍스트도 REST fallback 정상', async () => {
    const price = await getPrice('035420', {
      section: 'CATALYST',
      allowRestFallback: true,
    });
    expect(price).toBe(70_000);
    expect(fetchCurrentPrice).toHaveBeenCalledTimes(1);
  });
});

describe('getPrice — 후방호환 (ctx 미전달 / allowRestFallback undefined)', () => {
  it('getPrice(stockCode) — ctx 없는 기존 호출자는 REST fallback 그대로', async () => {
    const price = await getPrice('005930');
    expect(price).toBe(70_000);
    expect(fetchCurrentPrice).toHaveBeenCalledWith('005930');
  });

  it('ctx 전달하되 allowRestFallback 미지정 → REST fallback 그대로 (undefined !== false)', async () => {
    const price = await getPrice('005930', { stockName: '삼성전자', isEntryCandidate: true });
    expect(price).toBe(70_000);
    expect(fetchCurrentPrice).toHaveBeenCalledTimes(1);
  });

  it('WS 실시간 가격 우선 — REST fallback 호출 안 함 (기존 동작)', async () => {
    getRealtimePrice.mockReturnValue(69_800);
    const price = await getPrice('005930');
    expect(price).toBe(69_800);
    expect(fetchCurrentPrice).not.toHaveBeenCalled();
  });
});
