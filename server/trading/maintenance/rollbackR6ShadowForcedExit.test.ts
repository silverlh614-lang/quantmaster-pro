// @responsibility rollbackR6ShadowForcedExit regression tests for forbidden Shadow R6 forced exits
import { describe, expect, it } from 'vitest';
import {
  quarantineR6ShadowForcedExitLearningSamples,
  rollbackR6ShadowForcedExitPolicyViolations,
} from './rollbackR6ShadowForcedExit.js';
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

  it('복원 없이 Shadow R6 forced-exit 샘플만 학습 격리한다', () => {
    const trades = [makeBadTrade('017670', 'SK텔레콤')];
    const attributionRecords = [
      {
        schemaVersion: 2,
        tradeId: 'bad-017670',
        stockCode: '017670',
        stockName: 'SK텔레콤',
        closedAt: '2026-05-18T11:41:00.000Z',
        returnPct: -1,
        isWin: false,
        conditionScores: { 1: 7 },
        holdingDays: 0,
      },
      {
        schemaVersion: 2,
        tradeId: 'keep-1',
        stockCode: '005930',
        stockName: '삼성전자',
        closedAt: '2026-05-18T11:41:00.000Z',
        returnPct: 1,
        isWin: true,
        conditionScores: { 1: 8 },
        holdingDays: 0,
      },
    ];

    const result = quarantineR6ShadowForcedExitLearningSamples({
      trades,
      attributionRecords,
      now: new Date('2026-05-18T12:00:00.000Z'),
      appendLog: false,
    });

    expect(result).toMatchObject({
      quarantined: 1,
      attributionRecordsRemoved: 1,
      tradeIds: ['bad-017670'],
    });
    expect(trades[0]?.status).toBe('HIT_STOP');
    expect(trades[0]?.quantity).toBe(0);
    expect(trades[0]?.incidentFlag).toBe('R6_FORCED_EXIT_SHADOW_POLICY_VIOLATION');
    expect(trades[0]?.manualReviewReason).toBe('SHADOW_R6_FORCED_EXIT_FILL_SUSPECTED');
    expect(attributionRecords).toHaveLength(1);
    expect(attributionRecords[0]?.tradeId).toBe('keep-1');
  });
});
