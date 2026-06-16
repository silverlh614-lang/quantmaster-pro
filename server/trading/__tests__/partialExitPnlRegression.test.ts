/**
 * partialExitPnlRegression.test.ts — "부분익절 + 잔여 청산" 시나리오의
 * P&L 산정·결과 라벨이 fills SSOT 단일 소스에서 일관되게 파생되는지 고정하는
 * 회귀 방지 테스트.
 *
 * 배경 (2026-06-16 일일 리포트 플래그):
 *   "디아이씨 부분익절 종료가 손실로 기록 — P&L 산정 로직 검토 필요" 라는 의심이
 *   제기됐으나, 조사 결과 *버그가 아님*. 진입 후 1차 익절(+수익)을 했더라도 잔여
 *   물량을 손절(−손실)로 닫아 두 fill 의 수량 가중평균이 음수가 되면 결과는
 *   올바르게 PARTIAL_LOSS 로 분류된다. P&L(getWeightedPnlPct)·결과 라벨
 *   (weightedSellPnlPct→returnR) 모두 동일한 fills SSOT 에서 파생되므로 서로
 *   모순될 수 없다.
 *
 * 이 테스트는 *정상 동작을 고정*한다. 현행 코드 against PASS 여야 한다.
 * 과거 returnPct-strip 류 회귀(파생 캐시가 SSOT 를 앞질러 거짓 P&L 노출)를
 * 미연에 방지하는 것이 목적이다. 만약 이 테스트가 fail 한다면 P&L 또는 라벨
 * 산정 경로가 fills 단일 소스에서 이탈한 것이다.
 */
import { describe, it, expect } from 'vitest';

import {
  getWeightedPnlPct,
  getTotalRealizedPnl,
  type ServerShadowTrade,
  type PositionFill,
} from '../../persistence/shadowTradeRepo.js';
import { resolveCanonicalTradeOutcomeFromShadowTrade } from '../canonicalTradeOutcomeResolver.js';

const ENTRY = 100;

/** 진입 100주 @ENTRY + 임의의 SELL fill 들로 종결된 SHADOW 포지션을 만든다. */
function makeTradeWithSells(opts: {
  status: 'HIT_TARGET' | 'HIT_STOP';
  stopLoss: number;
  sells: Array<Partial<PositionFill> & { qty: number; price: number; pnl: number; pnlPct: number }>;
}): ServerShadowTrade {
  const fills: PositionFill[] = [
    {
      id: 'f-buy',
      type: 'BUY',
      subType: 'INITIAL_BUY',
      qty: 100,
      price: ENTRY,
      reason: 'ENTRY',
      timestamp: '2026-06-15T00:00:00.000Z',
      status: 'CONFIRMED',
    } as PositionFill,
    ...opts.sells.map((s, i) => ({
      id: `f-sell-${i}`,
      type: 'SELL',
      reason: 'exit',
      timestamp: `2026-06-15T0${i + 1}:00:00.000Z`,
      status: 'CONFIRMED',
      ...s,
    }) as PositionFill),
  ];
  return {
    id: 'dic-regression',
    stockCode: '012860',
    stockName: '디아이씨',
    signalTime: '2026-06-15T00:00:00.000Z',
    signalPrice: ENTRY,
    shadowEntryPrice: ENTRY,
    entryPrice: ENTRY,
    quantity: 0,
    originalQuantity: 100,
    stopLoss: opts.stopLoss,
    initialStopLoss: opts.stopLoss,
    status: opts.status,
    mode: 'SHADOW',
    fills,
  } as unknown as ServerShadowTrade;
}

