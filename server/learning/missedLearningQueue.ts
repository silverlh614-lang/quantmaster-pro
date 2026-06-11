// @responsibility ADR-0173 §1 MissedLearningQueue 비즈니스 로직 SSOT — enqueue + replay + drop
/**
 * missedLearningQueue.ts (ADR-0173 §1) — Phase 1 SSOT.
 *
 * 휴일·서버 장애·배포·API 실패 시 스킵된 학습 작업을 다음 영업일에 안전하게
 * 복구하는 큐의 비즈니스 로직. 영속 SSOT 는 `server/persistence/missedLearningQueueRepo.ts`.
 *
 * 동작 원칙 (사용자 §1 명세):
 *   1. KRX 휴장일 시 학습 작업 PENDING 저장 (DROP 금지)
 *   2. 다음 영업일 안전 시간대 (장 시작 전 / 장 마감 후) replay (caller 책임)
 *   3. `idempotencyKey` 멱등성 — 동일 키 enqueue 중복 차단
 *   4. 14일 이상 STALE 자동 DROP_IF_STALE
 *   5. replay 실패 시 FAILED 영속 + 재시도 횟수 제한 (default 3)
 *   6. **실제 주문 경로와 절대 결합 금지** — 학습 복구 전용 (KIS 주문 함수 import 0건)
 *
 * Active replay queue behind ENV `MISSED_LEARNING_QUEUE_ENABLED=true`.
 *
 * 본 PR scope:
 *   - 타입 SSOT + enqueue/replay/dropStale API
 *   - replay maps jobName to real learning recovery functions via dispatcher
 *   - 호출자 0건 — `signalScanner` / `entryEngine` / `exitEngine` 본체 무수정
 */

import {
  loadMissedLearningQueue,
  saveMissedLearningQueue,
} from '../persistence/missedLearningQueueRepo.js';
import { dispatchMissedLearningReplay } from './missedLearningReplayDispatcher.js';

// ─── 타입 SSOT ────────────────────────────────────────────────────────────────

/**
 * Phase 2 cron wiring 시 8 학습 작업 매핑 대상.
 * daily_eval_fallback — 2026-06-11 EVAL_STALE 인시던트 처방 (L2 일일 평가 보충, KST 17:05 cron).
 */
export type MissedLearningJobName =
  | 'counterfactual_resolve'
  | 'ledger_resolve'
  | 'ghost_portfolio'
  | 'nightly_reflection'
  | 'daily_mini_backtest'
  | 'shadow_live_delta_report'
  | 'safety_gate_attribution'
  | 'daily_eval_fallback';

/** 작업이 스킵된 사유 — Phase 2 cron 식별 + 운영자 진단 입력. */
export type MissedLearningReason =
  | 'KRX_HOLIDAY'
  | 'SERVER_DOWN'
  | 'DEPLOYMENT'
  | 'API_FAILURE'
  | 'MARKET_DATA_MISSING'
  | 'TIMEOUT'
  | 'MANUAL_SKIP';

/** Replay 정책 — 작업별 다른 정책 가능 (호출자 결정). */
export type ReplayPolicy =
  | 'SAFE_NEXT_TRADING_DAY'  // 다음 영업일 안전 시간대 (default)
  | 'REPLAY_IMMEDIATELY'     // 즉시 재시도 (transient API failure)
  | 'DROP_IF_STALE'          // 14일+ 자동 DROP
  | 'MANUAL_REVIEW';         // 운영자 수동 검토 후 처리

export interface MissedLearningJob {
  id: string;
  jobName: MissedLearningJobName;
  reason: MissedLearningReason;
  /** 작업이 스킵된 시각 (ISO). */
  skippedAt: string;
  replayPolicy: ReplayPolicy;
  status: 'PENDING' | 'REPLAYED' | 'DROPPED' | 'FAILED';
  /** 마지막 replay 시각 (ISO) — REPLAYED/FAILED 시 채움. */
  replayedAt?: string;
  failureReason?: string;
  /** 재시도 카운트 (default 0). MAX_RETRY_COUNT 초과 시 더 이상 replay 안 함. */
  retryCount?: number;
  /** 멱등성 키 — 동일 키 enqueue 중복 차단 (예: `nightly_reflection:2026-05-01`). */
  idempotencyKey: string;
}

