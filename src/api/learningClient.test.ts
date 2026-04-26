// @vitest-environment jsdom
/**
 * @responsibility learningClient fetch 회귀 (ADR-0047 PR-Z5)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchLearningStatus, type LearningStatusSnapshot } from './learningClient';

const mockSnapshot: LearningStatusSnapshot = {
  lastReflection: {
    date: '2026-04-25',
    generatedAt: '2026-04-25T10:00:00Z',
    mode: 'FULL',
    dailyVerdict: 'GOOD_DAY',
    narrativeLength: 250,
    narrativePreview: '오늘은 강한 손절 규율로 손실을 -5% 이내 억제했다.',
    keyLessonsCount: 3,
    questionableDecisionsCount: 1,
    tomorrowAdjustmentsCount: 2,
    fiveWhyCount: 1,
    personaReviewStressed: true,
    integrityRemovedCount: 0,
    integrityParseFailed: false,
  },
  consecutiveMissingDays: 0,
  reflectionBudget: { mode: 'FULL' },
  biasHeatmapToday: null,
  biasHeatmap7dAvg: [
    { bias: 'OVERCONFIDENCE', avg: 0.45 },
    { bias: 'LOSS_AVERSION', avg: 0.55 },
  ],
  experimentProposalsActive: [],
  experimentProposalsCompletedRecent: [],
  tomorrowPriming: null,
  ghostPortfolioOpenCount: 0,
  suggestAlerts7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regimeCoverage: 0, total: 0 },
  diagnostics: { healthy: true, warnings: [] },
};

describe('fetchLearningStatus — ADR-0047', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('200 정상 → snapshot 그대로 반환', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSnapshot,
    } as Response);
    const result = await fetchLearningStatus();
    expect(result).toEqual(mockSnapshot);
  });

  it('500 에러 → throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    await expect(fetchLearningStatus()).rejects.toThrow(/500/);
  });
});
