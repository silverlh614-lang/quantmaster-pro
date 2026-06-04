// @responsibility ADR-0572 canonical(L1) 섹터 return/rank/leading 룩업 leaf — normalizer 가 KIS/fs 부작용 없이 per-candidate Gate2 축에 소비.

/**
 * sectorCanonicalReturnLookup.ts — ADR-0572 Stage 0 데이터원 룩업 leaf.
 *
 * 목적: ADR-0570 `sectorIndexCycleProvider` 가 이미 산출·캐시한 canonical 공식 섹터 index
 *   return(20d/5d, L1 OFFICIAL_KIS_SECTOR_INDEX)을 sector 명으로 동기 룩업하는 헬퍼를
 *   제공한다. `sectorThemeLeaderCycleNormalizer`(순수 모듈)가 무거운 provider/KIS 를 직접
 *   import 하지 않고도 canonical 우선 데이터원을 소비할 수 있게 하는 의존성-0 leaf 다.
 *
 * 부작용 0: 본 모듈은 네트워크/fs 호출을 하지 않는다. provider(Stage 0)가 build 시 이미
 *   확보한 Map 을 `publishCanonicalSectorReturns` 로 주입(publish)하고, normalizer 는
 *   `canonicalSectorReturn20d` 등으로 read 만 한다. 신규 KIS 콜 0 (ADR-0570 캐시 재사용).
 *
 * flag-gate: `SECTOR_LEADERSHIP_CANONICAL_SOURCE_ENABLED !== 'true'` → 모든 룩업이 null
 *   반환 (default OFF = canonical 미조회, normalizer 가 basket fallback = byte-identical).
 *   ADR-0157 정확 비교. 기존 공급/소비 flag(SECTOR_INDEX_CYCLE_WIRING_ENABLED /
 *   SECTOR_ENERGY_GATE2_WIRING_ENABLED)와 직교 — 본 flag 는 per-candidate 축의 *데이터원
 *   선택*(basket→canonical)만 정밀 토글한다(A/B).
 *
 * 데이터 위계(ADR-0572 D4): canonical=L1(우선). basket=DIAGNOSTIC_ONLY(normalizer fallback).
 *   L4(AI) 미혼입(#7). providerIssue(결손)→bearish 변환 0(#6) — 결손 시 null=중립 반환.
 */

/** publish 받는 per-sector canonical return 스냅샷 (provider 의 SectorCycleReturn 구조 호환). */
export interface CanonicalSectorReturnEntry {
  sectorName: string;
  sectorReturn20d: number | null;
  sectorReturn5d: number | null;
}

/** module-local 스냅샷 — provider build 가 publish, normalizer 가 read. */
let _snapshot: ReadonlyMap<string, CanonicalSectorReturnEntry> | null = null;

/** ENV flag — default OFF (ADR-0157 정확 비교). OFF 면 모든 룩업 null = byte-identical. */
export function isCanonicalSectorSourceDisabled(): boolean {
  return process.env.SECTOR_LEADERSHIP_CANONICAL_SOURCE_ENABLED !== 'true';
}

/**
 * provider(Stage 0) 가 이미 캐시/빌드한 canonical return Map 을 leaf 에 publish 한다.
 * 신규 fetch 0 — 기존 결과를 그대로 스냅샷(불변 복사)한다. null/빈 입력은 스냅샷 비움.
 */
export function publishCanonicalSectorReturns(
  returns: Iterable<CanonicalSectorReturnEntry> | null | undefined,
): void {
  if (!returns) {
    _snapshot = null;
    return;
  }
  const next = new Map<string, CanonicalSectorReturnEntry>();
  for (const entry of returns) {
    const name = typeof entry?.sectorName === 'string' ? entry.sectorName.trim() : '';
    if (!name) continue;
    next.set(name, {
      sectorName: name,
      sectorReturn20d:
        typeof entry.sectorReturn20d === 'number' && Number.isFinite(entry.sectorReturn20d)
          ? entry.sectorReturn20d
          : null,
      sectorReturn5d:
        typeof entry.sectorReturn5d === 'number' && Number.isFinite(entry.sectorReturn5d)
          ? entry.sectorReturn5d
          : null,
    });
  }
  _snapshot = next;
}

/** 테스트 전용 — 스냅샷 리셋. */
export function __resetCanonicalSectorReturnLookupForTests(): void {
  _snapshot = null;
}

/** flag ON + 스냅샷 존재 + 섹터 매칭 시 canonical entry, 그외 null (graceful). */
function lookupEntry(sector: string | null): CanonicalSectorReturnEntry | null {
  if (isCanonicalSectorSourceDisabled()) return null;
  if (!sector || !_snapshot) return null;
  const trimmed = sector.trim();
  if (!trimmed) return null;
  return _snapshot.get(trimmed) ?? null;
}

/**
 * canonical L1 20d return (sector 명 룩업). flag OFF/스냅샷부재/미매칭/결손 → null
 * (normalizer 가 basket fallback). providerIssue→bearish 변환 0: null=중립.
 */
export function canonicalSectorReturn20d(sector: string | null): number | null {
  return lookupEntry(sector)?.sectorReturn20d ?? null;
}

/** canonical L1 5d return (sector 명 룩업). 동일 graceful 정책. */
export function canonicalSectorReturn5d(sector: string | null): number | null {
  return lookupEntry(sector)?.sectorReturn5d ?? null;
}

/**
 * canonical leadership rank(1-based) — 스냅샷 내 finite sectorReturn20d 섹터를 내림차순
 * 정렬한 순위. 해당 sector 의 20d 가 결손이면 순위 산출 불가 → null. flag OFF → null.
 */
export function canonicalSectorRank20d(sector: string | null): number | null {
  if (isCanonicalSectorSourceDisabled()) return null;
  if (!sector || !_snapshot) return null;
  const trimmed = sector.trim();
  if (!trimmed) return null;
  const self = _snapshot.get(trimmed);
  if (!self || self.sectorReturn20d == null) return null;
  const ranked = [..._snapshot.values()]
    .filter((e): e is CanonicalSectorReturnEntry & { sectorReturn20d: number } => e.sectorReturn20d != null)
    .sort((a, b) => b.sectorReturn20d - a.sectorReturn20d);
  const idx = ranked.findIndex((e) => e.sectorName === trimmed);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * canonical leading 여부 — 스냅샷 내 finite 섹터 중 상위 1/3(최소 1) 안에 들면 true.
 * 순위 산출 불가(결손/미매칭/flag OFF) → null (basket fallback / 중립). false 강제 변환 0.
 */
export function canonicalIsLeadingSector(sector: string | null): boolean | null {
  const rank = canonicalSectorRank20d(sector);
  if (rank == null || !_snapshot) return null;
  const total = [..._snapshot.values()].filter((e) => e.sectorReturn20d != null).length;
  if (total <= 0) return null;
  const leadingCount = Math.max(1, Math.ceil(total / 3));
  return rank <= leadingCount;
}