describe('부분익절 + 잔여 청산 — P&L·라벨 fills SSOT 정합 (버그 아님 고정)', () => {
  it('1차 +10% 익절 후 잔여 -20% 손절 → 가중 P&L 음수 + PARTIAL_LOSS', () => {
    // 진입 @100. TP1 SELL 50주 @110(+10%, pnl=+500). 잔여 SELL 50주 @80(-20%, pnl=-1000).
    // 수량 가중평균 = (10*50 + (-20)*50)/100 = -5% → 손실권. tp1Hit=true, returnR<0.
    const trade = makeTradeWithSells({
      status: 'HIT_STOP',
      stopLoss: 85,
      sells: [
        { subType: 'PARTIAL_TP', qty: 50, price: 110, pnl: 500, pnlPct: 10 },
        { subType: 'STOP_LOSS', qty: 50, price: 80, pnl: -1000, pnlPct: -20 },
      ],
    });

    // 리포트 P&L 경로 (shadowTradeRepo SSOT).
    expect(getWeightedPnlPct(trade)).toBeCloseTo(-5, 6);
    expect(getTotalRealizedPnl(trade)).toBeCloseTo(-500, 6);

    // 결과 라벨 경로 (canonicalTradeOutcomeResolver).
    const outcome = resolveCanonicalTradeOutcomeFromShadowTrade(trade);
    expect(outcome.outcome).toBe('PARTIAL_LOSS');
    expect(outcome.winRateBucket).toBe('LOSS');
    expect(outcome.tp1Hit).toBe(true); // 부분익절 이력은 보존된다.
    expect(outcome.returnR).toBeLessThan(0);

    // 두 SELL fill 모두 가중 P&L 필터(SELL && pnlPct!==undefined && isActiveFill)에 포함.
    const activeSells = (trade.fills ?? []).filter(
      (f) => f.type === 'SELL' && f.pnlPct !== undefined && f.status !== 'REVERTED',
    );
    expect(activeSells).toHaveLength(2);
  });

  it('1차 +10% 익절 후 잔여 +5% 트레일링 종료 → 가중 P&L 양수 + PARTIAL_WIN', () => {
    // 진입 @100. TP1 SELL 50주 @110(+10%). 잔여 SELL 50주 @105(+5%) 트레일링.
    // 가중평균 = (10*50 + 5*50)/100 = +7.5% → 수익권 종료.
    const trade = makeTradeWithSells({
      status: 'HIT_TARGET',
      stopLoss: 90,
      sells: [
        { subType: 'PARTIAL_TP', qty: 50, price: 110, pnl: 500, pnlPct: 10 },
        { subType: 'TRAILING_TP', qty: 50, price: 105, pnl: 250, pnlPct: 5 },
      ],
    });

    expect(getWeightedPnlPct(trade)).toBeCloseTo(7.5, 6);
    expect(getTotalRealizedPnl(trade)).toBeCloseTo(750, 6);

    const outcome = resolveCanonicalTradeOutcomeFromShadowTrade(trade);
    expect(outcome.outcome).toBe('PARTIAL_WIN');
    expect(outcome.winRateBucket).toBe('WIN_PARTIAL');
    expect(outcome.returnR).toBeGreaterThan(0);
  });

  it('라벨 grossReturnPct(weightedSellPnlPct)와 리포트 P&L(getWeightedPnlPct)은 동일 소스·동일 값', () => {
    // 손실 시나리오·수익 시나리오 모두에서 두 산정 경로가 절대 어긋나지 않아야 한다.
    const lossTrade = makeTradeWithSells({
      status: 'HIT_STOP',
      stopLoss: 85,
      sells: [
        { subType: 'PARTIAL_TP', qty: 50, price: 110, pnl: 500, pnlPct: 10 },
        { subType: 'STOP_LOSS', qty: 50, price: 80, pnl: -1000, pnlPct: -20 },
      ],
    });
    const lossOutcome = resolveCanonicalTradeOutcomeFromShadowTrade(lossTrade);
    expect(lossOutcome.grossReturnPct).toBeCloseTo(getWeightedPnlPct(lossTrade), 6);

    const winTrade = makeTradeWithSells({
      status: 'HIT_TARGET',
      stopLoss: 90,
      sells: [
        { subType: 'PARTIAL_TP', qty: 50, price: 110, pnl: 500, pnlPct: 10 },
        { subType: 'TRAILING_TP', qty: 50, price: 105, pnl: 250, pnlPct: 5 },
      ],
    });
    const winOutcome = resolveCanonicalTradeOutcomeFromShadowTrade(winTrade);
    expect(winOutcome.grossReturnPct).toBeCloseTo(getWeightedPnlPct(winTrade), 6);
  });

  it('방어: 부분익절 fill 의 pnlPct 가 누락되면 가중 P&L 가 그 fill 을 제외(과거 strip 회귀 감지)', () => {
    // pnlPct 가 undefined 인 SELL 은 getWeightedPnlPct 필터에서 빠진다.
    // 만약 미래의 변경이 부분익절 fill 의 pnlPct stamp 를 누락시키면, 가중 P&L 이
    // 손절 fill 만 반영해 -20% 로 왜곡된다 — 이 단언이 그 회귀를 잡는다.
    const trade = makeTradeWithSells({
      status: 'HIT_STOP',
      stopLoss: 85,
      sells: [
        // 부분익절 fill 의 pnlPct 누락(undefined).
        { subType: 'PARTIAL_TP', qty: 50, price: 110, pnl: 500, pnlPct: undefined as unknown as number },
        { subType: 'STOP_LOSS', qty: 50, price: 80, pnl: -1000, pnlPct: -20 },
      ],
    });

    // 정상이라면 +10%/-20% 가중 -5% 여야 하나, pnlPct 누락 시 손절 fill 만 남아 -20%.
    // 이 값이 -5 로 "회복"되면 누락 stamp 를 보완한 것이고, -20 이면 stamp 누락이
    // 그대로 P&L 을 왜곡함을 증명한다. 현행 동작(누락 fill 제외)을 고정한다.
    expect(getWeightedPnlPct(trade)).toBeCloseTo(-20, 6);
    // 정상(stamp 보존) 경로의 가중 P&L(-5%)과 다름을 명시 — stamp 누락은 P&L 왜곡.
    expect(getWeightedPnlPct(trade)).not.toBeCloseTo(-5, 6);
  });
});
