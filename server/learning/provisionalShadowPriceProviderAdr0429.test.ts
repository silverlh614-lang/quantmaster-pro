// @responsibility ADR-0429 cache-first priceProvider 회귀 테스트.
//
// 사용자 §I 17 케이스 — entry validation / horizon 도달 / entryPrice 확보 / DATA_UNAVAILABLE
// 안전 fallback / KIS 주문 import 0건 정적 grep 가드.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createProvisionalShadowPriceProvider,
  findNthTradingDayAfter,
  getMaxExternalLookups,
  isHorizonReached,
  isProvisionalPriceProviderDisabled,
  PROVISIONAL_HORIZON_OFFSET_MS,
  resolveEntryPrice,
  resolveHorizonTargetTimeKst,
  wrapAsProviderObject,
  type ProvisionalShadowPriceSource,
} from './provisionalShadowPriceProvider.js';
import type { ProvisionalShadowLedgerEntry } from '../persistence/provisionalShadowLedger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODULE_PATH = join(__dirname, 'provisionalShadowPriceProvider.ts');
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf-8');

function makeEntry(
  overrides: Partial<ProvisionalShadowLedgerEntry & { entryPrice?: number }> = {},
): ProvisionalShadowLedgerEntry {
  return {
    eventType: 'PROVISIONAL_SHADOW_ENTRY',
    provisional: true,
    source: 'ADR-0426',
    symbol: '005930',
    name: '삼성전자',
    scanId: '2026-05-07:scan-1',
    scannedAtKst: '2026-05-07T10:00:00+09:00',
    createdAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
    reasons: ['R3_EARLY', 'GATE1_SURVIVOR'],
    regime: 'R3_EARLY',
    gate1Passed: true,
    gate2Passed: false,
    liveAllowed: false,
    shadowAllowed: true,
    ...overrides,
  } as ProvisionalShadowLedgerEntry;
}

