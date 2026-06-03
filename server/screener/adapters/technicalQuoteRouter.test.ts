import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { YahooQuoteExtended } from './yahooQuoteAdapter.js';

vi.mock('./yahooQuoteAdapter.js', () => ({
  fetchYahooQuote: vi.fn(),
}));
vi.mock('./kisQuoteAdapter.js', () => ({
  fetchKisQuoteFallback: vi.fn(),
  // enrich 는 입력 quote 를 그대로 통과시키는 기본 스텁(보강 무영향) — 테스트에서 재정의 가능.
  enrichQuoteWithKisMTAS: vi.fn(async (q: YahooQuoteExtended) => q),
}));
// yahooSymbolResolver funnel 위임 검증용 — R1 flag-OFF byte-equivalence 차등 테스트.
vi.mock('./yahooSymbolResolver.js', () => ({
  fetchYahooQuoteByCode: vi.fn(),
}));
vi.mock('../../utils/marketClock.js', () => ({
  isKstWeekend: vi.fn(() => false),
  classifyMarketDataMode: vi.fn(() => 'LIVE_TRADING_DAY'),
}));

import {
  fetchTechnicalQuote,
  fetchTechnicalQuoteByCode,
  _clearKisDailyQuoteCache,
} from './technicalQuoteRouter.js';
import { fetchYahooQuote } from './yahooQuoteAdapter.js';
import { fetchKisQuoteFallback, enrichQuoteWithKisMTAS } from './kisQuoteAdapter.js';
import { fetchYahooQuoteByCode } from './yahooSymbolResolver.js';
import { isKstWeekend, classifyMarketDataMode } from '../../utils/marketClock.js';

const yahooMock = vi.mocked(fetchYahooQuote);
const kisMock = vi.mocked(fetchKisQuoteFallback);
const enrichMock = vi.mocked(enrichQuoteWithKisMTAS);
const funnelMock = vi.mocked(fetchYahooQuoteByCode);
const weekendMock = vi.mocked(isKstWeekend);
const modeMock = vi.mocked(classifyMarketDataMode);

function makeQuote(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 70000,
    changePercent: 1.2,
    volume: 1_000_000,
    rsi14: 55,
    ma5: 69000,
    ma20: 68000,
    ma60: 65000,
    ...overrides,
  } as YahooQuoteExtended;
}

const CODE = '005930';
const SYMBOL = '005930.KS';

