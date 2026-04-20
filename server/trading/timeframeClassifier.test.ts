/**
 * timeframeClassifier.test.ts — Phase 4-⑧ 시간축 분류기 회귀.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTimeframe,
  getTimeframeConfig,
  countByTimeframe,
  hasTimeframeSlot,
  TIMEFRAME_CONFIGS,
  TIMEFRAME_TOTAL_SLOTS,
} from './timeframeClassifier.js';

describe('timeframeClassifier — 설정 불변식', () => {
  it('슬롯 총합 = SCALPING(3) + DAY(3) + SWING(6) = 12', () => {
    expect(TIMEFRAME_TOTAL_SLOTS).toBe(12);
  });

  it('Kelly factor 차등 — SCALPING(0.2) < DAY(0.4) < SWING(1.0)', () => {
    expect(TIMEFRAME_CONFIGS.SCALPING.kellyFactor).toBeLessThan(TIMEFRAME_CONFIGS.DAY.kellyFactor);
    expect(TIMEFRAME_CONFIGS.DAY.kellyFactor).toBeLessThan(TIMEFRAME_CONFIGS.SWING.kellyFactor);
  });

  it('손절 폭 — SCALPING -1% / DAY -3% / SWING -5%', () => {
    expect(TIMEFRAME_CONFIGS.SCALPING.stopLossPct).toBe(-0.01);
    expect(TIMEFRAME_CONFIGS.DAY.stopLossPct).toBe(-0.03);
    expect(TIMEFRAME_CONFIGS.SWING.stopLossPct).toBe(-0.05);
    expect(TIMEFRAME_CONFIGS.SWING.stopLossMaxPct).toBe(-0.07);
  });
});

describe('classifyTimeframe — 추론', () => {
  it('명시적 timeframe 필드가 있으면 그 값', () => {
    expect(classifyTimeframe({ timeframe: 'SCALPING' })).toBe('SCALPING');
    expect(classifyTimeframe({ timeframe: 'DAY' })).toBe('DAY');
  });

  it('CATALYST section → DAY', () => {
    expect(classifyTimeframe({ section: 'CATALYST' })).toBe('DAY');
  });

  it('profileType C (소형 모멘텀) → DAY', () => {
    expect(classifyTimeframe({ profileType: 'C' })).toBe('DAY');
  });

  it('기본 → SWING', () => {
    expect(classifyTimeframe({ section: 'SWING', profileType: 'A' })).toBe('SWING');
    expect(classifyTimeframe({})).toBe('SWING');
  });
});

describe('countByTimeframe / hasTimeframeSlot', () => {
  it('보유 항목을 timeframe 별로 집계', () => {
    const items = [
      { timeframe: 'SCALPING' as const },
      { timeframe: 'DAY' as const },
      { timeframe: 'SWING' as const },
      { timeframe: 'SWING' as const },
      {}, // 기본 SWING
    ];
    const counts = countByTimeframe(items);
    expect(counts.SCALPING).toBe(1);
    expect(counts.DAY).toBe(1);
    expect(counts.SWING).toBe(3);
  });

  it('hasTimeframeSlot — maxPositions 기반 가용성 검사', () => {
    expect(hasTimeframeSlot('SCALPING', 2)).toBe(true);  // 3 max
    expect(hasTimeframeSlot('SCALPING', 3)).toBe(false);
    expect(hasTimeframeSlot('SWING', 5)).toBe(true);     // 6 max
    expect(hasTimeframeSlot('SWING', 5, 1)).toBe(false); // reserved 포함
  });

  it('getTimeframeConfig — 레지스트리 반환', () => {
    const cfg = getTimeframeConfig('DAY');
    expect(cfg.maxPositions).toBe(3);
    expect(cfg.kellyFactor).toBe(0.4);
  });
});