// ─── 상수 SSOT ────────────────────────────────────────────────────────────────

/** 사용자 §1 — replay 실패 누적 후 더 이상 시도 안 함. */
export const MAX_RETRY_COUNT = 3;
/** 사용자 §1 — 14일+ PENDING 은 자동 DROP. */
export const STALE_DAYS = 14;
/** 메모리/디스크 폭주 차단 — FIFO trim. */
export const QUEUE_TRIM_LIMIT = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── ENV 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * ENV `MISSED_LEARNING_QUEUE_ENABLED=true` 정확 비교 — `'1'` / `'TRUE'` / 기타 truthy 모두 거부.
 * default OFF — Phase 2 cron wiring 후 운영자 명시 활성화 의무.
 */
export function isMissedLearningQueueEnabled(): boolean {
  return process.env.MISSED_LEARNING_QUEUE_ENABLED === 'true';
}

// ─── ID 생성 ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function generateJobId(now: Date = new Date()): string {
  // 충돌 방지를 위한 시각 + 카운터 조합 — 동시 enqueue 시에도 고유.
  _idCounter = (_idCounter + 1) % 100000;
  return `mlq-${now.getTime()}-${_idCounter.toString().padStart(5, '0')}`;
}

// ─── enqueue ──────────────────────────────────────────────────────────────────

/**
 * 스킵된 학습 작업을 영속 큐에 등록.
 *
 * 멱등성: `idempotencyKey` 동일 + status='PENDING' 인 entry 가 이미 있으면 그대로 반환
 * (중복 enqueue 차단). 동일 키이지만 status='REPLAYED'/'DROPPED'/'FAILED' 이면 새 entry 추가.
 *
 * 진단 로그: `[MissedLearningQueue] enqueue jobName=... reason=... skippedAt=...`
 *
 * @param input id/status/retryCount 제외한 필드
 * @returns 영속된 (또는 기존) job
 */
export function enqueueMissedLearningJob(
  input: Omit<MissedLearningJob, 'id' | 'status' | 'retryCount'>,
): MissedLearningJob {
  const now = new Date();
  const jobs = loadMissedLearningQueue(now);

  // 멱등성 — idempotencyKey 동일 + PENDING 이면 기존 반환
  const existing = jobs.find(
    (j) => j.idempotencyKey === input.idempotencyKey && j.status === 'PENDING',
  );
  if (existing) {
    return existing;
  }

  const job: MissedLearningJob = {
    id: generateJobId(now),
    jobName: input.jobName,
    reason: input.reason,
    skippedAt: input.skippedAt,
    replayPolicy: input.replayPolicy,
    status: 'PENDING',
    retryCount: 0,
    idempotencyKey: input.idempotencyKey,
  };

  jobs.push(job);
  saveMissedLearningQueue(jobs);

  console.log(
    `[MissedLearningQueue] enqueue jobName=${job.jobName} reason=${job.reason} skippedAt=${job.skippedAt}`,
  );

  return job;
}

// ─── replay ───────────────────────────────────────────────────────────────────

type MissedLearningReplayDispatcher = (jobName: MissedLearningJobName) => Promise<void>;

let replayDispatcher: MissedLearningReplayDispatcher = dispatchMissedLearningReplay;

export interface ReplayMissedLearningJobsOptions {
  /** 다음 영업일 (YYYY-MM-DD KST). caller 가 trading day 검증 후 전달. */
  tradingDate: string;
  /** 한 번 replay 사이클당 최대 처리 건수. */
  maxJobsPerRun?: number;
}

export interface ReplayMissedLearningJobsResult {
  replayed: number;
  failed: number;
  dropped: number;
}

/**
 * PENDING + retryCount<MAX 인 entry 만 replay 후보.
 * - SAFE_NEXT_TRADING_DAY 는 trading day 진입 시점 caller 가 호출 의무.
 * - DROP_IF_STALE 은 14일+ 시 status='DROPPED' 로 전이.
 * - REPLAYED 시 replayedAt 시각 영속.
 * - FAILED 시 retryCount +1 + failureReason 영속 (MAX 초과 시 더 이상 replay 안 함).
 *
 * 진단 로그:
 *   - `[MissedLearningQueue] replay jobName=... status=REPLAYED`
 *   - `[MissedLearningQueue] drop jobName=... reason=STALE_OVER_14D`
 *
 * ENV OFF → `{replayed:0, failed:0, dropped:0}` 즉시 반환 (영속 변경 0건).
 */
