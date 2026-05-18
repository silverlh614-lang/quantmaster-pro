// @responsibility rollbackR6ShadowForcedExit regression tests for forbidden Shadow R6 forced exits
import { describe, expect, it } from 'vitest';
import { rollbackR6ShadowForcedExitPolicyViolations } from './rollbackR6ShadowForcedExit.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

function makeBadTrade(stockCode: string, stockName: string): ServerShadowTrade {
  return {
    id: `bad-${stockCode}`,
    stockCode,
    stockName,
    signalTime: '2026-05-18T00:00:00.000Z',
    signalPrice: 100_000,
    shadowEntryPrice: 100_000,
    quantity: 0,
    originalQuantity: 1,
    stopLoss: 90_000,
    targetPrice: 120_000,
    status: 'HIT_STOP',
    mode: 'SHADOW',
    exitRuleTag: 'R6_EMERGENCY_EXIT',
    exitTime: '2026-05-18T11:41:00.000Z',
    exitPrice: 100_500,
    fills: [
      {
        id: `buy-${stockCode}`,
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: 1,
        price: 100_000,
        reason: 'shadow buy',
        timestamp: '2026-05-18T00:20:00.000Z',
        status: 'CONFIRMED',
      },
      {
        id: `sell-${stockCode}`,
        type: 'SELL',
        subType: 'EMERGENCY',
        qty: 1,
        price: 100_500,
        reason: 'BLACKSWAN_FORCED_EXIT R6_EMERGENCY_EXIT',
        exitRuleTag: 'R6_EMERGENCY_EXIT',
        timestamp: '2026-05-18T11:41:00.000Z',
        status: 'CONFIRMED',
      },
    ],
  } as ServerShadowTrade;
}

describe('rollbackR6ShadowForcedExitPolicyViolations', () => {
  it('SK텔레콤/파두 Shadow R6 forced-exit SELL fill을 제거하고 ACTIVE로 복원한다', () => {
    const trades = [
      makeBadTrade('017670', 'SK텔레콤'),
      makeBadTrade('454910', '파두'),
    ];

    const result = rollbackR6ShadowForcedExitPolicyViolations({
      trades,
      now: new Date('2026-05-18T12:00:00.000Z'),
      appendLog: false,
    });

    expect(result.restored).toBe(2);
    for (const trade of trades) {
      expect(trade.status).toBe('ACTIVE');
      expect(trade.quantity).toBe(1);
      expect(trade.exitRuleTag).toBeUndefined();
      expect(trade.exitTime).toBeUndefined();
      expect(trade.exitPrice).toBeUndefined();
      expect(trade.rollbackReason).toBe('R6_FORCED_EXIT_SHADOW_POLICY_VIOLATION');
      expect((trade.fills ?? []).filter(fill => fill.type === 'SELL')).toHaveLength(0);
    }
  });
});
