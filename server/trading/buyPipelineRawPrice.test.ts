// @responsibility ADR-0116 buildBuyTrade entryPriceRaw 영속 회귀 가드
import { describe, expect, it } from 'vitest';
import { buildBuyTrade } from './buyPipeline.js';
import type { StopLossPlan } from './entryEngine.js';

const MOCK_STOP_PLAN: StopLossPlan = {
  hardStopLoss: 9300,
  initialStopLoss: 9300,
  regimeStopLoss: 9300,
  dynamicStopLoss: 9300,
};

describe('buildBuyTrade — ADR-0116 entryPriceRaw 영속', () => {
  it('entryPriceRaw = shadowEntryPrice (RAW 불변 원장)', () => {
    const trade = buildBuyTrade({
      idPrefix: 'TEST',
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 10000,
      shadowEntryPrice: 10000,
      quantity: 5,
      stopLossPlan: MOCK_STOP_PLAN,
      targetPrice: 11500,
      shadowMode: true,
      regime: 'R2_BULL',
      profileType: 'B',
      watchlistSource: 'PRE_BREAKOUT',
      profitTranches: [],
      trailPct: 0.10,
      entryATR14: 200,
    });
    expect(trade.entryPriceRaw).toBe(10000);
    expect(trade.entryPriceRaw).toBe(trade.shadowEntryPrice);
  });

  it('cumulativeAdjustmentFactor = 1.0 default', () => {
    const trade = buildBuyTrade({
      idPrefix: 'TEST',
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 10000,
      shadowEntryPrice: 10000,
      quantity: 5,
      stopLossPlan: MOCK_STOP_PLAN,
      targetPrice: 11500,
      shadowMode: true,
      regime: 'R2_BULL',
      profileType: 'B',
      watchlistSource: 'PRE_BREAKOUT',
      profitTranches: [],
      trailPct: 0.10,
      entryATR14: 200,
    });
    expect(trade.cumulativeAdjustmentFactor).toBe(1.0);
  });

  it('shadowEntryPrice 가 currentPrice 와 다른 경우 (catalyst) → entryPriceRaw = shadowEntryPrice', () => {
    // CATALYST: shadowEntryPrice = catalyst 진입가 ≠ currentPrice.
    // RAW 는 *진입* 시점 가격이라 shadowEntryPrice 우선.
    const trade = buildBuyTrade({
      idPrefix: 'TEST',
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 10500,
      shadowEntryPrice: 10000,
      quantity: 5,
      stopLossPlan: MOCK_STOP_PLAN,
      targetPrice: 11500,
      shadowMode: true,
      regime: 'R2_BULL',
      profileType: 'D',
      watchlistSource: 'PRE_BREAKOUT',
      profitTranches: [],
      trailPct: 0.10,
      entryATR14: 200,
    });
    expect(trade.entryPriceRaw).toBe(10000); // shadowEntryPrice 우선 (RAW = 의도 진입가)
    expect(trade.signalPrice).toBe(10500); // signalPrice 는 currentPrice 그대로 (시그널 발생 시점)
  });

  it('회귀 가드 — 기존 호출자 무수정 (signalTime/quantity/stopLoss/targetPrice 보존)', () => {
    const trade = buildBuyTrade({
      idPrefix: 'TEST',
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 10000,
      shadowEntryPrice: 10000,
      quantity: 5,
      stopLossPlan: MOCK_STOP_PLAN,
      targetPrice: 11500,
      shadowMode: true,
      regime: 'R2_BULL',
      profileType: 'B',
      watchlistSource: 'PRE_BREAKOUT',
      profitTranches: [],
      trailPct: 0.10,
      entryATR14: 200,
    });
    expect(trade.quantity).toBe(5);
    expect(trade.targetPrice).toBe(11500);
    expect(trade.stopLoss).toBe(9300);
    expect(trade.status).toBe('PENDING');
    expect(trade.mode).toBe('SHADOW');
    // 신규 옵셔널 필드 추가만, 기존 필드 보존
    expect(trade.signalPrice).toBe(10000);
    expect(trade.shadowEntryPrice).toBe(10000);
  });
});
