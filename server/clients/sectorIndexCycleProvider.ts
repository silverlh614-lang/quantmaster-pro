// @responsibility KIS 섹터 index 20d/5d return 배치 fetch·캐시 SSOT — Gate2 sectorReturn20d 배선용 (flag-gate, default OFF).
/**
 * sectorIndexCycleProvider.ts — 공식 섹터 index 20d/5d return cycle SSOT (ADR-0570, ADR-0423 후속).
 *
 * 목적: Gate2 sector cycle 정규화기(`sectorThemeLeaderCycleNormalizer`)가 요구하는
 *   `sectorReturn20d`(+5d) 를 verify 된 공식 섹터 index daily history 로부터 계산해
 *   `SectorEnergyInput.sectorReturn20d` 에 배선한다. 이로써 "Gate2 Sector 0/25"
 *   (SECTOR_THEME_CYCLE_MISSING) 가 해소된다.
 *
 * 데이터 출처(SSOT 재사용):
 *   - fetch: `fetchKisSectorIndexDaily(iscd)` (kisClient SSOT, realDataKisGet 경유 →
 *            회로차단/blacklist/jitter 자동, raw KIS 0). 절대 규칙 #2 충족.
 *   - 섹터→iscd 매핑: `OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS`
 *            (SectorEnergyCanonicalResolver SSOT). 신규 매핑 생성 금지 — 재사용만.
 *
 * KIS quota: refresh 당 섹터당 1콜(~11콜)만. 6h+ TTL 캐시(휴장 인지). 후보당 재fetch 0.
 *
 * flag-gate: `SECTOR_INDEX_CYCLE_WIRING_ENABLED !== 'true'` → 항상 빈 Map 반환
 *   (byte-equivalent: KIS 추가콜 0, sectorReturn20d 미배선). ADR-0157 정확 비교.
 *
 * executionImpact: 본 모듈은 데이터만 산출. 배선 후 evaluateSectorEnergy 의 scoring
 *   formula 가 바뀌어 sector tier(LEADING/LAGGING)·applySectorScoreBoost 가 영향받을 수
 *   있으므로 (execution-adjacent), flag default OFF + shadow 검증 의무. ADR-0570 §D5.
 */

import {
  fetchKisSectorIndexDaily,
  type KisSectorIndexDaily,
} from './kisClient/index.js';
import { OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS } from '../../src/domain/sector-energy/SectorEnergyCanonicalResolver.js';
import type { KisApiPriority } from './kisRateLimiter.js';
import { publishCanonicalSectorReturns } from './sectorCanonicalReturnLookup.js'; // ADR-0577 Stage 0: canonical 룩업 leaf 에 publish (read-only, 신규 fetch 0).

/** StrategicSector(meta.inputs 의 KRX 12-섹터명) → 공식 iscd 매핑 (verifiedMapping SSOT 재사용). */
export interface SectorCycleReturn {
  /** StrategicSector display name (예: '반도체'). */
  sectorName: string;
  /** 사용한 공식 섹터 iscd. */
  iscd: string;
  /** (latest.close - close[~20거래일 전]) / close[~20거래일 전] * 100. 부족/오류 시 null. */
  sectorReturn20d: number | null;
  /** 5거래일 기준. 가능할 때만. */
  sectorReturn5d: number | null;
}

/**
 * StrategicSector(KRX 12-섹터, meta.inputs 의 `name`) → 공식 섹터 iscd 매핑.
 * iscd 값은 OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS(verifiedMapping SSOT) 의 sectorName→indexCode
 * 를 그대로 재사용한다 (신규 매핑 생성 금지). 직접 1:1 대응이 없는 KRX 섹터는 가장 가까운
 * 공식 섹터 iscd 로 매핑하거나(인터넷/플랫폼·통신→방송통신) 매핑 부재 시 제외(null 유지).
 */
