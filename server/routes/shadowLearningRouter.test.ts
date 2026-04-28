/**
 * @responsibility Shadow Learning router 단위 테스트 — ADR-0088
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RejectionShadowEntry } from '../learning/rejectionShadowTracker.js';
import type { TwinEntry } from '../learning/counterfactualTwinPortfolio.js';

vi.mock('../learning/rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/rejectionShadowTracker.js');
  return {
    ...actual,
    getAllRejectionShadow: vi.fn(),
    summarizeRejectionShadow: vi.fn(),
  };
});

vi.mock('../learning/counterfactualTwinPortfolio.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/counterfactualTwinPortfolio.js');
  return {
    ...actual,
    getAllTwinEntries: vi.fn(),
    compareTwinsVsReal: vi.fn(),
  };
});

vi.mock('../learning/recommendationTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/recommendationTracker.js');
  return {
    ...actual,
    getMonthlyStats: vi.fn(),
  };
});

import * as rejection from '../learning/rejectionShadowTracker.js';
import * as twin from '../learning/counterfactualTwinPortfolio.js';
import * as recom from '../learning/recommendationTracker.js';
import learningRouter from './learningRouter.js';

const mockedAllRej = vi.mocked(rejection.getAllRejectionShadow);
const mockedSumRej = vi.mocked(rejection.summarizeRejectionShadow);
const mockedAllTwin = vi.mocked(twin.getAllTwinEntries);
const mockedCompare = vi.mocked(twin.compareTwinsVsReal);
const mockedMonthly = vi.mocked(recom.getMonthlyStats);

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

function makeRejection(overrides: Partial<RejectionShadowEntry> = {}): RejectionShadowEntry {
  return {
    id: 'r_1', stockCode: '005930', stockName: '삼성전자', signalDate: '2026-04-15',
    signalPriceKrw: 70000, gateScore: 16, scoreDelta: 2, rejectionReason: 'Gate 1 미달',
    trackUntil: '2026-04-22', closed: true, currentReturnPct: 5,
    ...overrides,
  };
}

function makeTwin(overrides: Partial<TwinEntry> = {}): TwinEntry {
  return {
    id: 't_1', twin: 'AGGRESSIVE', stockCode: '005930', stockName: '삼성전자',
    signalDate: '2026-04-15', signalGateScore: 18, entryPrice: 70000, positionWeight: 0.2,
    trackUntil: '2026-05-15', status: 'CLOSED', currentReturnPct: 5,
    ...overrides,
  };
}

describe('learningRouter — Shadow Learning UI (ADR-0088)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  describe('GET /rejection-shadow', () => {
    it('정상 응답 — entries + summary + totalCount', () => {
      mockedAllRej.mockReturnValue([
        makeRejection({ signalDate: '2026-04-15' }),
        makeRejection({ signalDate: '2026-04-20' }),
      ]);
      mockedSumRej.mockReturnValue({
        totalCount: 2, closedCount: 2, activeCount: 0,
        avgClosedReturnPct: 5, medianClosedReturnPct: 5,
        falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 }, reliable: false,
      });
      const handler = findHandler('GET', '/rejection-shadow');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(200);
      const body = res.body as { entries: unknown[]; totalCount: number };
      expect(body.totalCount).toBe(2);
      expect(body.entries).toHaveLength(2);
    });

    it('limit 인자 — 절삭', () => {
      mockedAllRej.mockReturnValue(Array.from({ length: 100 }, (_, i) => makeRejection({ id: `r_${i}` })));
      mockedSumRej.mockReturnValue({
        totalCount: 100, closedCount: 100, activeCount: 0,
        avgClosedReturnPct: 0, medianClosedReturnPct: 0,
        falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 }, reliable: true,
      });
      const handler = findHandler('GET', '/rejection-shadow');
      const res = makeRes();
      handler({ query: { limit: '20' } }, res);
      const body = res.body as { entries: unknown[] };
      expect(body.entries).toHaveLength(20);
    });

    it('signalDate 내림차순 정렬', () => {
      mockedAllRej.mockReturnValue([
        makeRejection({ id: 'a', signalDate: '2026-04-15' }),
        makeRejection({ id: 'b', signalDate: '2026-04-20' }),
        makeRejection({ id: 'c', signalDate: '2026-04-10' }),
      ]);
      mockedSumRej.mockReturnValue({
        totalCount: 3, closedCount: 3, activeCount: 0,
        avgClosedReturnPct: 0, medianClosedReturnPct: 0,
        falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 }, reliable: false,
      });
      const handler = findHandler('GET', '/rejection-shadow');
      const res = makeRes();
      handler({ query: {} }, res);
      const body = res.body as { entries: Array<{ id: string }> };
      expect(body.entries[0].id).toBe('b'); // 가장 최신
      expect(body.entries[2].id).toBe('c'); // 가장 오래됨
    });

    it('throw → 500', () => {
      mockedAllRej.mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/rejection-shadow');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /twin-portfolio', () => {
    it('정상 응답 — comparison + entries + realCumReturnPct', () => {
      mockedMonthly.mockReturnValue({
        month: '2026-04', total: 10, wins: 6, losses: 3, expired: 1,
        winRate: 0.6, avgReturn: 1.2, strongBuyWinRate: 0.7,
        sampleSufficient: true, compoundReturn: 4.2, profitFactor: 2.1,
      });
      mockedCompare.mockReturnValue({
        perTwin: {
          AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
          DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
          EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
        },
        realCumReturnPct: 4.2,
        weekWinning: { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
      });
      mockedAllTwin.mockReturnValue([makeTwin()]);
      const handler = findHandler('GET', '/twin-portfolio');
      const res = makeRes();
      handler({ query: {} }, res);
      const body = res.body as { realCumReturnPct: number; totalCount: number };
      expect(body.realCumReturnPct).toBe(4.2);
      expect(body.totalCount).toBe(1);
      expect(mockedCompare).toHaveBeenCalledWith(4.2);
    });

    it('throw → 500', () => {
      mockedMonthly.mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/twin-portfolio');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
    });
  });
});
