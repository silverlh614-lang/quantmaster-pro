/**
 * @responsibility ADR-0179 MissedLearningQueue stats endpoint 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissedLearningJob } from '../learning/missedLearningQueue.js';

vi.mock('../persistence/missedLearningQueueRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../persistence/missedLearningQueueRepo.js',
  );
  return { ...actual, loadMissedLearningQueue: vi.fn() };
});

import * as repo from '../persistence/missedLearningQueueRepo.js';
import learningRouter from './learningRouter.js';

const mockedLoad = vi.mocked(repo.loadMissedLearningQueue);

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

function makeRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

interface RouteHandler {
  (req: { query: Record<string, unknown> }, res: MockRes): void | Promise<void>;
}

function findHandler(method: string, path: string): RouteHandler {
  const stack = (learningRouter as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

function makeJob(overrides: Partial<MissedLearningJob> = {}): MissedLearningJob {
  return {
    id: 'job_1',
    jobName: 'counterfactual_resolve',
    reason: 'KRX_HOLIDAY',
    skippedAt: '2026-05-01T00:00:00.000Z',
    replayPolicy: 'SAFE_NEXT_TRADING_DAY',
    status: 'PENDING',
    idempotencyKey: 'counterfactual_resolve:2026-05-01',
    ...overrides,
  };
}

describe('ADR-0179 MissedLearningQueue stats endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /missed-learning-queue-stats', () => {
    it('빈 큐 — 모든 카운트 0', () => {
      mockedLoad.mockReturnValue([]);
      const handler = findHandler('GET', '/missed-learning-queue-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        pending: 0, replayed: 0, failed: 0, dropped: 0,
        total: 0, lastEnqueuedAt: undefined,
      });
    });

    it('4 status 모두 카운트 정확', () => {
      mockedLoad.mockReturnValue([
        makeJob({ status: 'PENDING', skippedAt: '2026-05-01T00:00:00.000Z' }),
        makeJob({ status: 'PENDING', skippedAt: '2026-05-02T00:00:00.000Z' }),
        makeJob({ status: 'REPLAYED', skippedAt: '2026-04-28T00:00:00.000Z' }),
        makeJob({ status: 'FAILED', skippedAt: '2026-04-30T00:00:00.000Z' }),
        makeJob({ status: 'DROPPED', skippedAt: '2026-04-15T00:00:00.000Z' }),
      ]);
      const handler = findHandler('GET', '/missed-learning-queue-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      const body = res.body as { pending: number; replayed: number; failed: number; dropped: number; total: number; lastEnqueuedAt: string };
      expect(body.pending).toBe(2);
      expect(body.replayed).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.dropped).toBe(1);
      expect(body.total).toBe(5);
    });

    it('lastEnqueuedAt — skippedAt 최대값', () => {
      mockedLoad.mockReturnValue([
        makeJob({ skippedAt: '2026-04-15T00:00:00.000Z' }),
        makeJob({ skippedAt: '2026-05-02T12:00:00.000Z' }),
        makeJob({ skippedAt: '2026-04-30T00:00:00.000Z' }),
      ]);
      const handler = findHandler('GET', '/missed-learning-queue-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      const body = res.body as { lastEnqueuedAt: string };
      expect(body.lastEnqueuedAt).toBe('2026-05-02T12:00:00.000Z');
    });

    it('throw → 500', () => {
      mockedLoad.mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/missed-learning-queue-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'missed_learning_queue_stats_failed' });
    });

    it('GET 메서드만 등록 (정적 invariant)', () => {
      const stack = (learningRouter as unknown as { stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }> }).stack;
      const layer = stack.find((l) => l.route?.path === '/missed-learning-queue-stats');
      expect(layer?.route?.methods).toEqual({ get: true });
    });
  });
});
