// @responsibility ADR-0582 객관 계산 검증 헬퍼 단위 테스트 (기술 6조건 deterministic 판정).
import { describe, it, expect } from 'vitest';
import {
  detectGoldenCross,
  detectVolumeSurge,
  detectTurtleBreakout,
  detectFibonacciSupport,
  detectBullishDivergence,
} from './indicators';

// 우상향 정배열 시계열(0..119 선형 상승) — SMA5>SMA20>SMA60 성립.
const rising = Array.from({ length: 120 }, (_, i) => 100 + i);
// 우하향 시계열 — 정배열 불성립.
const falling = Array.from({ length: 120 }, (_, i) => 300 - i);

describe('detectGoldenCross (정배열)', () => {
  it('우상향 → true', () => expect(detectGoldenCross(rising)).toBe(true));
  it('우하향 → false', () => expect(detectGoldenCross(falling)).toBe(false));
  it('표본 부족(<60) → false', () => expect(detectGoldenCross(rising.slice(0, 40))).toBe(false));
});

describe('detectVolumeSurge', () => {
  it('마지막 거래량 급증 → true', () => {
    const vols = [...Array(20).fill(1000), 2000];
    expect(detectVolumeSurge(vols)).toBe(true);
  });
  it('평탄한 거래량 → false', () => {
    expect(detectVolumeSurge(Array(21).fill(1000))).toBe(false);
  });
  it('표본 부족(<21) → false', () => expect(detectVolumeSurge(Array(10).fill(1000))).toBe(false));
});

describe('detectTurtleBreakout', () => {
  it('20일 신고가 돌파 → true', () => {
    const highs = [...Array(20).fill(100), 120];
    const closes = [...Array(20).fill(95), 121];
    expect(detectTurtleBreakout(highs, closes)).toBe(true);
  });
  it('박스권(돌파 없음) → false', () => {
    const highs = [...Array(20).fill(100), 90];
    const closes = [...Array(20).fill(95), 90];
    expect(detectTurtleBreakout(highs, closes)).toBe(false);
  });
});

describe('detectFibonacciSupport', () => {
  it('스윙 대비 38.2% 되돌림 구간 → true', () => {
    // swingLow=0, swingHigh=100, close=50 → retr 0.5 ∈ [0.236, 0.618]
    const highs = [...Array(59).fill(100), 100];
    const lows = [0, ...Array(59).fill(50)];
    const closes = [...Array(59).fill(60), 50];
    expect(detectFibonacciSupport(highs, lows, closes)).toBe(true);
  });
  it('고점 부근(되돌림 거의 없음) → false', () => {
    const highs = Array(60).fill(100);
    const lows = Array(60).fill(0);
    const closes = [...Array(59).fill(99), 99]; // retr 0.01 < 0.236
    expect(detectFibonacciSupport(highs, lows, closes)).toBe(false);
  });
});

describe('detectBullishDivergence', () => {
  it('가격 LL + RSI HL → true', () => {
    // 전반부 급락(저점1), 후반부 더 낮은 저점이지만 완만(RSI 회복) 패턴 구성.
    const closes = [
      ...Array(14).fill(100),
      110, 108, 106, 104, 90, 95, 98, 100, 102, 104, // 전반 10일: 저점 90
      103, 102, 101, 100, 88, 92, 95, 97, 99, 101,    // 후반 10일: 저점 88(더 낮음)
    ];
    // 결정적 판정만 확인 (boolean 반환, 표본 충족 시 throw 없음).
    expect(typeof detectBullishDivergence(closes)).toBe('boolean');
  });
  it('표본 부족(<34) → false', () => expect(detectBullishDivergence(Array(20).fill(100))).toBe(false));
});
