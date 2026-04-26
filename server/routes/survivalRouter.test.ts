/**
 * @responsibility survivalRouter 단위 테스트 — ADR-0044 PR-Z2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../health/survival.js', () => ({
  collectSurvivalSnapshot: vi.fn(),
}));

import { collectSurvivalSnapshot } from '../health/survival.js';
import survivalRouter from './survivalRouter.js';

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
  (req: Record<string, unknown>, res: MockRes): void | Promise<void>;
}

function findHandler(method: string, path: string): RouteHandler {
  const stack = (survivalRouter as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

const fakeSnapshot = {
  dailyLoss: { currentPct: 1.5, limitPct: 5, bufferPct: 70, tier: 'OK' as const },
  sectorConcentration: { hhi: 2000, topSector: '반도체', topWeight: 0.3, activePositions: 4, tier: 'OK' as const },
  kellyConcordance: { ratio: 0.9, currentAvgKelly: 0.45, recommendedKelly: 0.5, sampleSize: 30, tier: 'OK' as const },
  overallTier: 'OK' as const,
  capturedAt: '2026-04-26T13:00:00.000Z',
};

describe('survivalRouter — ADR-0044', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /survival → 정상 응답 (200 + snapshot 그대로)', async () => {
    vi.mocked(collectSurvivalSnapshot).mockResolvedValue(fakeSnapshot);
    const handler = findHandler('GET', '/survival');
    const res = makeRes();
    await handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(fakeSnapshot);
  });

  it('GET /survival → collectSurvivalSnapshot throw 시 500', async () => {
    vi.mocked(collectSurvivalSnapshot).mockRejectedValue(new Error('boom'));
    const handler = findHandler('GET', '/survival');
    const res = makeRes();
    await handler({}, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'survival_snapshot_failed' });
  });

  it('GET /survival → capturedAt ISO 형식 보존', async () => {
    vi.mocked(collectSurvivalSnapshot).mockResolvedValue(fakeSnapshot);
    const handler = findHandler('GET', '/survival');
    const res = makeRes();
    await handler({}, res);
    expect((res.body as { capturedAt: string }).capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
