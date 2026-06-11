// @responsibility ADR-0601 D4 — Gate2 Sector 축 KIS 네이티브 hydration: 종목 마스터 업종코드→업종지수 일봉으로 sectorCycle 결손 보충 (일캐시·상한·실패 격리).

import { fetchKisSectorIndexDaily } from '../../../clients/kisClient/index.js';
import {
  loadStockSectorCodeMaster,
  type StockSectorCodeMasterResult,
} from '../../../sector/StockSectorCodeMasterProvider.js';

export interface Gate2SectorCycleHydrationReportAdr0601 {
  enabled: boolean;
  masterLoaded: boolean;
  masterRows: number;
  candidates: number;
  alreadyCovered: number;
  mappedByMaster: number;
  indexFetches: number;
  cacheHits: number;
  hydrated: number;
  failures: number;
  capped: number;
  maxIndexFetchPerScan: number;
  executionImpact: 'NONE';
}

/** D4 스위치 (default ON, `!== 'false'`). false 1줄 롤백 → ADR-0600 동종군 fallback 만 잔존. */
export function isGate2SectorCycleHydrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GATE2_SECTOR_CYCLE_NATIVE_HYDRATION_ENABLED !== 'false';
}

/** 스캔당 업종지수 신규 조회 상한 (0~30 정수, 무효/미설정 → 12). 일중 캐시 적중은 미소모. */
export function resolveGate2SectorIndexFetchMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GATE2_SECTOR_INDEX_FETCH_MAX;
  if (raw === undefined || raw.trim() === '') return 12;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 30 ? parsed : 12;
}

interface HydratableSnapshot {
  symbol?: string;
  gate1Passed?: boolean;
  return20d?: number;
  symbolFeatures?: { return20d?: number };
  gate2ExternalDataCoverage?: Record<string, unknown>;
}

interface CachedSectorReturn {
  dateKey: string;
  sectorName: string;
  sectorReturn20d: number;
}

const sectorReturnCache = new Map<string, CachedSectorReturn>();
const sectorFailureSuppressed = new Map<string, string>();

/** 테스트 격리용 — 운영 경로 미사용. */
export function __resetGate2SectorCycleHydrationStateForTest(): void {
  sectorReturnCache.clear();
  sectorFailureSuppressed.clear();
}

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function hasSectorCoverage(snapshot: HydratableSnapshot): boolean {
  const cycle = snapshot.gate2ExternalDataCoverage?.sectorCycle as Record<string, unknown> | undefined;
  if (!cycle) return false;
  const status = String(cycle.status ?? '').toUpperCase();
  return status === 'VERIFIED' || status === 'PARTIAL' || cycle.available === true;
}

function stockReturn20dOf(snapshot: HydratableSnapshot): number | null {
  if (finite(snapshot.symbolFeatures?.return20d)) return snapshot.symbolFeatures.return20d;
  if (finite(snapshot.return20d)) return snapshot.return20d;
  return null;
}

function sectorReturn20dFromSeries(series: ReadonlyArray<{ close: number }>): number | null {
  if (series.length < 21) return null;
  const latest = series[0]?.close;
  const past = series[20]?.close;
  if (!finite(latest) || !finite(past) || past <= 0) return null;
  return round1(((latest - past) / past) * 100);
}

/**
 * sectorCycle 결손 후보를 종목 마스터(지수업종 중분류 코드)→KIS 업종지수 일봉(r20)으로 보충한다.
 * 공식 11-섹터 이름 매핑 체인을 우회하는 네이티브 경로 — 어떤 시장/종목이든 마스터 코드만 있으면
 * stockVsSectorReturn20d(+벤치마크 가용 시 sectorRelativeReturn20d)를 산출해
 * `gate2ExternalDataCoverage.sectorCycle(status=PARTIAL)` 로 주입 → buildSectorAxis 기존 경로 소비.
 * quota: 업종지수 조회는 심볼이 아니라 **고유 업종코드 단위**(일중 캐시·스캔당 상한·실패 억제).
 */
