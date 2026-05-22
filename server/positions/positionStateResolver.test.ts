import { describe, expect, it, vi } from 'vitest';

import {
  calculatePositionSlotsBySsot,
  detectPositionStateReconciliationIssues,
  formatPositionExistenceCheckedBySsotLog,
  formatPositionSlotCalculatedBySsotLog,
  formatPositionStateOpenedLog,
  formatPositionStateReconciliationRequiredLog,
  formatPositionStateResolvedLog,
  formatTelegramPositionCommandUsingSsotLog,
  hasOpenPosition,
  positionExistsInStates,
  resolvePositionState,
  type PositionState,
} from './positionStateResolver.js';
import type {
  NormalizedPosition,
  PositionSourceAggregate,
} from '../telegram/commands/positions/positionSourceTypes.js';
import { recordCounterfactualForDecision } from '../trading/gates/counterfactualAlwaysOn.js';
import { resolveSimpleTradeDecision } from '../trading/gates/simpleDecision.js';

const NOW = new Date('2026-05-21T01:00:00.000Z');

function position(overrides: Partial<NormalizedPosition> = {}): NormalizedPosition {
  return {
    symbol: '005930',
    name: 'Samsung',
    qty: 10,
    avgPrice: 70000,
    currentPrice: 71000,
    sourceTag: 'SHADOW',
    mode: 'SHADOW',
    source: 'ShadowPositionLedger',
    id: 'pos-1',
    status: 'OPEN',
    ...overrides,
  };
}

function aggregate(positions: NormalizedPosition[]): PositionSourceAggregate {
  return {
    positions,
    results: [
      { source: 'ShadowPositionLedger', kind: 'SUCCESS', positions: positions.filter((p) => p.source === 'ShadowPositionLedger') },
      { source: 'VirtualAccount', kind: 'SUCCESS', positions: positions.filter((p) => p.source === 'VirtualAccount') },
      { source: 'PaperTradeLedger', kind: 'SUCCESS', positions: positions.filter((p) => p.source === 'PaperTradeLedger') },
      { source: 'KISLiveHolding', kind: 'SUCCESS', positions: positions.filter((p) => p.source === 'KISLiveHolding') },
    ],
    diagnostics: [],
    hasFailure: false,
    allFailed: false,
  };
}

