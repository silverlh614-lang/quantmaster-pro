/**
 * @responsibility yahooQuoteAdapter 단위 테스트 (PR-56) — Yahoo HTTP mock + cache + 데이터 부족
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/egressGuard.js', () => ({
  guardedFetch: vi.fn(),
}));

const { fetchYahooQuote } = await import('./yahooQuoteAdapter.js');
const { guardedFetch } = await import('../../utils/egressGuard.js');

/** Yahoo chart API 응답 형태 모의 — closes/highs/lows/volumes 길이 동일 */
function makeYahooResponse(opts: {
  closes?: (number | null)[];
  highs?: (number | null)[];
  lows?: (number | null)[];
  volumes?: (number | null)[];
  meta?: Record<string, unknown>;
} = {}): Response {
  // ma60TrendUp 은 closes5dAgo (length-5) 에서 MA60 도 계산하므로 65 미만이면 fallback 0.
  // 80 으로 잡아 두 경로 모두 안정 산출.
  const N = 80;
  const closes = opts.closes ?? Array.from({ length: N }, (_, i) => 100 + i);
  const highs = opts.highs ?? closes.map(c => (c == null ? null : c + 1));
  const lows = opts.lows ?? closes.map(c => (c == null ? null : c - 1));
  const volumes = opts.volumes ?? Array.from({ length: closes.length }, () => 1000);
  const meta = opts.meta ?? {
    regularMarketPrice: closes[closes.length - 1] ?? 100,
    regularMarketPreviousClose: closes[closes.length - 2] ?? 100,
    regularMarketOpen: closes[closes.length - 1] ?? 100,
  };
  const body = {
    chart: {
      result: [{
        meta,
        indicators: { quote: [{ close: closes, high: highs, low: lows, volume: volumes }] },
      }],
    },
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('fetchYahooQuote', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('HTTP non-OK 응답 → null 반환', async () => {
    (guardedFetch as any).mockResolvedValue(new Response('', { status: 503 }));
    const result = await fetchYahooQuote('TEST.KS');
    expect(result).toBeNull();
  });

  it('chart.result 없음 → null 반환', async () => {
    (guardedFetch as any).mockResolvedValue(new Response(JSON.stringify({ chart: { result: [] } })));
    const result = await fetchYahooQuote('TEST.KS');
    expect(result).toBeNull();
  });

  it('closes < 5 → null (데이터 부족)', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({
      closes: [100, 101, null, null, null],
      highs: [101, 102, null, null, null],
      lows: [99, 100, null, null, null],
      volumes: [1000, 1100, null, null, null],
    }));
    const result = await fetchYahooQuote('TEST.KS');
    expect(result).toBeNull();
  });

  it('정상 응답 → YahooQuoteExtended 핵심 필드 채워짐', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse());
    const result = await fetchYahooQuote('TESTOK.KS');
    expect(result).not.toBeNull();
    expect(result!.price).toBeGreaterThan(0);
    expect(result!.ma5).toBeGreaterThan(0);
    expect(result!.ma20).toBeGreaterThan(0);
    expect(result!.ma60).toBeGreaterThan(0);
    expect(result!.atr).toBeGreaterThan(0);
    expect(typeof result!.rsi14).toBe('number');
    expect(result!.rsi14).toBeGreaterThanOrEqual(0);
    expect(result!.rsi14).toBeLessThanOrEqual(100);
    expect(typeof result!.isHighRisk).toBe('boolean');
    // 상승 추세 시계열 → MACD 양수 + ma60TrendUp true 기대
    expect(result!.ma60TrendUp).toBe(true);
  });

  it('5분 캐시 동작 — 동일 심볼 두 번째 호출은 fetch 생략', async () => {
    (guardedFetch as any).mockResolvedValue(makeYahooResponse());
    const r1 = await fetchYahooQuote('CACHE-TEST.KS');
    const r2 = await fetchYahooQuote('CACHE-TEST.KS');
    expect(r1).toEqual(r2);
    expect(guardedFetch).toHaveBeenCalledTimes(1); // 캐시 hit
  });

  it('null close 값은 필터링 후 indicators 계산', async () => {
    const N = 60;
    const closes = Array.from({ length: N }, (_, i) => i % 10 === 0 ? null : 100 + i);
    const highs = closes.map(c => c == null ? null : (c as number) + 1);
    const lows = closes.map(c => c == null ? null : (c as number) - 1);
    const volumes = Array.from({ length: N }, (_, i) => i % 10 === 0 ? null : 1000);
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ closes, highs, lows, volumes }));
    const result = await fetchYahooQuote('NULL-FILTER.KS');
    expect(result).not.toBeNull();
    // null 제거 후 정상 계산
    expect(result!.ma5).toBeGreaterThan(0);
  });

  it('정상 거래량 → isHighRisk=false (volume > 0 필터로 0 거래량 entry 는 자연 제거)', async () => {
    // 참고: 원본 isHighRisk 로직은 volumes.filter(v => v > 0) 후의 0 카운트를 본다.
    // 따라서 볼륨 0 입력은 필터링되어 isHighRisk=true 분기는 실제로 도달 불가능 —
    // 본 테스트는 정상 시나리오에서 false 가 나오는 것만 검증.
    (guardedFetch as any).mockResolvedValue(makeYahooResponse());
    const result = await fetchYahooQuote('NORMAL-VOL.KS');
    expect(result).not.toBeNull();
    expect(result!.isHighRisk).toBe(false);
  });

  it('fetch throw → null 반환 (catch 블록)', async () => {
    (guardedFetch as any).mockRejectedValue(new Error('network error'));
    const result = await fetchYahooQuote('THROW-TEST.KS');
    expect(result).toBeNull();
  });

  // ── safePctChange 진단 로그에 symbol 포함 (2026-04-27 진단 갭 해소) ──
  describe('safePctChange label 에 symbol 포함 — 종목별 식별 가능', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      // throttle map 을 비워서 매 케이스가 독립적으로 로그 검증.
      const { __resetSafePctChangeWarnsForTests } = await import('../../utils/safePctChange.js');
      __resetSafePctChangeWarnsForTests();
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('changePercent sanity 위반 시 label 에 symbol 포함', async () => {
      // prevClose=28,400 → price=115,100 (305% 점프 — 액면분할 상황 재현)
      const N = 80;
      const closes = Array.from({ length: N }, (_, i) => 28000 + i * 5);
      closes[N - 1] = 115100;
      const highs = closes.map(c => c + 100);
      const lows = closes.map(c => c - 100);
      const volumes = Array.from({ length: N }, () => 1000);
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes, highs, lows, volumes,
        meta: {
          regularMarketPrice: 115100,
          regularMarketPreviousClose: 28400,
          regularMarketOpen: 115100,
        },
      }));
      await fetchYahooQuote('SPLIT-CASE.KS');
      const warnedMessage = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnedMessage).toContain('yahooQuoteAdapter.changePercent:SPLIT-CASE.KS');
      // 종목 식별 가능한 라벨이 노출됐는지 — symbol 미포함 (구버전) 형식이 *없는지* 확인.
      expect(warnedMessage).not.toMatch(/yahooQuoteAdapter\.changePercent\s/);
    });

    it('return5d sanity 위반 시 label 에 symbol 포함', async () => {
      // close5dAgo=115,300 → price=219,500 (90.37% 상승 — stale base 재현)
      const N = 80;
      const closes = Array.from({ length: N }, (_, i) => 110000 + i * 100);
      // closes[N - 6] = 5거래일 전 종가 = 115,300
      closes[N - 6] = 115300;
      closes[N - 1] = 219500;
      const highs = closes.map(c => c + 200);
      const lows = closes.map(c => c - 200);
      const volumes = Array.from({ length: N }, () => 1000);
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes, highs, lows, volumes,
        meta: {
          regularMarketPrice: 219500,
          regularMarketPreviousClose: 219000,
          regularMarketOpen: 219500,
        },
      }));
      await fetchYahooQuote('STALE-5D.KS');
      const warnedMessage = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnedMessage).toContain('yahooQuoteAdapter.return5d:STALE-5D.KS');
    });

    it('정상 종목은 sanity 위반 로그 0건 (회귀 가드)', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse());
      await fetchYahooQuote('NORMAL-CASE.KS');
      const warnedMessage = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnedMessage).not.toContain('sanity 위반');
    });
  });
});