export async function hydrateGate2SectorCycleAdr0601(input: {
  candidateSnapshots: readonly HydratableSnapshot[];
  benchmarkReturn20d?: number | null;
  now?: Date;
  masterLoader?: typeof loadStockSectorCodeMaster;
  sectorDailyFetcher?: typeof fetchKisSectorIndexDaily;
  env?: NodeJS.ProcessEnv;
}): Promise<Gate2SectorCycleHydrationReportAdr0601> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const maxIndexFetchPerScan = resolveGate2SectorIndexFetchMax(env);
  const report: Gate2SectorCycleHydrationReportAdr0601 = {
    enabled: isGate2SectorCycleHydrationEnabled(env),
    masterLoaded: false,
    masterRows: 0,
    candidates: input.candidateSnapshots.length,
    alreadyCovered: 0,
    mappedByMaster: 0,
    indexFetches: 0,
    cacheHits: 0,
    hydrated: 0,
    failures: 0,
    capped: 0,
    maxIndexFetchPerScan,
    executionImpact: 'NONE',
  };
  if (!report.enabled || maxIndexFetchPerScan === 0) return report;

  let master: StockSectorCodeMasterResult;
  try {
    master = await (input.masterLoader ?? loadStockSectorCodeMaster)();
  } catch {
    report.failures += 1;
    return report;
  }
  report.masterLoaded = master.loaded;
  report.masterRows = master.rowCount;
  if (!master.loaded) return report;

  const dateKey = kstDateKey(now);
  const fetcher = input.sectorDailyFetcher ?? fetchKisSectorIndexDaily;
  const missing = input.candidateSnapshots
    .filter((snapshot) => {
      if (!snapshot.symbol) return false;
      if (hasSectorCoverage(snapshot)) {
        report.alreadyCovered += 1;
        return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.gate1Passed === true) - Number(a.gate1Passed === true));

  for (const snapshot of missing) {
    const row = master.bySymbol.get(String(snapshot.symbol));
    const iscd = row?.sectorMediumCode?.trim();
    if (!row || !iscd || !/^\d{1,4}$/.test(iscd)) continue;
    report.mappedByMaster += 1;

    let cached = sectorReturnCache.get(iscd);
    if (!cached || cached.dateKey !== dateKey) {
      if (sectorFailureSuppressed.get(iscd) === dateKey) continue;
      if (report.indexFetches >= maxIndexFetchPerScan) {
        report.capped += 1;
        continue;
      }
      report.indexFetches += 1;
      try {
        const daily = await fetcher(iscd, undefined, undefined, 'LOW');
        const sectorReturn20d = daily ? sectorReturn20dFromSeries(daily.series ?? []) : null;
        if (sectorReturn20d == null) {
          sectorFailureSuppressed.set(iscd, dateKey);
          report.failures += 1;
          continue;
        }
        cached = { dateKey, sectorName: daily?.sectorName ?? '', sectorReturn20d };
        sectorReturnCache.set(iscd, cached);
      } catch {
        sectorFailureSuppressed.set(iscd, dateKey);
        report.failures += 1;
        continue;
      }
    } else {
      report.cacheHits += 1;
    }

    const stockReturn20d = stockReturn20dOf(snapshot);
    const benchmark = finite(input.benchmarkReturn20d) ? input.benchmarkReturn20d : null;
    const values: Record<string, number> = { sectorReturn20d: cached.sectorReturn20d };
    if (stockReturn20d != null) values.stockVsSectorReturn20d = round1(stockReturn20d - cached.sectorReturn20d);
    if (benchmark != null) values.sectorRelativeReturn20d = round1(cached.sectorReturn20d - benchmark);
    if (values.stockVsSectorReturn20d === undefined && values.sectorRelativeReturn20d === undefined) continue;

    snapshot.gate2ExternalDataCoverage = {
      ...(snapshot.gate2ExternalDataCoverage ?? {}),
      sectorCycle: {
        status: 'PARTIAL',
        available: true,
        sectorIscd: iscd,
        ...(cached.sectorName ? { sectorName: cached.sectorName } : {}),
        values,
        hydratedBy: 'ADR_0601_KIS_MASTER_SECTOR_INDEX',
      },
    };
    report.hydrated += 1;
  }

  if (report.indexFetches > 0 || report.cacheHits > 0 || report.hydrated > 0) {
    console.info(
      `[ADR-0601] Gate2 sector-cycle native hydration — hydrated=${report.hydrated} ` +
        `(masterRows=${report.masterRows} mapped=${report.mappedByMaster} indexFetch=${report.indexFetches} ` +
        `cache=${report.cacheHits} fail=${report.failures} capped=${report.capped} max=${maxIndexFetchPerScan}) executionImpact=NONE`,
    );
  }
  return report;
}
