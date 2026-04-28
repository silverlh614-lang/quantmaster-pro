/**
 * @responsibility conditionLifecycle endpoint 단위 테스트 — ADR-0084
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';

vi.mock('../persistence/attributionRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../persistence/attributionRepo.js',
  );
  return {
    ...actual,
    loadCurrentSchemaRecords: vi.fn(),
  };
});

import * as repo from '../persistence/attributionRepo.js';
import learningRouter from './learningRouter.js';

const mockedLoad = vi.mocked(repo.loadCurrentSchemaRecords);

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

function makeRecord(overrides: Partial<ServerAttributionRecord> = {}): ServerAttributionRecord {
  return {
    schemaVersion: 2,
    tradeId: `t_${Math.random().toString(36).slice(2)}`,
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-15T01:00:00Z',
    returnPct: 5,
    isWin: true,
    holdingDays: 3,
    conditionScores: { 1: 8 },
    ...overrides,
  };
}

describe('learningRouter — condition-lifecycle (ADR-0084)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONDITION_LIFECYCLE_DISABLED;
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CONDITION_LIFECYCLE_DISABLED;
  });

  it('정상 응답 — windowDays + conditions 27 + summary', () => {
    mockedLoad.mockReturnValue([makeRecord()]);
    const handler = findHandler('GET', '/condition-lifecycle');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      windowDays: number;
      disabled: boolean;
      conditions: unknown[];
      summary: { total: number };
    };
    expect(body.windowDays).toBe(180);
    expect(body.conditions).toHaveLength(27);
    expect(body.summary.total).toBe(27);
  });

  it('빈 records — 모두 grace', () => {
    mockedLoad.mockReturnValue([]);
    const handler = findHandler('GET', '/condition-lifecycle');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { summary: { grace: number; normal: number } };
    expect(body.summary.grace).toBe(27);
    expect(body.summary.normal).toBe(0);
  });

  it('windowDays 인자 propagate', () => {
    mockedLoad.mockReturnValue([]);
    const handler = findHandler('GET', '/condition-lifecycle');
    const res = makeRes();
    handler({ query: { days: '60' } }, res);
    const body = res.body as { windowDays: number };
    expect(body.windowDays).toBe(60);
  });

  it('windowDays 잘못된 값 → 180 fallback', () => {
    mockedLoad.mockReturnValue([]);
    const handler = findHandler('GET', '/condition-lifecycle');
    const res = makeRes();
    handler({ query: { days: 'NOT_A_NUMBER' } }, res);
    const body = res.body as { windowDays: number };
    expect(body.windowDays).toBe(180);
  });

  it('disabled=true 플래그 전달', () => {
    process.env.CONDITION_LIFECYCLE_DISABLED = 'true';
    mockedLoad.mockReturnValue([]);
    const handler = findHandler('GET', '/condition-lifecycle');
    const res = makeRes();
    handler({ query: {} }, res);
    const body = res.body as { disabled: boolean };
    expect(body.disabled).toBe(true);
  });

  it('load throw → 500', () => {
    mockedLoad.mockImplementation(() => { throw new Error('disk fail'); });
    const handler = findHandler('GET', '/condition-lifecycle');
    const res = makeRes();
    handler({ query: {} }, res);
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toBe('condition_lifecycle_failed');
  });
});
