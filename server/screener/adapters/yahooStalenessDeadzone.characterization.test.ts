/**
 * @responsibility Yahoo staleness dead-zone 2종 characterization 하네스 (탐지층 측정, ENV 불변)
 *
 * dead-zone1: timestamp 결측/0 시 fetchTime(now) fallback → close 정체(price-only-stale)가
 * 7일reject·isStaleBase 둘 다 우회. dead-zone2: 1~4일 mild stale 이 quarantine(5일)·
 * base age(20영업일) grace 밑이라 진단조차 안 됨. 본 하네스가 봉합 전 "fresh 통과" 버그를
 * 재현하고 봉합 후 "stale 탐지/가시화" 를 단언한다. 점수 본체 0줄, 실집행 없음(SHADOW_ONLY).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/egressGuard.js', () => ({
  guardedFetch: vi.fn(),
}));

const { fetchYahooQuote } = await import('./yahooQuoteAdapter.js');
const { guardedFetch } = await import('../../utils/egressGuard.js');

const ENV_FLAG_BEFORE = process.env.KIS_OHLCV_PRIMARY_ENABLED;

/**
 * Yahoo chart API 응답 모의 — closes/highs/lows/volumes 길이 동일.
 * timestamps 미명시 시 result.timestamp 부재 (dead-zone1 재현: 0 placeholder fallback).
 */
