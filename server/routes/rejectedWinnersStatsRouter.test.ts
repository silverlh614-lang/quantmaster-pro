/**
 * @responsibility ADR-0180 RejectedWinners stats endpoint 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../learning/rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../learning/rejectionShadowTracker.js',
  );
  return { ...actual, summarizeRejectionShadow: vi.fn() };
});

import * as tracker from '../learning/rejectionShadowTracker.js';
import learningRouter from './learningRouter.js';

const mockedSummarize = vi.mocked(tracker.summarizeRejectionShadow);

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

describe('ADR-0180 RejectedWinners stats endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /rejection-shadow-stats', () => {
    it('빈 영속 — 모든 카운트 0 + reliable=false', () => {
      mockedSummarize.mockReturnValue({
        totalCount: 0,
        closedCount: 0,
        activeCount: 0,
        avgClosedReturnPct: 0,
        medianClosedReturnPct: 0,
        falseNegativeRate: 0,
        quartiles: { q1: 0, q2: 0, q3: 0 },
        reliable: false,
      });
      const handler = findHandler('GET', '/rejection-shadow-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { totalCount: number; closedCount: number; reliable: boolean };
      expect(body.totalCount).toBe(0);
      expect(body.closedCount).toBe(0);
      expect(body.reliable).toBe(false);
    });

    it('정상 응답 — falseNegativeRate ≥ 0.3 게이트 완화 후보', () => {
      mockedSummarize.mockReturnValue({
        totalCount: 12,
        closedCount: 8,
        activeCount: 4,
        avgClosedReturnPct: 3.5,
        medianClosedReturnPct: 2.0,
        falseNegativeRate: 0.375,
        quartiles: { q1: -1.0, q2: 2.0, q3: 7.5 },
        reliable: true,
      });
      const handler = findHandler('GET', '/rejection-shadow-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as {
        totalCount: number; closedCount: number; activeCount: number;
        falseNegativeRate: number; reliable: boolean;
        quartiles?: { q1: number; q2: number; q3: number };
      };
      expect(body.totalCount).toBe(12);
      expect(body.closedCount).toBe(8);
      expect(body.activeCount).toBe(4);
      expect(body.falseNegativeRate).toBe(0.375);
      expect(body.reliable).toBe(true);
      expect(body.quartiles).toEqual({ q1: -1.0, q2: 2.0, q3: 7.5 });
    });

    it('정상 응답 — falseNegativeRate < 0.1 게이트 정합', () => {
      mockedSummarize.mockReturnValue({
        totalCount: 20,
        closedCount: 15,
        activeCount: 5,
        avgClosedReturnPct: -0.5,
        medianClosedReturnPct: -1.0,
        falseNegativeRate: 0.0667,
        quartiles: { q1: -3.0, q2: -1.0, q3: 2.0 },
        reliable: true,
      });
      const handler = findHandler('GET', '/rejection-shadow-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { falseNegativeRate: number; reliable: boolean };
      expect(body.falseNegativeRate).toBeLessThan(0.1);
      expect(body.reliable).toBe(true);
    });

    it('throw → 500', () => {
      mockedSummarize.mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/rejection-shadow-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'rejection_shadow_stats_failed' });
    });

    it('GET 메서드만 등록 (정적 invariant — read-only 보장)', () => {
      const stack = (learningRouter as unknown as { stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }> }).stack;
      const layer = stack.find((l) => l.route?.path === '/rejection-shadow-stats');
      expect(layer).toBeDefined();
      expect(layer?.route?.methods).toEqual({ get: true });
    });
  });
});
