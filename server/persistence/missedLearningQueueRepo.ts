// @responsibility ADR-0173 §1 MissedLearningQueue 영속 SSOT — atomic write 멱등 학습 작업 영속
/**
 * missedLearningQueueRepo.ts (ADR-0173 §1) — Phase 1 영속 SSOT.
 *
 * 휴일·서버 장애·배포·API 실패 시 스킵된 학습 작업을 다음 영업일에 안전하게
 * 복구하는 큐. atomic write tmp→rename + 손상 JSON 빈 배열 fallback +
 * FIFO 1000 trim.
 *
 * 절대 규칙 — KIS 주문 함수 import 절대 금지 (학습 복구 전용, LIVE 주문 경로 결합 영구 차단).
 *
 * 비즈니스 로직 (`enqueueMissedLearningJob` / `replayMissedLearningJobs` /
 * `dropStaleJobs` / `MissedLearningJob` 타입) 은 `server/learning/missedLearningQueue.ts`
 * 에 격리. 본 모듈은 read/write SSOT 만.
 */

import fs from 'fs';
import { MISSED_LEARNING_QUEUE_FILE, ensureDataDir } from './paths.js';
import type { MissedLearningJob } from '../learning/missedLearningQueue.js';

/** FIFO trim — 메모리/디스크 폭주 차단. */
export const QUEUE_TRIM_LIMIT = 1000;

/**
 * 영속 파일 로드.
 * - 부재 → 빈 배열
 * - 손상 JSON → 빈 배열 (운영 무중단)
 * - non-array → 빈 배열 (잘못된 형식 안전 차단)
 *
 * 만료 자동 청소는 `dropStaleJobs()` (비즈니스 로직) 가 명시 호출 — 본 read 는 raw.
 *
 * @param _now - 시그니처 호환을 위한 옵셔널 인자 (호출자가 dropStaleJobs 와 동일 시각 사용 시 활용)
 */
export function loadMissedLearningQueue(_now: Date = new Date()): MissedLearningJob[] {
  ensureDataDir();
  if (!fs.existsSync(MISSED_LEARNING_QUEUE_FILE)) return [];
  try {
    const raw = fs.readFileSync(MISSED_LEARNING_QUEUE_FILE, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 잘못된 entry (id 부재 / skippedAt 부재) 자동 제외
    return (parsed as unknown[]).filter((job): job is MissedLearningJob => {
      if (!job || typeof job !== 'object') return false;
      const j = job as Partial<MissedLearningJob>;
      return (
        typeof j.id === 'string' &&
        j.id.length > 0 &&
        typeof j.skippedAt === 'string' &&
        j.skippedAt.length > 0 &&
        typeof j.idempotencyKey === 'string' &&
        j.idempotencyKey.length > 0
      );
    });
  } catch {
    return [];
  }
}

/**
 * 큐 영속 저장 — atomic write tmp → rename.
 * race condition 시 이전 정상 본 보존.
 *
 * FIFO trim 1000 적용 (skippedAt 오름차순 후 후미 N개).
 */
export function saveMissedLearningQueue(jobs: MissedLearningJob[]): void {
  ensureDataDir();
  let toSave = jobs;
  if (jobs.length > QUEUE_TRIM_LIMIT) {
    const sorted = [...jobs].sort(
      (a, b) => Date.parse(a.skippedAt) - Date.parse(b.skippedAt),
    );
    toSave = sorted.slice(sorted.length - QUEUE_TRIM_LIMIT);
  }
  const tmp = `${MISSED_LEARNING_QUEUE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2), 'utf-8');
  fs.renameSync(tmp, MISSED_LEARNING_QUEUE_FILE);
}

/**
 * 테스트 전용 — 영속 파일 + tmp 잔존 파일 청소.
 * (production 코드에서 호출 금지)
 */
export function __resetMissedLearningQueueForTests(): void {
  try {
    if (fs.existsSync(MISSED_LEARNING_QUEUE_FILE)) {
      fs.unlinkSync(MISSED_LEARNING_QUEUE_FILE);
    }
    const tmp = `${MISSED_LEARNING_QUEUE_FILE}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    // ignore — 테스트 격리
  }
}