describe('PositionStateResolver SSOT', () => {
  it('A/B. resolves Shadow holdings as positions even when live holdings are empty', async () => {
    const sourceAggregate = aggregate([
      position({ id: 'shadow-1', symbol: '005930' }),
      position({ id: 'shadow-2', symbol: '000660' }),
    ]);

    const result = await resolvePositionState(
      { modePreference: 'SHADOW_FIRST', includePending: true },
      { sourceAggregate, now: NOW },
    );

    expect(result.openCount).toBe(2);
    expect(result.states.map((state) => state.mode)).toEqual(['SHADOW', 'SHADOW']);
    expect(positionExistsInStates(result.states)).toBe(true);
    await expect(hasOpenPosition('005930', 'SHADOW_FIRST', { sourceAggregate, now: NOW })).resolves.toBe(true);
    expect(formatPositionStateResolvedLog(result)).toContain('[POSITION_STATE_RESOLVED]');
    expect(formatPositionExistenceCheckedBySsotLog({
      exists: true,
      state: result.states[0],
    })).toContain('dedupIgnored=true');
    expect(formatTelegramPositionCommandUsingSsotLog({
      command: '/pos',
      liveCount: 0,
      shadowCount: 2,
      virtualHoldingCount: 0,
      displayedCount: 2,
    })).toContain("[TELEGRAM_POSITION_COMMAND_USING_SSOT]");
  });

  it('C. does not treat dedupOpenCount as position existence', () => {
    const issues = detectPositionStateReconciliationIssues({
      symbol: '005930',
      dedupOpenCount: 2,
      paperOpenCount: 0,
      virtualHoldingCount: 0,
      pendingCount: 0,
      states: [],
    });

    expect(positionExistsInStates([])).toBe(false);
    expect(issues).toEqual([
      expect.objectContaining({
        mismatchType: 'STALE_DEDUP_LOCK_SUSPECTED',
        executionImpact: 'NONE',
      }),
    ]);
    expect(formatPositionStateReconciliationRequiredLog(issues[0]!)).toContain('STALE_DEDUP_LOCK_SUSPECTED');
  });

  it('D. queues rebuild when VirtualAccount has holdings but PositionState is missing', () => {
    const issues = detectPositionStateReconciliationIssues({
      symbol: '084670',
      virtualHoldingCount: 1,
      states: [],
    });

    expect(issues).toEqual([
      expect.objectContaining({
        mismatchType: 'POSITION_STATE_REBUILD_FROM_VIRTUAL_ACCOUNT',
        action: 'QUEUE_RECONCILIATION',
      }),
    ]);
  });

  it('D2. queues live import when KIS live holdings exist but PositionState is missing', () => {
    const issues = detectPositionStateReconciliationIssues({
      symbol: '005930',
      liveHoldingCount: 1,
      states: [],
    });

    expect(issues).toEqual([
      expect.objectContaining({
        mismatchType: 'LIVE_POSITION_IMPORT_REQUIRED',
        action: 'QUEUE_RECONCILIATION',
      }),
    ]);
  });

  it('E. calculates slots from PositionState OPEN and ORDER_PENDING states', async () => {
    const sourceAggregate = aggregate([
      position({ id: 'open-1', symbol: '005930', status: 'OPEN' }),
      position({ id: 'open-2', symbol: '000660', status: 'PARTIAL_TAKE_PROFIT' }),
      position({ id: 'pending-1', symbol: '035420', status: 'ORDER_SUBMITTED' }),
    ]);
    const sizing = await calculatePositionSlotsBySsot({
      regime: 'R5_STABILIZING',
      totalEquity: 5_000_000,
      modePreference: 'SHADOW_FIRST',
      sourceAggregate,
      now: NOW,
    });

    expect(sizing.policy.maxPositions).toBe(3);
    expect(sizing.currentPositions).toBe(3);
    expect(sizing.remainingSlots).toBe(0);
    expect(formatPositionSlotCalculatedBySsotLog({
      regime: sizing.policy.regime,
      maxPositions: sizing.policy.maxPositions,
      currentPositions: sizing.currentPositions,
      remainingSlots: sizing.remainingSlots,
      modePreference: 'SHADOW_FIRST',
    })).toContain("source='PositionStateResolver'");
  });

  it('F. records counterfactual even when PositionState slots are full', () => {
    const decision = resolveSimpleTradeDecision({
      symbol: '005930',
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: false,
      finalScore: 82,
      maxPositions: 3,
      currentPositions: 3,
      remainingSlots: 0,
    });
    const recorded = recordCounterfactualForDecision({
      decision,
      snapshotId: 'slot-full',
      asOf: NOW.toISOString(),
    });

    expect(recorded.sample.sampleType).toBe('SLOT_FULL_COUNTERFACTUAL');
    expect(recorded.sample.outcomeStatus).toBe('PENDING');
    expect(recorded.logs.join('\n')).toContain('[SLOT_FULL_COUNTERFACTUAL_RECORDED]');
  });

  it('G. formats Shadow PositionState OPENED log after paper fill', () => {
    const state: PositionState = {
      positionId: 'trade-1',
      tradingDate: '2026-05-21',
      symbol: '084670',
      name: 'Dongyang Express',
      mode: 'SHADOW',
      status: 'OPEN',
      quantity: 58,
      avgEntryPrice: 46300,
      currentPrice: 46300,
      marketValue: 2_685_400,
      unrealizedPnL: 0,
      unrealizedPnLPct: 0,
      updatedAt: NOW.toISOString(),
      source: 'SHADOW_LEDGER',
      sourceConfidence: 'VERIFIED',
      tradePlanId: 'tp-084670',
      initialStopLoss: 43_985,
      currentStopLoss: 43_985,
      targetPrice1: 50_930,
      riskReward1: 2,
      relatedOrderIds: [],
      relatedSignalIds: [],
    };

    expect(formatPositionStateOpenedLog(state)).toContain('[POSITION_STATE_OPENED]');
    expect(formatPositionStateOpenedLog(state)).toContain("source='SHADOW_LEDGER'");
    expect(formatPositionStateOpenedLog(state)).toContain('tradePlanId=tp-084670');
  });

  it('routes slot calculation log through console for operational visibility', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await calculatePositionSlotsBySsot({
      regime: 'R6_DEFENSE',
      totalEquity: 5_000_000,
      sourceAggregate: aggregate([]),
      now: NOW,
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[POSITION_SLOT_CALCULATED_BY_SSOT]'));
    spy.mockRestore();
  });
});