describe('ADR-0429 Provisional Shadow priceProvider', () => {
  beforeEach(() => {
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
  });

  afterEach(() => {
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED;
    delete process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS;
  });

  // ────────────────────────────────────────────────────────
  // SSOT 정합 — HORIZON_OFFSET_MS Object.freeze + ADR-0428 정합
  // ────────────────────────────────────────────────────────
  it('PROVISIONAL_HORIZON_OFFSET_MS Object.freeze SSOT', () => {
    expect(Object.isFrozen(PROVISIONAL_HORIZON_OFFSET_MS)).toBe(true);
    expect(PROVISIONAL_HORIZON_OFFSET_MS.T_PLUS_30M).toBe(30 * 60 * 1_000);
    expect(PROVISIONAL_HORIZON_OFFSET_MS.T_PLUS_1H).toBe(60 * 60 * 1_000);
    expect(PROVISIONAL_HORIZON_OFFSET_MS.T_PLUS_3D_CLOSE).toBe(80 * 60 * 60 * 1_000);
  });

  // ────────────────────────────────────────────────────────
  // §D #1: T_PLUS_30M 도달 검증
  // ────────────────────────────────────────────────────────
  describe('isHorizonReached', () => {
    it('T+30m 미도달 (entry 후 5분) → false', () => {
      const entry = '2026-05-07T10:00:00+09:00';
      const now = Date.parse('2026-05-07T10:05:00+09:00');
      expect(isHorizonReached(entry, 'T_PLUS_30M', now)).toBe(false);
    });

    it('T+30m 도달 (entry 후 35분) → true', () => {
      const entry = '2026-05-07T10:00:00+09:00';
      const now = Date.parse('2026-05-07T10:35:00+09:00');
      expect(isHorizonReached(entry, 'T_PLUS_30M', now)).toBe(true);
    });

    it('T+1H boundary — 정확 1시간 → true', () => {
      const entry = '2026-05-07T10:00:00+09:00';
      const now = Date.parse('2026-05-07T11:00:00+09:00');
      expect(isHorizonReached(entry, 'T_PLUS_1H', now)).toBe(true);
    });

    it('잘못된 entry ISO → false (안전 fallback)', () => {
      expect(isHorizonReached('invalid-iso', 'T_PLUS_30M', Date.now())).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────
  // §D resolveHorizonTargetTimeKst
  // ────────────────────────────────────────────────────────
  describe('resolveHorizonTargetTimeKst', () => {
    it('T+30m → entry + 30분 ISO', () => {
      const result = resolveHorizonTargetTimeKst('2026-05-07T10:00:00+09:00', 'T_PLUS_30M');
      expect(result).toBeTruthy();
      expect(Date.parse(result!)).toBe(Date.parse('2026-05-07T10:30:00+09:00'));
    });

    it('SAME_DAY_CLOSE → entry 거래일 KST 15:30', () => {
      const result = resolveHorizonTargetTimeKst('2026-05-07T10:00:00+09:00', 'SAME_DAY_CLOSE');
      expect(result).toBe('2026-05-07T15:30:00+09:00');
    });

    it('NEXT_OPEN — 평일 entry → 다음 거래일 09:00 KST (KRX 휴장일 자동 skip)', () => {
      // 2026-05-07 (목) → 2026-05-08 (금)
      const result = resolveHorizonTargetTimeKst('2026-05-07T10:00:00+09:00', 'NEXT_OPEN');
      expect(result).toBe('2026-05-08T09:00:00+09:00');
    });

    it('NEXT_OPEN — 금요일 entry → 다음 월요일 09:00 (주말 skip)', () => {
      // 2026-05-08 (금) → 2026-05-11 (월)
      const result = resolveHorizonTargetTimeKst('2026-05-08T10:00:00+09:00', 'NEXT_OPEN');
      expect(result).toBe('2026-05-11T09:00:00+09:00');
    });

    it('T+1d_close → 다음 거래일 KST 15:30', () => {
      const result = resolveHorizonTargetTimeKst('2026-05-07T10:00:00+09:00', 'T_PLUS_1D_CLOSE');
      expect(result).toBe('2026-05-08T15:30:00+09:00');
    });

    it('T+3d_close → 3 거래일 후 KST 15:30', () => {
      // 2026-05-07 (목) + 3 거래일 → 2026-05-12 (화)
      const result = resolveHorizonTargetTimeKst('2026-05-07T10:00:00+09:00', 'T_PLUS_3D_CLOSE');
      expect(result).toBe('2026-05-12T15:30:00+09:00');
    });

    it('잘못된 entry ISO → null', () => {
      expect(resolveHorizonTargetTimeKst('invalid', 'SAME_DAY_CLOSE')).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────
  // findNthTradingDayAfter — KRX 휴장일 skip
  // ────────────────────────────────────────────────────────
  describe('findNthTradingDayAfter', () => {
    it('평일 → 다음 거래일', () => {
      expect(findNthTradingDayAfter('2026-05-07', 1)).toBe('2026-05-08');
    });

    it('금요일 + 1 → 다음 월요일', () => {
      expect(findNthTradingDayAfter('2026-05-08', 1)).toBe('2026-05-11');
    });

    it('잘못된 date → null', () => {
      expect(findNthTradingDayAfter('not-a-date', 1)).toBeNull();
    });

    it('n=0 → null', () => {
      expect(findNthTradingDayAfter('2026-05-07', 0)).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────
  // §E entryPrice 확보 우선순위
  // ────────────────────────────────────────────────────────
  describe('§E resolveEntryPrice', () => {
    it('§I#1: entryPrice 직접 보유 → 반환', () => {
      const entry = makeEntry({ entryPrice: 75000 });
      expect(resolveEntryPrice(entry)).toBe(75000);
    });

    it('§I#2: entryPrice 부재 → undefined (INSUFFICIENT_DATA caller 처리)', () => {
      const entry = makeEntry();
      expect(resolveEntryPrice(entry)).toBeUndefined();
    });

    it('NaN/0/음수 → undefined (안전 fallback)', () => {
      expect(resolveEntryPrice(makeEntry({ entryPrice: NaN }))).toBeUndefined();
      expect(resolveEntryPrice(makeEntry({ entryPrice: 0 }))).toBeUndefined();
      expect(resolveEntryPrice(makeEntry({ entryPrice: -100 }))).toBeUndefined();
    });

    it('metadata.entryPriceHint fallback', () => {
      const entry = makeEntry({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: { entryPriceHint: 80000 } as any,
      });
      expect(resolveEntryPrice(entry)).toBe(80000);
    });
  });

  // ────────────────────────────────────────────────────────
  // ENV 우회
  // ────────────────────────────────────────────────────────
  describe('ENV 우회', () => {
    it('isProvisionalPriceProviderDisabled — default false', () => {
      expect(isProvisionalPriceProviderDisabled()).toBe(false);
    });

    it('=true → true', () => {
      process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED = 'true';
      expect(isProvisionalPriceProviderDisabled()).toBe(true);
    });

    it('"1"/"TRUE"/"yes" 거부 (정확 비교)', () => {
      for (const v of ['1', 'TRUE', 'yes']) {
        process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED = v;
        expect(isProvisionalPriceProviderDisabled()).toBe(false);
      }
    });

    it('getMaxExternalLookups default 0 (cache-only)', () => {
      expect(getMaxExternalLookups()).toBe(0);
    });

    it('getMaxExternalLookups ENV 설정 시 그대로 (양수)', () => {
      process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS = '5';
      expect(getMaxExternalLookups()).toBe(5);
    });

    it('getMaxExternalLookups 음수/NaN → 0 (안전)', () => {
      process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS = '-5';
      expect(getMaxExternalLookups()).toBe(0);
      process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_MAX_EXTERNAL_LOOKUPS = 'invalid';
      expect(getMaxExternalLookups()).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────
  // createProvisionalShadowPriceProvider — Provider 동작
  // ────────────────────────────────────────────────────────
  describe('createProvisionalShadowPriceProvider', () => {
    it('§I#5: ENV DISABLED → DATA_UNAVAILABLE', async () => {
      process.env.PROVISIONAL_SHADOW_PRICE_PROVIDER_DISABLED = 'true';
      const entry = makeEntry({ entryPrice: 75000 });
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const result = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.status).toBe('DATA_UNAVAILABLE');
        expect(result.reason).toContain('DISABLED');
      }
    });

    it('§I#6: entry 미발견 → DATA_UNAVAILABLE', async () => {
      const provider = createProvisionalShadowPriceProvider({ entries: [] });
      const result = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.status).toBe('DATA_UNAVAILABLE');
        expect(result.reason).toContain('entry not found');
      }
    });

    it('§I#7: entryPrice 부재 → DATA_UNAVAILABLE (INSUFFICIENT_DATA 의미)', async () => {
      const entry = makeEntry();  // entryPrice 부재
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const result = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.status).toBe('DATA_UNAVAILABLE');
        expect(result.reason).toContain('entryPrice');
      }
    });

    it('§I#5 (cache miss + maxExternal=0) → DATA_UNAVAILABLE (외부 호출 0)', async () => {
      const entry = makeEntry({ entryPrice: 75000 });
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const result = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.status).toBe('DATA_UNAVAILABLE');
        expect(result.reason).toContain('cache-only');
      }
    });

    it('§I#10: 외부 lookup 활성 (maxExternalLookups=5) → 후속 PR scope DATA_UNAVAILABLE', async () => {
      const entry = makeEntry({ entryPrice: 75000 });
      const provider = createProvisionalShadowPriceProvider({
        entries: [entry],
        maxExternalLookups: 5,
      });
      const result = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.status).toBe('DATA_UNAVAILABLE');
        expect(result.reason).toContain('external lookup not implemented');
      }
    });

    it('multi-entry index — symbol 같지만 createdAtKst 다른 entry 분리', async () => {
      const e1 = makeEntry({
        entryPrice: 75000,
        createdAtKst: '2026-05-07T10:00:00+09:00',
      });
      const e2 = makeEntry({
        entryPrice: 76000,
        createdAtKst: '2026-05-08T10:00:00+09:00',
      });
      const provider = createProvisionalShadowPriceProvider({ entries: [e1, e2] });
      const r1 = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
      const r2 = await provider('005930', 'T_PLUS_30M', '2026-05-08T10:00:00+09:00');
      // 둘 다 cache miss → DATA_UNAVAILABLE 하지만 *entry 발견*
      expect(r1.available).toBe(false);
      expect(r2.available).toBe(false);
      if (!r1.available) expect(r1.reason).not.toContain('entry not found');
      if (!r2.available) expect(r2.reason).not.toContain('entry not found');
    });
  });

  // ────────────────────────────────────────────────────────
  // wrapAsProviderObject — 사용자 §C 권장 객체 시그니처 어댑터
  // ────────────────────────────────────────────────────────
  describe('wrapAsProviderObject', () => {
    it('객체 시그니처 — getObservedPrice 반환 형식', async () => {
      const entry = makeEntry({ entryPrice: 75000 });
      const provider = createProvisionalShadowPriceProvider({ entries: [entry] });
      const obj = wrapAsProviderObject(provider);
      const result = await obj.getObservedPrice({
        symbol: '005930',
        entryAtKst: '2026-05-07T10:00:00+09:00',
        horizon: 'T_PLUS_30M',
      });
      expect(result.symbol).toBe('005930');
      expect(result.horizon).toBe('T_PLUS_30M');
      expect(result.status).toBe('DATA_UNAVAILABLE');
      const expectedSource: ProvisionalShadowPriceSource = 'NONE';
      expect(result.source).toBe(expectedSource);
    });
  });

  // ────────────────────────────────────────────────────────
  // §I#15: provisional=false / source≠ADR-0426 entry 처리
  // ────────────────────────────────────────────────────────
  it('§I#15: provisional=false entry — provider index 에는 등록되지만 buildReport 가 무시', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generalShadow: any = {
      eventType: 'BUY',
      provisional: false,
      source: 'GENERAL',
      symbol: '005930',
      createdAtKst: '2026-05-07T10:00:00+09:00',
      entryPrice: 75000,
    };
    const provider = createProvisionalShadowPriceProvider({ entries: [generalShadow] });
    // Provider 자체는 entry 검증 안 함 — buildReport (ADR-0428) 가 isValidProvisionalEntry 검증.
    // 본 PR scope: provider index 에 등록되어 entry 발견 가능 — buildReport 단에서 분리 차단 검증은
    // ADR-0428 회귀 테스트에서 보장.
    const result = await provider('005930', 'T_PLUS_30M', '2026-05-07T10:00:00+09:00');
    expect(result.available).toBe(false);
    // entry 발견 + entryPrice 보유 → cache miss 분기 도달
    if (!result.available) {
      expect(result.reason).toContain('cache-only');
    }
  });

  // ────────────────────────────────────────────────────────
  // §I#17 정적 grep 가드 — KIS 주문 import 0건 + 정책 변경 0
  // ────────────────────────────────────────────────────────
  describe('§I#17: 정적 grep 가드 — LIVE 매매 영향 0', () => {
    function stripComments(src: string): string {
      return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    }
    const STRIPPED = stripComments(MODULE_SOURCE);

    it('KIS 주문 함수 5종 import 0건', () => {
      expect(STRIPPED).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/);
    });

    it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
      expect(STRIPPED).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/);
    });

    it('shadowTradeRepo / shadow-trades.json import 0건 — provisional ledger 만', () => {
      expect(STRIPPED).not.toMatch(/shadowTradeRepo|appendShadow|saveShadowTrades|shadow-trades\.json/);
    });

    it('Gate threshold / STRONG_BUY / 자동 승격 키워드 부재', () => {
      expect(STRIPPED).not.toMatch(/setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX/);
      expect(STRIPPED).not.toMatch(/STRONG_BUY_OVERRIDE|setStrongBuyThreshold/);
      expect(STRIPPED).not.toMatch(/promoteToPaper|promoteToLive|autoPromote/);
    });

    it('직접 fetch / axios / node-fetch import 0건 (cache-only)', () => {
      expect(STRIPPED).not.toMatch(/^import.*['"](?:fetch|axios|node-fetch)/m);
      expect(STRIPPED).not.toMatch(/\bfetch\(/);
    });

    it('ENV 정확 비교 (ADR-0157)', () => {
      expect(STRIPPED).toContain("=== 'true'");
    });
  });
});
