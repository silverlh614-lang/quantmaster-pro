// @vitest-environment jsdom
// @responsibility ADR-0178 learningDashboardClient SDK 회귀 테스트
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_GATE_NAMES,
  ALL_DELTA_CATEGORIES,
  fetchSafetyGateAttribution,
  fetchShadowVsLiveDelta,
  fetchMissedLearningQueueStats,
  fetchRejectionShadowStats,
  fetchReflectionImpact,
  fetchCounterfactualUnresolvedStats,
  type ClientGateAttributionResult,
  type ClientDeltaCategoryResult,
  type ClientMissedLearningQueueStats,
  type ClientRejectionShadowSummary,
  type ClientReflectionImpactSummary,
  type ClientCounterfactualUnresolvedStats,
} from './learningDashboardClient';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

describe('learningDashboardClient', () => {
  describe('SSOT 상수', () => {
    it('ALL_GATE_NAMES 7개 entry', () => {
      expect(ALL_GATE_NAMES).toHaveLength(7);
      expect(ALL_GATE_NAMES).toContain('FOMC');
      expect(ALL_GATE_NAMES).toContain('VIX');
      expect(ALL_GATE_NAMES).toContain('R0_R1_REGIME');
      expect(ALL_GATE_NAMES).toContain('LIQUIDITY');
      expect(ALL_GATE_NAMES).toContain('DATA_SANITY');
      expect(ALL_GATE_NAMES).toContain('EXPOSURE_BUDGET');
      expect(ALL_GATE_NAMES).toContain('ENEMY_CHECKLIST');
    });

    it('ALL_DELTA_CATEGORIES 5개 entry', () => {
      expect(ALL_DELTA_CATEGORIES).toHaveLength(5);
      expect(ALL_DELTA_CATEGORIES).toContain('SHADOW_BUY_LIVE_BLOCKED');
      expect(ALL_DELTA_CATEGORIES).toContain('LIVE_BUY_SHADOW_BETTER_SIZE');
      expect(ALL_DELTA_CATEGORIES).toContain('EXPOSURE_CAP_REDUCED');
      expect(ALL_DELTA_CATEGORIES).toContain('MACRO_GATE_BLOCKED');
      expect(ALL_DELTA_CATEGORIES).toContain('LIQUIDITY_GATE_BLOCKED');
    });
  });

  describe('fetchSafetyGateAttribution', () => {
    it('정상 응답 + default URL', async () => {
      const fakeResults: ClientGateAttributionResult[] = [
        { gate: 'FOMC', avoidedLoss: 100, missedGain: 50, netGateImpact: 50,
          blockedWinnerCount: 1, blockedLoserCount: 2, gatePrecision: 0.667, sampleSize: 3 },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse(fakeResults));
      const r = await fetchSafetyGateAttribution();
      expect(r).toEqual(fakeResults);
      expect(fetchMock).toHaveBeenCalledWith('/api/learning/safety-gate-attribution');
    });

    it('opts.days + opts.horizon query 전달', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse([]));
      await fetchSafetyGateAttribution({ days: 30, horizon: 20 });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/learning/safety-gate-attribution?days=30&horizon=20',
      );
    });

    it('opts.days 만 — query 1개', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse([]));
      await fetchSafetyGateAttribution({ days: 60 });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/learning/safety-gate-attribution?days=60',
      );
    });

    it('빈 배열 응답 (ENV OFF)', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse([]));
      const r = await fetchSafetyGateAttribution();
      expect(r).toEqual([]);
    });

    it('500 응답 — throw', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(null, false, 500));
      await expect(fetchSafetyGateAttribution()).rejects.toThrow(
        'safety-gate-attribution 500',
      );
    });
  });

  describe('fetchShadowVsLiveDelta', () => {
    it('정상 응답 + default URL', async () => {
      const fakeResults: ClientDeltaCategoryResult[] = [
        { category: 'SHADOW_BUY_LIVE_BLOCKED', sampleSize: 3,
          shadowReturnSum: 15, liveReturnSum: 0, missedAlpha: 15, missedAlphaAvg: 5 },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse(fakeResults));
      const r = await fetchShadowVsLiveDelta();
      expect(r).toEqual(fakeResults);
      expect(fetchMock).toHaveBeenCalledWith('/api/learning/shadow-vs-live-delta');
    });

    it('opts.days + opts.horizon query 전달', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse([]));
      await fetchShadowVsLiveDelta({ days: 180, horizon: 3 });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/learning/shadow-vs-live-delta?days=180&horizon=3',
      );
    });

    it('빈 배열 응답 (ENV OFF)', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse([]));
      const r = await fetchShadowVsLiveDelta();
      expect(r).toEqual([]);
    });

    it('500 응답 — throw', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(null, false, 500));
      await expect(fetchShadowVsLiveDelta()).rejects.toThrow(
        'shadow-vs-live-delta 500',
      );
    });
  });

  describe('fetchMissedLearningQueueStats (ADR-0179)', () => {
    it('정상 응답 + URL', async () => {
      const fakeStats: ClientMissedLearningQueueStats = {
        pending: 2, replayed: 5, failed: 1, dropped: 0,
        total: 8, lastEnqueuedAt: '2026-05-02T12:00:00.000Z',
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeStats));
      const r = await fetchMissedLearningQueueStats();
      expect(r).toEqual(fakeStats);
      expect(fetchMock).toHaveBeenCalledWith('/api/learning/missed-learning-queue-stats');
    });

    it('빈 큐 응답', async () => {
      const fakeStats: ClientMissedLearningQueueStats = {
        pending: 0, replayed: 0, failed: 0, dropped: 0, total: 0,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeStats));
      const r = await fetchMissedLearningQueueStats();
      expect(r.total).toBe(0);
      expect(r.lastEnqueuedAt).toBeUndefined();
    });

    it('500 응답 — throw', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(null, false, 500));
      await expect(fetchMissedLearningQueueStats()).rejects.toThrow(
        'missed-learning-queue-stats 500',
      );
    });
  });

  describe('fetchRejectionShadowStats (ADR-0180)', () => {
    it('정상 응답 + URL — falseNegativeRate ≥ 0.3 (게이트 완화 후보)', async () => {
      const fakeSummary: ClientRejectionShadowSummary = {
        totalCount: 12,
        closedCount: 8,
        activeCount: 4,
        avgClosedReturnPct: 3.5,
        medianClosedReturnPct: 2.0,
        falseNegativeRate: 0.375,
        quartiles: { q1: -1.0, q2: 2.0, q3: 7.5 },
        reliable: true,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeSummary));
      const r = await fetchRejectionShadowStats();
      expect(r).toEqual(fakeSummary);
      expect(fetchMock).toHaveBeenCalledWith('/api/learning/rejection-shadow-stats');
    });

    it('빈 영속 응답 — closedCount=0 + reliable=false', async () => {
      const fakeSummary: ClientRejectionShadowSummary = {
        totalCount: 0,
        closedCount: 0,
        activeCount: 0,
        avgClosedReturnPct: 0,
        medianClosedReturnPct: 0,
        falseNegativeRate: 0,
        reliable: false,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeSummary));
      const r = await fetchRejectionShadowStats();
      expect(r.closedCount).toBe(0);
      expect(r.reliable).toBe(false);
    });

    it('500 응답 — throw', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(null, false, 500));
      await expect(fetchRejectionShadowStats()).rejects.toThrow(
        'rejection-shadow-stats 500',
      );
    });
  });

  describe('fetchReflectionImpact (ADR-0181)', () => {
    it('정상 응답 + default URL', async () => {
      const fakeData: ClientReflectionImpactSummary = {
        windowDays: 180,
        modules: [
          { module: 'mainReflection', status: 'normal', impactRate: 0.6,
            runs: 100, meaningfulRuns: 60, firstSeenAt: '2026-04-01T00:00:00.000Z',
            ageDays: 32 },
        ],
        summary: { total: 1, normal: 1, grace: 0, silent: 0, deprecated: 0 },
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeData));
      const r = await fetchReflectionImpact();
      expect(r).toEqual(fakeData);
      expect(fetchMock).toHaveBeenCalledWith('/api/learning/reflection-impact');
    });

    it('opts.days query 전달', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({
        windowDays: 90,
        modules: [],
        summary: { total: 0, normal: 0, grace: 0, silent: 0, deprecated: 0 },
      }));
      await fetchReflectionImpact({ days: 90 });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/learning/reflection-impact?days=90',
      );
    });

    it('빈 모듈 + summary 모두 0 (운영 데이터 부재)', async () => {
      const fakeData: ClientReflectionImpactSummary = {
        windowDays: 180,
        modules: [],
        summary: { total: 0, normal: 0, grace: 0, silent: 0, deprecated: 0 },
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeData));
      const r = await fetchReflectionImpact();
      expect(r.modules).toHaveLength(0);
      expect(r.summary.total).toBe(0);
    });

    it('500 응답 — throw', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(null, false, 500));
      await expect(fetchReflectionImpact()).rejects.toThrow(
        'reflection-impact 500',
      );
    });
  });

  describe('fetchCounterfactualUnresolvedStats (ADR-0182)', () => {
    it('정상 응답 + URL — pending30dCount ≥ 5 (cron 미실행 의심)', async () => {
      const fakeStats: ClientCounterfactualUnresolvedStats = {
        totalCount: 12,
        resolved30dCount: 2,
        resolved60dCount: 0,
        resolved90dCount: 0,
        pending30dCount: 7,
        pending60dCount: 5,
        pending90dCount: 3,
        awaitingHorizonCount: 3,
        oldestSignalDate: '2026-01-15',
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeStats));
      const r = await fetchCounterfactualUnresolvedStats();
      expect(r).toEqual(fakeStats);
      expect(fetchMock).toHaveBeenCalledWith('/api/learning/counterfactual-unresolved-stats');
    });

    it('빈 영속 응답 — totalCount=0', async () => {
      const fakeStats: ClientCounterfactualUnresolvedStats = {
        totalCount: 0,
        resolved30dCount: 0,
        resolved60dCount: 0,
        resolved90dCount: 0,
        pending30dCount: 0,
        pending60dCount: 0,
        pending90dCount: 0,
        awaitingHorizonCount: 0,
      };
      fetchMock.mockResolvedValueOnce(mockResponse(fakeStats));
      const r = await fetchCounterfactualUnresolvedStats();
      expect(r.totalCount).toBe(0);
      expect(r.oldestSignalDate).toBeUndefined();
    });

    it('500 응답 — throw', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(null, false, 500));
      await expect(fetchCounterfactualUnresolvedStats()).rejects.toThrow(
        'counterfactual-unresolved-stats 500',
      );
    });
  });
});
