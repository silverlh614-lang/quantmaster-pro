/**
 * executionCosts.test.ts — Phase 2-⑥ 회귀 테스트.
 * 거래 비용 회계의 수학적 불변식을 고정한다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  computeNetPnL,
  computeRoundTripCostPct,
  inferMarketFromSymbol,
  applyRoundTripCostToPct,
  setExecutionCostOverride,
  resetExecutionCostOverride,
  getExecutionCostConfig,
} from './executionCosts.js';

describe('executionCosts — 기본 상수 불변식', () => {
  afterEach(() => resetExecutionCostOverride());

  it('KOSPI 왕복 순비용 = 수수료(0.03%) + 거래세(0.18%) + 농특세(0.15%) + 슬리피지(0.6%) ≈ 0.96%', () => {
    const pct = computeRoundTripCostPct('KOSPI', true);
    expect(pct).toBeCloseTo(0.96, 2);
  });

  it('KOSDAQ 왕복 순비용 ≈ 0.83% (농특세 없음)', () => {
    const pct = computeRoundTripCostPct('KOSDAQ', true);
    expect(pct).toBeCloseTo(0.83, 2);
  });

  it('슬리피지 제외 KOSPI 왕복 ≈ 0.36%', () => {
    const pct = computeRoundTripCostPct('KOSPI', false);
    expect(pct).toBeCloseTo(0.36, 2);
  });
});

describe('computeNetPnL — P&L 분해', () => {
  afterEach(() => resetExecutionCostOverride());

  it('손익 분해가 산술적으로 일관 — gross - totalCost === net', () => {
    const r = computeNetPnL({ entryPrice: 50_000, exitPrice: 55_000, quantity: 100, market: 'KOSPI' });
    expect(r.gross).toBeCloseTo(500_000, 2);
    const sumCosts = r.buyFee + r.sellFee + r.transferTax + r.ruralTax + r.slippageIn + r.slippageOut;
    expect(sumCosts).toBeCloseTo(r.totalCost, 2);
    expect(r.gross - r.totalCost).toBeCloseTo(r.net, 2);
  });

  it('gross +10% → net ≈ +8.9% (KOSPI, slippage 포함)', () => {
    // (exit - entry)/entry = 10% → 왕복 비용 ≈ 1% 차감 후 ≈ 9%
    const r = computeNetPnL({ entryPrice: 10_000, exitPrice: 11_000, quantity: 100, market: 'KOSPI' });
    expect(r.netPct).toBeGreaterThan(8.8);
    expect(r.netPct).toBeLessThan(9.1);
  });

  it('KOSDAQ 는 KOSPI 대비 같은 조건에서 net 이 더 높음 (세금 낮음)', () => {
    const kospi = computeNetPnL({ entryPrice: 10_000, exitPrice: 11_000, quantity: 100, market: 'KOSPI' });
    const kosdaq = computeNetPnL({ entryPrice: 10_000, exitPrice: 11_000, quantity: 100, market: 'KOSDAQ' });
    expect(kosdaq.net).toBeGreaterThan(kospi.net);
    expect(kosdaq.ruralTax).toBe(0);
  });

  it('qty=0 → 모든 값 0, netPct=0', () => {
    const r = computeNetPnL({ entryPrice: 10_000, exitPrice: 11_000, quantity: 0 });
    expect(r.gross).toBe(0);
    expect(r.net).toBe(0);
    expect(r.netPct).toBe(0);
  });

  it('entry 와 exit 같고 qty>0 → net < 0 (비용만큼 손실)', () => {
    const r = computeNetPnL({ entryPrice: 10_000, exitPrice: 10_000, quantity: 100, market: 'KOSPI' });
    expect(r.gross).toBe(0);
    expect(r.net).toBeLessThan(0);
    expect(r.netPct).toBeLessThan(0);
  });

  it('includeSlippage=false → 슬리피지 성분 0', () => {
    const r = computeNetPnL({ entryPrice: 10_000, exitPrice: 11_000, quantity: 100, includeSlippage: false });
    expect(r.slippageIn).toBe(0);
    expect(r.slippageOut).toBe(0);
  });
});

describe('override / inferMarket / applyRoundTripCostToPct', () => {
  afterEach(() => resetExecutionCostOverride());

  it('override 주입 시 기본값보다 높은 슬리피지 적용', () => {
    setExecutionCostOverride({ slippageRate: 0.01 });
    const cfg = getExecutionCostConfig();
    expect(cfg.slippageRate).toBe(0.01);
    // 왕복 비용이 올라가야 함
    const pct = computeRoundTripCostPct('KOSPI', true);
    expect(pct).toBeGreaterThan(1.5);
  });

  it('inferMarketFromSymbol — .KQ → KOSDAQ, 그 외 → KOSPI', () => {
    expect(inferMarketFromSymbol('005930.KS')).toBe('KOSPI');
    expect(inferMarketFromSymbol('035420.KQ')).toBe('KOSDAQ');
    expect(inferMarketFromSymbol(undefined)).toBe('KOSPI');
    expect(inferMarketFromSymbol('')).toBe('KOSPI');
  });

  it('applyRoundTripCostToPct — gross 수익률에서 왕복 비용을 즉시 차감', () => {
    const kospi = applyRoundTripCostToPct(10, 'KOSPI', true);
    const kosdaq = applyRoundTripCostToPct(10, 'KOSDAQ', true);
    expect(kospi).toBeCloseTo(10 - 0.96, 2);
    expect(kosdaq).toBeCloseTo(10 - 0.83, 2);
    expect(kosdaq).toBeGreaterThan(kospi);
  });
});
