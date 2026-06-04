// @responsibility ADR-0570 sectorReturn20d 배선 회귀 — return 계산·캐시·flag OFF byte-equal·graceful.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fetchKisSectorIndexDailyMock = vi.fn();

vi.mock('./kisClient/index.js', () => ({
  fetchKisSectorIndexDaily: (...args: unknown[]) => fetchKisSectorIndexDailyMock(...args),
}));

import {
  computeSectorReturnsFromDaily,
  getSectorCycleReturns,
  isSectorIndexCycleWiringDisabled,
  __resetSectorIndexCycleCacheForTests,
} from './sectorIndexCycleProvider.js';
import type { KisSectorIndexDaily, KisSectorIndexDailyRow } from './kisClient/index.js';

function row(baseDate: string, close: number): KisSectorIndexDailyRow {
  return { baseDate, close, open: close, high: close, low: close, volume: 0, value: 0 };
}

/** YYYYMMDD 고유 오름차순 날짜 생성 (2026-01-01 부터 i일). */
function uniqueDate(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** N 거래일치 series 생성 (오름차순). latest=last. */
function daily(closes: number[], iscd = '4003'): KisSectorIndexDaily {
  const series = closes.map((c, i) => row(uniqueDate(i), c));
  return {
    sectorIscd: iscd,
    sectorName: '반도체',
    currentIndex: closes[closes.length - 1] ?? null,
    changePct: null,
    series,
    fetchedAt: new Date().toISOString(),
    source: 'KIS_API',
  };
}

describe('ADR-0570 computeSectorReturnsFromDaily', () => {
  it('정상: 21+ 거래일 → 20d/5d return 계산', () => {
    // close: index i 의 값 = 100 + i. latest = 120 (idx 20), past20 = 100 (idx 0), past5 = 115 (idx 15).
    const closes = Array.from({ length: 21 }, (_, i) => 100 + i);
    const out = computeSectorReturnsFromDaily(daily(closes));
    // 20d: (120-100)/100*100 = 20
    expect(out.sectorReturn20d).toBe(20);
    // 5d: (120-115)/115*100 = 4.35
    expect(out.sectorReturn5d).toBeCloseTo(4.35, 2);
  });

  it('거래일 부족(20d 미만) → sectorReturn20d null (graceful), 5d 는 가능하면 계산', () => {
    const closes = Array.from({ length: 7 }, (_, i) => 100 + i); // 7 rows → 20d 불가, 5d 가능
    const out = computeSectorReturnsFromDaily(daily(closes));
    expect(out.sectorReturn20d).toBeNull();
    expect(out.sectorReturn5d).not.toBeNull();
  });

  it('close<=0 row 제거 후에도 부족하면 null', () => {
    const closes = [0, -1, 100, 101];
    const out = computeSectorReturnsFromDaily(daily(closes));
    expect(out.sectorReturn20d).toBeNull();
  });

  it('null/빈 series → 둘 다 null', () => {
    expect(computeSectorReturnsFromDaily(null)).toEqual({ sectorReturn20d: null, sectorReturn5d: null });
    expect(computeSectorReturnsFromDaily(daily([]))).toEqual({ sectorReturn20d: null, sectorReturn5d: null });
  });

  it('baseDate 역순 series 도 정렬 보정 후 동일 결과', () => {
    const closes = Array.from({ length: 21 }, (_, i) => 100 + i);
    const d = daily(closes);
    d.series = [...d.series].reverse();
    const out = computeSectorReturnsFromDaily(d);
    expect(out.sectorReturn20d).toBe(20);
  });
});

describe('ADR-0570 flag gate + getSectorCycleReturns', () => {
  beforeEach(() => {
    fetchKisSectorIndexDailyMock.mockReset();
    __resetSectorIndexCycleCacheForTests();
    delete process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED;
  });
  afterEach(() => {
    delete process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED;
    __resetSectorIndexCycleCacheForTests();
  });

  it('flag OFF(default) → 빈 Map + KIS 콜 0 (byte-equivalent)', async () => {
    expect(isSectorIndexCycleWiringDisabled()).toBe(true);
    const out = await getSectorCycleReturns();
    expect(out.size).toBe(0);
    expect(fetchKisSectorIndexDailyMock).not.toHaveBeenCalled();
  });

  it("flag 'true' 외 값('1'/'TRUE') 거부 (ADR-0157 정확 비교)", async () => {
    process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED = '1';
    expect(isSectorIndexCycleWiringDisabled()).toBe(true);
    process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED = 'TRUE';
    expect(isSectorIndexCycleWiringDisabled()).toBe(true);
  });

  it('flag ON → 섹터별 1콜 배치 + sectorReturn20d 산출', async () => {
    process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED = 'true';
    const closes = Array.from({ length: 21 }, (_, i) => 100 + i);
    fetchKisSectorIndexDailyMock.mockResolvedValue(daily(closes));
    const out = await getSectorCycleReturns();
    expect(out.size).toBeGreaterThan(0);
    const semi = out.get('반도체');
    expect(semi?.sectorReturn20d).toBe(20);
    expect(semi?.iscd).toBe('4003');
    // 캐시 fresh → 두 번째 호출은 추가 fetch 0.
    const callsAfterFirst = fetchKisSectorIndexDailyMock.mock.calls.length;
    const out2 = await getSectorCycleReturns();
    expect(out2.size).toBe(out.size);
    expect(fetchKisSectorIndexDailyMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('섹터 fetch 실패(throw)는 graceful — 해당 섹터 null, 다른 섹터 무영향', async () => {
    process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED = 'true';
    const closes = Array.from({ length: 21 }, (_, i) => 100 + i);
    let n = 0;
    fetchKisSectorIndexDailyMock.mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error('KIS 500');
      return daily(closes);
    });
    const out = await getSectorCycleReturns();
    // 첫 섹터(반도체)는 throw → null. 나머지 섹터는 산출.
    expect(out.get('반도체')?.sectorReturn20d).toBeNull();
    const anyOk = [...out.values()].some((v) => v.sectorReturn20d === 20);
    expect(anyOk).toBe(true);
  });
});
