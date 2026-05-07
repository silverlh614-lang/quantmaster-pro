// @responsibility ADR-0439 lookupCachedPrice 4-tier wiring 회귀 테스트.
//
// 사용자 §C 결정 트리 + horizon 별 reader 라우팅 + 4 source (INTRADAY / DAILY / MARKET_DATA /
// READ_ONLY_QUOTE) + ENV gate 정확 비교 + 정적 grep 가드 (KIS 주문 import 0건 / fetch 0건 /
// counterfactual adapter 본체 변경 0).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createProvisionalShadowPriceProvider,
  isProvisionalCacheLookupDisabled,
  lookupCachedPrice,
  resolveHorizonTargetTimeKst,
} from './provisionalShadowPriceProvider.js';
import { __resetForTests, setSnapshot } from '../persistence/offHoursSnapshotRepo.js';
import type { ProvisionalShadowLedgerEntry } from '../persistence/provisionalShadowLedger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODULE_PATH = join(__dirname, 'provisionalShadowPriceProvider.ts');
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf-8');
const ADAPTER_PATH = join(__dirname, 'counterfactualShadowPriceProviderAdapter.ts');
const ADAPTER_SOURCE = readFileSync(ADAPTER_PATH, 'utf-8');

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

/**
 * Synthesize Yahoo chart API JSON body for a given timestamp+price pair.
 * Mirrors the structure parsed by `parseYahooChartBody` in counterfactualShadowPriceProviderAdapter.
 */
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

