// @responsibility ADR-0128 데이터 검증 실패 큐 영속 SSOT — 3회+ 누적 시 manual review 격상
/**
 * verificationQueueRepo.ts (ADR-0128) — 검증 실패 누적 영속 SSOT.
 *
 * batch (정책 #2 16:30 KST) + incremental (정책 #3 진입 시점) 검증의 *실패 누적*
 * 영속 store. 종목별 consecutiveFailures 카운트 + nextRetryAt cooldown + 3회+ 시
 * manualReviewState='QUEUED' 격상 → 운영자 텔레그램 검토 의무.
 *
 * 영속 정책:
 *   - atomic write tmp → rename (race 시 이전 정상 본 보존)
 *   - 손상 JSON → 빈 배열 fallback
 *   - FIFO trim 500 — 메모리 폭주 차단
 *   - paths.ts VERIFICATION_QUEUE_FILE
 *
 * ENV 우회 `VERIFICATION_QUEUE_DISABLED=true` → record* no-op (queue 무력화).
 */

import fs from 'fs';
import path from 'path';
import { VERIFICATION_QUEUE_FILE, ensureDataDir } from './paths.js';

/** 사용자 정책 #6 — 3회+ 누적 시 manual review queue 격상. */
export const MAX_CONSECUTIVE_FAILURES = 3;
/** 1·2회 실패 후 24h 대기. 3회+ 는 manualReviewState='QUEUED' 로 retry 차단. */
export const RETRY_BACKOFF_HOURS = 24;
/** 메모리/디스크 폭주 차단 — FIFO trim. */
export const QUEUE_TRIM_LIMIT = 500;

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * 수동 검토 상태:
 *   - NONE       — 신규 entry / 자동 재시도 가능
 *   - QUEUED     — 3회+ 실패 누적 → 운영자 검토 대기
 *   - APPROVED   — 운영자 수동 승인 (격리 해제)
 *   - DROPPED    — 운영자 수동 폐기 (universe 제외)
 */
export type ManualReviewState = 'NONE' | 'QUEUED' | 'APPROVED' | 'DROPPED';

export interface VerificationQueueEntry {
  stockCode: string;
  stockName?: string;
  /** 누적 실패 횟수. recordVerificationSuccess 호출 시 entry 제거 (reset). */
  consecutiveFailures: number;
  /** 첫 실패 ISO. 갱신 시 보존 (lastFailedAt 만 갱신). */
  firstFailedAt: string;
  /** 가장 최근 실패 ISO. */
  lastFailedAt: string;
  /** safePctChangeStrict status 등 마지막 실패 사유. */
  lastFailureReason: string;
  /** 다음 재시도 가능 시각 ISO. 1·2회: +24h, 3회+ 는 의미 없음 (manualReview QUEUED). */
  nextRetryAt: string;
  manualReviewState: ManualReviewState;
  manualReviewedAt?: string;
  manualReviewedBy?: string;
}

function isQueueDisabled(): boolean {
  return process.env.VERIFICATION_QUEUE_DISABLED === 'true';
}

/**
 * 영속 파일 로드 — 손상 JSON / 파일 부재 시 빈 배열 fallback.
 */
