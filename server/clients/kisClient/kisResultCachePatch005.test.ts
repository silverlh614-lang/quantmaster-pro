/**
 * Patch-KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001 회귀 — result cache.
 *
 * 사용자 §10 5초 TTL result cache by trId+symbol+params 정합 + P0 절대 보호 + 정적 grep 가드.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESULT_CACHE_TTL_MS,
  __resetKisTrResultCacheForTests,
  buildParamsHash,
  buildResultCacheKey,
  formatKisTrTtlCacheHitLog,
  getResultCacheSize,
  isKisResultCacheDisabled,
  lookupKisTrResultCache,
  storeKisTrResultCache,
} from './kisResultCachePatch005.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Patch-005 result cache — ENV gate (ADR-0157 정확 비교)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetKisTrResultCacheForTests();
    delete process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default OFF', () => {
    expect(isKisResultCacheDisabled()).toBe(false);
  });
  it('=== "true" 시 active', () => {
    process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED = 'true';
    expect(isKisResultCacheDisabled()).toBe(true);
  });
  it("'1' / 'TRUE' / 'yes' / 빈값 모두 default", () => {
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED = v;
      expect(isKisResultCacheDisabled()).toBe(false);
    }
  });
});

describe('Patch-005 buildParamsHash — stable hash SSOT', () => {
  it('빈/null/undefined 안전', () => {
    expect(buildParamsHash({})).toBe('NO_PARAMS');
    // null 입력 — 호출자 측 책임이지만 type-cast 시뮬레이션
    expect(buildParamsHash(null as unknown as Record<string, unknown>)).toBe('NO_PARAMS');
    expect(buildParamsHash(undefined as unknown as Record<string, unknown>)).toBe(
      'NO_PARAMS',
    );
  });
  it('key 정렬 안정성 — 동일 객체 다른 입력 순서에서 동일 hash', () => {
    const a = buildParamsHash({ b: 2, a: 1, c: 3 });
    const b = buildParamsHash({ a: 1, c: 3, b: 2 });
    const c = buildParamsHash({ c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
  it('primitive 값 분리 표기', () => {
    expect(buildParamsHash({ a: 'x' })).toBe('a=x');
    expect(buildParamsHash({ a: 1 })).toBe('a=1');
    expect(buildParamsHash({ a: true })).toBe('a=true');
    expect(buildParamsHash({ a: null })).toBe('a=null');
    expect(buildParamsHash({ a: undefined })).toBe('a=undef');
  });
  it('object/array 값 JSON serialize', () => {
    const h = buildParamsHash({ a: { b: 1 } });
    expect(h).toContain('a=');
    expect(h).toContain('{');
  });
  it('다중 키 정확한 |구분', () => {
    const h = buildParamsHash({ a: 1, b: 2 });
    expect(h.split('|').length).toBe(2);
    expect(h).toContain('a=1');
    expect(h).toContain('b=2');
  });
});

describe('Patch-005 buildResultCacheKey — composite SSOT', () => {
  it('trId + symbol + paramsHash 결합', () => {
    const key = buildResultCacheKey('FHKST01010100', '005930', { fid: 'J' });
    expect(key).toContain('FHKST01010100');
    expect(key).toContain('005930');
    expect(key).toContain('fid=J');
  });
  it('빈 params 도 안정적', () => {
    const key = buildResultCacheKey('TR1', 'AAA', {});
    expect(key).toBe('TR1:AAA:NO_PARAMS');
  });
});

describe('Patch-005 lookupKisTrResultCache — 결정 트리 SSOT', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    __resetKisTrResultCacheForTests();
    delete process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('ENV_DISABLED — skipReason ENV_DISABLED + hit=false', () => {
    process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED = 'true';
    storeKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {}, { v: 1 });
    const r = lookupKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {});
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('ENV_DISABLED');
  });

  it('P0_EXCLUSION — 보유 매도 최신 데이터 의무 (사용자 명시 절대 불변식)', () => {
    storeKisTrResultCache('TR1', 'AAA', 'P0_POSITION_EXIT', {}, { v: 1 });
    const r = lookupKisTrResultCache('TR1', 'AAA', 'P0_POSITION_EXIT', {});
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('P0_EXCLUSION');
  });

  it('CACHE_MISS — 미저장 키', () => {
    const r = lookupKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {});
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('CACHE_MISS');
  });

  it('hit + age ≤ TTL', () => {
    const t0 = 1_000_000;
    storeKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      { fid: 'J' },
      { v: 1 },
      t0,
    );
    const r = lookupKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      { fid: 'J' },
      t0 + 1000,
    );
    expect(r.hit).toBe(true);
    expect(r.result).toEqual({ v: 1 });
    expect(r.ageMs).toBe(1000);
  });

  it('CACHE_EXPIRED — age > TTL + entry 자동 제거', () => {
    const t0 = 1_000_000;
    storeKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      { v: 1 },
      t0,
    );
    expect(getResultCacheSize()).toBe(1);
    const r = lookupKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      t0 + 6000,
    );
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('CACHE_EXPIRED');
    expect(getResultCacheSize()).toBe(0);
  });

  it('TTL = 5000ms 절대 변경 금지', () => {
    expect(RESULT_CACHE_TTL_MS).toBe(5000);
  });
});

describe('Patch-005 storeKisTrResultCache — 절대 불변식', () => {
  beforeEach(() => {
    __resetKisTrResultCacheForTests();
    delete process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED;
  });

  it('ENV_DISABLED → no-op', () => {
    process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED = 'true';
    storeKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {}, { v: 1 });
    expect(getResultCacheSize()).toBe(0);
  });

  it('P0_POSITION_EXIT → no-op (사용자 §10 절대 불변식)', () => {
    storeKisTrResultCache('TR1', 'AAA', 'P0_POSITION_EXIT', {}, { v: 1 });
    expect(getResultCacheSize()).toBe(0);
  });

  it('null result → no-op (실패 응답 cache 금지)', () => {
    storeKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {}, null);
    expect(getResultCacheSize()).toBe(0);
  });

  it('undefined result → no-op', () => {
    storeKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      undefined,
    );
    expect(getResultCacheSize()).toBe(0);
  });

  it('정상 응답 + non-P0 priority → store', () => {
    storeKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {}, { v: 1 });
    expect(getResultCacheSize()).toBe(1);
  });

  it('Light prune — 100건 초과 시 만료 entry 정리', () => {
    const t0 = 1_000_000;
    // 105 entries 저장
    for (let i = 0; i < 105; i++) {
      storeKisTrResultCache(
        `TR${i}`,
        `S${i}`,
        'P2_READY_CANDIDATE_CONFIRM',
        {},
        { v: i },
        t0,
      );
    }
    expect(getResultCacheSize()).toBeGreaterThan(100);
    // 6초 후 새 entry 저장 → 기존 105 entry 모두 만료 + prune 발동
    storeKisTrResultCache(
      'TR_NEW',
      'NEW',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      { v: 999 },
      t0 + 6000,
    );
    // 새 entry 1건만 남거나, 적어도 105보다 적어야 함
    expect(getResultCacheSize()).toBeLessThan(105);
  });
});

describe('Patch-005 사용자 §10 시나리오 — same trId+symbol+params 5초 내 재호출', () => {
  beforeEach(() => {
    __resetKisTrResultCacheForTests();
    delete process.env.KIS_RESULT_CACHE_PATCH_005_DISABLED;
  });

  it('첫 호출 store + 4초 후 재호출 → hit + newNetworkCall=false', () => {
    const t0 = 1_000_000;
    const trId = 'FHKST01010100';
    const symbol = '005930';
    const params = { fid: 'J' };

    // 첫 호출 — store
    storeKisTrResultCache(
      trId,
      symbol,
      'P2_READY_CANDIDATE_CONFIRM',
      params,
      { price: 50000 },
      t0,
    );

    // 4초 후 재호출
    const r = lookupKisTrResultCache(
      trId,
      symbol,
      'P2_READY_CANDIDATE_CONFIRM',
      params,
      t0 + 4000,
    );
    expect(r.hit).toBe(true);
    expect(r.result).toEqual({ price: 50000 });
    expect(r.ageMs).toBe(4000);
  });

  it('첫 호출 store + 6초 후 재호출 → CACHE_EXPIRED', () => {
    const t0 = 1_000_000;
    storeKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      { v: 1 },
      t0,
    );
    const r = lookupKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      t0 + 6000,
    );
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('CACHE_EXPIRED');
  });

  it('다른 params → cache miss (params 분리 검증)', () => {
    storeKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      { fid: 'J' },
      { v: 1 },
    );
    const r = lookupKisTrResultCache('TR1', 'AAA', 'P2_READY_CANDIDATE_CONFIRM', {
      fid: 'K',
    });
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('CACHE_MISS');
  });

  it('P0_POSITION_EXIT — 5초 내 재호출도 cache 무시 (보유 매도 최신 데이터 의무)', () => {
    const t0 = 1_000_000;
    // P2 로 store
    storeKisTrResultCache(
      'TR1',
      'AAA',
      'P2_READY_CANDIDATE_CONFIRM',
      {},
      { v: 'STALE' },
      t0,
    );
    // P0 로 lookup → 절대 P0_EXCLUSION
    const r = lookupKisTrResultCache(
      'TR1',
      'AAA',
      'P0_POSITION_EXIT',
      {},
      t0 + 1000,
    );
    expect(r.hit).toBe(false);
    expect(r.skipReason).toBe('P0_EXCLUSION');
  });
});

describe('Patch-005 formatKisTrTtlCacheHitLog — 사용자 §"기대 로그" 정확 형식', () => {
  it('필수 필드 모두 포함 + newNetworkCall=false', () => {
    const log = formatKisTrTtlCacheHitLog('FHKST01010100', '005930', 3000);
    expect(log).toContain('[KIS_TR_TTL_CACHE_HIT]');
    expect(log).toContain('trId=FHKST01010100');
    expect(log).toContain('symbol=005930');
    expect(log).toContain('ttlMs=5000');
    expect(log).toContain('ageMs=3000');
    expect(log).toContain('newNetworkCall=false');
  });
});

describe('Patch-005 result cache — 정적 grep 가드', () => {
  const sourcePath = resolve(__dirname, 'kisResultCachePatch005.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('KIS 주문 함수 5종 import 0건', () => {
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(code).not.toMatch(/autoTradeEngine/);
    expect(code).not.toMatch(/orderExecutor/);
    expect(code).not.toMatch(/trancheExecutor/);
  });

  it('외부 fetch / axios / node-fetch import 0건', () => {
    expect(code).not.toMatch(/from ['"]axios['"]/);
    expect(code).not.toMatch(/from ['"]node-fetch['"]/);
    expect(code).not.toMatch(/\bfetch\(/);
  });

  it('ENV `=== \'true\'` 정확 비교 (ADR-0157)', () => {
    expect(code).toMatch(/=== 'true'/);
    expect(code).not.toMatch(/!== 'false'/);
  });

  it('P0_POSITION_EXIT 절대 불변식 표기', () => {
    expect(code).toMatch(/P0_POSITION_EXIT/);
  });

  it('TTL 5000ms SSOT 명시', () => {
    expect(code).toMatch(/RESULT_CACHE_TTL_MS = 5_000/);
  });

  it('Patch ID 추적 주석', () => {
    expect(source).toMatch(/Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001/);
  });
});
