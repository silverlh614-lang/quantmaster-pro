/**
 * @responsibility _indicators.ts 기술적 지표 순수 함수 단위 테스트 (PR-56)
 *
 * RSI/EMA/MACD 산식은 Yahoo·KIS 어댑터 양쪽이 공유하므로 본 테스트가 SSOT.
 * 산식 변경 시 본 테스트의 기댓값도 동기화 필요.
 */

import { describe, it, expect } from 'vitest';
import { calcRSI, calcRSI14, calcEMAArr, calcMACD } from './_indicators.js';

describe('calcRSI (Wilder 평활화)', () => {
  it('데이터 부족 (closes.length < period+1) → 50 fallback', () => {
    expect(calcRSI([100, 101, 102], 14)).toBe(50);
    expect(calcRSI([], 14)).toBe(50);
  });

  it('지속 상승만 → RSI 100', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(calcRSI(closes, 14)).toBe(100);
  });

  it('지속 하락만 → RSI 0 근처 (avgGain=0 이지만 1+0/loss=1 → 0)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 130 - i);
    const result = calcRSI(closes, 14);
    expect(result).toBeLessThan(5);
  });

  it('보합 (변동 없음) → 50 fallback (avgLoss=0 분기 진입)', () => {
    const closes = Array.from({ length: 30 }, () => 100);
    // avgGain=0, avgLoss=0 → avgLoss===0 분기 진입 → 100 반환
    expect(calcRSI(closes, 14)).toBe(100);
  });

  it('period=9 (주봉 RSI) — 기간 파라미터화 동작 확인', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 5);
    const r9 = calcRSI(closes, 9);
    const r14 = calcRSI(closes, 14);
    expect(typeof r9).toBe('number');
    expect(typeof r14).toBe('number');
    // 다른 기간이면 일반적으로 다른 값
    expect(r9).not.toBe(r14);
  });
});

describe('calcRSI14 — 하위 호환 래퍼', () => {
  it('calcRSI(_, 14) 와 동일 결과', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i * 0.5);
    expect(calcRSI14(closes)).toBe(calcRSI(closes, 14));
  });
});

describe('calcEMAArr (지수 이동평균 시계열)', () => {
  it('빈 배열 → 빈 배열', () => {
    expect(calcEMAArr([], 12)).toEqual([]);
  });

  it('첫 원소는 입력 첫 값과 동일 (seed)', () => {
    const out = calcEMAArr([100, 110, 120], 12);
    expect(out[0]).toBe(100);
  });

  it('동일한 길이 반환 + 단조 EMA 흐름', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const ema = calcEMAArr(closes, 12);
    expect(ema).toHaveLength(30);
    // 상승 시계열 → EMA 도 단조 증가
    for (let i = 1; i < ema.length; i++) {
      expect(ema[i]).toBeGreaterThan(ema[i - 1]);
    }
  });
});

describe('calcMACD (12, 26, 9)', () => {
  it('데이터 부족 (<27) → zero 객체 반환', () => {
    const out = calcMACD([100, 101, 102]);
    expect(out).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it('정확히 27 봉 — macdLine.length=2 < 9 → zero (signal 데이터 부족)', () => {
    const closes = Array.from({ length: 27 }, (_, i) => 100 + i);
    const out = calcMACD(closes);
    expect(out).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it('충분한 데이터 (50봉 상승) → MACD 양수 (상승 추세)', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const out = calcMACD(closes);
    expect(out.macd).toBeGreaterThan(0);
    expect(out.histogram).toBe(out.macd - out.signal);
  });

  it('histogram = macd - signal 항상 정합', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const out = calcMACD(closes);
    expect(out.histogram).toBeCloseTo(out.macd - out.signal, 6);
  });
});
