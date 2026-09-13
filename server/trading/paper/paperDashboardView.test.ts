// @responsibility Verify compact dashboard evidence.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../../src/types/paperExperiment.js';
import { buildPaperOverview } from './paperDashboardView.js';

describe('compact dashboard projection', () => {
  it('preserves totals, zeros, missing results and reason counts without sending ledgers', () => {
    const view: PaperExperimentView = {
      mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 81, openCount: 80, completedCount: 1,
      lastRun: null, experiments: [], groups: [], outcomes: [{ horizon: 1, label: 'D1', count: 1, meanNetReturnPct: 0, winRatePct: 0 }],
      strategy: { mode: 'SHADOW', strategyVersion: 'news-trend-v2', policy: { version: 'news-trend-v2', newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3, horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE' },
        totalCount: 0, openCount: 0, performance: { closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null }, lastRun: null, trades: [],
        latestDecisions: [0, 1].map(index => ({ snapshotId: 's', decisionAt: '2026-09-13T00:00:00Z', symbol: String(index), name: 'sample', action: 'WAIT', reasonCode: 'INSUFFICIENT_MATURE_SAMPLES', reason: 'sample evidence', cohort: null, evidence: null, tradeId: null })),
      },
    };
    const original = JSON.stringify(view);
    const result = buildPaperOverview(view);
    expect(result.totalCount).toBe(81);
    expect(result.outcomes[0].meanNetReturnPct).toBe(0);
    expect(result.strategy?.performance.meanNetReturnPct).toBeNull();
    expect(result.strategy?.decisionCounts).toEqual({ BUY: 0, WAIT: 2, HOLD: 0, EXIT: 0 });
    expect(result.strategy?.waitingReasons).toEqual([{ code: 'INSUFFICIENT_MATURE_SAMPLES', label: '완료 표본 누적 중', count: 2 }]);
    expect(result).not.toHaveProperty('experiments');
    expect(result.strategy).not.toHaveProperty('latestDecisions');
    expect(result.strategy).not.toHaveProperty('trades');
    expect(JSON.stringify(view)).toBe(original);
    expect(JSON.stringify(result).length).toBeLessThan(original.length);
  });
});
