/**
 * @responsibility ADR-0182 Counterfactual Unresolved stats endpoint 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../learning/counterfactualShadow.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../learning/counterfactualShadow.js',
  );
  return { ...actual, summarizeUnresolvedCounterfactuals: vi.fn() };
});

import * as cfShadow from '../learning/counterfactualShadow.js';
import learningRouter from './learningRouter.js';

const mockedSummarize = vi.mocked(cfShadow.summarizeUnresolvedCounterfactuals);

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

describe('ADR-0182 Counterfactual Unresolved stats endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /counterfactual-unresolved-stats', () => {
    it('빈 영속 — 모든 카운트 0', () => {
      mockedSummarize.mockReturnValue({
        totalCount: 0,
        resolved30dCount: 0,
        resolved60dCount: 0,
        resolved90dCount: 0,
        pending30dCount: 0,
        pending60dCount: 0,
        pending90dCount: 0,
        awaitingHorizonCount: 0,
        oldestSignalDate: undefined,
      });
      const handler = findHandler('GET', '/counterfactual-unresolved-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { totalCount: number; awaitingHorizonCount: number };
      expect(body.totalCount).toBe(0);
      expect(body.awaitingHorizonCount).toBe(0);
    });

    it('정상 응답 — pending30dCount ≥ 5 (cron 미실행 의심)', () => {
      mockedSummarize.mockReturnValue({
        totalCount: 12,
        resolved30dCount: 2,
        resolved60dCount: 0,
        resolved90dCount: 0,
        pending30dCount: 7,
        pending60dCount: 5,
        pending90dCount: 3,
        awaitingHorizonCount: 3,
        oldestSignalDate: '2026-01-15',
      });
      const handler = findHandler('GET', '/counterfactual-unresolved-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as {
        totalCount: number; pending30dCount: number; oldestSignalDate: string;
      };
      expect(body.totalCount).toBe(12);
      expect(body.pending30dCount).toBe(7);
      expect(body.oldestSignalDate).toBe('2026-01-15');
    });

    it('정상 응답 — 모든 entry awaiting (정상 대기)', () => {
      mockedSummarize.mockReturnValue({
        totalCount: 5,
        resolved30dCount: 0,
        resolved60dCount: 0,
        resolved90dCount: 0,
        pending30dCount: 0,
        pending60dCount: 0,
        pending90dCount: 0,
        awaitingHorizonCount: 5,
        oldestSignalDate: '2026-04-25',
      });
      const handler = findHandler('GET', '/counterfactual-unresolved-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      const body = res.body as { awaitingHorizonCount: number; pending30dCount: number };
      expect(body.awaitingHorizonCount).toBe(5);
      expect(body.pending30dCount).toBe(0);
    });

    it('throw → 500', () => {
      mockedSummarize.mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/counterfactual-unresolved-stats');
      const res = makeRes();
      handler({ query: {} }, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'counterfactual_unresolved_stats_failed' });
    });

    it('GET 메서드만 등록 (정적 invariant — read-only 보장)', () => {
      const stack = (learningRouter as unknown as { stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }> }).stack;
      const layer = stack.find((l) => l.route?.path === '/counterfactual-unresolved-stats');
      expect(layer).toBeDefined();
      expect(layer?.route?.methods).toEqual({ get: true });
    });
  });
});