describe('technicalQuoteRouter.fetchTechnicalQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearKisDailyQuoteCache();
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
    weekendMock.mockReturnValue(false);
    modeMock.mockReturnValue('LIVE_TRADING_DAY');
    enrichMock.mockImplementation(async (q: YahooQuoteExtended) => q);
  });

  afterEach(() => {
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
  });

  // (a) kisFirst=true → KIS 우선 호출, KIS_PRIMARY marker 부착.
  it('kisFirst=true 시 fetchKisQuoteFallback 을 우선 호출하고 KIS_PRIMARY marker 를 부착한다', async () => {
    kisMock.mockResolvedValue(makeQuote({ price: 71000 }));

    const result = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });

    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(kisMock).toHaveBeenCalledWith(CODE);
    expect(yahooMock).not.toHaveBeenCalled();
    expect(result?.dataQuality).toBe('KIS_PRIMARY');
    expect(result?.priceProvider).toBe('KIS_PRICE');
    expect(result?.price).toBe(71000);
    // BB/MTAS 보강(enrich) 호출 확인.
    expect(enrichMock).toHaveBeenCalledTimes(1);
    expect(enrichMock).toHaveBeenCalledWith(expect.any(Object), CODE);
  });

  // (b) KIS 실패(null)/봉수부족 → Yahoo fallback.
  it('kisFirst=true 인데 KIS 가 null 이면 fetchYahooQuote 로 fallback 한다', async () => {
    kisMock.mockResolvedValue(null);
    yahooMock.mockResolvedValue(makeQuote({ price: 69500, dataQuality: 'OK' }));

    const result = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });

    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(yahooMock).toHaveBeenCalledTimes(1);
    expect(yahooMock).toHaveBeenCalledWith(SYMBOL);
    expect(result?.price).toBe(69500);
    expect(result?.dataQuality).toBe('OK'); // KIS_PRIMARY marker 미부착(Yahoo 결과 그대로).
  });

  // (b-2) KIS throw → Yahoo fallback (에러 삼킴 금지 — 로깅 후 강등).
  it('kisFirst=true 인데 KIS 가 throw 하면 Yahoo 로 fallback 한다', async () => {
    kisMock.mockRejectedValue(new Error('KIS 5xx'));
    yahooMock.mockResolvedValue(makeQuote({ price: 69000 }));

    const result = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });

    expect(yahooMock).toHaveBeenCalledTimes(1);
    expect(result?.price).toBe(69000);
  });

  // (c) 6h 캐시 히트 시 신규 KIS 호출 0.
  it('6h 캐시 히트 시 두 번째 호출은 신규 KIS/Yahoo 호출을 하지 않는다', async () => {
    kisMock.mockResolvedValue(makeQuote({ price: 72000 }));

    const first = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });
    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(first?.dataQuality).toBe('KIS_PRIMARY');

    const second = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });
    // 캐시 히트 → KIS 신규 호출 없음(여전히 1회), Yahoo 도 미호출.
    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(yahooMock).not.toHaveBeenCalled();
    expect(second?.price).toBe(72000);
    expect(second?.dataQuality).toBe('KIS_PRIMARY');
  });

  // (d) kisFirst=false(기본) → Yahoo-first 순서 유지(회귀).
  it('kisFirst=false(기본) 시 fetchYahooQuote 만 호출하고 KIS 는 호출하지 않는다', async () => {
    yahooMock.mockResolvedValue(makeQuote({ price: 68000, dataQuality: 'OK' }));

    const result = await fetchTechnicalQuote(CODE, SYMBOL);

    expect(yahooMock).toHaveBeenCalledTimes(1);
    expect(yahooMock).toHaveBeenCalledWith(SYMBOL);
    expect(kisMock).not.toHaveBeenCalled();
    expect(result?.price).toBe(68000);
    expect(result?.dataQuality).toBe('OK');
  });

  // (d-2) ENV ON 만으로도 KIS-first 활성화(opts 없이).
  it('ENV KIS_OHLCV_PRIMARY_ENABLED=true 면 opts 없이도 KIS-first 로 동작한다', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    kisMock.mockResolvedValue(makeQuote({ price: 73000 }));

    const result = await fetchTechnicalQuote(CODE, SYMBOL);

    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(result?.dataQuality).toBe('KIS_PRIMARY');
  });

  // (e) 휴장 TTL 연장 — 6h 경과해도 휴장이면 캐시 유지(신규 호출 0).
  it('휴장(주말)이면 6h 경과 후에도 캐시가 유지되어 신규 KIS 호출이 없다', async () => {
    weekendMock.mockReturnValue(true); // 휴장 → 연장 TTL(18h)
    kisMock.mockResolvedValue(makeQuote({ price: 74000 }));

    const realNow = Date.now;
    let nowMs = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

    try {
      const first = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });
      expect(first?.price).toBe(74000);
      expect(kisMock).toHaveBeenCalledTimes(1);

      // 7시간 경과 — 평일 TTL(6h)은 만료지만 휴장 연장 TTL(18h) 내 → 캐시 유지.
      nowMs += 7 * 60 * 60 * 1000;
      const second = await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });
      expect(kisMock).toHaveBeenCalledTimes(1); // 신규 호출 없음
      expect(second?.price).toBe(74000);
    } finally {
      Date.now = realNow;
      vi.restoreAllMocks();
    }
  });

  // (e-2) 장중(LIVE_TRADING_DAY)에는 6h 경과 시 캐시 만료 → 신규 KIS 호출 발생.
  it('장중에는 6h 경과 후 캐시가 만료되어 신규 KIS 호출이 발생한다', async () => {
    weekendMock.mockReturnValue(false);
    modeMock.mockReturnValue('LIVE_TRADING_DAY');
    kisMock.mockResolvedValue(makeQuote({ price: 75000 }));

    const realNow = Date.now;
    let nowMs = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

    try {
      await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });
      expect(kisMock).toHaveBeenCalledTimes(1);

      // 7시간 경과 — 평일 TTL(6h) 만료 → 신규 호출.
      nowMs += 7 * 60 * 60 * 1000;
      await fetchTechnicalQuote(CODE, SYMBOL, { kisFirst: true });
      expect(kisMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
      vi.restoreAllMocks();
    }
  });
});

