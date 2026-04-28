// @responsibility shadowLearningClient 회귀 테스트 — fetch 함수 + 타입 호환.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TWIN_KEYS,
  fetchRejectionShadow,
  fetchShadowAttribution,
  fetchTwinPortfolio,
} from './shadowLearningClient';

describe('shadowLearningClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('ALL_TWIN_KEYS — 정확 3 값', () => {
    expect(ALL_TWIN_KEYS).toEqual(['AGGRESSIVE', 'DISCIPLINED', 'EQUAL_WEIGHT']);
  });

  describe('fetchRejectionShadow', () => {
    it('정상 응답 + limit propagate', async () => {
      const mockResponse = {
        summary: {
          totalCount: 10, closedCount: 8, activeCount: 2,
          avgClosedReturnPct: 2.5, medianClosedReturnPct: 1.0,
          falseNegativeRate: 0.25, quartiles: { q1: -1, q2: 1, q3: 5 },
          reliable: true,
        },
        entries: [],
        totalCount: 10,
      };
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchRejectionShadow(50);
      expect(result.summary.totalCount).toBe(10);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/learning/rejection-shadow?limit=50'),
      );
    });

    it('default limit 50', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ summary: {}, entries: [], totalCount: 0 }),
      } as Response);
      await fetchRejectionShadow();
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('limit=50'));
    });

    it('!ok → throw', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);
      await expect(fetchRejectionShadow()).rejects.toThrow('rejection-shadow 500');
    });
  });

  describe('fetchTwinPortfolio', () => {
    it('정상 응답', async () => {
      const mockResponse = {
        comparison: {
          perTwin: {
            AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 2, closedCount: 5, avgReturnPct: 2, cumReturnPct: 9.4, weeklySharpeProxy: 0.4 },
            DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 1, closedCount: 3, avgReturnPct: 1.5, cumReturnPct: 5.8, weeklySharpeProxy: 0.3 },
            EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 4, avgReturnPct: 1, cumReturnPct: 3.9, weeklySharpeProxy: 0.2 },
          },
          realCumReturnPct: 4.2,
          weekWinning: { AGGRESSIVE: true, DISCIPLINED: true, EQUAL_WEIGHT: false },
        },
        entries: [],
        realCumReturnPct: 4.2,
        totalCount: 12,
      };
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchTwinPortfolio();
      expect(result.realCumReturnPct).toBe(4.2);
      expect(result.comparison.perTwin.AGGRESSIVE.cumReturnPct).toBe(9.4);
    });

    it('!ok → throw', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 502,
      } as Response);
      await expect(fetchTwinPortfolio()).rejects.toThrow('twin-portfolio 502');
    });
  });

  describe('fetchShadowAttribution', () => {
    it('정상 응답', async () => {
      const mockResponse = {
        totalConditions: 27, status: 'OK', closedSampleSize: 30, conditions: [],
        summary: { overStrictCandidates: 1, goodDefenseCandidates: 0, insufficient: 26, normal: 0 },
      };
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);
      const result = await fetchShadowAttribution();
      expect(result.status).toBe('OK');
      expect(result.totalConditions).toBe(27);
    });

    it('!ok → throw', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);
      await expect(fetchShadowAttribution()).rejects.toThrow('condition-attribution-shadow 500');
    });
  });
});
