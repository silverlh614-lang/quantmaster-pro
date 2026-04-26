/**
 * @responsibility recommendationsRouter 단위 테스트 — ADR-0019 PR-B
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../learning/recommendationTracker.js', () => ({
  getRecommendations: vi.fn(),
  getMonthlyStats: vi.fn(),
}));

import { getRecommendations, getMonthlyStats } from '../learning/recommendationTracker.js';
import recommendationsRouter from './recommendationsRouter.js';

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
  // express Router 의 stack 에서 매칭 layer 의 handle 추출
  const stack = (recommendationsRouter as unknown as { stack: Array<{
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RouteHandler }> };
  }> }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`route ${method} ${path} not found`);
}

describe('recommendationsRouter — ADR-0019', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /history', () => {
    it('빈 이력 → total=0, records=[]', () => {
      vi.mocked(getRecommendations).mockReturnValue([]);
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(200);
      expect((res.body as { total: number; records: unknown[] }).total).toBe(0);
      expect((res.body as { records: unknown[] }).records).toEqual([]);
    });

    it('limit 미지정 → 기본 100', () => {
      const records = Array.from({ length: 150 }, (_, i) => ({
        id: `rec_${i}`, stockCode: `00000${i}`, stockName: `종목${i}`,
        signalTime: new Date(2026, 3, 26 - i % 30).toISOString(),
        priceAtRecommend: 100, stopLoss: 90, targetPrice: 110,
        kellyPct: 0.05, gateScore: 7, signalType: 'BUY' as const, status: 'PENDING' as const,
      }));
      vi.mocked(getRecommendations).mockReturnValue(records);
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: {} }, res);
      const body = res.body as { total: number; limit: number; records: unknown[] };
      expect(body.total).toBe(150);
      expect(body.limit).toBe(100);
      expect(body.records).toHaveLength(100);
    });

    it('limit=20 → 20건', () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: `rec_${i}`, stockCode: `${i}`.padStart(6, '0'), stockName: `s${i}`,
        signalTime: new Date(2026, 3, 1 + i).toISOString(),
        priceAtRecommend: 100, stopLoss: 90, targetPrice: 110,
        kellyPct: 0, gateScore: 7, signalType: 'BUY' as const, status: 'PENDING' as const,
      }));
      vi.mocked(getRecommendations).mockReturnValue(records);
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: { limit: '20' } }, res);
      expect((res.body as { records: unknown[] }).records).toHaveLength(20);
    });

    it('limit > MAX(500) → 500 으로 절삭', () => {
      vi.mocked(getRecommendations).mockReturnValue([]);
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: { limit: '9999' } }, res);
      expect((res.body as { limit: number }).limit).toBe(500);
    });

    it('limit 음수/NaN → 기본 100', () => {
      vi.mocked(getRecommendations).mockReturnValue([]);
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: { limit: '-5' } }, res);
      expect((res.body as { limit: number }).limit).toBe(100);

      const res2 = makeRes();
      handler({ query: { limit: 'abc' } }, res2);
      expect((res2.body as { limit: number }).limit).toBe(100);
    });

    it('signalTime 역순 정렬 (최신 먼저)', () => {
      const oldRec = {
        id: 'old', stockCode: '111111', stockName: 'OLD',
        signalTime: '2026-01-01T00:00:00Z',
        priceAtRecommend: 100, stopLoss: 90, targetPrice: 110,
        kellyPct: 0, gateScore: 7, signalType: 'BUY' as const, status: 'PENDING' as const,
      };
      const newRec = { ...oldRec, id: 'new', stockCode: '222222', stockName: 'NEW',
        signalTime: '2026-04-26T00:00:00Z' };
      vi.mocked(getRecommendations).mockReturnValue([oldRec, newRec]);
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: {} }, res);
      const recs = (res.body as { records: { id: string }[] }).records;
      expect(recs[0].id).toBe('new');
      expect(recs[1].id).toBe('old');
    });

    it('getRecommendations throw → 500', () => {
      vi.mocked(getRecommendations).mockImplementation(() => { throw new Error('disk full'); });
      const handler = findHandler('GET', '/history');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
      expect((res.body as { error: string }).error).toBe('recommendation_history_failed');
    });
  });

  describe('GET /stats', () => {
    it('통계 + pendingCount 정확 계산', () => {
      vi.mocked(getRecommendations).mockReturnValue([
        { id: 'a', status: 'PENDING' } as never,
        { id: 'b', status: 'WIN' } as never,
        { id: 'c', status: 'PENDING' } as never,
        { id: 'd', status: 'LOSS' } as never,
      ]);
      vi.mocked(getMonthlyStats).mockReturnValue({
        month: '2026-04', total: 4, wins: 1, losses: 1, expired: 0,
        winRate: 0.5, avgReturn: 2.5, strongBuyWinRate: 0.5,
        sampleSufficient: false, compoundReturn: 4.5, profitFactor: 2.3,
      });
      const handler = findHandler('GET', '/stats');
      const res = makeRes();
      handler({ query: {} }, res);
      const body = res.body as { totalCount: number; pendingCount: number; monthly: { wins: number } };
      expect(body.totalCount).toBe(4);
      expect(body.pendingCount).toBe(2);
      expect(body.monthly.wins).toBe(1);
    });

    it('getMonthlyStats throw → 500', () => {
      vi.mocked(getRecommendations).mockReturnValue([]);
      vi.mocked(getMonthlyStats).mockImplementation(() => { throw new Error('boom'); });
      const handler = findHandler('GET', '/stats');
      const res = makeRes();
      handler({ query: {} }, res);
      expect(res.statusCode).toBe(500);
      expect((res.body as { error: string }).error).toBe('recommendation_stats_failed');
    });
  });
});
