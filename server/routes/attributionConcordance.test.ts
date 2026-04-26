/**
 * @responsibility /api/attribution/concordance + buildConcordanceMatrix 회귀 (ADR-0048)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../persistence/attributionRepo.js', () => ({
  loadAttributionRecords: vi.fn(),
  loadCurrentSchemaRecords: vi.fn(),
  computeAttributionStats: vi.fn(() => []),
}));

import { loadCurrentSchemaRecords, type ServerAttributionRecord } from '../persistence/attributionRepo.js';
import attributionRouter, { /* buildConcordanceMatrix re-exported via internal? */ } from './attributionRouter.js';
import { buildConcordanceMatrix } from './attributionRouter.js';

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

function makeRecord(overrides: Partial<ServerAttributionRecord> = {}): ServerAttributionRecord {
  return {
    schemaVersion: 2,
    tradeId: 't1',
    stockCode: '005930',
    stockName: '삼성전자',
    closedAt: '2026-04-25T00:00:00Z',
    returnPct: 5,
    isWin: true,
    conditionScores: {},
    holdingDays: 5,
    ...overrides,
  };
}

// ─── buildConcordanceMatrix 단위 ────────────────────────────────────────

describe('buildConcordanceMatrix — ADR-0048 §2.3', () => {
  it('빈 records → 25 cells 모두 sample=0 + diagonalStats null', () => {
    const m = buildConcordanceMatrix([]);
    expect(m.cells).toHaveLength(25);
    expect(m.cells.every((c) => c.sampleCount === 0 && c.winRate === null)).toBe(true);
    expect(m.diagonalStats.sampleCount).toBe(0);
    expect(m.diagonalStats.winRate).toBeNull();
    expect(m.offDiagonalStats.sampleCount).toBe(0);
    expect(m.totalSamples).toBe(0);
  });

  it('단일 trade — REAL_DATA=8 (EXCELLENT) + AI=8 (EXCELLENT) → diagonal cell', () => {
    const scores: Record<number, number> = {
      2: 8, 6: 8, 7: 8, 10: 8, 11: 8, 18: 8, 19: 8, 24: 8, 25: 8,           // REAL_DATA 9개 모두 8
      1: 8, 3: 8, 4: 8, 5: 8, 8: 8, 9: 8, 12: 8, 13: 8, 14: 8, 15: 8,        // AI 18개 모두 8
      16: 8, 17: 8, 20: 8, 21: 8, 22: 8, 23: 8, 26: 8, 27: 8,
    };
    const m = buildConcordanceMatrix([makeRecord({ conditionScores: scores, isWin: true, returnPct: 10 })]);
    const diagonalCell = m.cells.find((c) => c.quantTier === 'EXCELLENT' && c.qualTier === 'EXCELLENT');
    expect(diagonalCell?.sampleCount).toBe(1);
    expect(diagonalCell?.wins).toBe(1);
    expect(diagonalCell?.winRate).toBe(100);
    expect(m.diagonalStats.sampleCount).toBe(1);
    expect(m.offDiagonalStats.sampleCount).toBe(0);
  });

  it('off-diagonal — REAL_DATA=8 (EXCELLENT) + AI=2 (WEAK) → off-diagonal 누적', () => {
    const scores: Record<number, number> = {
      2: 8, 6: 8, 7: 8, 10: 8, 11: 8, 18: 8, 19: 8, 24: 8, 25: 8,
      1: 2, 3: 2, 4: 2, 5: 2, 8: 2, 9: 2, 12: 2, 13: 2, 14: 2, 15: 2,
      16: 2, 17: 2, 20: 2, 21: 2, 22: 2, 23: 2, 26: 2, 27: 2,
    };
    const m = buildConcordanceMatrix([makeRecord({ conditionScores: scores, isWin: false, returnPct: -3 })]);
    const offCell = m.cells.find((c) => c.quantTier === 'EXCELLENT' && c.qualTier === 'WEAK');
    expect(offCell?.sampleCount).toBe(1);
    expect(offCell?.losses).toBe(1);
    expect(m.offDiagonalStats.sampleCount).toBe(1);
    expect(m.diagonalStats.sampleCount).toBe(0);
  });

  it('diagonal vs off-diagonal 통계 합산', () => {
    const excellentScores: Record<number, number> = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [i + 1, 8]));
    const offScores: Record<number, number> = {
      // REAL_DATA EXCELLENT (8) + AI POOR (1)
      2: 8, 6: 8, 7: 8, 10: 8, 11: 8, 18: 8, 19: 8, 24: 8, 25: 8,
      1: 1, 3: 1, 4: 1, 5: 1, 8: 1, 9: 1, 12: 1, 13: 1, 14: 1, 15: 1,
      16: 1, 17: 1, 20: 1, 21: 1, 22: 1, 23: 1, 26: 1, 27: 1,
    };
    const m = buildConcordanceMatrix([
      makeRecord({ tradeId: 't1', conditionScores: excellentScores, isWin: true, returnPct: 10 }),
      makeRecord({ tradeId: 't2', conditionScores: excellentScores, isWin: true, returnPct: 8 }),
      makeRecord({ tradeId: 't3', conditionScores: offScores, isWin: false, returnPct: -2 }),
    ]);
    expect(m.diagonalStats.sampleCount).toBe(2);
    expect(m.diagonalStats.winRate).toBe(100);
    expect(m.diagonalStats.avgReturnPct).toBe(9);
    expect(m.offDiagonalStats.sampleCount).toBe(1);
    expect(m.offDiagonalStats.winRate).toBe(0);
    expect(m.totalSamples).toBe(3);
  });

  it('5×5=25 cell 모두 보장 (sample 없는 셀도 포함)', () => {
    const m = buildConcordanceMatrix([]);
    const tiers = ['EXCELLENT', 'GOOD', 'NEUTRAL', 'WEAK', 'POOR'];
    for (const q of tiers) {
      for (const a of tiers) {
        const cell = m.cells.find((c) => c.quantTier === q && c.qualTier === a);
        expect(cell, `cell ${q}|${a}`).toBeDefined();
      }
    }
  });

  it('avgReturnPct 정확 계산 — 수익률 합/표본', () => {
    const excellentScores: Record<number, number> = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [i + 1, 8]));
    const m = buildConcordanceMatrix([
      makeRecord({ tradeId: 't1', conditionScores: excellentScores, returnPct: 10 }),
      makeRecord({ tradeId: 't2', conditionScores: excellentScores, returnPct: -2 }),
    ]);
    const cell = m.cells.find((c) => c.quantTier === 'EXCELLENT' && c.qualTier === 'EXCELLENT');
    expect(cell?.avgReturnPct).toBe(4);
  });
});

// ─── /concordance 엔드포인트 ────────────────────────────────────────────

describe('GET /concordance — ADR-0048', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('정상 응답 — 25 cells + capturedAt ISO', () => {
    vi.mocked(loadCurrentSchemaRecords).mockReturnValue([]);
    const handler = findHandler('GET', '/concordance');
    const res = makeRes();
    handler({}, res);
    expect(res.statusCode).toBe(200);
    const body = res.body as { cells: unknown[]; capturedAt: string };
    expect(body.cells).toHaveLength(25);
    expect(body.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('loadCurrentSchemaRecords throw → 500', () => {
    vi.mocked(loadCurrentSchemaRecords).mockImplementation(() => { throw new Error('boom'); });
    const handler = findHandler('GET', '/concordance');
    const res = makeRes();
    handler({}, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'concordance_matrix_failed' });
  });
});
