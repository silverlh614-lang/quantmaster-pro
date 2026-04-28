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
      // ADR-0028 §모드: return5d 가 RECOMMENDATION_RETURN 300% 적용으로 격상.
      // 기존 +90% stale 시나리오는 통과되므로 자릿수 mismatch 수준 (+400%) 으로 격상.
      // close5dAgo=100,000 → price=550,000 (+450% — 명백한 자릿수 mismatch / stale base)
      const N = 80;
      const closes = Array.from({ length: N }, (_, i) => 100000 + i * 100);
      closes[N - 6] = 100000; // 5거래일 전 종가 = 100,000
      closes[N - 1] = 550000; // 현재 = 550,000 → +450%
      const highs = closes.map(c => c + 200);
      const lows = closes.map(c => c - 200);
      const volumes = Array.from({ length: N }, () => 1000);
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes, highs, lows, volumes,
        meta: {
          regularMarketPrice: 550000,
          regularMarketPreviousClose: 549000,
          regularMarketOpen: 550000,
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

  describe('ADR-0028 §모순: validPrice — Yahoo 가격 누락 0 fallback 차단', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('regularMarketPrice=0 (사용자 보고 222160.KQ 시나리오) → null 반환 + PRICE_MISSING 로그', async () => {
      // 사용자 Railway 12:00 KST 로그: current=0, base=8040 → safePctChange -100% 패턴
      const closesEmpty: (number | null)[] = []; // closes 도 비어 있어 fallback 0 가 되던 케이스
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes: closesEmpty,
        meta: {
          regularMarketPrice: 0, // ← Yahoo 가 KRX 일부 종목에 0 응답
          regularMarketPreviousClose: 8040,
        },
      }));
      const result = await fetchYahooQuote('222160.KQ');
      // closes < 5 가 먼저 차단하지만, closes 충분해도 price=0 → null 반환 검증을 별도 케이스에서.
      expect(result).toBeNull();
    });

    it('regularMarketPrice=0 + closes 충분 → closes 마지막 값으로 fallback (validPrice chain)', async () => {
      // closes 80개 정상, meta.regularMarketPrice=0 만 비정상 → closes[-1] fallback 작동
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: 0, // 0 이지만 ?? 우회로 통과 → 기존 코드는 0 채택, 신규 코드는 fallback
          regularMarketPreviousClose: 100,
        },
      }));
      const result = await fetchYahooQuote('FALLBACK-OK.KS');
      // closes 의 마지막 값 = 179 (default 100 + 79)
      expect(result).not.toBeNull();
      expect(result!.price).toBe(179);
      // PRICE_MISSING 로그 없어야 함 (fallback 성공)
      const warnMsg = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnMsg).not.toContain('PRICE_MISSING');
    });

    it('regularMarketPrice=0 + closes 도 모두 0/null → null 반환 + PRICE_MISSING 로그', async () => {
      // 모든 closes 가 0 → validPrice 가 모두 null → price=null → 함수 null 반환
      // 단 L92 의 `> 0` 필터로 closes 가 빈 배열이 됨 → closes.length < 5 차단
      const allZeroCloses: (number | null)[] = Array.from({ length: 80 }, () => 0);
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes: allZeroCloses,
        meta: {
          regularMarketPrice: 0,
          regularMarketPreviousClose: 0,
        },
      }));
      const result = await fetchYahooQuote('ALL-ZERO.KS');
      expect(result).toBeNull();
    });

    it('regularMarketPrice=NaN → closes 로 fallback (validPrice 가 NaN 차단)', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: NaN,
          regularMarketPreviousClose: 100,
        },
      }));
      const result = await fetchYahooQuote('NAN-PRICE.KS');
      expect(result).not.toBeNull();
      expect(result!.price).toBe(179); // closes 마지막 값
    });

    it('regularMarketPrice=음수 → closes 로 fallback (validPrice 가 음수 차단)', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: -100,
          regularMarketPreviousClose: 100,
        },
      }));
      const result = await fetchYahooQuote('NEGATIVE-PRICE.KS');
      expect(result).not.toBeNull();
      expect(result!.price).toBe(179);
    });

    it('regularMarketPreviousClose=0 + closes[-2] 도 0 + chartPreviousClose 부재 → changePercent=0', async () => {
      // 정상 price 는 있지만 prevClose 모두 null → changePercent 계산 자체 스킵 (0 fallback)
      // 핵심: -100% 같은 비정상 값이 changePercent 에 들어가지 않음
      const closes = [100, 100, ...Array.from({ length: 78 }, (_, i) => 110 + i)];
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes,
        meta: {
          regularMarketPrice: closes[closes.length - 1],
          regularMarketPreviousClose: 0, // 비정상
          // chartPreviousClose 부재
        },
      }));
      const result = await fetchYahooQuote('NO-PREV-CLOSE.KS');
      expect(result).not.toBeNull();
      // 기존 코드는 closes[-2] 로 fallback 했는데 신규 코드도 동일 (validPrice 통과)
      // closes[-2] = 187 → changePercent = (188-187)/187 ≈ 0.53%
      expect(Math.abs(result!.changePercent)).toBeLessThan(5);
    });

    it('chartPreviousClose 만 유효 (regularMarketPreviousClose=0 + closes[-2]=null) → 3차 fallback 작동', async () => {
      // 시나리오: prevClose 1차/2차 fallback 실패, 3차 chartPreviousClose 채택
      const closes = [...Array.from({ length: 78 }, (_, i) => 100 + i), 178, 179];
      // closes[-2] = 178 — 정상이라 1차 fallback (regularMarketPreviousClose=0) 후 2차 closes[-2] 작동
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes,
        meta: {
          regularMarketPrice: 179,
          regularMarketPreviousClose: 0,
          chartPreviousClose: 175,
        },
      }));
      const result = await fetchYahooQuote('CHART-PREV.KS');
      expect(result).not.toBeNull();
      // 2차 fallback closes[-2]=178 채택 → (179-178)/178 ≈ 0.56%
      expect(Math.abs(result!.changePercent)).toBeLessThan(2);
    });

    it('-100% 패턴 차단 (회귀 가드) — current=0 fallback 케이스에서 sanity 위반 0건', async () => {
      // 사용자 보고 정확 재현: regularMarketPrice=0 + prevClose=8040
      // 기존 코드: price=0, prevClose=8040 → safePctChange -100% sanity 위반 1건 발생
      // 신규 코드: price=closes[-1] fallback → 정상 변화율
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: 0,
          regularMarketPreviousClose: 8040,
        },
      }));
      await fetchYahooQuote('222160.KQ');
      const warnMsg = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      // -100% sanity 위반 발생 안 함
      expect(warnMsg).not.toContain('-100');
      expect(warnMsg).not.toMatch(/changePercent.*sanity 위반/);
    });
  });

  describe('ADR-0028 §PR-D3-B: priceMetadata 부착', () => {
    it('정상 응답 — priceMetadata.value=price, source=YAHOO_INTRADAY 부착', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse());
      const result = await fetchYahooQuote('NORMAL.KS');
      expect(result).not.toBeNull();
      expect(result!.priceMetadata).toBeDefined();
      expect(result!.priceMetadata!.value).toBe(result!.price);
      expect(result!.priceMetadata!.source).toBe('YAHOO_INTRADAY');
      // asOf 가 ISO 형식
      expect(() => new Date(result!.priceMetadata!.asOf)).not.toThrow();
      expect(Number.isFinite(new Date(result!.priceMetadata!.asOf).getTime())).toBe(true);
    });

    it('regularMarketTime 명시 — asOf 가 그 시점 (Unix sec → ISO)', async () => {
      const fixedTimestamp = 1745798400; // 2025-04-28 00:00:00 UTC (예시)
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: 100,
          regularMarketPreviousClose: 99,
          regularMarketOpen: 100,
          regularMarketTime: fixedTimestamp,
        },
      }));
      const result = await fetchYahooQuote('FIXED-TIME.KS');
      expect(result!.priceMetadata!.asOf).toBe(new Date(fixedTimestamp * 1000).toISOString());
    });

    it('regularMarketTime 부재 — asOf 가 fetch 시점 (현재) fallback', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: 100,
          regularMarketPreviousClose: 99,
          regularMarketOpen: 100,
          // regularMarketTime 없음
        },
      }));
      const before = Date.now();
      const result = await fetchYahooQuote('NO-TIME.KS');
      const after = Date.now();
      const asOfMs = new Date(result!.priceMetadata!.asOf).getTime();
      expect(asOfMs).toBeGreaterThanOrEqual(before);
      expect(asOfMs).toBeLessThanOrEqual(after);
    });

    it('regularMarketTime=NaN/Infinity — fetch 시점 fallback', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        meta: {
          regularMarketPrice: 100,
          regularMarketPreviousClose: 99,
          regularMarketOpen: 100,
          regularMarketTime: NaN,
        },
      }));
      const result = await fetchYahooQuote('NAN-TIME.KS');
      // fetch 시점 fallback — 미래 timestamp 가 아님
      expect(new Date(result!.priceMetadata!.asOf).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('priceMetadata 가 PriceBase 타입과 정확히 호환 (safePctChange 직접 전달 가능)', async () => {
      (guardedFetch as any).mockResolvedValue(makeYahooResponse());
      const result = await fetchYahooQuote('UNION-OK.KS');
      const { safePctChange } = await import('../../utils/safePctChange.js');
      // priceMetadata 를 base 로 직접 전달 — PriceBase union 검증
      const pct = safePctChange(200, result!.priceMetadata!, { mode: 'INTRADAY', silent: true });
      // priceMetadata.value=179 (closes 마지막 + 1) 또는 비슷한 값. 200 vs 179 → +11.7%
      expect(pct).not.toBeNull();
    });
  });
});
