// @responsibility ADR-0621 intraday horizon honesty 회귀 테스트 — T+30m/T+1h OBSERVED 자격 = INTRADAY_CANDLE_CACHE 한정.
//
// T+30m/T+1h 는 coarser fallback(MARKET_DATA/READ_ONLY_QUOTE/SCAN/ENTRY)이 same-day-close 단일점이라
// follow-through 부풀림을 유발 → INTRADAY_CANDLE_CACHE 없으면 null → DATA_UNAVAILABLE 강등 검증.
// SAME_DAY_CLOSE / daily horizon 무변경 회귀 방지 + performance report de-inflation 통합 검증.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProvisionalShadowPriceProvider,
  lookupCachedPrice,
} from './provisionalShadowPriceProvider.js';
import { buildProvisionalShadowPerformanceReport } from './provisionalShadowPerformanceReport.js';
import { __resetForTests, setSnapshot } from '../persistence/offHoursSnapshotRepo.js';
import type { ProvisionalShadowLedgerEntry } from '../persistence/provisionalShadowLedger.js';

function makeEntry(
  overrides: Partial<ProvisionalShadowLedgerEntry & {
    entryPrice?: number;
    metadata?: Record<string, unknown>;
  }> = {},
): ProvisionalShadowLedgerEntry {
  return {
    eventType: 'PROVISIONAL_SHADOW_ENTRY',
    provisional: true,
    source: 'ADR-0426',
    symbol: '005930',
    name: '삼성전자',
    scanId: 'scan-1',
    scannedAtKst: '2026-05-07T10:00:00+09:00',
    createdAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
    reasons: ['R3_EARLY', 'GATE1_SURVIVOR'],
    regime: 'R3_EARLY',
    gate1Passed: true,
    gate2Passed: false,
    liveAllowed: false,
    shadowAllowed: true,
    entryPrice: 70_000,
    ...overrides,
  } as ProvisionalShadowLedgerEntry;
}

function makeYahooBody(points: Array<{ timestampMs: number; close: number }>): string {
  return JSON.stringify({
    chart: {
      result: [
        {
          timestamp: points.map((p) => Math.floor(p.timestampMs / 1000)),
          indicators: { quote: [{ close: points.map((p) => p.close) }] },
        },
      ],
    },
  });
}

