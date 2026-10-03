// @responsibility Verify compact dashboard evidence.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../../src/types/paperExperiment.js';
import { buildPaperOverview } from './paperDashboardView.js';
import { matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { buildPaperStrategyView } from './paperStrategyPolicy.js';
import { legacyStrategyLedger } from './paperStrategyFixtures.js';

function autonomousView(): PaperExperimentView {
  const experiments = matureAdaptiveSamples();
  for (const experiment of experiments) {
    const index = Number(experiment.symbol.slice(-1));
    experiment.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
    experiment.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
  }
  const adaptive = selectPaperAdaptiveState(undefined, experiments, '2026-09-18T01:00:00Z');
  adaptive.discovery!.round = 3;
  const strategy = buildPaperStrategyView({ ...legacyStrategyLedger(), adaptive });
  strategy.performance = { closedCount: 9, meanNetReturnPct: 8, winRatePct: 75, totalNetPnl: 800 };
  strategy.performanceByVersion!['adaptive-features-v1'] = { closedCount: 2, meanNetReturnPct: 0, winRatePct: 0, totalNetPnl: 0 };
  return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: experiments.length,
    openCount: 0, completedCount: experiments.length, lastRun: null,
    outcomes: [{ horizon: 1, label: 'D1', count: 0, meanNetReturnPct: null, winRatePct: null }],
    experiments, groups: [], strategy };
}

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

  it('preserves discovered formulas and version-specific realized results while excluding trade and observation ledgers', () => {
    const view = autonomousView(), before = structuredClone(view);
    const result = buildPaperOverview(view);
    expect(view.strategy!.adaptive!.discovery!.inventions.length).toBeGreaterThan(0);
    expect(view.experiments.length).toBeGreaterThan(0);
    expect(view.strategy!.trades.length).toBeGreaterThan(0);
    expect(view.strategy!.latestDecisions.length).toBeGreaterThan(0);
    expect(result.strategy!.adaptive).toEqual(view.strategy!.adaptive);
    expect(result.strategy!.adaptive!.discovery!.round).toBe(3);
    expect(result.strategy!.adaptive!.discovery!.attemptedIds).toHaveLength(3);
    expect(result.strategy!.adaptive!.candidates.filter(item => item.rule.invention)).toHaveLength(2);
    expect(result.strategy!.performanceByVersion!['adaptive-features-v1']).toEqual({
      closedCount: 2, meanNetReturnPct: 0, winRatePct: 0, totalNetPnl: 0,
    });
    expect(result.strategy!.performance.meanNetReturnPct).toBe(8);
    expect(result.outcomes[0].meanNetReturnPct).toBeNull();
    expect(result.strategy!.decisionCounts).toEqual({ BUY: 1, WAIT: 0, HOLD: 0, EXIT: 0 });
    expect(result).not.toHaveProperty('experiments');
    expect(result).not.toHaveProperty('groups');
    expect(result.strategy).not.toHaveProperty('trades');
    expect(result.strategy).not.toHaveProperty('latestDecisions');
    expect(view).toEqual(before);
    expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(view).length);
  });

  it('preserves errors and unavailable current-version results without synthesizing successful empty data', () => {
    const view = autonomousView();
    view.strategy!.error = '전략 기록을 읽을 수 없습니다';
    view.strategy!.lastRun = { snapshotId: 'failed', asOf: '2026-09-18T01:00:00Z', openedCount: 0,
      closedCount: 0, waitingCount: 0, holdingCount: 0, error: '전략 평가 실패' };
    delete view.strategy!.performanceByVersion!['adaptive-features-v1'];
    const result = buildPaperOverview(view);
    expect(result.strategy!.error).toBe(view.strategy!.error);
    expect(result.strategy!.lastRun!.error).toBe('전략 평가 실패');
    expect(result.strategy!.performanceByVersion!['adaptive-features-v1']).toBeUndefined();
    expect(result.strategy!.performance.meanNetReturnPct).toBe(8);
    delete view.strategy;
    expect(buildPaperOverview(view)).not.toHaveProperty('strategy');
  });
});
