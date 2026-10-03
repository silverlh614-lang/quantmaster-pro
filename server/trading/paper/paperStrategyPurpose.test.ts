// @responsibility Verify full-ledger Shadow performance attribution by entry purpose.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';

function entered(exploratory: boolean): PaperStrategyTrade {
  const snapshot = adaptiveTestSnapshot();
  const registration = structuredClone(snapshot);
  registration.asOf = '2026-09-18T00:59:00Z';
  registration.observations[0].observedAt = registration.asOf;
  registration.observations[0].features!.asOf = registration.asOf;
  const state = selectPaperAdaptiveState(undefined, exploratory ? [] : matureAdaptiveSamples(),
    registration.asOf, exploratory ? registration.observations : []);
  return evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, state).trades[0];
}

describe('Shadow purpose performance', () => {
  it('uses all trades while keeping legacy, validated and exploration outcomes distinct', () => {
    const validated = entered(false), exploration = entered(true), legacy = legacyStrategyLedger().trades[0];
    const trades: PaperStrategyTrade[] = [];
    const add = (base: PaperStrategyTrade, count: number, netReturnPct?: number) => {
      for (let index = 0; index < count; index++) {
        const trade = structuredClone(base); trade.id = `purpose-${trades.length}`;
        if (netReturnPct !== undefined) {
          trade.status = 'CLOSED';
          trade.exit = { model: 'SCHEDULED_CLOSE', snapshotId: 'closed', effectiveAt: trade.scheduledExitAt,
            observedAt: trade.scheduledExitAt, decisionAt: trade.scheduledExitAt, price: 10000,
            grossReturnPct: netReturnPct, netReturnPct, netPnl: netReturnPct * 100,
            decision: { ...trade.entryDecision, action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED' } };
        }
        trades.push(trade);
      }
    };
    add(validated, 10, 2); add(validated, 10, -1); add(validated, 3);
    add(exploration, 1, -4); add(exploration, 1, 6); add(exploration, 5);
    add(legacy, 210, 99);
    const view = buildPaperStrategyView({ ...emptyStrategyLedger(), trades });
    expect(view.trades).toHaveLength(200);
    expect(view.trades!.every(trade => trade.strategyVersion === 'news-trend-v2')).toBe(true);
    expect(view.performanceByPurpose).toEqual({
      VALIDATED: { openCount: 3, closedCount: 20, meanNetReturnPct: 0.5, winRatePct: 50, totalNetPnl: 1000 },
      EXPLORATION: { openCount: 5, closedCount: 2, meanNetReturnPct: 1, winRatePct: 50, totalNetPnl: 200 },
    });
    expect(view.performanceByVersion!['adaptive-features-v1']).toMatchObject({ closedCount: 22, totalNetPnl: 1200 });
    expect(view.performance.closedCount).toBe(232);
    expect(view.openCount).toBe(8);
  });

  it('preserves unknown returns until a purpose has actual closed trades', () => {
    expect(buildPaperStrategyView(emptyStrategyLedger()).performanceByPurpose).toEqual({
      VALIDATED: { openCount: 0, closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
      EXPLORATION: { openCount: 0, closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
    });
  });
});
