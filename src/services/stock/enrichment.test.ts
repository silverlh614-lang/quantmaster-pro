/**
 * enrichment.test.ts — Fix 2 회귀 테스트
 *
 * AI 응답이 토큰 한도로 잘려 targetPrice/stopLoss/entryPrice 가 0 으로 남는
 * 경우에도 현재가 기반 기본값이 자동 채워지는 계약을 고정한다.
 */

import { describe, it, expect } from 'vitest';
import { applyTradingFieldFallbacks } from './enrichment';

describe('applyTradingFieldFallbacks — AI 토큰 절단 보정', () => {
  it('모든 필드가 0 이면 현재가 기반 기본값 주입 (+20% / +35% / 현재가 / -7%)', () => {
    const result = applyTradingFieldFallbacks({
      targetPrice: 0, targetPrice2: 0, entryPrice: 0, stopLoss: 0,
    }, 10_000);
    expect(result.targetPrice).toBe(12_000);   // +20%
    expect(result.targetPrice2).toBe(13_500);  // +35%
    expect(result.entryPrice).toBe(10_000);
    expect(result.stopLoss).toBe(9_300);       // -7%
  });

  it('이미 유효한 targetPrice 는 덮어쓰지 않는다', () => {
    const result = applyTradingFieldFallbacks({
      targetPrice: 15_000, targetPrice2: 0, entryPrice: 0, stopLoss: 0,
    }, 10_000);
    expect(result.targetPrice).toBe(15_000);   // 유지
    expect(result.targetPrice2).toBe(13_500);  // 0 이었으므로 기본값
  });

  it('currentPrice 가 0 이면 원본 그대로 반환 (기본값 계산 불가)', () => {
    const input = { targetPrice: 0, targetPrice2: 0, entryPrice: 0, stopLoss: 0 };
    const result = applyTradingFieldFallbacks(input, 0);
    expect(result).toEqual(input);
  });

  it('undefined 필드도 기본값으로 채움 (optional 프로퍼티 대응)', () => {
    const result = applyTradingFieldFallbacks({} as {
      targetPrice?: number; targetPrice2?: number; entryPrice?: number; stopLoss?: number;
    }, 20_000);
    expect(result.targetPrice).toBe(24_000);
    expect(result.stopLoss).toBe(18_600);
  });

  it('음수 값도 "유효하지 않음" 으로 간주해 기본값 주입', () => {
    const result = applyTradingFieldFallbacks({
      targetPrice: -1, targetPrice2: 0, entryPrice: 0, stopLoss: 0,
    }, 10_000);
    expect(result.targetPrice).toBe(12_000);
  });
});
