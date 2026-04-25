/**
 * @responsibility 종목 마스터 last-known-good 스냅샷 — 검증 통과 응답만 저장 (ADR-0013)
 *
 * Tier 1 (KRX) 또는 Tier 2 (Naver) 가 검증 임계를 만족했을 때만 갱신된다.
 * Tier 3 (자기 자신) 또는 Tier 4 (Seed) 응답은 절대 shadow 를 갱신하지 않아
 * 폴백 사용이 shadow 를 오염시키지 않는다.
 */

import fs from 'fs';
import { STOCK_MASTER_SHADOW_FILE, ensureDataDir } from './paths.js';
import type { StockMasterEntry } from './krxStockMasterRepo.js';
import type { StockMasterSource } from './stockMasterHealthRepo.js';

export interface ShadowMasterSnapshot {
  fetchedAt: number;
  source: StockMasterSource;
  entries: StockMasterEntry[];
  validatedCount: number;
}

const VALID_SHADOW_SOURCES: ReadonlyArray<StockMasterSource> = ['KRX_CSV', 'NAVER_LIST'];

let _cached: ShadowMasterSnapshot | null = null;
let _loadedFromDisk = false;

function loadFromDisk(): ShadowMasterSnapshot | null {
  ensureDataDir();
  if (!fs.existsSync(STOCK_MASTER_SHADOW_FILE)) return null;
  try {
    const raw = fs.readFileSync(STOCK_MASTER_SHADOW_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ShadowMasterSnapshot;
    if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') return null;
    if (!VALID_SHADOW_SOURCES.includes(parsed.source)) {
      console.warn(`[ShadowMasterDb] 잘못된 source 로 영속됨: ${parsed.source} — 무시`);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn('[ShadowMasterDb] 디스크 로드 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

function saveToDisk(snap: ShadowMasterSnapshot): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STOCK_MASTER_SHADOW_FILE, JSON.stringify(snap, null, 2));
  } catch (e) {
    console.warn('[ShadowMasterDb] 디스크 저장 실패:', e instanceof Error ? e.message : e);
  }
}

function ensureLoaded(): void {
  if (_loadedFromDisk) return;
  _cached = loadFromDisk();
  _loadedFromDisk = true;
}

/**
 * Shadow DB 스냅샷 조회. 부재 시 null.
 */
export function loadShadowMaster(): ShadowMasterSnapshot | null {
  ensureLoaded();
  return _cached;
}

/**
 * Shadow DB 갱신 — Tier 1/2 검증 통과 응답만 받는다.
 *
 * @returns true: 저장 성공 / false: source 가 허용되지 않거나 entries 가 비었음
 */
export function updateShadowMaster(
  source: StockMasterSource,
  entries: StockMasterEntry[],
  now: number = Date.now(),
): boolean {
  if (!VALID_SHADOW_SOURCES.includes(source)) {
    console.warn(`[ShadowMasterDb] 갱신 거부 — source=${source} 는 shadow 갱신 비허용`);
    return false;
  }
  if (entries.length === 0) {
    console.warn('[ShadowMasterDb] 갱신 거부 — 빈 entries');
    return false;
  }
  const snap: ShadowMasterSnapshot = {
    fetchedAt: now,
    source,
    entries,
    validatedCount: entries.length,
  };
  _cached = snap;
  _loadedFromDisk = true;
  saveToDisk(snap);
  return true;
}

/** 메모리 캐시된 entry 수. 디스크에 없으면 0. */
export function getShadowMasterSize(): number {
  ensureLoaded();
  return _cached?.entries.length ?? 0;
}

/** Shadow 의 fetchedAt 부터 경과 시간 (ms). 부재 시 Infinity. */
export function getShadowMasterAgeMs(now: number = Date.now()): number {
  ensureLoaded();
  if (!_cached) return Infinity;
  return now - _cached.fetchedAt;
}

export const __testOnly = {
  reset(): void {
    _cached = null;
    _loadedFromDisk = false;
    try { fs.unlinkSync(STOCK_MASTER_SHADOW_FILE); } catch { /* not present */ }
  },
  VALID_SHADOW_SOURCES,
};
