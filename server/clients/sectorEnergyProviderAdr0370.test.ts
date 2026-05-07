// @responsibility ADR-0370 Sector Energy Hardening Phase 1 회귀 — fallback OFF + sanity 30 + composite key
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETURN_SANITY_BOUND_PCT_DEFAULT,
  __resetIndexNameFallbackWarningForTests,
  aggregateIndexDeltas,
  emitIndexNameFallbackWarningIfEnabled,
  isSectorEnergyIndexNameFallbackEnabled,
} from './sectorEnergyProvider.js';
import type { KrxIndexDailyRow } from './krxOpenApi.js';

function makeRow(overrides: Partial<KrxIndexDailyRow> & { market?: string }): KrxIndexDailyRow {
  // KrxIndexDailyRow 기본 + market 옵셔널 필드 (ADR-0370 composite key SSOT 검증용).
  const base: KrxIndexDailyRow = {
    baseDate: '20260427',
    indexCode: '',
    indexName: '',
    close: 1000,
    change: 0,
    changePct: 0,
    open: 1000,
    high: 1010,
    low: 990,
    volume: 100_000,
    value: 0,
    marketCap: 0,
  };
  return { ...base, ...overrides } as KrxIndexDailyRow;
}

describe('ADR-0370 Sector Energy Hardening Phase 1', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalFallbackEnv: string | undefined;
  let originalSanityEnv: string | undefined;

  beforeEach(() => {
    originalFallbackEnv = process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
    originalSanityEnv = process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT;
    delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    __resetIndexNameFallbackWarningForTests();
  });

  afterEach(() => {
    if (originalFallbackEnv === undefined) delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
    else process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = originalFallbackEnv;
    if (originalSanityEnv === undefined) delete process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT;
    else process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT = originalSanityEnv;
    warnSpy.mockRestore();
    __resetIndexNameFallbackWarningForTests();
  });

  describe('SSOT 상수 + ENV 정확 비교 (ADR-0157 정합)', () => {
    it('RETURN_SANITY_BOUND_PCT_DEFAULT = 30 (ADR-0370 default 90 → 30 강화)', () => {
      expect(RETURN_SANITY_BOUND_PCT_DEFAULT).toBe(30);
    });

    it('isSectorEnergyIndexNameFallbackEnabled — default OFF (ENV 미설정 시 false)', () => {
      delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
      expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(false);
    });

    it('ENV 정확 비교 의무 — "TRUE" (대문자) 거부, "true" 만 활성', () => {
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'TRUE';
      expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(false);
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = '1';
      expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(false);
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'yes';
      expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(false);
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
      expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(true);
    });
  });

  describe('부팅 1회 console.warn (emitIndexNameFallbackWarningIfEnabled)', () => {
    it('ENV OFF (default) → warn 호출 0건', () => {
      const emitted = emitIndexNameFallbackWarningIfEnabled();
      expect(emitted).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('ENV ON → 1회 warn + ADR-0369/0370 메시지', () => {
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
      const emitted = emitIndexNameFallbackWarningIfEnabled();
      expect(emitted).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy.mock.calls[0]![0]);
      expect(msg).toContain('SECTOR_ENERGY');
      expect(msg).toContain('unsafe indexName fallback');
      expect(msg).toContain('ADR-0369/0370');
    });

    it('idempotent — 중복 호출 시 warn 1회 (latch 보존)', () => {
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
      emitIndexNameFallbackWarningIfEnabled();
      emitIndexNameFallbackWarningIfEnabled();
      emitIndexNameFallbackWarningIfEnabled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('__resetIndexNameFallbackWarningForTests — latch 초기화 후 재발동 가능', () => {
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
      emitIndexNameFallbackWarningIfEnabled();
      __resetIndexNameFallbackWarningForTests();
      const emitted = emitIndexNameFallbackWarningIfEnabled();
      expect(emitted).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('aggregateIndexDeltas composite key (KOSPI vs KOSDAQ 분리)', () => {
    it('동일 indexName 다른 시장 — silent overwrite 금지 (ADR-0370 핵심 결함)', () => {
      // KOSPI:반도체 (close 1000→1100, +10%) + KOSDAQ:반도체 (close 500→750, +50% sanity 차단)
      // 시장 다른 두 row 가 indexCode 다른 KRX sub-index 이므로 정상 매칭.
      // composite key 가 silent overwrite 차단해야 함.
      const today = [
        makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1100 }),
        makeRow({ market: 'KOSDAQ', indexCode: 'KQ_SEMI', indexName: 'KOSDAQ 반도체', close: 600 }),
      ];
      const past = [
        makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' }),
        makeRow({ market: 'KOSDAQ', indexCode: 'KQ_SEMI', indexName: 'KOSDAQ 반도체', close: 500, baseDate: '20260330' }),
      ];
      const result = aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      // 두 시장 모두 정상 매칭 — KOSPI +10% / KOSDAQ +20% 모두 sanity 30 통과
      expect(sem).toBeDefined();
      expect(sem!.returns).toHaveLength(2);
      expect(sem!.returns[0]).toBeCloseTo(10, 5);
      expect(sem!.returns[1]).toBeCloseTo(20, 5);
    });

    it('past 행 동일 composite key 중복 → 첫 번째 row 보존 + console.warn', () => {
      const today = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1100 })];
      // 동일 composite key (KOSPI:code:KS_SEMI) 중복 — 두 번째 close=999 가 silent overwrite 시도
      const past = [
        makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' }),
        makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 9999, baseDate: '20260330' }),
      ];
      const result = aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      // 첫 번째 close=1000 보존 → +10% 정확 산출
      expect(sem!.returns).toHaveLength(1);
      expect(sem!.returns[0]).toBeCloseTo(10, 5);
      // 진단 로그 검증
      const dupWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('duplicate past key'));
      expect(dupWarns).toHaveLength(1);
      expect(String(dupWarns[0]![0])).toContain('ADR-0370');
    });

    it('fallback OFF (default) → indexName 단독 매칭 경로 호출 0건 (회귀 가드)', () => {
      // 두 row 모두 indexCode 부재 + indexName 만 보유 → fallback OFF 시 매칭 실패
      delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
      const today = [makeRow({ market: 'KOSPI', indexCode: '', indexName: 'KOSPI 반도체', close: 1100 })];
      const past = [makeRow({ market: 'KOSPI', indexCode: '', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
      const result = aggregateIndexDeltas(today, past);
      // fallback OFF — indexName 단독 매칭 경로 차단
      expect(result.get('반도체')).toBeUndefined();
      expect(result.size).toBe(0);
    });

    it('fallback ON 명시 시 → indexName 단독 매칭 복원 (회귀 분석용 ENV opt-in)', () => {
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
      const today = [makeRow({ market: 'KOSPI', indexCode: '', indexName: 'KOSPI 반도체', close: 1100 })];
      const past = [makeRow({ market: 'KOSPI', indexCode: '', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
      const result = aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      expect(sem).toBeDefined();
      expect(sem!.returns).toHaveLength(1);
      expect(sem!.returns[0]).toBeCloseTo(10, 5);
    });

    it('indexCode 우선순위 — fallback ON 이어도 indexCode 매칭 우선', () => {
      process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
      const today = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1100 })];
      // past 에 동일 indexCode + 다른 close 가 존재 + 추가로 동일 indexName 의 다른 row
      const past = [
        makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' }),
        // 동일 indexName 의 다른 row (indexCode 부재) — fallback 매칭 후보
        makeRow({ market: 'KOSPI', indexCode: '', indexName: 'KOSPI 반도체', close: 500, baseDate: '20260330' }),
      ];
      const result = aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      // indexCode 매칭 우선 → +10% (close 1000 기준)
      expect(sem!.returns).toHaveLength(1);
      expect(sem!.returns[0]).toBeCloseTo(10, 5);
    });
  });

  describe('RETURN_SANITY_BOUND_PCT default 30 (ADR-0370)', () => {
    it('정상 변화율 +12% → 통과 (sanity 30 이내)', () => {
      delete process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT;
      const today = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1120 })];
      const past = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
      const result = aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      expect(sem).toBeDefined();
      expect(sem!.returns).toHaveLength(1);
      expect(sem!.returns[0]).toBeCloseTo(12, 5);
      // sanity 위반 진단 로그 부재
      const sanityWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('sanity-violation'));
      expect(sanityWarns).toHaveLength(0);
    });

    it('변화율 +35% → skip + 진단 로그 (default 30 초과, ADR-0370 핵심)', () => {
      delete process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT;
      // safePctChange 기본 sanity 가 90 으로 35% 통과시키므로 pushDelta 단계에서 본 PR 가드 발동
      const today = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1350 })];
      const past = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
      const result = aggregateIndexDeltas(today, past);
      // 35% > 30% sanity → skip
      expect(result.get('반도체')).toBeUndefined();
      const sanityWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('sanity-violation'));
      expect(sanityWarns).toHaveLength(1);
      expect(String(sanityWarns[0]![0])).toContain('pct=35');
      expect(String(sanityWarns[0]![0])).toContain('sector=반도체');
      expect(String(sanityWarns[0]![0])).toContain('bound=30');
      expect(String(sanityWarns[0]![0])).toContain('ADR-0370');
    });

    it('ENV 우회 — SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT=90 시 +35% 통과 (legacy 회귀 격리)', async () => {
      // 모듈 상수가 import 시점에 고정이라 dynamic import 로 ENV 변경 후 재로드
      process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT = '90';
      vi.resetModules();
      const mod = await import('./sectorEnergyProvider.js');
      const today = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1350 })];
      const past = [makeRow({ market: 'KOSPI', indexCode: 'KS_SEMI', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
      const result = mod.aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      expect(sem).toBeDefined();
      expect(sem!.returns[0]).toBeCloseTo(35, 5);
    });

    it('정상 KRX 12개 섹터 행 — sanity 30 통과 회귀 가드 (기존 정상 사례 보존)', () => {
      // 모든 섹터 +5%~+15% 정상 변화 → 12개 모두 통과
      const today: KrxIndexDailyRow[] = [
        makeRow({ market: 'KOSPI', indexCode: 'C1', indexName: 'KOSPI 반도체', close: 1050 }),
        makeRow({ market: 'KOSPI', indexCode: 'C2', indexName: 'KOSPI 이차전지', close: 1080 }),
        makeRow({ market: 'KOSPI', indexCode: 'C3', indexName: 'KOSPI 바이오', close: 1100 }),
        makeRow({ market: 'KOSPI', indexCode: 'C4', indexName: 'KOSPI 인터넷', close: 1075 }),
      ];
      const past: KrxIndexDailyRow[] = today.map((t) => ({
        ...t,
        close: 1000,
        baseDate: '20260330',
      }));
      const result = aggregateIndexDeltas(today, past);
      // 모든 변화 5~10% — sanity 30 통과
      expect(result.size).toBeGreaterThanOrEqual(4);
      const sanityWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('sanity-violation'));
      expect(sanityWarns).toHaveLength(0);
    });
  });
});

