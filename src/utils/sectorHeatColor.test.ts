/**
 * @responsibility classifySectorHeat 단위 테스트 — ADR-0022 PR-E
 */
import { describe, it, expect } from 'vitest';
import { classifySectorHeat, SECTOR_HEAT_CSS } from './sectorHeatColor';

describe('classifySectorHeat — ADR-0022 4단계 분류', () => {
  it('score ≥ 70 → HOT', () => {
    expect(classifySectorHeat(70)).toBe('HOT');
    expect(classifySectorHeat(85)).toBe('HOT');
    expect(classifySectorHeat(100)).toBe('HOT');
  });

  it('score 50~69 → WARM', () => {
    expect(classifySectorHeat(50)).toBe('WARM');
    expect(classifySectorHeat(60)).toBe('WARM');
    expect(classifySectorHeat(69.9)).toBe('WARM');
  });

  it('score 30~49 → COOL', () => {
    expect(classifySectorHeat(30)).toBe('COOL');
    expect(classifySectorHeat(40)).toBe('COOL');
    expect(classifySectorHeat(49.9)).toBe('COOL');
  });

  it('score < 30 → COLD', () => {
    expect(classifySectorHeat(29.9)).toBe('COLD');
    expect(classifySectorHeat(0)).toBe('COLD');
    expect(classifySectorHeat(-10)).toBe('COLD');
  });

  it('NaN/Infinity → COLD (안전 fallback)', () => {
    expect(classifySectorHeat(NaN)).toBe('COLD');
    expect(classifySectorHeat(Infinity)).toBe('COLD');
    expect(classifySectorHeat(null)).toBe('COLD');
    expect(classifySectorHeat(undefined)).toBe('COLD');
  });

  it('SECTOR_HEAT_CSS 4 키 모두 정의', () => {
    expect(SECTOR_HEAT_CSS.HOT).toContain('red');
    expect(SECTOR_HEAT_CSS.WARM).toContain('amber');
    expect(SECTOR_HEAT_CSS.COOL).toContain('cyan');
    expect(SECTOR_HEAT_CSS.COLD).toContain('blue');
  });
});