export async function replayMissedLearningJobs(
  opts: ReplayMissedLearningJobsOptions,
): Promise<ReplayMissedLearningJobsResult> {
  if (!isMissedLearningQueueEnabled()) {
    return { replayed: 0, failed: 0, dropped: 0 };
  }

  const now = new Date();
  const jobs = loadMissedLearningQueue(now);
  const maxPerRun =
    typeof opts.maxJobsPerRun === 'number' && opts.maxJobsPerRun > 0
      ? opts.maxJobsPerRun
      : Number.POSITIVE_INFINITY;

  let replayed = 0;
  let failed = 0;
  let dropped = 0;
  let processed = 0;

  for (const job of jobs) {
    if (processed >= maxPerRun) break;

    // PENDING 또는 FAILED + 재시도 가능
    const isPending = job.status === 'PENDING';
    const isRetryEligible =
      job.status === 'FAILED' && (job.retryCount ?? 0) < MAX_RETRY_COUNT;
    if (!isPending && !isRetryEligible) continue;

    // STALE 자동 DROP — 14일+ PENDING
    const skippedMs = Date.parse(job.skippedAt);
    const ageDays =
      Number.isFinite(skippedMs) && skippedMs > 0
        ? (now.getTime() - skippedMs) / DAY_MS
        : 0;

    if (job.replayPolicy === 'DROP_IF_STALE' && ageDays > STALE_DAYS) {
      job.status = 'DROPPED';
      job.replayedAt = now.toISOString();
      dropped++;
      processed++;
      console.log(
        `[MissedLearningQueue] drop jobName=${job.jobName} reason=STALE_OVER_14D`,
      );
      continue;
    }

    // tradingDate 가 작업 KST 일자 이후 (또는 같음) — caller 가 ScheduleClass='TRADING_DAY_ONLY' 가드.
    void opts.tradingDate;

    let success = false;
    try {
      await replayDispatcher(job.jobName);
      success = true;
    } catch (e) {
      /* SDS-ignore: replay failures are persisted on the queue job failureReason diagnostic field. */
      success = false;
      job.failureReason = e instanceof Error ? e.message : String(e);
    }

    if (success) {
      job.status = 'REPLAYED';
      job.replayedAt = now.toISOString();
      replayed++;
      console.log(
        `[MissedLearningQueue] replay jobName=${job.jobName} status=REPLAYED`,
      );
    } else {
      job.status = 'FAILED';
      job.replayedAt = now.toISOString();
      job.retryCount = (job.retryCount ?? 0) + 1;
      job.failureReason = job.failureReason ?? 'replay_dispatch_failed';
      failed++;
    }
    processed++;
  }

  saveMissedLearningQueue(jobs);
  return { replayed, failed, dropped };
}

// ─── dropStaleJobs ────────────────────────────────────────────────────────────

/**
 * 14일 이상 PENDING entry 를 status='DROPPED' 로 전이.
 *
 * @returns dropped 카운트
 */
export function dropStaleJobs(now: Date = new Date()): number {
  const jobs = loadMissedLearningQueue(now);
  let dropped = 0;
  for (const job of jobs) {
    if (job.status !== 'PENDING') continue;
    const skippedMs = Date.parse(job.skippedAt);
    if (!Number.isFinite(skippedMs) || skippedMs <= 0) continue;
    const ageDays = (now.getTime() - skippedMs) / DAY_MS;
    if (ageDays > STALE_DAYS) {
      job.status = 'DROPPED';
      job.replayedAt = now.toISOString();
      dropped++;
      console.log(
        `[MissedLearningQueue] drop jobName=${job.jobName} reason=STALE_OVER_14D`,
      );
    }
  }
  if (dropped > 0) {
    saveMissedLearningQueue(jobs);
  }
  return dropped;
}

// ─── 테스트 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * 테스트 전용 — generateJobId 카운터 reset (production 호출 금지).
 */
export function __resetMissedLearningQueueCounterForTests(): void {
  _idCounter = 0;
  replayDispatcher = dispatchMissedLearningReplay;
}

export function __setMissedLearningReplayDispatcherForTests(
  dispatcher: MissedLearningReplayDispatcher,
): void {
  replayDispatcher = dispatcher;
}
