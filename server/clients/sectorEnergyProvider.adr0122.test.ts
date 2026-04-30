/**
 * @responsibility ADR-0122 sectorEnergy KRX 매칭 결함 차단 회귀 테스트
 *
 * 사용자 §1/§2/§4/§7 정합:
 * #1 validateIndexResponseSymmetry — today/past indexCode 정합성 검증
 * #2 indexName fallback 매칭 제거 (default OFF, ENV 우회)
 * #4 유효 섹터 < 8 시 결과 폐기 (STALE)
 * #7 SectorEnergyBuildResult.dataQuality 4값 분류
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateIndexDeltas,
  validateIndexResponseSymmetry,
  isSectorEnergySymmetryDisabled,
  isSectorEnergyIndexNameFallbackEnabled,
  getSectorEnergyMinValid,
  SECTOR_ENERGY_MIN_VALID_DEFAULT,
  SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD,
} from './sectorEnergyProvider.js';
import type { KrxIndexDailyRow } from './krxOpenApi.js';

function makeRow(opts: {
  indexCode?: string;
  indexName: string;
  close: number;
  volume?: number;
  baseDate?: string;
}): KrxIndexDailyRow {
  return {
    indexCode: opts.indexCode ?? '',
    indexName: opts.indexName,
    close: opts.close,
    volume: opts.volume ?? 1000,
    baseDate: opts.baseDate ?? '20260429',
  } as KrxIndexDailyRow;
}

describe('validateIndexResponseSymmetry — ADR-0122 §1', () => {
  it('빈 배열 → invalid + reasons', () => {
    const result = validateIndexResponseSymmetry([], []);
    expect(result.valid).toBe(false);
    expect(result.reasons[0]).toContain('empty rows');
  });

  it('모두 indexCode 채움 (100%) → valid', () => {
    const today = [
      makeRow({ indexCode: '1010', indexName: '전기전자', close: 2000 }),
      makeRow({ indexCode: '1020', indexName: '화학', close: 3000 }),
    ];
    const past = [
      makeRow({ indexCode: '1010', indexName: '전기전자', close: 1900, baseDate: '20260401' }),
      makeRow({ indexCode: '1020', indexName: '화학', close: 2900, baseDate: '20260401' }),
    ];
    const result = validateIndexResponseSymmetry(today, past);
    expect(result.valid).toBe(true);
    expect(result.todayCodeFillRatio).toBe(1);
    expect(result.pastCodeFillRatio).toBe(1);
  });

  it('today 50% indexCode → invalid', () => {
    const today = [
      makeRow({ indexCode: '1010', indexName: '전기전자', close: 2000 }),
      makeRow({ indexName: '화학', close: 3000 }), // indexCode 비어있음
    ];
    const past = [
      makeRow({ indexCode: '1010', indexName: '전기전자', close: 1900, baseDate: '20260401' }),
      makeRow({ indexCode: '1020', indexName: '화학', close: 2900, baseDate: '20260401' }),
    ];
    const result = validateIndexResponseSymmetry(today, past);
    expect(result.valid).toBe(false);
    expect(result.todayCodeFillRatio).toBe(0.5);
    expect(result.reasons.some((r) => r.includes('today indexCode 충실도'))).toBe(true);
  });

  it('past 80% indexCode → invalid (90% 임계 미달)', () => {
    const today = Array.from({ length: 10 }, (_, i) =>
      makeRow({ indexCode: `10${i}0`, indexName: `${i}섹터`, close: 1000 + i * 100 }),
    );
    const past = Array.from({ length: 10 }, (_, i) =>
      makeRow({
        indexCode: i < 8 ? `10${i}0` : '',
        indexName: `${i}섹터`,
        close: 900 + i * 100,
        baseDate: '20260401',
      }),
    );
    const result = validateIndexResponseSymmetry(today, past);
    expect(result.valid).toBe(false);
    expect(result.pastCodeFillRatio).toBe(0.8);
  });

  it('boundary 정확 90% → valid', () => {
    const today = Array.from({ length: 10 }, (_, i) =>
      makeRow({ indexCode: i < 9 ? `10${i}0` : '', indexName: `${i}섹터`, close: 1000 + i * 100 }),
    );
    const past = Array.from({ length: 10 }, (_, i) =>
      makeRow({ indexCode: i < 9 ? `10${i}0` : '', indexName: `${i}섹터`, close: 900 + i * 100, baseDate: '20260401' }),
    );
    const result = validateIndexResponseSymmetry(today, past);
    expect(result.valid).toBe(true);
    expect(result.todayCodeFillRatio).toBe(0.9);
    expect(result.pastCodeFillRatio).toBe(0.9);
  });

  it('1차 로그 시나리오 — KRX 응답 indexCode 비대칭 → invalid', () => {
    // 사용자 분석: today 와 past 가 indexCode 비대칭으로 잘못된 매칭
    const today = Array.from({ length: 5 }, (_, i) =>
      makeRow({ indexCode: `1${i}0`, indexName: `섹터${i}`, close: 1000 }),
    );
    // past: 80% 만 indexCode 채움 (회귀 시나리오)
    const past = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        indexCode: i < 4 ? `1${i}0` : '',
        indexName: `섹터${i}`,
        close: 950,
        baseDate: '20260401',
      }),
    );
    const result = validateIndexResponseSymmetry(today, past);
    expect(result.valid).toBe(false);
    expect(result.pastCodeFillRatio).toBe(0.8);
  });
});

describe('aggregateIndexDeltas — ADR-0122 §2 indexName fallback 제거', () => {
  it('indexCode 매칭 — 정상 동작', () => {
    const today = [makeRow({ indexCode: '1010', indexName: '전기전자', close: 2100 })];
    const past = [makeRow({ indexCode: '1010', indexName: '전기전자', close: 2000, baseDate: '20260401' })];
    const deltas = aggregateIndexDeltas(today, past);
    expect(deltas.size).toBe(1);
    const data = deltas.get('반도체');
    expect(data).toBeDefined();
    expect(data?.returns[0]).toBe(5);
  });

  it('today indexCode 비어있음 + past indexCode 있음 → indexName fallback 미작동 (default)', () => {
    const today = [makeRow({ indexName: '전기전자', close: 2100 })]; // indexCode 비어있음
    const past = [makeRow({ indexCode: '1010', indexName: '전기전자', close: 2000, baseDate: '20260401' })];
    const deltas = aggregateIndexDeltas(today, past);
    // ADR-0122: indexName fallback default OFF → 매칭 미발생
    expect(deltas.size).toBe(0);
  });

  it('ENV SECTOR_ENERGY_INDEX_NAME_FALLBACK=true → indexName fallback 복원', () => {
    const original = process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
    process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
    try {
      const today = [makeRow({ indexName: '전기전자', close: 2100 })];
      const past = [makeRow({ indexCode: '1010', indexName: '전기전자', close: 2000, baseDate: '20260401' })];
      const deltas = aggregateIndexDeltas(today, past);
      // 회귀 분석용 ENV 우회 시 fallback 매칭 동작
      // 단, today indexCode 비어있고 past 에는 indexCode 있는 경우는 여전히
      // 매칭 미발생 (today 가 indexCode 가 비어있을 때만 indexName 매칭 시도)
      const data = deltas.get('반도체');
      expect(data).toBeDefined();
    } finally {
      if (original === undefined) delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
      else process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = original;
    }
  });

  it('1차 로그 시나리오 — 자릿수 격차 0.034x → skip', () => {
    const today = [makeRow({ indexCode: '2010', indexName: '종이·목재', close: 282.61 })];
    const past = [
      makeRow({ indexCode: '2010', indexName: '종이·목재', close: 8372.2, baseDate: '20260401' }),
    ];
    const deltas = aggregateIndexDeltas(today, past);
    // 자릿수 격차로 skip → 빈 deltas
    expect(deltas.size).toBe(0);
  });

  it('1차 로그 시나리오 — 자릿수 격차 45.557x → skip', () => {
    const today = [makeRow({ indexCode: '1010', indexName: '전기전자', close: 94959.77 })];
    const past = [
      makeRow({ indexCode: '1010', indexName: '전기전자', close: 2084.43, baseDate: '20260401' }),
    ];
    const deltas = aggregateIndexDeltas(today, past);
    expect(deltas.size).toBe(0);
  });
});

describe('ENV 우회 헬퍼 — ADR-0122 §1/§2/§4', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {
      symmetry: process.env.SECTOR_ENERGY_SYMMETRY_DISABLED,
      fallback: process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK,
      minValid: process.env.SECTOR_ENERGY_MIN_VALID,
    };
    delete process.env.SECTOR_ENERGY_SYMMETRY_DISABLED;
    delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
    delete process.env.SECTOR_ENERGY_MIN_VALID;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(original)) {
      const envKey = key === 'symmetry'
        ? 'SECTOR_ENERGY_SYMMETRY_DISABLED'
        : key === 'fallback'
          ? 'SECTOR_ENERGY_INDEX_NAME_FALLBACK'
          : 'SECTOR_ENERGY_MIN_VALID';
      if (val === undefined) delete process.env[envKey];
      else process.env[envKey] = val;
    }
  });

  it('isSectorEnergySymmetryDisabled — 기본 false', () => {
    expect(isSectorEnergySymmetryDisabled()).toBe(false);
  });

  it('isSectorEnergySymmetryDisabled — "true" → true', () => {
    process.env.SECTOR_ENERGY_SYMMETRY_DISABLED = 'true';
    expect(isSectorEnergySymmetryDisabled()).toBe(true);
  });

  it('isSectorEnergyIndexNameFallbackEnabled — 기본 false (ADR-0122 §2 default)', () => {
    expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(false);
  });

  it('isSectorEnergyIndexNameFallbackEnabled — "true" → true (회귀 분석용)', () => {
    process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
    expect(isSectorEnergyIndexNameFallbackEnabled()).toBe(true);
  });

  it('getSectorEnergyMinValid — 기본 8 (ADR-0122 §4 default)', () => {
    expect(getSectorEnergyMinValid()).toBe(SECTOR_ENERGY_MIN_VALID_DEFAULT);
    expect(getSectorEnergyMinValid()).toBe(8);
  });

  it('getSectorEnergyMinValid — ENV 6 → 6', () => {
    process.env.SECTOR_ENERGY_MIN_VALID = '6';
    expect(getSectorEnergyMinValid()).toBe(6);
  });

  it('getSectorEnergyMinValid — 잘못된 ENV (음수/0/13) → default 8', () => {
    process.env.SECTOR_ENERGY_MIN_VALID = '-1';
    expect(getSectorEnergyMinValid()).toBe(8);
    process.env.SECTOR_ENERGY_MIN_VALID = '0';
    expect(getSectorEnergyMinValid()).toBe(8);
    process.env.SECTOR_ENERGY_MIN_VALID = '13';
    expect(getSectorEnergyMinValid()).toBe(8);
    process.env.SECTOR_ENERGY_MIN_VALID = 'invalid';
    expect(getSectorEnergyMinValid()).toBe(8);
  });
});

describe('ADR-0122 상수 SSOT', () => {
  it('SECTOR_ENERGY_MIN_VALID_DEFAULT = 8 (사용자 §4 정합)', () => {
    expect(SECTOR_ENERGY_MIN_VALID_DEFAULT).toBe(8);
  });

  it('SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD = 0.9 (사용자 §1 정합)', () => {
    expect(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD).toBe(0.9);
  });
});
