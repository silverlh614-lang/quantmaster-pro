/**
 * @responsibility /at attributionTrace returnPct 표시 fills SSOT fallback 회귀 가드
 *
 * 진단 결과: ServerShadowTrade.returnPct 필드는 updateShadow invariant 보호로
 * (shadowTradeRepo.ts:287-290) 영원히 저장 차단된다. /at 명령 표시는 fills SSOT
 * (PR-15~19 getWeightedPnlPct) 가중평균 fallback 으로 정상화. 본 PR 1/3.
 */

import { describe, it, expect } from 'vitest';
import type { ServerShadowTrade, PositionFill } from '../../../persistence/shadowTradeRepo.js';
import { resolveReturnPctForDisplay } from './attributionTrace.cmd.js';

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'TT1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: '2026-04-30T00:00:00.000Z',
    signalPrice: 100,
    shadowEntryPrice: 100,
    quantity: 0,
    originalQuantity: 100,
    stopLoss: 90,
    targetPrice: 120,
    status: 'HIT_STOP',
    fills: [],
    ...overrides,
  } as ServerShadowTrade;
}

function makeSellFill(qty: number, pnlPct: number): PositionFill {
  return {
    id: `f-${qty}`,
    type: 'SELL',
    subType: 'STOP_LOSS',
    qty,
    price: 95,
    pnl: -500,
    pnlPct,
    timestamp: '2026-04-30T05:00:00.000Z',
    reason: 'test',
    status: 'CONFIRMED',
  } as PositionFill;
}

describe('/at resolveReturnPctForDisplay (결함 A 1차 수리)', () => {
  it('레거시 trade.returnPct 가 정상 값이면 그대로 사용 (후방호환)', () => {
    const t = makeTrade({ returnPct: -3.45, fills: [] });
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(-3.45, 2);
  });

  it('returnPct 부재 + fills 보유 시 가중평균 (fills SSOT fallback)', () => {
    const t = makeTrade({
      fills: [
        { id: 'b1', type: 'BUY', qty: 100, price: 100, timestamp: '...', reason: '진입', status: 'CONFIRMED' } as PositionFill,
        makeSellFill(50, -2.0),
        makeSellFill(50, -4.0),
      ],
    });
    // 가중평균: (-2 × 50 + -4 × 50) / 100 = -3.0
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(-3.0, 2);
  });

  it('returnPct 부재 + fills 부재 → undefined (N/A 표시)', () => {
    const t = makeTrade({ fills: [] });
    expect(resolveReturnPctForDisplay(t)).toBeUndefined();
  });

  it('returnPct=NaN/Infinity → fills fallback', () => {
    const t = makeTrade({
      returnPct: NaN,
      fills: [
        { id: 'b1', type: 'BUY', qty: 100, price: 100, timestamp: '...', reason: 'b', status: 'CONFIRMED' } as PositionFill,
        makeSellFill(100, +5.0),
      ],
    });
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(5.0, 2);
  });

  it('returnPct=0 + fills 가중평균 0 → undefined (formatPctSigned 가 N/A 표시 회피)', () => {
    const t = makeTrade({ fills: [] });
    expect(resolveReturnPctForDisplay(t)).toBeUndefined();
  });

  it('returnPct 부재 + 부분매도 가중평균 (PR-15~19 fills SSOT 정합)', () => {
    const t = makeTrade({
      fills: [
        { id: 'b1', type: 'BUY', qty: 100, price: 100, timestamp: '...', reason: 'b', status: 'CONFIRMED' } as PositionFill,
        makeSellFill(30, +10.0), // 트랜치 1: 30주, +10%
        makeSellFill(70, -2.0),  // 잔여 70주, -2%
      ],
    });
    // 가중평균: (10 × 30 + -2 × 70) / 100 = (300 - 140) / 100 = 1.6
    expect(resolveReturnPctForDisplay(t)).toBeCloseTo(1.6, 2);
  });
});