const STRATEGIC_SECTOR_TO_OFFICIAL_SECTOR_NAME: Readonly<Record<string, string>> = Object.freeze({
  '반도체': '반도체',
  '바이오/헬스케어': '바이오/헬스케어',
  '자동차': '자동차',
  '금융': '금융',
  '철강': '철강',
  '유통/소비재': '유통/소비재',
  '건설/부동산': '건설',
  '에너지/화학': '화학',
  '인터넷/플랫폼': '방송통신',
  '통신/유틸리티': '방송통신',
  // 이차전지·조선·방산 은 공식 11-섹터 verifiedMapping 에 직접 대응 iscd 없음 → 미배선(null 유지).
});

/** sectorName → iscd 직접 조회 (base verify targets SSOT). */
function iscdForOfficialSectorName(officialSectorName: string): string | null {
  const target = OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS.find(
    (t) => t.sectorName === officialSectorName,
  );
  return target ? target.indexCode : null;
}

/** ENV flag — default OFF (ADR-0157 정확 비교). OFF 면 본 모듈은 KIS 콜 0. */
export function isSectorIndexCycleWiringDisabled(): boolean {
  return process.env.SECTOR_INDEX_CYCLE_WIRING_ENABLED !== 'true';
}

/**
 * StrategicSector cycle Map → SectorEnergyInput 에 주입할 옵셔널 필드.
 * finite 한 값만 부착 (미배선/거래일부족 → 빈 객체 = byte-equivalent).
 */
export function sectorCycleInputFields(
  cycleReturns: Map<string, SectorCycleReturn>,
  sectorName: string,
): { sectorReturn20d?: number; sectorReturn5d?: number } {
  const cycle = cycleReturns.get(sectorName);
  const out: { sectorReturn20d?: number; sectorReturn5d?: number } = {};
  if (cycle && typeof cycle.sectorReturn20d === 'number' && Number.isFinite(cycle.sectorReturn20d)) {
    out.sectorReturn20d = cycle.sectorReturn20d;
  }
  if (cycle && typeof cycle.sectorReturn5d === 'number' && Number.isFinite(cycle.sectorReturn5d)) {
    out.sectorReturn5d = cycle.sectorReturn5d;
  }
  return out;
}

/** 캐시 TTL — 휴장 인지를 위해 6h+ (refresh cron 사이클보다 길게). */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CycleCacheEntry {
  fetchedAtMs: number;
  byStrategicSector: Map<string, SectorCycleReturn>;
}

let _cache: CycleCacheEntry | null = null;

/** 테스트 전용 — 캐시 리셋 (ADR-0577 canonical leaf 스냅샷 동반 리셋). */
export function __resetSectorIndexCycleCacheForTests(): void {
  _cache = null;
  publishCanonicalSectorReturns(null);
}

/**
 * series rows 에서 20d/5d return 계산.
 * - baseDate(YYYYMMDD) 오름차순 정렬 후 latest 기준 N거래일 전 close 대비.
 * - 거래일 부족(20/5 미만) 또는 close<=0 → 해당 윈도우 null (graceful).
 */
export function computeSectorReturnsFromDaily(
  daily: KisSectorIndexDaily | null,
): { sectorReturn20d: number | null; sectorReturn5d: number | null } {
  if (!daily || !Array.isArray(daily.series) || daily.series.length === 0) {
    return { sectorReturn20d: null, sectorReturn5d: null };
  }
  // 종가 유효 row 만 + baseDate 오름차순(과거→최신) 정렬.
  const rows = daily.series
    .filter((r) => /^\d{8}$/.test(String(r.baseDate ?? '')) && Number.isFinite(r.close) && r.close > 0)
    .slice()
    .sort((a, b) => a.baseDate.localeCompare(b.baseDate));
  if (rows.length === 0) return { sectorReturn20d: null, sectorReturn5d: null };

  const latest = rows[rows.length - 1];
  const returnOver = (tradingDaysBack: number): number | null => {
    const idx = rows.length - 1 - tradingDaysBack;
    if (idx < 0) return null;
    const past = rows[idx];
    if (!past || !(past.close > 0)) return null;
    const pct = ((latest.close - past.close) / past.close) * 100;
    return Number.isFinite(pct) ? Number(pct.toFixed(2)) : null;
  };

  return {
    sectorReturn20d: returnOver(20),
    sectorReturn5d: returnOver(5),
  };
}

