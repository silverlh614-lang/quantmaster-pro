/**
 * @responsibility ADR-0128 verificationQueueRepo 회귀 테스트 — 누적 카운트 + manualReview 격상 + 영속 정합
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// PERSIST_DATA_DIR 격리 — paths.ts 가 프로세스 시작 시 평가하므로 vi.resetModules 필요.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verqueue-test-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const ENV_KEY = 'VERIFICATION_QUEUE_DISABLED';

let repo: typeof import('./verificationQueueRepo.js');

beforeEach(async () => {
  delete process.env[ENV_KEY];
  // 모듈 재로드 — paths.ts 의 DATA_DIR 가 테스트 디렉토리로 평가되도록.
  const { vi } = await import('vitest');
  vi.resetModules();
  repo = await import('./verificationQueueRepo.js');
  repo.__resetVerificationQueueForTests();
});

afterEach(() => {
  delete process.env[ENV_KEY];
  try {
    if (fs.existsSync(tmpDir)) {
      fs.readdirSync(tmpDir).forEach((f) => {
        try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
      });
    }
  } catch { /* ignore */ }
});

describe('verificationQueueRepo — recordVerificationFailure 누적', () => {
  it('첫 실패 → 신규 entry, consecutive=1, manualReview=NONE', () => {
    const now = new Date('2026-04-30T16:30:00Z');
    const entry = repo.recordVerificationFailure('005930', 'STALE_BASE', now, '삼성전자');
    expect(entry.consecutiveFailures).toBe(1);
    expect(entry.manualReviewState).toBe('NONE');
    expect(entry.firstFailedAt).toBe(now.toISOString());
    expect(entry.lastFailedAt).toBe(now.toISOString());
    expect(entry.stockName).toBe('삼성전자');
    expect(entry.lastFailureReason).toBe('STALE_BASE');

    const all = repo.loadVerificationQueue();
    expect(all).toHaveLength(1);
  });

  it('2회 실패 → consecutive=2, manualReview=NONE, firstFailedAt 보존', () => {
    const t1 = new Date('2026-04-29T16:30:00Z');
    const t2 = new Date('2026-04-30T16:30:00Z');
    repo.recordVerificationFailure('005930', 'STALE_BASE', t1);
    const entry = repo.recordVerificationFailure('005930', 'INVALID_PRICE', t2);
    expect(entry.consecutiveFailures).toBe(2);
    expect(entry.manualReviewState).toBe('NONE');
    expect(entry.firstFailedAt).toBe(t1.toISOString()); // 보존
    expect(entry.lastFailedAt).toBe(t2.toISOString());
    expect(entry.lastFailureReason).toBe('INVALID_PRICE');
  });

  it('3회+ 실패 → manualReview=QUEUED 격상 (사용자 정책 #6)', () => {
    const base = new Date('2026-04-28T00:00:00Z');
    repo.recordVerificationFailure('005930', 'r1', new Date(base.getTime()));
    repo.recordVerificationFailure('005930', 'r2', new Date(base.getTime() + 86400000));
    const entry = repo.recordVerificationFailure('005930', 'r3', new Date(base.getTime() + 172800000));
    expect(entry.consecutiveFailures).toBe(3);
    expect(entry.manualReviewState).toBe('QUEUED'); // 격상
  });

  it('nextRetryAt = lastFailedAt + 24h', () => {
    const now = new Date('2026-04-30T16:30:00Z');
    const entry = repo.recordVerificationFailure('005930', 'STALE_BASE', now);
    const expectedMs = now.getTime() + 24 * 60 * 60 * 1000;
    expect(new Date(entry.nextRetryAt).getTime()).toBe(expectedMs);
  });
});

describe('verificationQueueRepo — recordVerificationSuccess', () => {
  it('성공 시 entry 제거 + true 반환', () => {
    const now = new Date('2026-04-30T16:30:00Z');
    repo.recordVerificationFailure('005930', 'r', now);
    expect(repo.loadVerificationQueue()).toHaveLength(1);

    const removed = repo.recordVerificationSuccess('005930');
    expect(removed).toBe(true);
    expect(repo.loadVerificationQueue()).toHaveLength(0);
  });

  it('entry 없을 때 false 반환 + no-op', () => {
    const removed = repo.recordVerificationSuccess('999999');
    expect(removed).toBe(false);
    expect(repo.loadVerificationQueue()).toHaveLength(0);
  });
});

