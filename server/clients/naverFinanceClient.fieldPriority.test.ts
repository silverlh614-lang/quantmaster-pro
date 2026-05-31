/**
 * @responsibility Naver Finance closePrice 필드 우선순위 회귀 — dealTrendInfos[0] 우선
 *
 * 사용자 보고(2026-05-30 스크린샷): SK하이닉스 000660 이 우리 앱에서 ₩1,860,000
 * 로 표시되지만 Naver 웹은 같은 5/29 장마감 기준 ₩2,333,000. 원인: top-level
 * `data.closePrice` 가 stale/기준가일 수 있어 `dealTrendInfos[0].closePrice`
 * (최근 거래일 record) 가 더 신뢰성 있음.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchNaverStockSnapshot,
  resetNaverNegativeCache,
} from './naverFinanceClient';

function mockNaverResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('naverFinanceClient — closePrice 필드 우선순위 (SK하이닉스 stale 사례)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetNaverNegativeCache();
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('dealTrendInfos[0].closePrice 와 top-level closePrice 가 다르면 dealTrendInfos 채택', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockNaverResponse({
        stockName: 'SK하이닉스',
        closePrice: 1_860_000, // top-level (stale)
        fluctuationsRatio: -5,
        dealTrendInfos: [
          { closePrice: 2_333_000, fluctuationsRatio: 1.92 }, // 최근 거래일 record (정답)
        ],
        totalInfos: [],
      }),
    );
    global.fetch = fetchSpy as any;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const snap = await fetchNaverStockSnapshot('000660');

    expect(snap).not.toBeNull();
    expect(snap?.closePrice).toBe(2_333_000); // dealTrendInfos 채택
    expect(snap?.changeRate).toBe(1.92); // changeRate 도 동일 출처 정합
    // 괴리 경고 로그 확인
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('closePrice 괴리'),
    );
    warnSpy.mockRestore();
  });

  it('dealTrendInfos[0].closePrice 만 있으면 그 값 사용', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockNaverResponse({
        stockName: '현대차',
        // top-level closePrice 부재
        dealTrendInfos: [{ closePrice: 723_000, fluctuationsRatio: 6.79 }],
        totalInfos: [],
      }),
    );
    global.fetch = fetchSpy as any;

    const snap = await fetchNaverStockSnapshot('005380');

    expect(snap?.closePrice).toBe(723_000);
    expect(snap?.changeRate).toBe(6.79);
  });

  it('dealTrendInfos 부재 → top-level closePrice 로 fallback', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockNaverResponse({
        stockName: 'TEST',
        closePrice: 50_000,
        fluctuationsRatio: 2.5,
        // dealTrendInfos 없음
        totalInfos: [],
      }),
    );
    global.fetch = fetchSpy as any;

    const snap = await fetchNaverStockSnapshot('999999');

    expect(snap?.closePrice).toBe(50_000);
    expect(snap?.changeRate).toBe(2.5);
  });

  it('두 필드 모두 0 이면 closePrice=0 (호출자가 NAVER 미확보로 처리)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockNaverResponse({
        stockName: 'TEST',
        dealTrendInfos: [{ closePrice: 0 }],
        totalInfos: [],
      }),
    );
    global.fetch = fetchSpy as any;

    const snap = await fetchNaverStockSnapshot('888888');

    expect(snap?.closePrice).toBe(0);
  });

  it('5% 이내 미세 차이 → 경고 미발생 (정상 intra-day fluctuation 허용)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      mockNaverResponse({
        stockName: 'TEST',
        closePrice: 100_000,
        dealTrendInfos: [{ closePrice: 102_000 }], // +2% 차이
        totalInfos: [],
      }),
    );
    global.fetch = fetchSpy as any;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchNaverStockSnapshot('777777');

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('closePrice 괴리'),
    );
    warnSpy.mockRestore();
  });
});