describe('ADR-0439 lookupCachedPrice 4-tier wiring', () => {
  beforeEach(() => {
    delete process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
    __resetForTests();
  });

  afterEach(() => {
    delete process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
    __resetForTests();
  });

  // ────────────────────────────────────────────────────────
  // ENV gate (사용자 §C #0)
  // ────────────────────────────────────────────────────────
  describe('ENV PROVISIONAL_CACHE_LOOKUP_DISABLED', () => {
    it('default (미설정) → false (cache lookup 활성)', () => {
      expect(isProvisionalCacheLookupDisabled()).toBe(false);
    });

    it("'true' 정확 일치 → true (legacy ADR-0429 동작 복원)", () => {
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = 'true';
      expect(isProvisionalCacheLookupDisabled()).toBe(true);
    });

    it("'1' 거부 (ADR-0157 정확 비교)", () => {
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = '1';
      expect(isProvisionalCacheLookupDisabled()).toBe(false);
    });

    it("'TRUE' 거부 (대문자 거부)", () => {
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = 'TRUE';
      expect(isProvisionalCacheLookupDisabled()).toBe(false);
    });

    it("'yes' 거부 / 빈 문자열 거부", () => {
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = 'yes';
      expect(isProvisionalCacheLookupDisabled()).toBe(false);
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = '';
      expect(isProvisionalCacheLookupDisabled()).toBe(false);
    });

    it('ENV true 시 lookupCachedPrice null 반환 (legacy 동작)', () => {
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = 'true';
      const entry = makeEntry();
      expect(lookupCachedPrice(entry, 'T_PLUS_30M')).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────
  // SCAN_SNAPSHOT — entry.metadata.scanQuote 우선 (사용자 §B #2)
  // ────────────────────────────────────────────────────────
  describe('SCAN_SNAPSHOT', () => {
    it('entry.metadata.scanQuote.lastPrice 양수 → SCAN_SNAPSHOT 반환 (모든 horizon)', () => {
      const entry = makeEntry({
        metadata: {
          scanQuote: {
            lastPrice: 71_000,
            observedAtKst: '2026-05-07T10:00:00+09:00',
          },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      expect(result).not.toBeNull();
      expect(result?.source).toBe('SCAN_SNAPSHOT');
      expect(result?.price).toBe(71_000);
      expect(result?.observedAtKst).toBe('2026-05-07T10:00:00+09:00');
    });

    it('scanQuote.lastPrice 부재 → SCAN_SNAPSHOT skip → 다음 reader 진입', () => {
      const entry = makeEntry({
        metadata: {
          scanQuote: undefined,
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      // cache 부재 + readOnlyQuote 도 부재 → null
      expect(result).toBeNull();
    });

    it('scanQuote.lastPrice ≤ 0 거부 → SCAN_SNAPSHOT skip', () => {
      const entry = makeEntry({
        metadata: {
          scanQuote: { lastPrice: 0 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      expect(lookupCachedPrice(entry, 'T_PLUS_30M')).toBeNull();
    });

    it('scanQuote.observedAtKst 부재 → entry.createdAtKst fallback', () => {
      const entry = makeEntry({
        metadata: {
          scanQuote: { lastPrice: 71_500 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      expect(result?.observedAtKst).toBe(entry.createdAtKst);
    });
  });

  // ────────────────────────────────────────────────────────
  // INTRADAY_CANDLE_CACHE reader (T+30m / T+1h / SAME_DAY_CLOSE 우선)
  // ────────────────────────────────────────────────────────
  describe('INTRADAY_CANDLE_CACHE', () => {
    it('T+30m horizon — 1m interval cache hit → INTRADAY_CANDLE_CACHE', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'T_PLUS_30M');
      expect(target).not.toBeNull();
      const targetMs = Date.parse(target!);
      // Yahoo proxy snapshot key: ${normalizedSymbol}:${range}:${interval}
      // 005930 → 005930.KS (KRX 6자리 정규화)
      setSnapshot('005930.KS:1d:1m', {
        body: makeYahooBody([{ timestampMs: targetMs, close: 71_500 }]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      expect(result).not.toBeNull();
      expect(result?.source).toBe('INTRADAY_CANDLE_CACHE');
      expect(result?.price).toBe(71_500);
    });

    it('T+1h horizon — 5m interval fallback (1m miss → 5m hit)', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'T_PLUS_1H');
      const targetMs = Date.parse(target!);
      // 1m: empty (no points), 5m: hit
      setSnapshot('005930.KS:1d:1m', {
        body: makeYahooBody([]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      setSnapshot('005930.KS:1d:5m', {
        body: makeYahooBody([{ timestampMs: targetMs, close: 72_100 }]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_1H');
      expect(result?.source).toBe('INTRADAY_CANDLE_CACHE');
      expect(result?.price).toBe(72_100);
    });

    it('SAME_DAY_CLOSE — 1h interval fallback', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'SAME_DAY_CLOSE');
      const targetMs = Date.parse(target!);
      setSnapshot('005930.KS:1d:1h', {
        body: makeYahooBody([{ timestampMs: targetMs, close: 73_000 }]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'SAME_DAY_CLOSE');
      expect(result?.source).toBe('INTRADAY_CANDLE_CACHE');
      expect(result?.price).toBe(73_000);
    });

    it('cache 부재 — 모든 interval miss → null', () => {
      const entry = makeEntry();
      // no snapshots set
      expect(lookupCachedPrice(entry, 'T_PLUS_30M')).toBeNull();
    });

    it('잘못된 symbol (.KS suffix 부재 — 6자리 외) → snapshot key mismatch → null', () => {
      const entry = makeEntry({ symbol: 'INVALID' });
      // Yahoo normalizeYahooSymbol: 6자리만 .KS suffix 부착, 그 외 그대로
      // setSnapshot 'INVALID:1d:1m' 로 등록해야 hit, 005930.KS 와 무관
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────
  // DAILY_CANDLE_CACHE reader (NEXT_OPEN / T+1d_close / T+3d_close 우선)
  // ────────────────────────────────────────────────────────
  describe('DAILY_CANDLE_CACHE', () => {
    it('NEXT_OPEN horizon — 5d range cache hit → DAILY_CANDLE_CACHE', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'NEXT_OPEN');
      expect(target).not.toBeNull();
      const targetMs = Date.parse(target!);
      setSnapshot('005930.KS:5d:1d', {
        body: makeYahooBody([{ timestampMs: targetMs, close: 71_800 }]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'NEXT_OPEN');
      expect(result?.source).toBe('DAILY_CANDLE_CACHE');
      expect(result?.price).toBe(71_800);
    });

    it('T+1d_close horizon — 1y range fallback (5d/1mo miss → 1y hit)', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'T_PLUS_1D_CLOSE');
      const targetMs = Date.parse(target!);
      setSnapshot('005930.KS:5d:1d', {
        body: makeYahooBody([]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      setSnapshot('005930.KS:1mo:1d', {
        body: makeYahooBody([]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      setSnapshot('005930.KS:1y:1d', {
        body: makeYahooBody([{ timestampMs: targetMs, close: 70_900 }]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_1D_CLOSE');
      expect(result?.source).toBe('DAILY_CANDLE_CACHE');
      expect(result?.price).toBe(70_900);
    });

    it('T+3d_close horizon — daily reader 우선 적용', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'T_PLUS_3D_CLOSE');
      expect(target).not.toBeNull();
      const targetMs = Date.parse(target!);
      setSnapshot('005930.KS:5d:1d', {
        body: makeYahooBody([{ timestampMs: targetMs, close: 73_200 }]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_3D_CLOSE');
      expect(result?.source).toBe('DAILY_CANDLE_CACHE');
      expect(result?.price).toBe(73_200);
    });

    it('NaN price 거부 → null (다음 range 시도)', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'NEXT_OPEN');
      const targetMs = Date.parse(target!);
      // close 가 null 인 경우 — parseYahooChartBody 가 isPositiveFinite 검증으로 skip
      const bodyWithNull = JSON.stringify({
        chart: {
          result: [
            {
              timestamp: [Math.floor(targetMs / 1000)],
              indicators: { quote: [{ close: [null] }] },
            },
          ],
        },
      });
      setSnapshot('005930.KS:5d:1d', {
        body: bodyWithNull,
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      // 5d/1mo/1y 모두 무효 → DAILY null → MARKET_DATA → READ_ONLY_QUOTE 모두 miss → null
      expect(lookupCachedPrice(entry, 'NEXT_OPEN')).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────
  // MARKET_DATA_CACHE — INTRADAY/DAILY 모두 miss 후 latest mode fallback
  // ────────────────────────────────────────────────────────
  describe('MARKET_DATA_CACHE', () => {
    it('INTRADAY/DAILY miss → MARKET_DATA latest mode fallback', () => {
      const entry = makeEntry();
      const target = resolveHorizonTargetTimeKst(entry.createdAtKst, 'NEXT_OPEN');
      const targetMs = Date.parse(target!);
      // DAILY (5d/1mo/1y) 모두 closest 부재 — at-or-after 0 points
      // BUT 5d:1d snapshot 에 *과거* point 만 있으면 DAILY closest miss + MARKET_DATA latest hit
      setSnapshot('005930.KS:5d:1d', {
        body: makeYahooBody([
          { timestampMs: targetMs - 10 * 24 * 60 * 60 * 1_000, close: 69_500 }, // 10 days BEFORE target
        ]),
        contentType: 'application/json',
        fetchedAt: Date.now(),
      });
      // DAILY closest at-or-after target: empty
      // But MARKET_DATA latest mode: 5d:1d hit (gives the past point)
      const result = lookupCachedPrice(entry, 'NEXT_OPEN');
      expect(result?.source).toBe('MARKET_DATA_CACHE');
      expect(result?.price).toBe(69_500);
    });

    it('cache 모두 부재 → MARKET_DATA 도 null → READ_ONLY_QUOTE 시도', () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: 70_500 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'NEXT_OPEN');
      // MARKET_DATA cache 0건 → READ_ONLY_QUOTE 70500
      expect(result?.source).toBe('READ_ONLY_QUOTE');
      expect(result?.price).toBe(70_500);
    });
  });

  // ────────────────────────────────────────────────────────
  // READ_ONLY_QUOTE — 마지막 fallback
  // ────────────────────────────────────────────────────────
  describe('READ_ONLY_QUOTE', () => {
    it('cache 모두 miss + readOnlyQuote.lastPrice 양수 → READ_ONLY_QUOTE', () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: {
            lastPrice: 70_500,
            observedAtKst: '2026-05-07T10:30:00+09:00',
          },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      expect(result?.source).toBe('READ_ONLY_QUOTE');
      expect(result?.price).toBe(70_500);
      expect(result?.observedAtKst).toBe('2026-05-07T10:30:00+09:00');
    });

    it('readOnlyQuote.lastPrice = 0 거부 → null', () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: 0 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      expect(lookupCachedPrice(entry, 'T_PLUS_30M')).toBeNull();
    });

    it('readOnlyQuote.lastPrice 음수 거부 → null', () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: -100 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      expect(lookupCachedPrice(entry, 'T_PLUS_30M')).toBeNull();
    });

    it('observedAtKst 부재 → entry.createdAtKst fallback', () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: 70_000 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const result = lookupCachedPrice(entry, 'T_PLUS_30M');
      expect(result?.observedAtKst).toBe(entry.createdAtKst);
    });
  });

  // ────────────────────────────────────────────────────────
  // createProvisionalShadowPriceProvider 통합 (ENV + cache 결합)
  // ────────────────────────────────────────────────────────
  describe('createProvisionalShadowPriceProvider 통합', () => {
    it('ENV PROVISIONAL_CACHE_LOOKUP_DISABLED → cache lookup skip → DATA_UNAVAILABLE', async () => {
      process.env.PROVISIONAL_CACHE_LOOKUP_DISABLED = 'true';
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: 70_500 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const result = await provider(entry.symbol, 'T_PLUS_30M', entry.createdAtKst);
      expect(result.available).toBe(false);
      if (!result.available) expect(result.status).toBe('DATA_UNAVAILABLE');
    });

    it('cache hit → OBSERVED + price (source 필드 미노출, 시그니처 변경 0)', async () => {
      const entry = makeEntry({
        metadata: {
          readOnlyQuote: { lastPrice: 70_500 },
        } as unknown as ProvisionalShadowLedgerEntry['metadata'],
      });
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const result = await provider(entry.symbol, 'T_PLUS_30M', entry.createdAtKst);
      expect(result.available).toBe(true);
      if (result.available) expect(result.price).toBe(70_500);
    });

    it('cache miss + maxExternalLookups=0 → DATA_UNAVAILABLE (cache-only 정책 보존)', async () => {
      const entry = makeEntry();
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const result = await provider(entry.symbol, 'T_PLUS_30M', entry.createdAtKst);
      expect(result.available).toBe(false);
      if (!result.available) expect(result.status).toBe('DATA_UNAVAILABLE');
    });

    it('entry not found → DATA_UNAVAILABLE', async () => {
      const provider = createProvisionalShadowPriceProvider({ entries: [] });
      const result = await provider(
        '005930',
        'T_PLUS_30M',
        '2026-05-07T10:00:00+09:00',
      );
      expect(result.available).toBe(false);
      if (!result.available) expect(result.status).toBe('DATA_UNAVAILABLE');
    });
  });

  // ────────────────────────────────────────────────────────
  // 정적 grep 가드 — KIS 주문 5종 / fetch / axios / counterfactual adapter 본체 변경 0 / write 0
  // ────────────────────────────────────────────────────────
  describe('정적 grep 가드 (안전 invariant)', () => {
    it('KIS 주문 함수 5종 import 0건 (placeKisMarketOrder / placeKisSellOrder / cancelKisOrder / placeKisStopLossOrder / placeKisTakeProfitOrder)', () => {
      const banned = [
        'placeKisMarketOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ];
      for (const fn of banned) {
        expect(MODULE_SOURCE).not.toContain(fn);
      }
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
      expect(MODULE_SOURCE).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
      expect(MODULE_SOURCE).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
      expect(MODULE_SOURCE).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
    });

    it('fetch / axios / node-fetch 신규 import 0건 (cache-only 정책 보존)', () => {
      expect(MODULE_SOURCE).not.toMatch(/from\s+['"]axios['"]/);
      expect(MODULE_SOURCE).not.toMatch(/from\s+['"]node-fetch['"]/);
      // fetch 는 globalThis 인지 확인 — `fetch(` 직접 호출 0건
      expect(MODULE_SOURCE).not.toMatch(/[^a-zA-Z]fetch\s*\(/);
    });

    it('counterfactualShadowPriceProviderAdapter 본체 0줄 변경 (export 키워드만 추가)', () => {
      // ParsedYahooPoint / parseYahooChartBody / readYahooSnapshotPoint / normalizeYahooSymbol /
      // closestPointAtOrAfter / latestPoint 모두 export 되어 있어야 함 (drift 차단)
      expect(ADAPTER_SOURCE).toMatch(/export\s+function\s+normalizeYahooSymbol/);
      expect(ADAPTER_SOURCE).toMatch(/export\s+interface\s+ParsedYahooPoint/);
      expect(ADAPTER_SOURCE).toMatch(/export\s+function\s+parseYahooChartBody/);
      expect(ADAPTER_SOURCE).toMatch(/export\s+function\s+closestPointAtOrAfter/);
      expect(ADAPTER_SOURCE).toMatch(/export\s+function\s+latestPoint/);
      expect(ADAPTER_SOURCE).toMatch(/export\s+function\s+readYahooSnapshotPoint/);
    });

    it('Yahoo proxy cache write 0건 (read-only) — setSnapshot import 0건', () => {
      expect(MODULE_SOURCE).not.toMatch(/setSnapshot\b/);
    });

    it('counterfactualShadowPriceProviderAdapter 헬퍼 import 정합', () => {
      // 본 PR 의 핵심 — adapter 헬퍼 reuse (drift 차단)
      expect(MODULE_SOURCE).toContain('counterfactualShadowPriceProviderAdapter');
      expect(MODULE_SOURCE).toMatch(/readYahooSnapshotPoint/);
      expect(MODULE_SOURCE).toMatch(/ParsedYahooPoint/);
    });

    it('lookupCachedPrice 본체에 ENV 가드 (PROVISIONAL_CACHE_LOOKUP_DISABLED) 존재', () => {
      expect(MODULE_SOURCE).toContain('PROVISIONAL_CACHE_LOOKUP_DISABLED');
      expect(MODULE_SOURCE).toMatch(/isProvisionalCacheLookupDisabled/);
    });

    it('horizon → reader 라우팅 SSOT — isIntradayHorizon 함수 존재', () => {
      expect(MODULE_SOURCE).toMatch(/isIntradayHorizon/);
    });

    it('ProvisionalShadowPriceProvider 시그니처 변경 0 — caller 무수정', () => {
      // 기존 ProvisionalShadowPriceProvider 시그니처는 source 필드 미포함
      // available: true 시 { available, price, observedAtKst } 만 반환
      // source 는 cached price 반환 객체에만 (lookupCachedPrice 내부 진단용)
      expect(MODULE_SOURCE).toMatch(/available:\s*true,\s*\n\s*price:/);
    });
  });
});