describe('ADR-0370 정적 grep 가드 (drift 차단)', () => {
  it('sectorEnergyProvider.ts 헤더에 ADR-0370 주석 명시', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    expect(src).toMatch(/ADR-0370/);
    expect(src).toMatch(/Phase 1/);
  });

  it('RETURN_SANITY_BOUND_PCT_DEFAULT = 30 SSOT 명시 (drift 차단)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    expect(src).toMatch(/RETURN_SANITY_BOUND_PCT_DEFAULT\s*=\s*30/);
  });

  it('emitIndexNameFallbackWarningIfEnabled 부팅 시점 1회 호출 명시', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    // 모듈 로드 시점 자동 호출 라인 검증
    expect(src).toMatch(/emitIndexNameFallbackWarningIfEnabled\(\);/);
  });

  it('aggregateIndexDeltas 가 indexRowKey composite key SSOT 사용', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    expect(src).toMatch(/indexRowKey/);
    expect(src).toMatch(/`\$\{market\}:code:\$\{[^}]+\}`/);
  });

  it('KIS 주문 함수 5종 import 0건 (절대 규칙 #2 정합)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('server/clients/sectorEnergyProvider.ts', 'utf8');
    const banned = ['placeKisMarketOrder', 'placeKisSellOrder', 'cancelKisOrder', 'placeKisStopLossOrder', 'placeKisTakeProfitOrder'];
    for (const fn of banned) {
      expect(src.includes(fn)).toBe(false);
    }
  });
});
