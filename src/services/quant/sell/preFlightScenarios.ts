/**
 * sell/preFlightScenarios.ts — Pre-Flight 5가지 시나리오 정의
 *
 * 매수 직전 매도 시뮬레이션에 쓸 SellContext 변형기들.
 */

import type { SellContext, OHLCCandle } from '../../../types/sell';
import type { RegimeLevel, ROEType } from '../../../types/core';

export type PreFlightScenarioId =
  | 'DAILY_CRASH_7'
  | 'ROE_TYPE4_TRANSITION'
  | 'ICHIMOKU_BREAKDOWN'
  | 'FOREIGN_SELLOUT_5D'
  | 'REGIME_R6_SHIFT';

export interface PreFlightScenario {
  id: PreFlightScenarioId;
  description: string;
  transform: (baseCtx: SellContext) => SellContext;
}

/** 구름대 이탈 시나리오용 합성 캔들 (52봉 상승 + 마지막 2봉 급락). */
function simulateCloudBreakdownCandles(entryPrice: number): OHLCCandle[] {
  const candles: OHLCCandle[] = [];
  for (let i = 0; i < 78; i++) {
    const close = entryPrice * (0.7 + (i / 78) * 0.5);
    candles.push({
      date: `sim-${i}`,
      open: close, high: close * 1.01, low: close * 0.99,
      close, volume: 1_000_000,
    });
  }
  const crashPrice = entryPrice * 0.70;
  candles.push(
    { date: 'sim-79', open: crashPrice, high: crashPrice, low: crashPrice * 0.98, close: crashPrice, volume: 1_500_000 },
    { date: 'sim-80', open: crashPrice * 0.98, high: crashPrice * 0.98, low: crashPrice * 0.95, close: crashPrice * 0.96, volume: 2_000_000 },
  );
  return candles;
}

export const PRE_FLIGHT_SCENARIOS: readonly PreFlightScenario[] = [
  {
    id: 'DAILY_CRASH_7',
    description: '이 종목이 내일 -7%면?',
    transform: (ctx) => ({
      ...ctx,
      position: {
        ...ctx.position,
        currentPrice: ctx.position.entryPrice * 0.93,
        highSinceEntry: ctx.position.entryPrice,
      },
      preMortem: { ...ctx.preMortem },
    }),
  },
  {
    id: 'ROE_TYPE4_TRANSITION',
    description: '2주 후 ROE 유형이 4로 전이되면?',
    transform: (ctx) => ({
      ...ctx,
      preMortem: { ...ctx.preMortem, currentROEType: 4 },
      roeTypeHistory: [3, 3, 3, 4] as ROEType[],
    }),
  },
  {
    id: 'ICHIMOKU_BREAKDOWN',
    description: '구름대 하단을 이탈하면?',
    transform: (ctx) => ({
      ...ctx,
      position: { ...ctx.position, currentPrice: ctx.position.entryPrice * 0.75 },
      candles: simulateCloudBreakdownCandles(ctx.position.entryPrice),
    }),
  },
  {
    id: 'FOREIGN_SELLOUT_5D',
    description: '외국인 5일 순매도면?',
    transform: (ctx) => ({
      ...ctx,
      preMortem: { ...ctx.preMortem, foreignNetBuy5d: -500 },
    }),
  },
  {
    id: 'REGIME_R6_SHIFT',
    description: '시장 레짐이 R6 DEFENSE로 전환되면?',
    transform: (ctx) => ({
      ...ctx,
      regime: 'R6_DEFENSE' as RegimeLevel,
      preMortem: { ...ctx.preMortem, currentRegime: 'R6_DEFENSE' as RegimeLevel },
    }),
  },
];
