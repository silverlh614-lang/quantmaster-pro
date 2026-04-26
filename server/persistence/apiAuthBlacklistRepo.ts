/**
 * @responsibility 운영자 API 인증 실패 IP 영속 블랙리스트 — 5분 윈도우 10회 누적 시 1시간 차단.
 *
 * 보안 패치 Tier 1 #3 — 외부에서 OPERATOR_TOKEN 을 무차별 대입하는 공격을 차단한다.
 * `kisEndpointBlacklistRepo` 패턴 차용 (메모리 + Volume JSON 이중 + debounce flush).
 * 임계(5분 / 10회 / 1시간) 는 본 모듈 상수가 SSOT.
 */

import fs from 'fs';
import { API_AUTH_BLACKLIST_FILE, ensureDataDir } from './paths.js';

export interface AuthBlacklistEntry {
  ip: string;
  blockedUntil: number;
  reason: 'AUTH_BRUTE_FORCE';
  recentFailureCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type AuthBlacklistStore = Record<string, AuthBlacklistEntry>;

export const AUTH_WINDOW_MS = 5 * 60 * 1000;
export const AUTH_FAILURE_THRESHOLD = 10;
export const AUTH_BLOCK_DURATION_MS = 60 * 60 * 1000;

const FLUSH_DEBOUNCE_MS = 200;

let _store: AuthBlacklistStore | null = null;
let _flushTimer: NodeJS.Timeout | null = null;
let _dirty = false;

const _failureWindows = new Map<string, number[]>();

function ensureLoaded(): AuthBlacklistStore {
  if (_store) return _store;
  ensureDataDir();
  if (!fs.existsSync(API_AUTH_BLACKLIST_FILE)) return (_store = {});
  try {
    const raw = fs.readFileSync(API_AUTH_BLACKLIST_FILE, 'utf-8');
    _store = JSON.parse(raw) as AuthBlacklistStore;
    pruneExpired();
    return _store!;
  } catch (e) {
    console.warn('[ApiAuthBlacklistRepo] 로드 실패 — 빈 블랙리스트로 시작:', e instanceof Error ? e.message : e);
    return (_store = {});
  }
}

function scheduleFlush(): void {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (!_dirty) return;
    flushApiAuthBlacklist();
  }, FLUSH_DEBOUNCE_MS);
}

function pruneExpired(now: number = Date.now()): number {
  if (!_store) return 0;
  let removed = 0;
  for (const [ip, entry] of Object.entries(_store)) {
    if (entry.blockedUntil <= now) {
      delete _store[ip];
      removed++;
    }
  }
  if (removed > 0) scheduleFlush();
  return removed;
}

/** 부팅 시 호출 — 만료 entry 자동 청소 후 활성 entry 수 반환. */
export function loadApiAuthBlacklist(): number {
  const store = ensureLoaded();
  return Object.keys(store).length;
}

/** 차단 여부 — 만료된 entry 는 호출 시점에 정리하므로 stale 는 false. */
export function isIpBlacklisted(ip: string, now: number = Date.now()): boolean {
  if ((process.env.API_AUTH_BLACKLIST_DISABLED ?? '').toLowerCase() === 'true') return false;
  const store = ensureLoaded();
  const entry = store[ip];
  if (!entry) return false;
  if (entry.blockedUntil <= now) {
    delete store[ip];
    scheduleFlush();
    return false;
  }
  return true;
}

/**
 * 401 발생 기록 — 5분 윈도우 내 누적 10회 도달 시 1시간 블랙리스트 등록.
 * @returns 이번 호출로 새로 차단되었는지 여부 (텔레그램 알림 트리거 신호).
 */
export function recordAuthFailure(ip: string, now: number = Date.now()): boolean {
  if ((process.env.API_AUTH_BLACKLIST_DISABLED ?? '').toLowerCase() === 'true') return false;
  const store = ensureLoaded();
  if (store[ip] && store[ip].blockedUntil > now) return false;

  const windowStart = now - AUTH_WINDOW_MS;
  const arr = _failureWindows.get(ip) ?? [];
  const pruned = arr.filter((t) => t >= windowStart);
  pruned.push(now);
  _failureWindows.set(ip, pruned);

  if (pruned.length < AUTH_FAILURE_THRESHOLD) return false;

  const firstSeenAt = pruned[0];
  store[ip] = {
    ip,
    blockedUntil: now + AUTH_BLOCK_DURATION_MS,
    reason: 'AUTH_BRUTE_FORCE',
    recentFailureCount: pruned.length,
    firstSeenAt,
    lastSeenAt: now,
  };
  _failureWindows.delete(ip);
  scheduleFlush();
  console.warn(
    `[ApiAuthBlacklistRepo] 🛑 ${ip} 1h 블랙리스트 등록 — ` +
    `${AUTH_WINDOW_MS / 60000}분 내 401 ${pruned.length}회 누적 (다음 시도: ${new Date(now + AUTH_BLOCK_DURATION_MS).toISOString()})`,
  );
  return true;
}

/** 성공 응답 시 호출 — 윈도우 카운터 리셋 (블랙리스트 entry 는 만료 대기). */
export function resetAuthFailureCounter(ip: string): void {
  _failureWindows.delete(ip);
}

/** 운영자 수동 해제 — 모든 블랙리스트 + 윈도우 카운터 청소. */
export function resetApiAuthBlacklist(): number {
  const store = ensureLoaded();
  const removed = Object.keys(store).length;
  for (const k of Object.keys(store)) delete store[k];
  _failureWindows.clear();
  scheduleFlush();
  return removed;
}

/** 디버깅·모니터링 스냅샷 (만료 정리 후). */
export function getApiAuthBlacklist(): AuthBlacklistEntry[] {
  const store = ensureLoaded();
  pruneExpired();
  return Object.values(store);
}

export function flushApiAuthBlacklist(): void {
  if (!_store || !_dirty) return;
  ensureDataDir();
  try {
    fs.writeFileSync(API_AUTH_BLACKLIST_FILE, JSON.stringify(_store, null, 2));
    _dirty = false;
  } catch (e) {
    console.warn('[ApiAuthBlacklistRepo] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

export const __testOnly = {
  reset(): void {
    _store = null;
    _failureWindows.clear();
    _dirty = false;
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
  },
  windowSize(ip: string): number {
    return (_failureWindows.get(ip) ?? []).length;
  },
};