describe('verificationQueueRepo — getEntriesEligibleForRetry 필터', () => {
  it('QUEUED / DROPPED 제외, nextRetryAt ≤ now 만 반환', () => {
    const t = new Date('2026-04-30T16:30:00Z');
    // 2회 실패 (NONE 상태) — nextRetryAt = t + 24h
    repo.recordVerificationFailure('A00001', 'r', new Date(t.getTime() - 86400000)); // 24h 전
    // QUEUED 상태로 격상 (3회)
    repo.recordVerificationFailure('B00002', 'r', new Date(t.getTime() - 172800000));
    repo.recordVerificationFailure('B00002', 'r', new Date(t.getTime() - 86400000));
    repo.recordVerificationFailure('B00002', 'r', new Date(t.getTime() - 3600000));

    // A00001 의 nextRetryAt = t - 86400000 + 24h = 정확히 t → 통과 (≤ now)
    // B00002 는 QUEUED → 제외
    const eligible = repo.getEntriesEligibleForRetry(t);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.stockCode).toBe('A00001');
  });
});

describe('verificationQueueRepo — getManualReviewQueue', () => {
  it('manualReviewState=QUEUED entry 만 반환', () => {
    const t = new Date('2026-04-30T16:30:00Z');
    // 2회 (NONE)
    repo.recordVerificationFailure('A00001', 'r', t);
    repo.recordVerificationFailure('A00001', 'r', t);
    // 3회 (QUEUED)
    repo.recordVerificationFailure('B00002', 'r', t);
    repo.recordVerificationFailure('B00002', 'r', t);
    repo.recordVerificationFailure('B00002', 'r', t);

    const queue = repo.getManualReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.stockCode).toBe('B00002');
  });
});

describe('verificationQueueRepo — setManualReviewState', () => {
  it('APPROVED 로 갱신 → reviewedAt + reviewedBy 영속, true 반환', () => {
    const t = new Date('2026-04-30T16:30:00Z');
    // 3회 → QUEUED
    for (let i = 0; i < 3; i++) repo.recordVerificationFailure('005930', 'r', t);

    const ok = repo.setManualReviewState('005930', 'APPROVED', t, 'operator');
    expect(ok).toBe(true);

    const list = repo.loadVerificationQueue();
    expect(list[0]!.manualReviewState).toBe('APPROVED');
    expect(list[0]!.manualReviewedAt).toBe(t.toISOString());
    expect(list[0]!.manualReviewedBy).toBe('operator');
  });

  it('entry 없을 때 false 반환', () => {
    expect(repo.setManualReviewState('999999', 'APPROVED')).toBe(false);
  });
});

describe('verificationQueueRepo — 영속 정합', () => {
  it('손상 JSON → 빈 배열 fallback (운영 무중단)', async () => {
    const { VERIFICATION_QUEUE_FILE } = await import('./paths.js');
    fs.writeFileSync(VERIFICATION_QUEUE_FILE, '{ this is not valid');
    const list = repo.loadVerificationQueue();
    expect(list).toEqual([]);
  });

  it('FIFO trim 500 — 초과 시 lastFailedAt 오래된 것부터 제거', async () => {
    const baseMs = new Date('2026-01-01T00:00:00Z').getTime();
    // 501개 직접 영속
    const { VERIFICATION_QUEUE_FILE } = await import('./paths.js');
    const entries: import('./verificationQueueRepo.js').VerificationQueueEntry[] = [];
    for (let i = 0; i < 501; i++) {
      entries.push({
        stockCode: String(i).padStart(6, '0'),
        consecutiveFailures: 1,
        firstFailedAt: new Date(baseMs + i * 1000).toISOString(),
        lastFailedAt: new Date(baseMs + i * 1000).toISOString(),
        lastFailureReason: 'r',
        nextRetryAt: new Date(baseMs + i * 1000 + 86400000).toISOString(),
        manualReviewState: 'NONE',
      });
    }
    fs.writeFileSync(VERIFICATION_QUEUE_FILE, JSON.stringify(entries));

    // 새 entry 1개 더 추가 → trim 발동
    repo.recordVerificationFailure('999999', 'r', new Date(baseMs + 600 * 1000));

    const list = repo.loadVerificationQueue();
    expect(list.length).toBeLessThanOrEqual(500);
    // 가장 오래된 것 (000000) 이 제거됐는지 확인
    expect(list.find((e) => e.stockCode === '000000')).toBeUndefined();
    // 신규 추가 entry 는 보존
    expect(list.find((e) => e.stockCode === '999999')).toBeDefined();
  });
});

describe('verificationQueueRepo — ENV 우회', () => {
  it('VERIFICATION_QUEUE_DISABLED=true — record* no-op, 임시 entry 반환', () => {
    process.env[ENV_KEY] = 'true';
    const entry = repo.recordVerificationFailure('005930', 'r', new Date());
    expect(entry.lastFailureReason).toContain('ENV disabled');
    // 영속 안 됨
    expect(repo.loadVerificationQueue()).toHaveLength(0);

    // recordSuccess 도 no-op (false)
    expect(repo.recordVerificationSuccess('005930')).toBe(false);
    // setManualReviewState 도 no-op
    expect(repo.setManualReviewState('005930', 'APPROVED')).toBe(false);
  });
});