/**
 * 공식 섹터별 20d/5d return 배치 fetch (캐시 우선).
 *
 * - flag OFF → 빈 Map (KIS 콜 0, byte-equivalent).
 * - 캐시 fresh(<6h) → 캐시 반환 (후보당 재fetch 0).
 * - 캐시 stale/부재 → 매핑된 공식 섹터별 1콜(~11콜) 배치 후 캐시 write.
 * - 섹터당 fetch 실패/거래일 부족 → 해당 섹터 null 유지(graceful), 다른 섹터 무영향.
 */
export async function getSectorCycleReturns(
  priority: KisApiPriority = 'LOW',
): Promise<Map<string, SectorCycleReturn>> {
  if (isSectorIndexCycleWiringDisabled()) return new Map();

  const now = Date.now();
  if (_cache && now - _cache.fetchedAtMs < CACHE_TTL_MS) {
    // ADR-0577 Stage 0: 캐시 hit 시에도 canonical leaf 에 publish (신규 fetch 0, read-only 재사용).
    publishCanonicalSectorReturns(_cache.byStrategicSector.values());
    return new Map(_cache.byStrategicSector);
  }

  const out = new Map<string, SectorCycleReturn>();
  const entries = Object.entries(STRATEGIC_SECTOR_TO_OFFICIAL_SECTOR_NAME);
  for (const [strategicSector, officialSectorName] of entries) {
    const iscd = iscdForOfficialSectorName(officialSectorName);
    if (!iscd) continue;
    // 동일 iscd 가 여러 StrategicSector 에 매핑될 수 있으나(인터넷/통신→방송통신),
    // fetch 는 캐시 미존재 시에만 호출되고 후보당 재fetch 가 없으므로 quota 영향 미미.
    let daily: KisSectorIndexDaily | null = null;
    try {
      daily = await fetchKisSectorIndexDaily(iscd, undefined, undefined, priority);
    } catch (e) {
      // graceful — 해당 섹터만 skip. 다른 섹터/엔진 흐름 무영향.
      console.warn(
        `[SectorIndexCycle] ${strategicSector}(${iscd}) fetch 실패 — skip:`,
        e instanceof Error ? e.message : e,
      );
      daily = null;
    }
    const { sectorReturn20d, sectorReturn5d } = computeSectorReturnsFromDaily(daily);
    out.set(strategicSector, { sectorName: strategicSector, iscd, sectorReturn20d, sectorReturn5d });
  }

  _cache = { fetchedAtMs: now, byStrategicSector: new Map(out) };
  // ADR-0577 Stage 0: 빌드 결과를 canonical leaf 에 publish (per-candidate 축이 룩업으로 소비).
  publishCanonicalSectorReturns(out.values());
  return out;
}

/**
 * build 진입 헬퍼 — flag OFF 면 빈 Map, throw 는 내부 격리(graceful 미배선 복귀).
 * sectorEnergyProvider raw 진입에서 1회 호출 (provider 측 try/catch·flag 검사 footprint 최소화).
 */
export async function getSectorCycleReturnsForBuild(
  priority: KisApiPriority = 'LOW',
): Promise<Map<string, SectorCycleReturn>> {
  if (isSectorIndexCycleWiringDisabled()) return new Map();
  try {
    return await getSectorCycleReturns(priority);
  } catch (e) {
    console.warn('[SectorIndexCycle] build fetch 실패 — 미배선 복귀:', e instanceof Error ? e.message : e);
    return new Map();
  }
}
