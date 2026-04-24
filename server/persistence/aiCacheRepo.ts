/**
 * aiCacheRepo.ts — AI 응답 영속화 캐시 (Idea 4)
 *
 * 3층 캐시의 최하위 백엔드:
 *   Layer 1 (브라우저): aiCache 메모리 — 무한 TTL (탭 생존 동안)
 *   Layer 2 (브라우저): localStorage — 4시간 TTL (탭 재오픈)
 *   Layer 3 (서버): ai-cache.json — Railway Volume 영속 (재배포 후에도 유지)
 *
 * I/O 패턴은 gateAuditRepo.ts와 동일:
 *   - 메모리 단일 인스턴스 캐시 (_cache)
 *   - 읽기: 메모리 우선, 미스 시 파일 1회 로드
 *   - 쓰기: 메모리 즉시 + flush() 시 파일 1회 저장 (debounce 가능)
 *
 * 쓰기 정책: setEntry()는 메모리만 갱신 + 100ms debounce flush.
 *            동시 다발 쓰기에도 파일 I/O는 초당 ~10회로 제한.
 *
 * TTL 정책: 항목별 ttlMs 필드. getEntry()가 만료 항목을 자동 삭제.
 *            기본 TTL은 4시간 (브라우저 layer 2와 동일).
 */

import fs from 'fs';
import { createHash } from 'crypto';
import { AI_CACHE_FILE, ensureDataDir } from './paths.js';

export interface AiCacheEntry<T = unknown> {
  /** 실제 응답 데이터 (JSON 직렬화 가능해야 함) */
  data: T;
  /** 저장 시각 (epoch ms) */
  timestamp: number;
  /** TTL — 만료 시 getEntry()가 자동 폐기. 기본 4시간. */
  ttlMs: number;
}

export type AiCacheStore = Record<string, AiCacheEntry>;

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;   // 4시간
const FLUSH_DEBOUNCE_MS = 100;
const MAX_KEYS = 200;                         // 무한 증가 방지

let _cache: AiCacheStore | null = null;
let _flushTimer: NodeJS.Timeout | null = null;
let _dirty = false;

function ensureLoaded(): AiCacheStore {
  if (_cache) return _cache;
  ensureDataDir();
  if (!fs.existsSync(AI_CACHE_FILE)) return (_cache = {});
  try {
    const raw = fs.readFileSync(AI_CACHE_FILE, 'utf-8');
    _cache = JSON.parse(raw) as AiCacheStore;
    return _cache;
  } catch (e) {
    console.warn('[AiCacheRepo] 로드 실패 — 빈 캐시로 시작:', e instanceof Error ? e.message : e);
    return (_cache = {});
  }
}

function scheduleFlush(): void {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (!_dirty) return;
    flushAiCache();
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * 만료/초과 항목 정리 — MAX_KEYS를 넘으면 가장 오래된 절반 제거.
 */
function evictIfNeeded(store: AiCacheStore): void {
  const now = Date.now();
  // 1) TTL 만료 제거
  for (const [k, e] of Object.entries(store)) {
    if (now - e.timestamp > e.ttlMs) delete store[k];
  }
  // 2) 키 수 제한
  const keys = Object.keys(store);
  if (keys.length <= MAX_KEYS) return;
  const sorted = keys
    .map(k => ({ k, ts: store[k].timestamp }))
    .sort((a, b) => a.ts - b.ts);
  const removeCount = keys.length - MAX_KEYS;
  for (let i = 0; i < removeCount; i++) delete store[sorted[i].k];
}

/**
 * 캐시 항목 조회. 만료된 경우 자동 삭제하고 null 반환.
 */
export function getCacheEntry<T = unknown>(key: string): AiCacheEntry<T> | null {
  const store = ensureLoaded();
  const entry = store[key] as AiCacheEntry<T> | undefined;
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.timestamp > entry.ttlMs) {
    delete store[key];
    scheduleFlush();
    return null;
  }
  return entry;
}

/**
 * 캐시 항목 저장 — 메모리 즉시 + debounce 파일 flush.
 */
export function setCacheEntry<T = unknown>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  const store = ensureLoaded();
  store[key] = { data, timestamp: Date.now(), ttlMs };
  evictIfNeeded(store);
  scheduleFlush();
}

/** 강제 파일 저장 — 프로세스 종료 직전 등에서 호출. */
export function flushAiCache(): void {
  if (!_cache || !_dirty) return;
  ensureDataDir();
  try {
    fs.writeFileSync(AI_CACHE_FILE, JSON.stringify(_cache));
    _dirty = false;
  } catch (e) {
    console.error('[AiCacheRepo] flush 실패:', e instanceof Error ? e.message : e);
  }
}

/** 디버깅/테스트용 — 전체 캐시 상태 스냅샷. */
export function getAiCacheSnapshot(): { keys: number; entries: Array<{ key: string; ageMs: number; ttlMs: number }> } {
  const store = ensureLoaded();
  const now = Date.now();
  return {
    keys: Object.keys(store).length,
    entries: Object.entries(store).map(([k, e]) => ({
      key: k, ageMs: now - e.timestamp, ttlMs: e.ttlMs,
    })),
  };
}

/** 테스트용 — 메모리 캐시 초기화 (파일은 그대로). */
export function resetAiCacheMemory(): void {
  _cache = null;
  _flushTimer = null;
  _dirty = false;
}

/** 단일 키 삭제 — 클라이언트가 빈/오염된 응답 박제를 무효화할 때 사용. */
export function deleteCacheEntry(key: string): boolean {
  const store = ensureLoaded();
  if (!(key in store)) return false;
  delete store[key];
  scheduleFlush();
  return true;
}

// ─── PR-3 #3: Canonical cache key helper ──────────────────────────────────
//
// 호출자가 동일 의미의 프롬프트를 약간 다른 문자열(추가 공백, JSON 키 순서 변경)로
// 보내는 경우 캐시 히트를 놓친다. makeCanonicalCacheKey 는 이를 정규화해 SHA256
// 해시로 묶는다. 호출자는 단일 문자열 키 대신 이 함수를 사용해 고품질 키를 얻는다.
//
// 정규화 규칙:
//   - 프롬프트: 연속 공백 → 단일 공백, 앞뒤 trim
//   - 파라미터: JSON.stringify 시 키 알파벳 오름차순
//   - 모델명: 소문자 통일
//
// 반환: "v1:<12자 해시>" — 버전 접두사로 향후 정규화 규칙 변경 시 캐시 자동 무효화.

function sortedJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(sortedJsonStringify).join(',')}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${sortedJsonStringify((obj as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

export interface CanonicalKeyInputs {
  prompt:   string;
  model?:   string;
  params?:  Record<string, unknown>;
  /** 호출 경로 식별자 — 동일 프롬프트라도 다른 경로(예: reportGenerator vs persona) 는 별도 키. */
  scope?:   string;
}

export function makeCanonicalCacheKey(inputs: CanonicalKeyInputs): string {
  const promptNorm = inputs.prompt.replace(/\s+/g, ' ').trim();
  const modelNorm  = (inputs.model ?? 'default').toLowerCase();
  const paramsStr  = inputs.params ? sortedJsonStringify(inputs.params) : '';
  const scopeNorm  = inputs.scope ?? '';
  const payload    = `${scopeNorm}|${modelNorm}|${promptNorm}|${paramsStr}`;
  const hash       = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return `v1:${hash}`;
}
