/**
 * @responsibility marketCapFormat 회귀 — 시총 단위(원/억) 크기 정규화 + 표시 포맷.
 *
 * 배경: parseMarketCapWon 픽스로 snapshot marketCap 이 원 단위로 채워지면서, 억 가정
 * 표시부(/10000·/1e8)가 1e8 배 과대표시한 결함을 크기 자동판별로 해소.
 */
import { describe, it, expect } from 'vitest';
import { marketCapToJo, formatMarketCapJoWon, formatMarketCapTKrw } from './marketCapFormat';

describe('marketCapToJo — 원/억 크기 자동 판별', () => {
  it('원 단위(≥1e8) → /1e12 조', () => {
    expect(marketCapToJo(131_236_800_000_000)).toBeCloseTo(131.2, 1); // 삼성전기 131조(원)
    expect(marketCapToJo(1_000_000_000_000)).toBeCloseTo(1, 5);       // 1조(원)
    expect(marketCapToJo(480_000_000_000_000)).toBeCloseTo(480, 0);   // 480조(원)
  });
  it('억 단위(<1e8) → /1e4 조 (같은 시총, 같은 조 값)', () => {
    expect(marketCapToJo(1_312_368)).toBeCloseTo(131.2, 1); // 131조(억)
    expect(marketCapToJo(10_000)).toBeCloseTo(1, 5);        // 1조 = 10000억
    expect(marketCapToJo(4_800_000)).toBeCloseTo(480, 0);   // 480조(억)
  });
  it('0/음수/NaN/null/undefined → null', () => {
    expect(marketCapToJo(0)).toBeNull();
    expect(marketCapToJo(-1)).toBeNull();
    expect(marketCapToJo(NaN)).toBeNull();
    expect(marketCapToJo(null)).toBeNull();
    expect(marketCapToJo(undefined)).toBeNull();
  });
});

describe('formatMarketCapJoWon / formatMarketCapTKrw', () => {
  it('원 단위 → 조원 / T KRW', () => {
    expect(formatMarketCapJoWon(131_236_800_000_000)).toBe('131.2조원');
    expect(formatMarketCapTKrw(131_236_800_000_000)).toBe('131.2T KRW');
  });
  it('값 부재 → N/A', () => {
    expect(formatMarketCapJoWon(0)).toBe('N/A');
    expect(formatMarketCapTKrw(undefined)).toBe('N/A');
  });
});
