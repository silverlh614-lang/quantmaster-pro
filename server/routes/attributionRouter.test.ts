/**
 * @responsibility attributionRouter 단위 테스트 — ADR-0035 PR-H
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../persistence/attributionRepo.js', () => ({
  computeAttributionStats: vi.fn(),
  loadAttributionRecords: vi.fn(),
}));

import {
  computeAttributionStats,
  loadAttributionRecords,
} from '../persistence/attributionRepo.js';
import attributionRouter from './attributionRouter.js';

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
  const stack = (attributionRouter as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

describe('attributionRouter — ADR-0035', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /stats — 빈 데이터 → 빈 stats 배열 + totalRecords=0', () => {
    vi.mocked(computeAttributionStats).mockReturnValue([]);
    vi.mocked(loadAttributionRecords).mockReturnValue([]);
    const handler = findHandler('GET', '/stats');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { stats: unknown[]; totalRecords: number };
    expect(body.stats).toEqual([]);
    expect(body.totalRecords).toBe(0);
  });

  it('GET /stats — 정상 응답', () => {
    vi.mocked(computeAttributionStats).mockReturnValue([
      { conditionId: 1, totalTrades: 10, winRate: 70, avgReturn: 5.5, avgReturnWhenHigh: 8, avgReturnWhenLow: 1 },
      { conditionId: 5, totalTrades: 8, winRate: 50, avgReturn: 2.0, avgReturnWhenHigh: 4, avgReturnWhenLow: -1 },
    ]);
    vi.mocked(loadAttributionRecords).mockReturnValue([
      { tradeId: 't1' } as never,
      { tradeId: 't2' } as never,
      { tradeId: 't3' } as never,
    ]);
    const handler = findHandler('GET', '/stats');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { stats: { conditionId: number }[]; totalRecords: number };
    expect(body.stats).toHaveLength(2);
    expect(body.stats[0].conditionId).toBe(1);
    expect(body.totalRecords).toBe(3);
  });

  it('computeAttributionStats throw → 500', () => {
    vi.mocked(computeAttributionStats).mockImplementation(() => { throw new Error('boom'); });
    vi.mocked(loadAttributionRecords).mockReturnValue([]);
    const handler = findHandler('GET', '/stats');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toBe('attribution_stats_failed');
  });

  it('loadAttributionRecords throw → 500', () => {
    vi.mocked(computeAttributionStats).mockReturnValue([]);
    vi.mocked(loadAttributionRecords).mockImplementation(() => { throw new Error('disk'); });
    const handler = findHandler('GET', '/stats');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});