function makeYahooResponse(opts: {
  closes?: (number | null)[];
  highs?: (number | null)[];
  lows?: (number | null)[];
  volumes?: (number | null)[];
  meta?: Record<string, unknown>;
  timestamps?: number[];
} = {}): Response {
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
  const body: Record<string, unknown> = {
    chart: {
      result: [{
        meta,
        ...(opts.timestamps !== undefined ? { timestamp: opts.timestamps } : {}),
        indicators: { quote: [{ close: closes, high: highs, low: lows, volume: volumes }] },
      }],
    },
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

/**
 * price-only-stale 시계열: 정상 상승 추세 후 마지막 plateauLen 봉의 종가를 동결.
 * 날짜·거래량은 진행하지만 timestamps 는 결측(dead-zone1) → "날짜는 도는데 close만 정체".
 */
function makePriceOnlyStaleCloses(N: number, plateauLen: number): number[] {
  const closes = Array.from({ length: N }, (_, i) => 50000 + i * 200);
  const freezeIdx = N - 1 - plateauLen;
  const frozen = closes[freezeIdx];
  for (let i = freezeIdx + 1; i < N; i++) closes[i] = frozen;
  return closes;
}

describe('Yahoo staleness dead-zone characterization (봉합 전/후 측정)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __resetSafePctChangeWarnsForTests } = await import('../../utils/safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  // ── 합격 조건 1: fresh quote 불변 (과탐 0) ────────────────────────────────────
  describe('fresh 불변 (과탐 0)', () => {
    it('정상 상승 시계열 + fresh timestamps → dataQuality=OK, priceFreshness 미설정/FRESH', async () => {
      const N = 80;
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const timestamps = Array.from({ length: N }, (_, i) => Math.floor((now - (N - 1 - i) * dayMs) / 1000));
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({ timestamps }));
      const result = await fetchYahooQuote('FRESH-NORMAL.KS');
      expect(result).not.toBeNull();
      expect(result!.dataQuality).toBe('OK');
      // return5d/20d 정상 산출 (stale 차단 없음)
      expect(result!.return5d).toBeGreaterThan(0);
      expect(result!.return20d).toBeGreaterThan(0);
      // priceFreshness 가 stale 마커가 아님 (과탐 0)
      expect(result!.priceFreshness ?? 'FRESH').not.toMatch(/STALE/);
    });

    it('timestamps 결측 + close 도 정상 진행(plateau 없음) → 봉합 후에도 fresh 불변', async () => {
      // dead-zone1 조건(timestamps 결측)이지만 close 가 계속 변동하면 stale 아님 → 과탐 0.
      (guardedFetch as any).mockResolvedValue(makeYahooResponse()); // timestamps 미명시
      const result = await fetchYahooQuote('NOTIME-MOVING.KS');
      expect(result).not.toBeNull();
      expect(result!.dataQuality).toBe('OK');
      expect(result!.return5d).toBeGreaterThan(0);
      expect(result!.return20d).toBeGreaterThan(0);
      expect(result!.priceFreshness ?? 'FRESH').not.toMatch(/STALE/);
    });
  });

  // ── 합격 조건 2: dead-zone1 (timestamp-0 + price-only-stale) 봉합 후 탐지 ──────
  describe('dead-zone1: timestamp 결측 + close 정체(price-only-stale)', () => {
    it('봉합 후 — price-only-stale(plateau 6봉) + timestamps 결측 → stale 탐지(priceFreshness STALE)', async () => {
      // timestamps 결측 → 봉합 전: fetchTime fallback 으로 fresh 오인 통과.
      //                    봉합 후: close 시계열 plateau 로 stale 판정.
      const closes = makePriceOnlyStaleCloses(80, 6);
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes,
        meta: {
          regularMarketPrice: closes[closes.length - 1],
          regularMarketPreviousClose: closes[closes.length - 2],
          regularMarketOpen: closes[closes.length - 1],
        },
        // timestamps 결측 (dead-zone1)
      }));
      const result = await fetchYahooQuote('PRICEONLY-STALE-6.KS');
      expect(result).not.toBeNull();
      // 봉합 후 단언: price-only-stale 이 stale 로 탐지된다 (priceFreshness STALE 마커).
      expect(result!.priceFreshness).toMatch(/STALE/);
      // 불변식 #6: stale=providerIssue, marketSignal 변환 0 → 진단 로그가 providerIssue 명시.
      const warnMsg = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnMsg).toMatch(/providerIssue=true/);
      expect(warnMsg).toMatch(/marketSignal=false/);
    });

    it('봉합 후 — plateau 가 임계 미만(2봉) 이면 stale 미탐지 (정상 단기 보합 보호)', async () => {
      // 짧은 보합(2봉)은 정상 시장 동작 → 과탐 방지. 임계 이상만 탐지.
      const closes = makePriceOnlyStaleCloses(80, 2);
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({
        closes,
        meta: {
          regularMarketPrice: closes[closes.length - 1],
          regularMarketPreviousClose: closes[closes.length - 2],
          regularMarketOpen: closes[closes.length - 1],
        },
      }));
      const result = await fetchYahooQuote('PRICEONLY-PLATEAU-2.KS');
      expect(result).not.toBeNull();
      expect(result!.priceFreshness ?? 'FRESH').not.toMatch(/STALE/);
    });
  });

  // ── 합격 조건 4: mild stale (1~4일) 가시화 (점수 hard-block 확대 없음) ─────────
  describe('dead-zone2: mild stale 1~4일 가시화', () => {
    it('봉합 후 — lastClose 가 3일 stale(quarantine 5일 미만) → priceFreshness 진단 가시화', async () => {
      // timestamps 마지막이 3일 전 → quarantine(5일)·base age(20영업일) grace 밑 → 진단조차 안 되던 dead-zone.
      const N = 80;
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const timestamps = Array.from({ length: N }, (_, i) => Math.floor((now - (N - 1 - i + 3) * dayMs) / 1000));
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({ timestamps }));
      const result = await fetchYahooQuote('MILD-STALE-3D.KS');
      expect(result).not.toBeNull();
      // 가시화: priceFreshness 에 mild stale 진단 노출 (점수 hard-block 아님).
      expect(result!.priceFreshness).toMatch(/MILD_STALE/);
      // 점수 hard-block 확대 안 함 — return5d/20d 는 여전히 산출됨(가시화만).
      expect(typeof result!.return5d).toBe('number');
      // quarantine 임계(5일) 미달이므로 격리 로그(YAHOO_STALE_QUARANTINED)는 미발생.
      const warnMsg = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warnMsg).not.toContain('YAHOO_STALE_QUARANTINED');
    });

    it('봉합 후 — lastClose 0일(today) fresh → mild stale 마커 미부여 (과탐 0)', async () => {
      const N = 80;
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const timestamps = Array.from({ length: N }, (_, i) => Math.floor((now - (N - 1 - i) * dayMs) / 1000));
      (guardedFetch as any).mockResolvedValue(makeYahooResponse({ timestamps }));
      const result = await fetchYahooQuote('FRESH-TODAY.KS');
      expect(result!.priceFreshness ?? 'FRESH').not.toMatch(/MILD_STALE/);
    });
  });

  // ── 합격 조건 3 보강: 기존 7일 reject(ADR-0235) 회귀 0 ────────────────────────
  it('회귀 — 7일 초과 stale + timestamps 존재 → 기존 ADR-0235 reject(null) 보존', async () => {
    const N = 80;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    // 전 시계열을 30일 전으로 → lastTimestamp 30일 전 → 7일 reject
    const timestamps = Array.from({ length: N }, (_, i) => Math.floor((now - (N - 1 - i + 30) * dayMs) / 1000));
    (guardedFetch as any).mockResolvedValue(makeYahooResponse({ timestamps }));
    const result = await fetchYahooQuote('HARD-STALE-30D.KS');
    expect(result).toBeNull();
  });

  // ── ENV 불변 단언 ────────────────────────────────────────────────────────────
  it('하네스가 KIS_OHLCV_PRIMARY_ENABLED ENV flag 을 변경하지 않음 (executionImpact NONE)', () => {
    expect(process.env.KIS_OHLCV_PRIMARY_ENABLED).toBe(ENV_FLAG_BEFORE);
  });
});
