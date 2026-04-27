// @responsibility ADR-0060 워치리스트 sector 필드 일괄 백필
/**
 * watchlistSectorBackfill.ts — ADR-0060 PR-Z1 후속
 *
 * PR-Z1 (2026-04-27) 이전에 추가된 워치리스트 entries 의 `sector` 필드는 빈 상태.
 * 그 결과 sectorCycleDashboard 의 "📋 국내 워치리스트 섹터 분포" 블록이 누락되고,
 * sectorConcentrationGate 의 fallback 분기 부담이 증가한다.
 *
 * 본 모듈은 *부팅 시 1회* 호출되어 sector 누락 entries 의 `sector` 필드를
 * `getSectorByCode` SSOT 결과로 백필한다. 이미 sector 가 있는 entry 는 *덮어쓰지 않음*
 * (사용자 수동 입력 보존). `getSectorByCode` 가 '미분류' 를 반환하면 *건너뜀*
 * (sectorMap 갱신 후 재시도 가능하도록 빈 상태 유지).
 */
import {
  loadWatchlist,
  saveWatchlist,
} from './watchlistRepo.js';
import { getSectorByCode } from '../screener/sectorMap.js';

export interface WatchlistSectorBackfillResult {
  /** 전체 워치리스트 entry 수 */
  total: number;
  /** sector 부재로 검사 대상이 된 entry 수 */
  scanned: number;
  /** sectorMap 매칭 성공으로 백필된 entry 수 */
  filled: number;
  /** sectorMap '미분류' 또는 빈 결과로 보류된 entry 수 */
  unmatched: number;
}

const UNCLASSIFIED_SECTOR_LABELS = new Set<string>([
  '미분류',
  'unknown',
  'UNKNOWN',
  '',
]);

function isMeaningfulSector(s: string | undefined | null): boolean {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  return !UNCLASSIFIED_SECTOR_LABELS.has(trimmed);
}

/**
 * 워치리스트 entries 의 누락된 `sector` 필드를 sectorMap SSOT 결과로 일괄 백필.
 *
 * - 이미 sector 가 있는 entry 는 보존 (사용자 수동 입력 유지).
 * - getSectorByCode 가 '미분류' / 빈 문자열 반환 시 미백필 (다음 sectorMap 갱신 후 재시도).
 * - 변경 사항이 없으면 saveWatchlist 미호출 (불필요한 disk write 회피).
 */
export function backfillWatchlistSectors(): WatchlistSectorBackfillResult {
  const list = loadWatchlist();
  let scanned = 0;
  let filled = 0;
  let unmatched = 0;
  let mutated = false;

  for (const entry of list) {
    if (isMeaningfulSector(entry.sector)) continue;
    scanned++;
    const sector = getSectorByCode(entry.code);
    if (isMeaningfulSector(sector)) {
      entry.sector = sector;
      filled++;
      mutated = true;
    } else {
      unmatched++;
    }
  }

  if (mutated) {
    saveWatchlist(list);
  }
  return {
    total: list.length,
    scanned,
    filled,
    unmatched,
  };
}