export function loadVerificationQueue(): VerificationQueueEntry[] {
  ensureDataDir();
  if (!fs.existsSync(VERIFICATION_QUEUE_FILE)) return [];
  try {
    const raw = fs.readFileSync(VERIFICATION_QUEUE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as VerificationQueueEntry[];
  } catch {
    // 손상 JSON → 빈 배열 (운영 무중단)
    return [];
  }
}

/** atomic write — tmp 파일에 쓰고 rename (race 시 이전 본 보존). */
function saveVerificationQueue(entries: VerificationQueueEntry[]): void {
  ensureDataDir();
  // FIFO trim — lastFailedAt 오름차순 정렬 후 후미 N개만 유지.
  let toSave = entries;
  if (entries.length > QUEUE_TRIM_LIMIT) {
    const sorted = [...entries].sort((a, b) =>
      new Date(a.lastFailedAt).getTime() - new Date(b.lastFailedAt).getTime(),
    );
    toSave = sorted.slice(sorted.length - QUEUE_TRIM_LIMIT);
  }
  const tmp = `${VERIFICATION_QUEUE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2));
  fs.renameSync(tmp, VERIFICATION_QUEUE_FILE);
}

/**
 * nextRetryAt 산출 — 1·2회 실패는 +24h, 3회+ 는 의미 없음 (manualReview QUEUED 진입).
 */
function computeNextRetryAt(consecutiveFailures: number, now: Date): string {
  // 3회+ 는 manualReview='QUEUED' 로 retry 차단되므로 +24h 도 부여 (수동 APPROVE 시
  // 즉시 재시도 가능하도록 명시적 시각만 기록).
  return new Date(now.getTime() + RETRY_BACKOFF_HOURS * ONE_HOUR_MS).toISOString();
}

/**
 * 검증 실패 기록.
 *   - 첫 실패 → 신규 entry (consecutive=1, manualReview='NONE')
 *   - 2회 실패 → consecutive=2 (manualReview='NONE')
 *   - 3회+ 실패 → manualReview='QUEUED' 격상 (운영자 검토 대기)
 *
 * ENV `VERIFICATION_QUEUE_DISABLED=true` → no-op + 임시 entry 반환.
 */
export function recordVerificationFailure(
  stockCode: string,
  reason: string,
  now: Date = new Date(),
  stockName?: string,
): VerificationQueueEntry {
  const nowIso = now.toISOString();

  if (isQueueDisabled()) {
    // ENV 우회 — 영속 안 함, 호출자가 결과 사용 안 하도록 임시 entry 반환.
    return {
      stockCode,
      stockName,
      consecutiveFailures: 1,
      firstFailedAt: nowIso,
      lastFailedAt: nowIso,
      lastFailureReason: `${reason} (ENV disabled)`,
      nextRetryAt: nowIso,
      manualReviewState: 'NONE',
    };
  }

  const entries = loadVerificationQueue();
  const idx = entries.findIndex((e) => e.stockCode === stockCode);
  let entry: VerificationQueueEntry;

  if (idx >= 0) {
    const prev = entries[idx]!;
    const newCount = (prev.consecutiveFailures || 0) + 1;
    entry = {
      ...prev,
      stockName: stockName ?? prev.stockName,
      consecutiveFailures: newCount,
      lastFailedAt: nowIso,
      lastFailureReason: reason,
      nextRetryAt: computeNextRetryAt(newCount, now),
      manualReviewState:
        newCount >= MAX_CONSECUTIVE_FAILURES && prev.manualReviewState === 'NONE'
          ? 'QUEUED'
          : prev.manualReviewState,
    };
    entries[idx] = entry;
  } else {
    entry = {
      stockCode,
      stockName,
      consecutiveFailures: 1,
      firstFailedAt: nowIso,
      lastFailedAt: nowIso,
      lastFailureReason: reason,
      nextRetryAt: computeNextRetryAt(1, now),
      manualReviewState: 'NONE',
    };
    entries.push(entry);
  }

  saveVerificationQueue(entries);
  return entry;
}

/**
 * 검증 성공 기록 → entry 제거 (consecutive reset).
 * @returns true = 제거됨 (이전에 entry 존재), false = no-op (entry 없었음)
 */
export function recordVerificationSuccess(stockCode: string, _now: Date = new Date()): boolean {
  if (isQueueDisabled()) return false;
  const entries = loadVerificationQueue();
  const idx = entries.findIndex((e) => e.stockCode === stockCode);
  if (idx < 0) return false;
  entries.splice(idx, 1);
  saveVerificationQueue(entries);
  return true;
}

/**
 * 재시도 대상 entry — `nextRetryAt ≤ now` AND `manualReviewState ∉ {QUEUED, DROPPED}`.
 * APPROVED 는 즉시 재시도 가능 (운영자가 승인 후 다음 사이클 verify).
 */
export function getEntriesEligibleForRetry(now: Date = new Date()): VerificationQueueEntry[] {
  const entries = loadVerificationQueue();
  const nowMs = now.getTime();
  return entries.filter((e) => {
    if (e.manualReviewState === 'QUEUED' || e.manualReviewState === 'DROPPED') return false;
    const nextMs = new Date(e.nextRetryAt).getTime();
    return Number.isFinite(nextMs) && nextMs <= nowMs;
  });
}

/** 운영자 검토 대기 entry — 텔레그램 `/data_verification_review` 표시. */
export function getManualReviewQueue(): VerificationQueueEntry[] {
  return loadVerificationQueue().filter((e) => e.manualReviewState === 'QUEUED');
}

/**
 * 운영자 수동 검토 결정 영속.
 *   - APPROVED → 격리 해제 (다음 사이클 즉시 재검증)
 *   - DROPPED  → universe 제외 (재시도 영구 차단)
 *
 * @returns true = 갱신됨, false = entry 없음
 */
export function setManualReviewState(
  stockCode: string,
  state: ManualReviewState,
  now: Date = new Date(),
  reviewedBy?: string,
): boolean {
  if (isQueueDisabled()) return false;
  const entries = loadVerificationQueue();
  const idx = entries.findIndex((e) => e.stockCode === stockCode);
  if (idx < 0) return false;

  const prev = entries[idx]!;
  entries[idx] = {
    ...prev,
    manualReviewState: state,
    manualReviewedAt: now.toISOString(),
    manualReviewedBy: reviewedBy,
  };
  saveVerificationQueue(entries);
  return true;
}

/** 테스트 전용 — 영속 파일 + 메모리 상태 초기화. */
export function __resetVerificationQueueForTests(): void {
  try {
    if (fs.existsSync(VERIFICATION_QUEUE_FILE)) {
      fs.unlinkSync(VERIFICATION_QUEUE_FILE);
    }
    const tmp = `${VERIFICATION_QUEUE_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // 무시 — 테스트 격리
  }
}

// path import 방어 — 본 파일에서 직접 path 사용은 없지만 paths.ts 변경 시 안전.
void path;
