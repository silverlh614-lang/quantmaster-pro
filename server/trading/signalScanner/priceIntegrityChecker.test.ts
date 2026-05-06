/**
 * @responsibility ADR-0414 PriceIntegrityChecker 회귀 테스트 (≥8 케이스)
 *
 * 작업 지침서 §10 1~8 — 종목별 분류 결정 트리 SSOT 검증.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePriceIntegrity,
  PRICE_INTEGRITY_THRESHOLDS,
  type PriceIntegrityInput,
} from './priceIntegrityChecker.js';

const baseInput = (override: Partial<PriceIntegrityInput> = {}): PriceIntegrityInput => ({
  symbol: '005930',
  currentPrice: 50000,
  currentPriceDate: '2026-05-06',
  previousClose: 49500,
  previousCloseDate: '2026-05-04', // 5/5 어린이날 휴장 → T-1 캘린더 거리 2 (영업일 1)
  lastKrxTradingDate: '2026-05-06',
  ...override,
});

describe('ADR-0414 §1 PriceIntegrityChecker — 결정 트리', () => {
  it('테스트 1: 정상 T/T-1 + gap 정상 → OK', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06', // 동일 일자 → date 거리 0 (T/T-1 관계 안전)
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('OK');
    expect(result.gapPct).toBeCloseTo(((50000 - 49500) / 49500) * 100, 4);
    expect(result.dateAlignment).toBe('MATCH');
    expect(result.daysFromLastTradingDay).toBe(0);
  });

  it('테스트 2: currentPriceDate=T, previousCloseDate=T-3 + 큰 gap → PRICE_BASE_MISMATCH', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 35000, // 28% gap
      previousCloseDate: '2026-05-03', // T-3 (캘린더 거리 3)
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('PRICE_BASE_MISMATCH');
    expect(result.reasons.some((r) => r.includes('PRICE_BASE_MISMATCH'))).toBe(true);
  });

  it('테스트 3: currentPriceDate=T-2 → STALE', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-04', // T-2 (캘린더 거리 -2 from T)
      previousClose: 49500,
      previousCloseDate: '2026-05-03',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('STALE');
    expect(result.daysFromLastTradingDay).toBe(-2);
    expect(result.dateAlignment).toBe('T_MINUS_2');
  });

  it('테스트 4: currentPrice === previousClose → FROZEN_QUOTE', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 50000, // 동일
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('FROZEN_QUOTE');
    expect(result.gapPct).toBeCloseTo(0, 4);
  });

  it('테스트 5: |gapPct|=8% → SUSPECT', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 53460, // 49500 × 1.08 = 53460 → gap=+8%
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('SUSPECT');
    expect(Math.abs(result.gapPct as number)).toBeCloseTo(8, 1);
  });

  it('테스트 6: |gapPct|=18% → REVERSE_GAP_SUSPECT', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 58410, // 49500 × 1.18 = 58410 → gap=+18%
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('REVERSE_GAP_SUSPECT');
    expect(Math.abs(result.gapPct as number)).toBeCloseTo(18, 1);
  });

  it('테스트 7: |gapPct|=28% + date mismatch → PRICE_BASE_MISMATCH', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 63360, // 49500 × 1.28
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-03', // 거리 3일
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('PRICE_BASE_MISMATCH');
  });

  it('테스트 8: comparable 부족 → SUSPECT (FAILED 금지)', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
      comparableQuoteCount: 5, // < MIN_COMPARABLE=10
    });
    expect(result.status).toBe('SUSPECT');
    // FAILED 금지 단언 — 장 전 frozen 만으로 FAILED 처리 금지 (사용자 명시)
    expect(result.status).not.toBe('FAILED');
    expect(result.reasons.some((r) => r.includes('FAILED 금지'))).toBe(true);
  });

  it('보너스 1: currentPrice/previousClose 모두 부재 → FAILED', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: null,
      previousClose: null,
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('FAILED');
    expect(result.gapPct).toBeNull();
  });

  it('보너스 2: currentPrice 만 부재 → SUSPECT (FAILED 격하)', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: null,
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('SUSPECT');
  });

  it('보너스 3: currentPrice ≤ 0 → SUSPECT (sanity 보호)', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 0,
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('SUSPECT');
  });

  it('보너스 4: NaN currentPrice → SUSPECT (sanity 보호)', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: NaN,
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: '2026-05-06',
    });
    expect(result.status).toBe('SUSPECT');
  });

  it('보너스 5: lastKrxTradingDate 부재 → STALE 분기 미평가, 다른 분기 통과', () => {
    const result = evaluatePriceIntegrity({
      symbol: '005930',
      currentPrice: 50000,
      currentPriceDate: '2026-05-06',
      previousClose: 49500,
      previousCloseDate: '2026-05-06',
      lastKrxTradingDate: null,
    });
    // STALE 분기 미평가 → OK 분기 도달
    expect(result.status).toBe('OK');
    expect(result.dateAlignment).toBe('UNKNOWN');
    expect(result.daysFromLastTradingDay).toBeNull();
  });

  it('보너스 6: 임계값 SSOT 정합 — EPSILON_PCT/STALE_DAYS/SUSPECT_GAP_PCT/REVERSE_GAP_PCT/MISMATCH_GAP_PCT/MIN_COMPARABLE', () => {
    expect(PRICE_INTEGRITY_THRESHOLDS.EPSILON_PCT).toBe(0.0001);
    expect(PRICE_INTEGRITY_THRESHOLDS.STALE_DAYS).toBe(2);
    expect(PRICE_INTEGRITY_THRESHOLDS.SUSPECT_GAP_PCT).toBe(7);
    expect(PRICE_INTEGRITY_THRESHOLDS.REVERSE_GAP_PCT).toBe(15);
    expect(PRICE_INTEGRITY_THRESHOLDS.MISMATCH_GAP_PCT).toBe(25);
    expect(PRICE_INTEGRITY_THRESHOLDS.MIN_COMPARABLE).toBe(10);
  });

  it('보너스 7: input 객체 mutate 0건 (절대 원칙 #1)', () => {
    const input = baseInput();
    const before = JSON.stringify(input);
    evaluatePriceIntegrity(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
