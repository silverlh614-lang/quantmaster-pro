// @responsibility ADR-0601 D4 sector-cycle 네이티브 hydration 회귀 — 업종코드 단위 캐시·상한·실패 격리·flag.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetGate2SectorCycleHydrationStateForTest,
  hydrateGate2SectorCycleAdr0601,
} from './gate2SectorCycleHydrationAdr0601.js';

const NOW = new Date('2026-06-11T03:30:00.000Z');

function snapshot(symbol: string, return20d: number | undefined = 5, covered = false): Record<string, unknown> {
  return {
    symbol,
    gate1Passed: true,
    symbolFeatures: { return20d },
    ...(covered ? { gate2ExternalDataCoverage: { sectorCycle: { status: 'VERIFIED' } } } : {}),
  };
}

function masterLoader(map: Record<string, string>) {
  return async () => ({
    loaded: true,
    rowCount: Object.keys(map).length,
    bySymbol: new Map(Object.entries(map).map(([symbol, medium]) => [symbol, {
      symbol, market: 'KOSDAQ' as const, sectorLargeCode: '1000', sectorMediumCode: medium, sectorSmallCode: '0000',
    }])),
  }) as never;
}

function dailyFetcher(sectorReturnPct: number) {
  // 최신순 21행 — r20 = (latest-past)/past*100.
  const past = 100;
  const latest = past * (1 + sectorReturnPct / 100);
  const series = [{ close: latest }, ...Array.from({ length: 20 }, () => ({ close: past }))];
  return vi.fn(async () => ({ sectorIscd: 'X', sectorName: '테스트업종', currentIndex: latest, changePct: 0, series })) as never;
}

describe('hydrateGate2SectorCycleAdr0601', () => {
  beforeEach(() => { __resetGate2SectorCycleHydrationStateForTest(); });
  afterEach(() => {
    delete process.env.GATE2_SECTOR_CYCLE_NATIVE_HYDRATION_ENABLED;
    delete process.env.GATE2_SECTOR_INDEX_FETCH_MAX;
  });

  it('마스터 업종코드→업종지수 r20 으로 sectorCycle(PARTIAL) 주입 — stockVsSector·sectorRelative 산출', async () => {
    const fetcher = dailyFetcher(2);
    const target = snapshot('084370', 10);
    const report = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [target],
      benchmarkReturn20d: -1,
      now: NOW,
      masterLoader: masterLoader({ '084370': '1006' }),
      sectorDailyFetcher: fetcher,
    });
    expect(report).toMatchObject({ enabled: true, masterLoaded: true, mappedByMaster: 1, indexFetches: 1, hydrated: 1 });
    const cycle = (target.gate2ExternalDataCoverage as Record<string, unknown>).sectorCycle as Record<string, unknown>;
    expect(cycle).toMatchObject({ status: 'PARTIAL', available: true, sectorIscd: '1006', hydratedBy: 'ADR_0601_KIS_MASTER_SECTOR_INDEX' });
    expect(cycle.values).toMatchObject({ sectorReturn20d: 2, stockVsSectorReturn20d: 8, sectorRelativeReturn20d: 3 });
  });

  it('업종코드 단위 dedup·일중 캐시 — 같은 코드 2종목=fetch 1, 재실행=fetch 0', async () => {
    const fetcher = dailyFetcher(2);
    const a = snapshot('084370');
    const b = snapshot('084371');
    const loader = masterLoader({ '084370': '1006', '084371': '1006' });
    const first = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [a, b], now: NOW, masterLoader: loader, sectorDailyFetcher: fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ hydrated: 2, indexFetches: 1, cacheHits: 1 });
    const again = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [snapshot('084370')], now: NOW, masterLoader: loader, sectorDailyFetcher: fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ indexFetches: 0, cacheHits: 1, hydrated: 1 });
  });

  it('상한·실패 억제·기보유 skip·flag off', async () => {
    process.env.GATE2_SECTOR_INDEX_FETCH_MAX = '1';
    const fetcher = dailyFetcher(2);
    const loader = masterLoader({ '100001': '1001', '100002': '1002' });
    const capped = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [snapshot('100001'), snapshot('100002')], now: NOW,
      masterLoader: loader, sectorDailyFetcher: fetcher,
    });
    expect(capped).toMatchObject({ indexFetches: 1, capped: 1 });
    delete process.env.GATE2_SECTOR_INDEX_FETCH_MAX;

    __resetGate2SectorCycleHydrationStateForTest();
    const failing = vi.fn(async () => { throw new Error('KIS_DOWN'); }) as never;
    const fail1 = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [snapshot('100001')], now: NOW, masterLoader: loader, sectorDailyFetcher: failing,
    });
    expect(fail1.failures).toBe(1);
    const fail2 = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [snapshot('100001')], now: NOW, masterLoader: loader, sectorDailyFetcher: failing,
    });
    expect(fail2.indexFetches).toBe(0);

    const covered = snapshot('100001', 5, true);
    const skip = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [covered], now: NOW, masterLoader: loader, sectorDailyFetcher: dailyFetcher(2),
    });
    expect(skip.alreadyCovered).toBe(1);

    process.env.GATE2_SECTOR_CYCLE_NATIVE_HYDRATION_ENABLED = 'false';
    const off = await hydrateGate2SectorCycleAdr0601({
      candidateSnapshots: [snapshot('100009')], now: NOW, masterLoader: loader, sectorDailyFetcher: dailyFetcher(2),
    });
    expect(off.enabled).toBe(false);
  });
});
