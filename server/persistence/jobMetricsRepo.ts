// @responsibility JobMetrics 디스크 영속 SSOT — atomic write + 30s throttle + 부팅 복원 (Railway 재배포 안전)
/**
 * jobMetricsRepo.ts — JobMetrics 영속 SSOT
 *
 * 결함 (사용자 4/30 /cron_introspect 보고):
 *   nightly_reflection / ghost_portfolio / f2w_reverse_loop / orchestrator_tick
 *   4/4 cron 모두 JobMetrics.runCount=0 (실제 파일은 갱신됨) → CONTRADICTION_METRICS_LIES.
 *
 * 근본 원인: `scheduleCatalog._metricsByJob` 가 in-memory `Map` (line 124) 이라
 * Railway 재배포 시 휘발. recordScheduleRun 호출은 정상 — 영속화만 부재.
 *
 * 본 모듈:
 * - `loadJobMetrics()`: 부팅 시 디스크에서 복원. 손상 JSON / 누락 시 빈 객체.
 * - `saveJobMetrics(snapshot)`: atomic write (tmp→rename, 부분 쓰기 차단).
 * - `scheduleSaveJobMetrics(snapshot)`: 30s throttle 래퍼 — recordScheduleRun 직후
 *   호출되어도 디스크 쓰기 부하 무시 가능.
 * - `flushJobMetrics()`: throttle 무시 즉시 flush — 테스트/긴급 종료 훅용.
 */

import fs from 'fs';
import path from 'path';
import { JOB_METRICS_FILE, DATA_DIR } from './paths.js';

export interface JobMetricsRecord {
  jobName: string;
  runCount: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorMessage?: string;
  lastSkipReason?: string;
}

export type JobMetricsSnapshot = Record<string, JobMetricsRecord>;

/** 디스크 쓰기 throttle 윈도우 (ms). 30s — 부팅 후 burst 흡수 + 재배포 즉시 flush. */
const THROTTLE_MS = 30_000;

let _lastFlushAt = 0;
let _pendingTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSnapshot: JobMetricsSnapshot | null = null;

/**
 * 디스크에서 JobMetrics 복원. 파일 부재/손상 시 빈 객체 (안전 fallback).
 * 부팅 시 server/index.ts 가 한 번 호출.
 */
export function loadJobMetrics(): JobMetricsSnapshot {
  try {
    if (!fs.existsSync(JOB_METRICS_FILE)) return {};
    const raw = fs.readFileSync(JOB_METRICS_FILE, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // 최소 schema 검증 — runCount 가 number 인 entry 만 통과 (손상된 필드는 무시).
    const out: JobMetricsSnapshot = {};
    for (const [name, rec] of Object.entries(parsed as Record<string, unknown>)) {
      if (rec && typeof rec === 'object' && typeof (rec as JobMetricsRecord).runCount === 'number') {
        out[name] = rec as JobMetricsRecord;
      }
    }
    return out;
  } catch {
    // 손상 JSON / IO 실패 → 빈 객체 fallback (시스템 무중단 우선).
    return {};
  }
}

/**
 * Atomic write — tmp 파일에 쓴 후 rename (POSIX atomic). 부분 쓰기/중단 시
 * 이전 정상 본 보존.
 */
export function saveJobMetrics(snapshot: JobMetricsSnapshot): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = JOB_METRICS_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  fs.renameSync(tmpFile, JOB_METRICS_FILE);
  _lastFlushAt = Date.now();
}

/**
 * Throttle 래퍼 — recordScheduleRun 직후 호출되어도 디스크 부하 차단.
 * 마지막 flush 후 30s 미만이면 pending 으로 누적 후 setTimeout 으로 일괄 처리.
 */
export function scheduleSaveJobMetrics(snapshot: JobMetricsSnapshot): void {
  _pendingSnapshot = snapshot;
  const elapsed = Date.now() - _lastFlushAt;
  if (elapsed >= THROTTLE_MS) {
    flushPending();
    return;
  }
  if (_pendingTimer) return; // 이미 예약됨
  _pendingTimer = setTimeout(flushPending, THROTTLE_MS - elapsed);
}

function flushPending(): void {
  if (_pendingTimer) {
    clearTimeout(_pendingTimer);
    _pendingTimer = null;
  }
  if (!_pendingSnapshot) return;
  try {
    saveJobMetrics(_pendingSnapshot);
  } catch (e) {
    console.warn('[JobMetricsRepo] save 실패:', e instanceof Error ? e.message : String(e));
  }
  _pendingSnapshot = null;
}

/** 즉시 flush — 테스트/SIGTERM 훅 용. */
export function flushJobMetrics(): void {
  flushPending();
}

/** 테스트 전용 — 모듈 상태 리셋. */
export function __resetJobMetricsRepoForTests(): void {
  if (_pendingTimer) {
    clearTimeout(_pendingTimer);
    _pendingTimer = null;
  }
  _pendingSnapshot = null;
  _lastFlushAt = 0;
}

/** Throttle 윈도우 SSOT export — 테스트 시점 보정용. */
export const JOB_METRICS_THROTTLE_MS = THROTTLE_MS;
