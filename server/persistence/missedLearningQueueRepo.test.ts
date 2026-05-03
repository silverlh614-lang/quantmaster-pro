/**
 * @responsibility ADR-0173 §1 missedLearningQueueRepo 회귀 — atomic write + 손상 fallback + FIFO trim
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// PERSIST_DATA_DIR 격리 — paths.ts 가 프로세스 시작 시 평가하므로 vi.resetModules 필요.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlqrepo-test-'));
process.env.PERSIST_DATA_DIR = tmpDir;

let repo: typeof import('./missedLearningQueueRepo.js');
let paths: typeof import('./paths.js');

beforeEach(async () => {
  vi.resetModules();
  repo = await import('./missedLearningQueueRepo.js');
  paths = await import('./paths.js');
  repo.__resetMissedLearningQueueForTests();
});

afterEach(() => {
  try {
    if (fs.existsSync(tmpDir)) {
      fs.readdirSync(tmpDir).forEach((f) => {
        try {
          fs.unlinkSync(path.join(tmpDir, f));
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* ignore */
  }
});

// ─── load 분기 ────────────────────────────────────────────────────────────────

describe('loadMissedLearningQueue — 영속 read', () => {
  it('파일 부재 → 빈 배열 fallback', () => {
    const result = repo.loadMissedLearningQueue();
    expect(result).toEqual([]);
  });

  it('round-trip — write 후 read 동일', () => {
    const jobs = [
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection' as const,
        reason: 'KRX_HOLIDAY' as const,
        skippedAt: '2026-05-01T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY' as const,
        status: 'PENDING' as const,
        idempotencyKey: 'nightly_reflection:2026-05-01',
        retryCount: 0,
      },
    ];
    repo.saveMissedLearningQueue(jobs);
    const loaded = repo.loadMissedLearningQueue();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('mlq-1');
    expect(loaded[0]!.jobName).toBe('nightly_reflection');
    expect(loaded[0]!.idempotencyKey).toBe('nightly_reflection:2026-05-01');
  });

  it('손상 JSON → 빈 배열 fallback', () => {
    fs.writeFileSync(paths.MISSED_LEARNING_QUEUE_FILE, '{ invalid json', 'utf-8');
    const result = repo.loadMissedLearningQueue();
    expect(result).toEqual([]);
  });

  it('null 직접 저장 → 빈 배열 fallback', () => {
    fs.writeFileSync(paths.MISSED_LEARNING_QUEUE_FILE, 'null', 'utf-8');
    const result = repo.loadMissedLearningQueue();
    expect(result).toEqual([]);
  });

  it('object 직접 저장 (non-array) → 빈 배열 fallback', () => {
    fs.writeFileSync(
      paths.MISSED_LEARNING_QUEUE_FILE,
      JSON.stringify({ not: 'array' }),
      'utf-8',
    );
    const result = repo.loadMissedLearningQueue();
    expect(result).toEqual([]);
  });

  it('잘못된 entry (id 부재) 자동 제외', () => {
    const jobs = [
      {
        // id 부재
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: '2026-05-01T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'PENDING',
        idempotencyKey: 'nightly_reflection:2026-05-01',
      },
      {
        id: 'mlq-valid',
        jobName: 'counterfactual_resolve',
        reason: 'KRX_HOLIDAY',
        skippedAt: '2026-05-01T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'PENDING',
        idempotencyKey: 'counterfactual_resolve:2026-05-01',
      },
    ];
    fs.writeFileSync(paths.MISSED_LEARNING_QUEUE_FILE, JSON.stringify(jobs), 'utf-8');
    const result = repo.loadMissedLearningQueue();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('mlq-valid');
  });
});

// ─── save 분기 ────────────────────────────────────────────────────────────────

describe('saveMissedLearningQueue — atomic write', () => {
  it('atomic write — tmp 파일 잔존 안 함', () => {
    repo.saveMissedLearningQueue([
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: '2026-05-01T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'PENDING',
        idempotencyKey: 'k1',
        retryCount: 0,
      },
    ]);
    expect(fs.existsSync(`${paths.MISSED_LEARNING_QUEUE_FILE}.tmp`)).toBe(false);
    expect(fs.existsSync(paths.MISSED_LEARNING_QUEUE_FILE)).toBe(true);
  });

  it('빈 배열 — 빈 파일 영속', () => {
    repo.saveMissedLearningQueue([]);
    const loaded = repo.loadMissedLearningQueue();
    expect(loaded).toEqual([]);
  });

  it('FIFO trim — QUEUE_TRIM_LIMIT(1000) 초과 시 후미 N개만 유지', () => {
    const jobs = Array.from({ length: 1100 }, (_, i) => ({
      id: `mlq-${i}`,
      jobName: 'nightly_reflection' as const,
      reason: 'KRX_HOLIDAY' as const,
      // skippedAt 오름차순 — i=0 이 가장 오래됨
      skippedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      replayPolicy: 'SAFE_NEXT_TRADING_DAY' as const,
      status: 'PENDING' as const,
      idempotencyKey: `k-${i}`,
      retryCount: 0,
    }));
    repo.saveMissedLearningQueue(jobs);
    const loaded = repo.loadMissedLearningQueue();
    expect(loaded).toHaveLength(1000);
    // 가장 오래된 100개 제거 → id 100~1099 만 남음
    expect(loaded[0]!.id).toBe('mlq-100');
    expect(loaded[loaded.length - 1]!.id).toBe('mlq-1099');
  });
});

// ─── __resetForTests ─────────────────────────────────────────────────────────

describe('__resetMissedLearningQueueForTests', () => {
  it('파일 + tmp 잔존 청소', () => {
    repo.saveMissedLearningQueue([
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: '2026-05-01T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'PENDING',
        idempotencyKey: 'k1',
        retryCount: 0,
      },
    ]);
    expect(fs.existsSync(paths.MISSED_LEARNING_QUEUE_FILE)).toBe(true);
    repo.__resetMissedLearningQueueForTests();
    expect(fs.existsSync(paths.MISSED_LEARNING_QUEUE_FILE)).toBe(false);
  });

  it('파일 부재 시 graceful (오류 안 남)', () => {
    expect(() => repo.__resetMissedLearningQueueForTests()).not.toThrow();
  });
});

// ─── KIS 주문 import 정적 grep 가드 (절대 규칙 #2) ───────────────────────────

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

describe('KIS 주문 함수 import 정적 grep 가드', () => {
  it('repo 본체에 KIS 주문 함수 import 0건 (주석 제외)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'missedLearningQueueRepo.ts'),
      'utf-8',
    );
    const code = stripComments(src);
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    expect(code).not.toMatch(/from ['"][^'"]*kisClient/);
  });
});
