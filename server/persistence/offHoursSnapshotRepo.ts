/**
 * @responsibility 장외 gated miss 폴백용 디스크 영속 스냅샷 저장소
 *
 * 성공한 /historical-data 응답을 디스크에 누적 저장해 장외 시 gated miss 에
 * 대한 코히런트 fallback 을 제공한다. 재배포·프로세스 재시작 후에도 "마지막
 * 장중 값" 을 즉시 사용 가능. 메모리 LRU 캐시와 동일 key 스키마 (`symbol:range:interval`).
 *
 * 정책:
 *   - TTL 없음 — 장 개장 직후 fresh fetch 가 overwrite 하므로 별도 만료 불필요
 *   - 최대 1,000 entry (LRU 축출) — 추적 종목 수 × (range, interval) 조합 상한
 *   - debounce flush 500ms — 연속 write 를 1회 I/O 로 모음
 */

import fs from 'fs';
import { OFFHOURS_SNAPSHOT_FILE, ensureDataDir } from './paths.js';

export interface SnapshotEntry {
  body: string;
  contentType: string;
  fetchedAt: number;
}

interface SnapshotStore {
  version: 1;
  entries: Array<{ key: string; entry: SnapshotEntry }>;
}

const MAX_ENTRIES = 1_000;
const FLUSH_DEBOUNCE_MS = 500;

let _store: Map<string, SnapshotEntry> = new Map();
let _loaded = false;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _dirty = false;

function load(): void {
  if (_loaded) return;
  _loaded = true;
  ensureDataDir();
  if (!fs.existsSync(OFFHOURS_SNAPSHOT_FILE)) return;
  try {
    const raw = fs.readFileSync(OFFHOURS_SNAPSHOT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as SnapshotStore;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
    for (const { key, entry } of parsed.entries) {
      if (typeof key === 'string' && entry && typeof entry.body === 'string') {
        _store.set(key, entry);
      }
    }
  } catch (e) {
    console.warn('[OffHoursSnapshot] 로드 실패:', e instanceof Error ? e.message : e);
  }
}

function scheduleFlush(): void {
  _dirty = true;
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (!_dirty) return;
    _dirty = false;
    ensureDataDir();
    try {
      const entries = Array.from(_store.entries()).map(([key, entry]) => ({ key, entry }));
      const store: SnapshotStore = { version: 1, entries };
      fs.writeFileSync(OFFHOURS_SNAPSHOT_FILE, JSON.stringify(store));
    } catch (e) {
      console.warn('[OffHoursSnapshot] 저장 실패:', e instanceof Error ? e.message : e);
    }
  }, FLUSH_DEBOUNCE_MS);
}

/** 스냅샷 조회. 없으면 null. */
export function getSnapshot(key: string): SnapshotEntry | null {
  load();
  return _store.get(key) ?? null;
}

/** 스냅샷 저장 — LRU 축출 + debounce flush. */
export function setSnapshot(key: string, entry: SnapshotEntry): void {
  load();
  if (_store.has(key)) _store.delete(key);
  _store.set(key, entry);
  while (_store.size > MAX_ENTRIES) {
    const oldest = _store.keys().next().value;
    if (oldest === undefined) break;
    _store.delete(oldest);
  }
  scheduleFlush();
}

/** 현재 엔트리 수 — 모니터링용. */
export function getSnapshotSize(): number {
  load();
  return _store.size;
}

/** 테스트 전용 — 메모리 + flush 타이머 리셋. */
export function __resetForTests(): void {
  _store = new Map();
  _loaded = false;
  _dirty = false;
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}

/** 테스트 전용 — debounce 무시 동기 flush. */
export function __flushForTests(): void {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (!_dirty) return;
  _dirty = false;
  ensureDataDir();
  const entries = Array.from(_store.entries()).map(([key, entry]) => ({ key, entry }));
  const store: SnapshotStore = { version: 1, entries };
  fs.writeFileSync(OFFHOURS_SNAPSHOT_FILE, JSON.stringify(store));
}
