// @responsibility R6 counterfactual active Shadow position quarantine regression tests.

import { describe, expect, it } from 'vitest';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import {
  R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON,
  quarantineR6CounterfactualActivePositions,
} from './quarantineR6CounterfactualPositions.js';

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'r6cf-005930',
    stockCode: '005930',
    stockName: 'Samsung',
    signalTime: '2026-05-18T03:05:00.000Z',
    signalPrice: 50_000,
    shadowEntryPrice: 50_000,
    quantity: 10,
    originalQuantity: 10,
    stopLoss: 46_500,
    targetPrice: 57_000,
    status: 'ACTIVE',
    mode: 'SHADOW',
    entryType: 'R6_COUNTERFACTUAL_BUY',
    entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
    riskUnit: 'R6_COUNTERFACTUAL',
    executionImpact: 'NONE',
    liveOrderSent: false,
    fills: [
      {
        id: 'buy-1',
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: 10,
        price: 50_000,
        reason: 'R6_COUNTERFACTUAL_RECOVERY_TEST (SHADOW/PAPER, not a live order)',
        timestamp: '2026-05-18T03:05:00.000Z',
        status: 'CONFIRMED',
      },
    ],
    ...overrides,
  } as ServerShadowTrade;
}

describe('quarantineR6CounterfactualActivePositions', () => {
  it('moves wrongly opened R6 counterfactual positions out of ACTIVE holdings without recording a sell', () => {
    const trades = [makeTrade()];

    const result = quarantineR6CounterfactualActivePositions({
      trades,
      appendLog: false,
      now: new Date('2026-05-19T01:00:00.000Z'),
    });

    expect(result).toMatchObject({
      dryRun: false,
      checked: 1,
      quarantined: 1,
    });
    expect(trades[0]).toMatchObject({
      quantity: 0,
      status: 'REJECTED',
      incidentFlag: R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON,
      rollbackReason: R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON,
      manualReviewReason: R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON,
      liveOrderSent: false,
      executionImpact: 'NONE',
    });
    expect(trades[0]?.fills?.filter(fill => fill.type === 'SELL')).toHaveLength(0);
    expect(trades[0]?.fills?.[0]).toMatchObject({
      type: 'BUY',
      status: 'REVERTED',
      revertReason: R6_COUNTERFACTUAL_POSITION_QUARANTINE_REASON,
    });
  });

  it('dry-run reports candidates without mutating holdings', () => {
    const trades = [makeTrade()];

    const result = quarantineR6CounterfactualActivePositions({
      trades,
      dryRun: true,
      appendLog: false,
    });

    expect(result.quarantined).toBe(1);
    expect(trades[0]?.status).toBe('ACTIVE');
    expect(trades[0]?.quantity).toBe(10);
    expect(trades[0]?.fills?.[0]?.status).toBe('CONFIRMED');
  });

  it('does not touch normal Shadow positions or already closed counterfactual samples', () => {
    const normal = makeTrade({
      id: 'normal-1',
      entryType: 'SHADOW_BUY_SIGNAL',
      entryReason: 'NORMAL_SHADOW_BUY',
      riskUnit: 'NORMAL',
    });
    const closed = makeTrade({
      id: 'closed-1',
      status: 'HIT_STOP',
      quantity: 0,
    });
    const trades = [normal, closed];

    const result = quarantineR6CounterfactualActivePositions({
      trades,
      appendLog: false,
    });

    expect(result.quarantined).toBe(0);
    expect(normal.status).toBe('ACTIVE');
    expect(closed.status).toBe('HIT_STOP');
  });
});
