/**
 * @responsibility ADR-0173 §1 missedLearningQueue 비즈니스 로직 회귀 — enqueue/replay/drop/ENV
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// PERSIST_DATA_DIR 격리
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlq-test-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const ENV_KEY = 'MISSED_LEARNING_QUEUE_ENABLED';

let q: typeof import('./missedLearningQueue.js');
let repo: typeof import('../persistence/missedLearningQueueRepo.js');

beforeEach(async () => {
  delete process.env[ENV_KEY];
  vi.resetModules();
  q = await import('./missedLearningQueue.js');
  repo = await import('../persistence/missedLearningQueueRepo.js');
  repo.__resetMissedLearningQueueForTests();
  q.__resetMissedLearningQueueCounterForTests();
  q.__setMissedLearningReplayDispatcherForTests(async () => {});
});

afterEach(() => {
  delete process.env[ENV_KEY];
  try {
    fs.readdirSync(tmpDir).forEach((f) => {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
});

// ─── enqueueMissedLearningJob ────────────────────────────────────────────────

describe('enqueueMissedLearningJob', () => {
  it('정상 enqueue — status=PENDING, retryCount=0', () => {
    const job = q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'nightly_reflection:2026-05-01',
    });
    expect(job.status).toBe('PENDING');
    expect(job.retryCount).toBe(0);
    expect(job.id).toMatch(/^mlq-/);
    expect(job.jobName).toBe('nightly_reflection');
    expect(job.reason).toBe('KRX_HOLIDAY');
  });

  it('idempotencyKey 중복 — 동일 키 + PENDING 시 기존 entry 그대로 반환', () => {
    const first = q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'nightly_reflection:2026-05-01',
    });
    const second = q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'nightly_reflection:2026-05-01',
    });
    expect(second.id).toBe(first.id); // 동일 entry
    expect(repo.loadMissedLearningQueue()).toHaveLength(1);
  });

  it('status 기본 PENDING 영속', () => {
    q.enqueueMissedLearningJob({
      jobName: 'counterfactual_resolve',
      reason: 'SERVER_DOWN',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'REPLAY_IMMEDIATELY',
      idempotencyKey: 'k1',
    });
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('PENDING');
  });

  it('retryCount 기본 0', () => {
    q.enqueueMissedLearningJob({
      jobName: 'ledger_resolve',
      reason: 'API_FAILURE',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'k1',
    });
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.retryCount).toBe(0);
  });

  it('7 jobName 모두 enqueue 가능', () => {
    const jobNames = [
      'counterfactual_resolve',
      'ledger_resolve',
      'ghost_portfolio',
      'nightly_reflection',
      'daily_mini_backtest',
      'shadow_live_delta_report',
      'safety_gate_attribution',
    ] as const;
    for (const name of jobNames) {
      q.enqueueMissedLearningJob({
        jobName: name,
        reason: 'KRX_HOLIDAY',
        skippedAt: '2026-05-01T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        idempotencyKey: `${name}:2026-05-01`,
      });
    }
    const all = repo.loadMissedLearningQueue();
    expect(all).toHaveLength(7);
    const persisted = all.map((j) => j.jobName).sort();
    expect(persisted).toEqual([...jobNames].sort());
  });

  it('동일 idempotencyKey 이지만 status=REPLAYED → 새 entry 추가', () => {
    const first = q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'k1',
    });
    // status REPLAYED 로 영속 변경 (drop 시뮬)
    const all = repo.loadMissedLearningQueue();
    all[0]!.status = 'REPLAYED';
    repo.saveMissedLearningQueue(all);

    const second = q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-08T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'k1', // 동일 키
    });
    expect(second.id).not.toBe(first.id);
    expect(repo.loadMissedLearningQueue()).toHaveLength(2);
  });
});

// ─── replayMissedLearningJobs ────────────────────────────────────────────────

describe('replayMissedLearningJobs', () => {
  it('ENV OFF → {replayed:0, failed:0, dropped:0} 즉시 반환', async () => {
    delete process.env[ENV_KEY];
    q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'k1',
    });
    const result = await q.replayMissedLearningJobs({ tradingDate: '2026-05-04' });
    expect(result).toEqual({ replayed: 0, failed: 0, dropped: 0 });
    // 영속 변경 0건
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('PENDING');
  });

  it('PENDING → REPLAYED 전이 (injected dispatcher 성공)', async () => {
    process.env[ENV_KEY] = 'true';
    q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: '2026-05-01T19:00:00.000Z',
      replayPolicy: 'SAFE_NEXT_TRADING_DAY',
      idempotencyKey: 'k1',
    });
    const result = await q.replayMissedLearningJobs({ tradingDate: '2026-05-04' });
    expect(result.replayed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.dropped).toBe(0);
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('REPLAYED');
    expect(all[0]!.replayedAt).toBeDefined();
  });

  it('DROP_IF_STALE + 14일 초과 → status=DROPPED', async () => {
    process.env[ENV_KEY] = 'true';
    // 15일 전 PENDING (DROP_IF_STALE)
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    q.enqueueMissedLearningJob({
      jobName: 'nightly_reflection',
      reason: 'KRX_HOLIDAY',
      skippedAt: fifteenDaysAgo,
      replayPolicy: 'DROP_IF_STALE',
      idempotencyKey: 'k1',
    });
    const result = await q.replayMissedLearningJobs({ tradingDate: '2026-05-16' });
    expect(result.dropped).toBe(1);
    expect(result.replayed).toBe(0);
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('DROPPED');
  });

  it('FAILED + retryCount<MAX → 재시도 가능', async () => {
    process.env[ENV_KEY] = 'true';
    // 직접 FAILED 영속 (retryCount=1)
    repo.saveMissedLearningQueue([
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: new Date().toISOString(),
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'FAILED',
        idempotencyKey: 'k1',
        retryCount: 1, // < MAX_RETRY_COUNT(3)
      },
    ]);
    const result = await q.replayMissedLearningJobs({ tradingDate: '2026-05-04' });
    expect(result.replayed).toBe(1);
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('REPLAYED');
  });

  it('FAILED + retryCount>=MAX → 더 이상 시도 안 함', async () => {
    process.env[ENV_KEY] = 'true';
    repo.saveMissedLearningQueue([
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: new Date().toISOString(),
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'FAILED',
        idempotencyKey: 'k1',
        retryCount: q.MAX_RETRY_COUNT, // 한계 도달
      },
    ]);
    const result = await q.replayMissedLearningJobs({ tradingDate: '2026-05-04' });
    expect(result.replayed).toBe(0);
    expect(result.failed).toBe(0); // 진입 자체 안 함
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('FAILED');
    expect(all[0]!.retryCount).toBe(q.MAX_RETRY_COUNT);
  });

  it('단일 job 실패 격리 — dispatcher 가 한 jobName 만 throw 시 해당 job 만 FAILED, 나머지 REPLAYED (전체 replay 무중단)', async () => {
    process.env[ENV_KEY] = 'true';
    q.__setMissedLearningReplayDispatcherForTests(async (jobName) => {
      if (jobName === 'ghost_portfolio') throw new Error('ghost replay boom');
    });
    const names = ['nightly_reflection', 'ghost_portfolio', 'daily_mini_backtest'] as const;
    for (const name of names) {
      q.enqueueMissedLearningJob({
        jobName: name,
        reason: 'KRX_HOLIDAY',
        skippedAt: '2026-06-09T19:00:00.000Z',
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        idempotencyKey: `${name}:2026-06-09`,
      });
    }
    const result = await q.replayMissedLearningJobs({ tradingDate: '2026-06-10' });
    expect(result.replayed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.dropped).toBe(0);
    const all = repo.loadMissedLearningQueue();
    const byName = new Map(all.map((j) => [j.jobName, j]));
    expect(byName.get('nightly_reflection')!.status).toBe('REPLAYED');
    expect(byName.get('daily_mini_backtest')!.status).toBe('REPLAYED');
    const failedJob = byName.get('ghost_portfolio')!;
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.retryCount).toBe(1);
    expect(failedJob.failureReason).toBe('ghost replay boom');
  });

  it('maxJobsPerRun 절삭 — 5 enqueue, maxPerRun=2', async () => {
    process.env[ENV_KEY] = 'true';
    for (let i = 0; i < 5; i++) {
      q.enqueueMissedLearningJob({
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: new Date(Date.now() - i * 60_000).toISOString(),
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        idempotencyKey: `k-${i}`,
      });
    }
    const result = await q.replayMissedLearningJobs({
      tradingDate: '2026-05-04',
      maxJobsPerRun: 2,
    });
    expect(result.replayed).toBe(2);
    const all = repo.loadMissedLearningQueue();
    expect(all.filter((j) => j.status === 'REPLAYED')).toHaveLength(2);
    expect(all.filter((j) => j.status === 'PENDING')).toHaveLength(3);
  });
});

// ─── dropStaleJobs ────────────────────────────────────────────────────────────

describe('dropStaleJobs', () => {
  it('14일+ PENDING → status=DROPPED', () => {
    const sixteenDaysAgo = new Date(
      Date.now() - 16 * 24 * 60 * 60 * 1000,
    ).toISOString();
    repo.saveMissedLearningQueue([
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: sixteenDaysAgo,
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'PENDING',
        idempotencyKey: 'k1',
        retryCount: 0,
      },
    ]);
    const dropped = q.dropStaleJobs();
    expect(dropped).toBe(1);
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('DROPPED');
  });

  it('13일 PENDING → 보존 (드랍 안 함)', () => {
    const thirteenDaysAgo = new Date(
      Date.now() - 13 * 24 * 60 * 60 * 1000,
    ).toISOString();
    repo.saveMissedLearningQueue([
      {
        id: 'mlq-1',
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: thirteenDaysAgo,
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        status: 'PENDING',
        idempotencyKey: 'k1',
        retryCount: 0,
      },
    ]);
    const dropped = q.dropStaleJobs();
    expect(dropped).toBe(0);
    const all = repo.loadMissedLearningQueue();
    expect(all[0]!.status).toBe('PENDING');
  });

  it('빈 큐 → 0 반환', () => {
    const dropped = q.dropStaleJobs();
    expect(dropped).toBe(0);
  });
});

// ─── isMissedLearningQueueEnabled — ENV 분기 ─────────────────────────────────

describe('isMissedLearningQueueEnabled', () => {
  it('ENV 미설정 → false (default OFF)', () => {
    delete process.env[ENV_KEY];
    expect(q.isMissedLearningQueueEnabled()).toBe(false);
  });

  it("ENV='true' → true", () => {
    process.env[ENV_KEY] = 'true';
    expect(q.isMissedLearningQueueEnabled()).toBe(true);
  });

  it("ENV='false' → false", () => {
    process.env[ENV_KEY] = 'false';
    expect(q.isMissedLearningQueueEnabled()).toBe(false);
  });

  it("ENV='1' / 'TRUE' / 임의 truthy → false (정확 비교)", () => {
    process.env[ENV_KEY] = '1';
    expect(q.isMissedLearningQueueEnabled()).toBe(false);
    process.env[ENV_KEY] = 'TRUE';
    expect(q.isMissedLearningQueueEnabled()).toBe(false);
    process.env[ENV_KEY] = 'yes';
    expect(q.isMissedLearningQueueEnabled()).toBe(false);
  });
});

// ─── 7 reason union 분기 ─────────────────────────────────────────────────────

describe('7 MissedLearningReason 분기', () => {
  it('7 reason 모두 enqueue 가능', () => {
    const reasons = [
      'KRX_HOLIDAY',
      'SERVER_DOWN',
      'DEPLOYMENT',
      'API_FAILURE',
      'MARKET_DATA_MISSING',
      'TIMEOUT',
      'MANUAL_SKIP',
    ] as const;
    for (let i = 0; i < reasons.length; i++) {
      q.enqueueMissedLearningJob({
        jobName: 'nightly_reflection',
        reason: reasons[i]!,
        skippedAt: new Date(Date.now() - i * 1000).toISOString(),
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        idempotencyKey: `r-${i}`,
      });
    }
    const all = repo.loadMissedLearningQueue();
    expect(all).toHaveLength(7);
    const persisted = all.map((j) => j.reason).sort();
    expect(persisted).toEqual([...reasons].sort());
  });
});

// ─── 4 replayPolicy union 분기 ───────────────────────────────────────────────

describe('4 ReplayPolicy 분기', () => {
  it('4 replayPolicy 모두 enqueue 가능', () => {
    const policies = [
      'SAFE_NEXT_TRADING_DAY',
      'REPLAY_IMMEDIATELY',
      'DROP_IF_STALE',
      'MANUAL_REVIEW',
    ] as const;
    for (let i = 0; i < policies.length; i++) {
      q.enqueueMissedLearningJob({
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: new Date(Date.now() - i * 1000).toISOString(),
        replayPolicy: policies[i]!,
        idempotencyKey: `p-${i}`,
      });
    }
    const all = repo.loadMissedLearningQueue();
    expect(all).toHaveLength(4);
    const persisted = all.map((j) => j.replayPolicy).sort();
    expect(persisted).toEqual([...policies].sort());
  });
});

// ─── 진단 로그 정합 ──────────────────────────────────────────────────────────

describe('진단 로그 정합 (사용자 명세)', () => {
  it('enqueue/replay/drop 로그 prefix [MissedLearningQueue]', async () => {
    process.env[ENV_KEY] = 'true';
    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg: unknown) => {
      logs.push(String(msg));
    };
    try {
      // enqueue 로그
      q.enqueueMissedLearningJob({
        jobName: 'nightly_reflection',
        reason: 'KRX_HOLIDAY',
        skippedAt: new Date().toISOString(),
        replayPolicy: 'SAFE_NEXT_TRADING_DAY',
        idempotencyKey: 'k1',
      });
      // replay 로그
      await q.replayMissedLearningJobs({ tradingDate: '2026-05-04' });
      // drop 로그 — 별도 stale entry 추가 후 dropStaleJobs
      const stale = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
      repo.saveMissedLearningQueue([
        ...repo.loadMissedLearningQueue(),
        {
          id: 'mlq-stale',
          jobName: 'ledger_resolve',
          reason: 'KRX_HOLIDAY',
          skippedAt: stale,
          replayPolicy: 'SAFE_NEXT_TRADING_DAY',
          status: 'PENDING',
          idempotencyKey: 'k-stale',
          retryCount: 0,
        },
      ]);
      q.dropStaleJobs();
    } finally {
      console.log = orig;
    }
    expect(logs.some((l) => /\[MissedLearningQueue\] enqueue jobName=/.test(l))).toBe(true);
    expect(logs.some((l) => /\[MissedLearningQueue\] replay jobName=.* status=REPLAYED/.test(l))).toBe(true);
    expect(logs.some((l) => /\[MissedLearningQueue\] drop jobName=.* reason=STALE_OVER_14D/.test(l))).toBe(true);
  });
});

// ─── KIS 주문 import 정적 grep 가드 (절대 규칙) ──────────────────────────────

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

describe('KIS 주문 함수 import 정적 grep 가드', () => {
  it('missedLearningQueue.ts 본체에 KIS 주문 함수 import 0건 (주석 제외)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, 'missedLearningQueue.ts'),
      'utf-8',
    );
    const code = stripComments(src);
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    expect(code).not.toMatch(/from ['"][^'"]*kisClient/);
    expect(code).not.toMatch(/from ['"][^'"]*tranchesRouter/);
    // runAutoSignalScan 직접 호출도 금지 — 무한 루프 차단
    expect(code).not.toMatch(/runAutoSignalScan/);
  });
});