describe('ADR-0621 intraday horizon honesty', () => {
  beforeEach(() => {
    delete process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
    delete process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED;
    __resetForTests();
  });

  afterEach(() => {
    delete process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
    delete process.env.PROVISIONAL_SHADOW_PERF_REPORT_DISABLED;
    __resetForTests();
  });

  // ────────────────────────────────────────────────────────
  // (1) T+30m/T+1h: intraday candle hit → OBSERVED(INTRADAY_CANDLE_CACHE)
  // ────────────────────────────────────────────────────────
  describe('intraday candle hit → OBSERVED', () => {
    for (const horizon of ['T_PLUS_30M', 'T_PLUS_1H'] as const) {
      it(`${horizon} — intraday 1m cache hit → INTRADAY_CANDLE_CACHE`, () => {
        const entry = makeEntry();
        // target 시각 — entry + offset (30m/1h). 충분히 가까운 1m point 등록.
        const entryMs = Date.parse(entry.createdAtKst);
        const offsetMs = horizon === 'T_PLUS_30M' ? 30 * 60_000 : 60 * 60_000;
        const targetMs = entryMs + offsetMs;
        setSnapshot('005930.KS:1d:1m', {
          body: makeYahooBody([{ timestampMs: targetMs, close: 72_000 }]),
          contentType: 'application/json',
          fetchedAt: Date.now(),
        });
        const result = lookupCachedPrice(entry, horizon);
        expect(result).not.toBeNull();
        expect(result?.source).toBe('INTRADAY_CANDLE_CACHE');
        expect(result?.price).toBe(72_000);
      });
    }
  });

  // ────────────────────────────────────────────────────────
  // (2) T+30m/T+1h: intraday miss + coarser sources only → null (short-circuit, no fallback)
  // ────────────────────────────────────────────────────────
  describe('intraday miss + coarser source only → null (coarser fallback 금지)', () => {
    for (const horizon of ['T_PLUS_30M', 'T_PLUS_1H'] as const) {
      it(`${horizon} — scanQuote + readOnlyQuote 존재해도 intraday 부재 → null`, () => {
        const entry = makeEntry({
          metadata: {
            scanQuote: { lastPrice: 71_000 },
            readOnlyQuote: { lastPrice: 70_900 },
          } as unknown as ProvisionalShadowLedgerEntry['metadata'],
        });
        // intraday snapshot 미등록
        expect(lookupCachedPrice(entry, horizon)).toBeNull();
      });

      it(`${horizon} — MARKET_DATA(latest) cache 존재해도 short-circuit → null`, () => {
        const entry = makeEntry();
        // 1d:5m latest 에 과거 point — MARKET_DATA latest mode 라면 hit 했을 것
        const entryMs = Date.parse(entry.createdAtKst);
        setSnapshot('005930.KS:1d:5m', {
          body: makeYahooBody([
            { timestampMs: entryMs - 5 * 60_000, close: 69_000 },
          ]),
          contentType: 'application/json',
          fetchedAt: Date.now(),
        });
        // intraday closest(at-or-after target) 는 과거 point 라 miss → short-circuit → null
        expect(lookupCachedPrice(entry, horizon)).toBeNull();
      });

      it(`${horizon} — provider 레벨에서 DATA_UNAVAILABLE`, async () => {
        const entry = makeEntry({
          metadata: {
            readOnlyQuote: { lastPrice: 70_900 },
          } as unknown as ProvisionalShadowLedgerEntry['metadata'],
        });
        const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
        const result = await provider(entry.symbol, horizon, entry.createdAtKst);
        expect(result.available).toBe(false);
        if (!result.available) expect(result.status).toBe('DATA_UNAVAILABLE');
      });
    }
  });

  // ────────────────────────────────────────────────────────
  // (3) SAME_DAY_CLOSE: intraday miss + market-data 존재 → OBSERVED(MARKET_DATA_CACHE) 현행 유지
  // ────────────────────────────────────────────────────────
  describe('SAME_DAY_CLOSE coarser fallback 회귀 방지', () => {
    it('intraday miss + MARKET_DATA(latest) hit → MARKET_DATA_CACHE (현행 유지)', () => {
      const entry = makeEntry();
      const entryMs = Date.parse(entry.createdAtKst);
      // 1d:5m 에 과거 point → intraday closest miss(at-or-after) → MARKET_DATA latest hit
      setSnapshot('005930.KS:1d:5m', {
        body: makeYahooBody([
          { timestampMs: entryMs - 5 * 60_000, close: 73_500 },
        ]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'SAME_DAY_CLOSE');
      expect(result?.source).toBe('MARKET_DATA_CACHE');
      expect(result?.price).toBe(73_500);
    });

    it('intraday miss + readOnlyQuote only → READ_ONLY_QUOTE (현행 유지)', () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: 70_800 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'SAME_DAY_CLOSE');
      expect(result?.source).toBe('READ_ONLY_QUOTE');
      expect(result?.price).toBe(70_800);
    });
  });

  // ────────────────────────────────────────────────────────
  // (4) NEXT_OPEN / T+1d : DAILY 경로 무변경
  // ────────────────────────────────────────────────────────
  describe('daily horizon 무변경', () => {
    for (const horizon of ['NEXT_OPEN', 'T_PLUS_1D_CLOSE'] as const) {
      it(`${horizon} — DAILY cache hit → DAILY_CANDLE_CACHE`, () => {
        const entry = makeEntry();
        // target 시각은 다음/+1 거래일 — 5d:1d range 에 충분히 미래 point 등록
        const entryMs = Date.parse(entry.createdAtKst);
        const futureMs = entryMs + 5 * 24 * 60 * 60_000;
        setSnapshot('005930.KS:5d:1d', {
          body: makeYahooBody([{ timestampMs: futureMs, close: 71_500 }]),
          contentType: 'application/json',
          fetchedAt: Date.now(),
        });
        const result = lookupCachedPrice(entry, horizon);
        expect(result?.source).toBe('DAILY_CANDLE_CACHE');
        expect(result?.price).toBe(71_500);
      });
    }
  });

  // ────────────────────────────────────────────────────────
  // (5) performance report de-inflation 통합 — 30m/1h DATA_UNAVAILABLE 시 winRate 가
  //     close/nextOpen/+1d 만으로 산출(부풀림 제거).
  // ────────────────────────────────────────────────────────
  describe('performance report de-inflation 통합', () => {
    it('intraday 부재 + coarser only → 30m/1h winRate 미산출, close/daily 만 OBSERVED', async () => {
      const entry = makeEntry({
        metadata: {
          // coarser source 만 존재 — 과거라면 30m/1h 도 같은 단일점으로 OBSERVED 됐을 것.
          readOnlyQuote: { lastPrice: 75_000 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      // nowKst 를 충분히 미래로 — 모든 horizon 도달.
      const report = await buildProvisionalShadowPerformanceReport({
        entries: [entry],
        nowKst: '2026-05-15T18:00:00+09:00',
        disableEnvCheck: true,
        priceProvider: createProvisionalShadowPriceProvider({ entries: [entry] }),
      });
      // 30m/1h 는 INTRADAY_CANDLE_CACHE 부재라 OBSERVED 자격 박탈 → winRate 미등록.
      expect(report.winRateByHorizon.T_PLUS_30M).toBeUndefined();
      expect(report.winRateByHorizon.T_PLUS_1H).toBeUndefined();
      // SAME_DAY_CLOSE 는 coarser fallback(READ_ONLY_QUOTE 75000 > entry 70000) → win 산출.
      expect(report.winRateByHorizon.SAME_DAY_CLOSE).toBe(1);
    });

    it('intraday candle 존재 시 30m/1h OBSERVED → winRate 산출(부풀림 아님, 진짜 intraday)', async () => {
      const entry = makeEntry();
      const entryMs = Date.parse(entry.createdAtKst);
      // 30m/1h 각각 별도 intraday point — distinct.
      setSnapshot('005930.KS:1d:1m', {
        body: makeYahooBody([
          { timestampMs: entryMs + 30 * 60_000, close: 71_000 },
          { timestampMs: entryMs + 60 * 60_000, close: 72_000 },
        ]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const report = await buildProvisionalShadowPerformanceReport({
        entries: [entry],
        nowKst: '2026-05-15T18:00:00+09:00',
        disableEnvCheck: true,
        priceProvider: createProvisionalShadowPriceProvider({ entries: [entry] }),
      });
      expect(report.winRateByHorizon.T_PLUS_30M).toBe(1);
      expect(report.winRateByHorizon.T_PLUS_1H).toBe(1);
    });
  });
});
