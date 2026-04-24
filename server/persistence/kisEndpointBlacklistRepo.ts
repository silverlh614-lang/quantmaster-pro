/**
 * @responsibility KIS trId 영속 블랙리스트 — 30분/10회 404 누적 시 24h 차단 (ADR-0010, PR-24)
 *
 * `kisClient` 의 회로차단기 메모리 카운터는 재배포 시 사라지므로, 같은 죽은 엔드포인트를
 * 처음부터 다시 두드리는 문제를 해소한다. 메모리 + Volume JSON 이중 저장 + debounce flush.
 *
 * 임계값(30분 윈도우 / 10회 / 24h 차단) 은 ADR-0010 본문이 SSOT — 운영 데이터 누적 후
 * PR-25 에서 튜닝 예정. 현재는 env 노출 없음.
 */

import fs from 'fs';
import { KIS_ENDPOINT_BLACKLIST_FILE, ensureDataDir } from './paths.js';

export interface BlacklistEntry {
  trId: string;
  blockedUntil: number;
  reason: '404_RECURRING';
  recentFailureCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type BlacklistStore = Record<string, BlacklistEntry>;

export const WINDOW_MS = 30 * 60 * 1000;
export const FAILURE_THRESHOLD = 10;
export const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;

const FLUSH_DEBOUNCE_MS = 200;

let _store: BlacklistStore | null = null;
let _flushTimer: NodeJS.Timeout | null = null;
let _dirty = false;

// 윈도우 내 404 timestamps — trId → epoch ms 배열. 메모리 only (영속화 불필요).
const _failureWindows = new Map<string, number[]>();

function ensureLoaded(): BlacklistStore {
  if (_store) return _store;
  ensureDataDir();
  if (!fs.existsSync(KIS_ENDPOINT_BLACKLIST_FILE)) return (_store = {});
  try {
    const raw = fs.readFileSync(KIS_ENDPOINT_BLACKLIST_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as BlacklistStore;
    _store = parsed;
    pruneExpired();
    return _store!;
  } catch (e) {
    console.warn('[KisBlacklistRepo] 로드 실패 — 빈 블랙리스트로 시작:', e instanceof Error ? e.message : e);
    return (_store = {});
  }
}

function scheduleFlush(): void {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (!_dirty) return;
    flushKisBlacklist();
  }, FLUSH_DEBOUNCE_MS);
}

function pruneExpired(now: number = Date.now()): number {
  if (!_store) return 0;
  let removed = 0;
  for (const [trId, entry] of Object.entries(_store)) {
    if (entry.blockedUntil <= now) {
      delete _store[trId];
      removed++;
    }
  }
  if (removed > 0) scheduleFlush();
  return removed;
}

/** 부팅 시 호출 — 만료 entry 자동 청소 후 활성 entry 수 반환. */
export function loadKisEndpointBlacklist(): number {
  const store = ensureLoaded();
  return Object.keys(store).length;
}

/**
 * 차단 여부 — 만료된 entry 는 호출 시점에 정리하므로 stale 는 false 반환.
 */
export function isEndpointBlacklisted(trId: string, now: number = Date.now()): boolean {
  if ((process.env.KIS_DISABLE_404_BLACKLIST ?? '').toLowerCase() === 'true') return false;
  const store = ensureLoaded();
  const entry = store[trId];
  if (!entry) return false;
  if (entry.blockedUntil <= now) {
    delete store[trId];
    scheduleFlush();
    return false;
  }
  return true;
}

/**
 * 404 발생 기록 — 30분 윈도우 내 누적 10회 도달 시 24h 블랙리스트 등록.
 * @returns 이번 호출로 새로 블랙리스트에 등록되었는지 여부.
 */
export function recordEndpoint404(trId: string, now: number = Date.now()): boolean {
  if ((process.env.KIS_DISABLE_404_BLACKLIST ?? '').toLowerCase() === 'true') return false;
  const store = ensureLoaded();
  if (store[trId] && store[trId].blockedUntil > now) return false;

  const windowStart = now - WINDOW_MS;
  const arr = _failureWindows.get(trId) ?? [];
  const pruned = arr.filter((t) => t >= windowStart);
  pruned.push(now);
  _failureWindows.set(trId, pruned);

  if (pruned.length < FAILURE_THRESHOLD) return false;

  const firstSeenAt = pruned[0];
  store[trId] = {
    trId,
    blockedUntil: now + BLOCK_DURATION_MS,
    reason: '404_RECURRING',
    recentFailureCount: pruned.length,
    firstSeenAt,
    lastSeenAt: now,
  };
  _failureWindows.delete(trId);
  scheduleFlush();
  console.warn(
    `[KisBlacklistRepo] 🛑 ${trId} 24h 블랙리스트 등록 — ` +
    `${WINDOW_MS / 60000}분 내 404 ${pruned.length}회 누적 (다음 시도: ${new Date(now + BLOCK_DURATION_MS).toISOString()})`
  );
  return true;
}

/** 성공 응답 시 호출 — 윈도우 카운터만 리셋. 블랙리스트 entry 는 그대로(만료 대기). */
export function resetEndpoint404Counter(trId: string): void {
  _failureWindows.delete(trId);
}

/** 운영자 수동 해제 — 모든 blacklist 와 윈도우 카운터 청소. */
export function resetKisEndpointBlacklist(): number {
  const store = ensureLoaded();
  const removed = Object.keys(store).length;
  for (const k of Object.keys(store)) delete store[k];
  _failureWindows.clear();
  scheduleFlush();
  return removed;
}

/** 디버깅·모니터링용 스냅샷 (만료 정리 후). */
export function getKisEndpointBlacklist(): BlacklistEntry[] {
  const store = ensureLoaded();
  pruneExpired();
  return Object.values(store);
}

export function flushKisBlacklist(): void {
  if (!_store || !_dirty) return;
  ensureDataDir();
  try {
    fs.writeFileSync(KIS_ENDPOINT_BLACKLIST_FILE, JSON.stringify(_store, null, 2));
    _dirty = false;
  } catch (e) {
    console.warn('[KisBlacklistRepo] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

// 테스트 전용 — 메모리 상태 강제 리셋
export const __testOnly = {
  reset(): void {
    _store = null;
    _failureWindows.clear();
    _dirty = false;
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  },
  windowSize(trId: string): number {
    return (_failureWindows.get(trId) ?? []).length;
  },
};