// ── R1 (ADR-0547 R1 Extension / ADR-0561 grandfather burn-down) ─────────────────
// fetchTechnicalQuoteByCode 의 flag-OFF byte-equivalence 차등 증명.
//
// 합격 절대조건 #1: flag OFF 에서 `fetchTechnicalQuoteByCode(code)` 의 관측 가능 동작이
// 직접 `fetchYahooQuoteByCode(code, fetchYahooQuote)`(yahooSymbolResolver funnel) 호출과 동일.
// funnel 이 ledger 부수효과(ADR-0255)·sanity fallback(ADR-0241)·KIS-first 부분동작(funnel ①)의
// SSOT 이므로, "funnel 을 동일 인자로 정확히 1회 호출하고 그 반환을 그대로 반환"임을 단언하면
// 6항(호출수·반환타입/값·ledger·marker·sanity·KIS-first 부분) 동일이 성립한다.
describe('technicalQuoteRouter.fetchTechnicalQuoteByCode — R1 byte-equivalence (flag OFF)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearKisDailyQuoteCache();
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
    weekendMock.mockReturnValue(false);
    modeMock.mockReturnValue('LIVE_TRADING_DAY');
    enrichMock.mockImplementation(async (q: YahooQuoteExtended) => q);
  });

  afterEach(() => {
    delete process.env.KIS_OHLCV_PRIMARY_ENABLED;
  });

  // (1)(2)(4) 호출 수 동일(funnel 1회) + 반환 타입/값(동일 객체 reference) + marker 동일.
  it('flag OFF: funnel 을 (code, fetchYahooQuote) 인자로 정확히 1회 호출하고 그 반환을 그대로 반환한다', async () => {
    const funnelReturn = makeQuote({ price: 70500, dataQuality: 'OK', priceProvider: 'YAHOO' });
    funnelMock.mockResolvedValue(funnelReturn);

    const result = await fetchTechnicalQuoteByCode(CODE);

    // (1) funnel 정확히 1회.
    expect(funnelMock).toHaveBeenCalledTimes(1);
    // 인자: (code, fetchYahooQuote) — 두 번째 인자가 yahooQuoteAdapter 의 fetchYahooQuote reference.
    expect(funnelMock).toHaveBeenCalledWith(CODE, fetchYahooQuote);
    // (2) 동일 객체 reference 그대로 반환(래핑·복사 없음 → ledger/marker/타입 전부 보존).
    expect(result).toBe(funnelReturn);
    // (4) marker 무가공(KIS_PRIMARY 미부착 — funnel 결과 그대로).
    expect(result?.dataQuality).toBe('OK');
    expect(result?.priceProvider).toBe('YAHOO');
    // KIS 경로 0 — 직접 KIS/Yahoo(symbol) 호출 없음(funnel 단일 통로).
    expect(kisMock).not.toHaveBeenCalled();
    expect(yahooMock).not.toHaveBeenCalled();
  });

  // (2) null 반환도 동일하게 전파(차등 0).
  it('flag OFF: funnel 이 null 이면 null 을 그대로 반환한다', async () => {
    funnelMock.mockResolvedValue(null);

    const result = await fetchTechnicalQuoteByCode(CODE);

    expect(funnelMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    expect(kisMock).not.toHaveBeenCalled();
  });

  // (3)(5)(6) ledger 부수효과·sanity fallback·KIS-first 부분동작 동일 — 차등 증명.
  // 핵심: flag OFF 의 byCode 가 "직접 funnel 호출"과 동일 인자·동일 호출수임을 단언하면,
  // funnel 내부의 ledger 갱신/sanity fallback/KIS-first 부분동작은 정의상 byte-equal 이다
  // (byCode 가 funnel 을 우회하거나 추가 호출하지 않으므로 부수효과가 더해지거나 빠지지 않는다).
  it('flag OFF: 직접 funnel 호출과 동일 인자/호출수 → 부수효과(ledger/sanity/KIS-first) byte-equal', async () => {
    const funnelReturn = makeQuote({ price: 71200, dataQuality: 'KIS_PRIMARY', priceProvider: 'KIS_PRICE' });
    funnelMock.mockResolvedValue(funnelReturn);

    // 시나리오 A: 라우터 경유.
    const viaRouter = await fetchTechnicalQuoteByCode(CODE);
    const routerCallArgs = funnelMock.mock.calls.map((c) => [...c]);
    const routerCallCount = funnelMock.mock.calls.length;

    funnelMock.mockClear();

    // 시나리오 B: 직접 funnel 호출(기존 grandfather callsite 와 동치).
    const direct = await fetchYahooQuoteByCode(CODE, fetchYahooQuote);
    const directCallArgs = funnelMock.mock.calls.map((c) => [...c]);
    const directCallCount = funnelMock.mock.calls.length;

    // 호출 수·인자·반환 모두 동일 → byte-equivalent.
    expect(routerCallCount).toBe(directCallCount);
    expect(routerCallArgs).toEqual(directCallArgs);
    expect(viaRouter).toBe(direct);
    // 라우터가 KIS 경로(추가 부수효과)를 절대 타지 않음.
    expect(kisMock).not.toHaveBeenCalled();
    expect(yahooMock).not.toHaveBeenCalled();
  });

  // flag ON 분기는 funnel 을 우회하고 KIS-first 로 진입함을 확인(flag OFF byte-equal 경계 명확화).
  it('flag ON(ENV): funnel 위임을 우회하고 KIS-first 로 진입한다', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    kisMock.mockResolvedValue(makeQuote({ price: 73500 }));

    const result = await fetchTechnicalQuoteByCode(CODE);

    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(kisMock).toHaveBeenCalledWith(CODE);
    expect(funnelMock).not.toHaveBeenCalled(); // flag ON 정상흐름은 funnel 미경유.
    expect(result?.dataQuality).toBe('KIS_PRIMARY');
  });

  // flag ON + KIS 불가 → funnel fallback(code-진입 일관성: symbol resolve 전가 0).
  it('flag ON 인데 KIS 가 null 이면 funnel(code, fetchYahooQuote) 로 fallback 한다', async () => {
    process.env.KIS_OHLCV_PRIMARY_ENABLED = 'true';
    kisMock.mockResolvedValue(null);
    funnelMock.mockResolvedValue(makeQuote({ price: 69900, dataQuality: 'OK' }));

    const result = await fetchTechnicalQuoteByCode(CODE);

    expect(kisMock).toHaveBeenCalledTimes(1);
    expect(funnelMock).toHaveBeenCalledTimes(1);
    expect(funnelMock).toHaveBeenCalledWith(CODE, fetchYahooQuote);
    expect(yahooMock).not.toHaveBeenCalled(); // symbol-진입 raw Yahoo 미사용(code-진입 일관성).
    expect(result?.price).toBe(69900);
  });
});
