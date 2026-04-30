// @responsibility sectorEnergyProvider 매칭 어긋남 회귀 차단 단위 테스트
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateIndexDeltas } from './sectorEnergyProvider.js';
import type { KrxIndexDailyRow } from './krxOpenApi.js';

function row(overrides: Partial<KrxIndexDailyRow>): KrxIndexDailyRow {
  return {
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
    ...overrides,
  };
}

describe('aggregateIndexDeltas — 매칭 어긋남 회귀 차단', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('정상 매칭: 같은 indexCode + 자릿수 일치 → returns 배열 누적', () => {
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1100, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    const sem = result.get('반도체');
    expect(sem).toBeDefined();
    expect(sem!.returns).toHaveLength(1);
    expect(sem!.returns[0]).toBeCloseTo(10, 5);
  });

  it('자릿수 격차 ±10배 초과 → skip + 진단 로그 (사용자 보고 시나리오)', () => {
    // 사용자 Railway 로그: 전기전자 today=94112.97, past=2009.91 → 47x mismatch
    const today = [row({ indexCode: 'I042', indexName: 'KRX 전기전자', close: 94112.97, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I042', indexName: 'KRX 전기전자', close: 2009.91, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.get('반도체')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('자릿수 격차');
    expect(warnSpy.mock.calls[0]![0]).toContain('전기전자');
    expect(warnSpy.mock.calls[0]![0]).toContain('20260427');
    expect(warnSpy.mock.calls[0]![0]).toContain('20260330');
  });

  it('자릿수 격차 0.1배 미만 → skip (종이/목재 시나리오)', () => {
    // 사용자 로그: 종이/목재 today=281.77, past=8417.32 → 0.033x mismatch
    const today = [row({ indexCode: 'I050', indexName: 'KRX 종이/목재', close: 281.77, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I050', indexName: 'KRX 종이/목재', close: 8417.32, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.get('에너지/화학')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('자릿수 격차');
    expect(warnSpy.mock.calls[0]![0]).toContain('0.033');
  });

  it('경계값 정확히 10배 → 통과 (>10 만 차단)', () => {
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 10000, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    // 10x 정확히 = 통과하지만 safePctChange ±90% sanity 가 800% 차단 → returns 비어있음
    // (자릿수 격차 가드를 통과했는지만 검증하기 위해 진단 로그 부재 확인)
    expect(warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('자릿수 격차'))).toHaveLength(0);
    // safePctChange 가드는 별도 모듈이라 결과 자체는 비어있을 수 있음
    expect(result.get('반도체')?.returns ?? []).toHaveLength(0);
  });

  it('today 가 indexCode 보유 / past 만 indexName 보유 → 매칭 실패 (mixed 매칭 차단)', () => {
    // KRX 응답 비대칭: today 는 indexCode 채움, past 는 indexCode 결측
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1100, baseDate: '20260427' })];
    const past = [row({ indexCode: '', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    // today.indexCode 가 있으므로 indexName fallback 시도 안 함 → 매칭 실패
    expect(result.get('반도체')).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('today/past 양쪽 모두 indexCode 부재 → indexName fallback 비활성 (ADR-0122 default OFF)', () => {
    // ADR-0122 (사용자 §2): KRX 동일 indexName + 다른 indexCode sub-index 다중성으로
    // indexName fallback 매칭은 본질적으로 불안전. default OFF 로 격하.
    // ENV SECTOR_ENERGY_INDEX_NAME_FALLBACK=true 시에만 복원 (회귀 분석용).
    const today = [row({ indexCode: '', indexName: 'KOSPI 반도체', close: 1100, baseDate: '20260427' })];
    const past = [row({ indexCode: '', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.get('반도체')).toBeUndefined();
  });

  it('ADR-0122 ENV 우회 — SECTOR_ENERGY_INDEX_NAME_FALLBACK=true 시 indexName 매칭 복원', () => {
    const original = process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
    process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = 'true';
    try {
      const today = [row({ indexCode: '', indexName: 'KOSPI 반도체', close: 1100, baseDate: '20260427' })];
      const past = [row({ indexCode: '', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
      const result = aggregateIndexDeltas(today, past);
      const sem = result.get('반도체');
      expect(sem).toBeDefined();
      expect(sem!.returns[0]).toBeCloseTo(10, 5);
    } finally {
      if (original === undefined) delete process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK;
      else process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK = original;
    }
  });

  it('past 행에 indexCode + indexName 둘 다 등록 → today indexCode 매칭 우선', () => {
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1100, baseDate: '20260427' })];
    // 동일 indexCode 의 past 행 1건 + 다른 행에서 indexName 만 매칭되는 경우
    const past = [
      row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' }),
      row({ indexCode: '', indexName: 'KOSPI 반도체', close: 50, baseDate: '20260330' }), // 자릿수 다른 노이즈
    ];
    const result = aggregateIndexDeltas(today, past);
    const sem = result.get('반도체');
    expect(sem!.returns).toHaveLength(1);
    expect(sem!.returns[0]).toBeCloseTo(10, 5);
  });

  it('past.close <= 0 → silent skip (close 결측 행 차단)', () => {
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1100, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 0, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.get('반도체')).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('today.close=0 → ratio=0 으로 자릿수 가드에 차단', () => {
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 0, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.get('반도체')).toBeUndefined();
    // ratio=0 < 0.1 → 자릿수 격차 차단 진단 로그
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('자릿수 격차');
  });

  it('today/past baseDate 동일 → skip + 진단 로그 (fetch boundary 어긋남 회귀)', () => {
    const today = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1050, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I001', indexName: 'KOSPI 반도체', close: 1000, baseDate: '20260427' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.get('반도체')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('baseDate 동일');
    expect(warnSpy.mock.calls[0]![0]).toContain('20260427');
  });

  it('classifyIndex 미매칭 indexName → silent skip (12섹터 외 KRX 지수 무시)', () => {
    const today = [row({ indexCode: 'I999', indexName: 'KRX 모르는지수', close: 1100, baseDate: '20260427' })];
    const past = [row({ indexCode: 'I999', indexName: 'KRX 모르는지수', close: 1000, baseDate: '20260330' })];
    const result = aggregateIndexDeltas(today, past);
    expect(result.size).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('7개 섹터 동시 자릿수 격차 (사용자 Railway 4/27 시나리오) → 격차 ±10x 위반 3건 1차 차단', () => {
    // 격차 비율 계산:
    //   섬유 6.74x / 종이/목재 0.034x* / 화학 2.15x / 비금속 0.055x* /
    //   기계/장비 6.20x / 전기전자 46.83x* / 건설 2.77x
    // 자릿수 가드(±10x)는 *표시한 3건만* 1차 차단. 나머지 4건은 safePctChange 의
    // sanity ±90% 가 후속 차단 (별도 모듈 책임).
    const cases: Array<[string, number, number]> = [
      ['KOSPI 섬유', 253.94, 37.68],
      ['KOSPI 종이/목재', 281.77, 8417.32], // 0.0335x — 자릿수 차단
      ['KOSPI 화학', 5471.43, 2544.93],
      ['KOSPI 비금속', 4376.20, 80118.18],   // 0.0546x — 자릿수 차단
      ['KOSPI 기계/장비', 4844.06, 781.64],
      ['KOSPI 전기전자', 94112.97, 2009.91], // 46.83x — 자릿수 차단
      ['KOSPI 건설', 236.55, 85.38],
    ];
    const today = cases.map(([name, c]) =>
      row({ indexCode: name, indexName: name, close: c, baseDate: '20260427' }),
    );
    const past = cases.map(([name, , p]) =>
      row({ indexCode: name, indexName: name, close: p, baseDate: '20260330' }),
    );
    aggregateIndexDeltas(today, past);
    const ratioWarns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('자릿수 격차'));
    expect(ratioWarns).toHaveLength(3);
    const skippedNames = ratioWarns.map((c: unknown[]) => String(c[0]));
    expect(skippedNames.some((s: string) => s.includes('종이/목재'))).toBe(true);
    expect(skippedNames.some((s: string) => s.includes('비금속'))).toBe(true);
    expect(skippedNames.some((s: string) => s.includes('전기전자'))).toBe(true);
  });
});
