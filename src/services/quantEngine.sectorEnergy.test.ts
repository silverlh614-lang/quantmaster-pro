/**
 * Tests for sectorEnergyEngine.ts — 섹터 에너지 맵 & 로테이션 마스터 게이트
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateSectorEnergy,
  getSeasonMonth,
  getSectorGate2Adjustment,
  getSectorPositionLimit,
} from '../../src/services/quant/sectorEnergyEngine';
import type { SectorEnergyInput } from '../../src/types/sectorEnergy';

// ─── 기본 입력 데이터 생성 헬퍼 ─────────────────────────────────────────────

function makeSample(): SectorEnergyInput[] {
  return [
    { name: '반도체',    return4w: 10, volumeChangePct: 20, foreignConcentration: 70 },
    { name: '이차전지',  return4w: 5,  volumeChangePct: 10, foreignConcentration: 50 },
    { name: '바이오',    return4w: 3,  volumeChangePct: 5,  foreignConcentration: 30 },
    { name: '자동차',    return4w: 2,  volumeChangePct: 3,  foreignConcentration: 25 },
    { name: '조선',      return4w: 8,  volumeChangePct: 15, foreignConcentration: 60 },
    { name: '방산',      return4w: 12, volumeChangePct: 25, foreignConcentration: 80 },
    { name: '금융',      return4w: 1,  volumeChangePct: 2,  foreignConcentration: 20 },
    { name: '유통',      return4w: -2, volumeChangePct: -5, foreignConcentration: 10 },
    { name: '건설',      return4w: -5, volumeChangePct:-10, foreignConcentration: 5  },
    { name: '에너지',    return4w: 0,  volumeChangePct: 1,  foreignConcentration: 15 },
    { name: '통신',      return4w: -1, volumeChangePct: 0,  foreignConcentration: 12 },
    { name: '플랫폼',    return4w: 4,  volumeChangePct: 8,  foreignConcentration: 40 },
  ];
}

// ─── getSeasonMonth ───────────────────────────────────────────────────────────

describe('getSeasonMonth', () => {
  it('returns JAN for month 1', () => {
    expect(getSeasonMonth(1)).toBe('JAN');
  });

  it('returns APR_MAY for month 4 and 5', () => {
    expect(getSeasonMonth(4)).toBe('APR_MAY');
    expect(getSeasonMonth(5)).toBe('APR_MAY');
  });

  it('returns OCT_NOV for month 10 and 11', () => {
    expect(getSeasonMonth(10)).toBe('OCT_NOV');
    expect(getSeasonMonth(11)).toBe('OCT_NOV');
  });

  it('returns OTHER for remaining months', () => {
    expect(getSeasonMonth(2)).toBe('OTHER');
    expect(getSeasonMonth(7)).toBe('OTHER');
    expect(getSeasonMonth(12)).toBe('OTHER');
  });
});

// ─── evaluateSectorEnergy ────────────────────────────────────────────────────

describe('evaluateSectorEnergy', () => {
  it('handles empty input gracefully', () => {
    const result = evaluateSectorEnergy([]);
    expect(result.scores).toHaveLength(0);
    expect(result.leadingSectors).toHaveLength(0);
    expect(result.laggingSectors).toHaveLength(0);
    expect(result.summary).toContain('없음');
  });

  it('produces Top 3 leading and Bottom 3 lagging for 12 sectors', () => {
    const result = evaluateSectorEnergy(makeSample(), 6); // 6월 = OTHER
    expect(result.leadingSectors).toHaveLength(3);
    expect(result.laggingSectors).toHaveLength(3);
    expect(result.leadingSectors.every(s => s.tier === 'LEADING')).toBe(true);
    expect(result.laggingSectors.every(s => s.tier === 'LAGGING')).toBe(true);
  });

  it('leading sectors have gate2Adjustment = -1', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    result.leadingSectors.forEach(s => {
      expect(s.gate2Adjustment).toBe(-1);
    });
  });

  it('lagging sectors have positionSizeLimit = 40', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    result.laggingSectors.forEach(s => {
      expect(s.positionSizeLimit).toBe(40);
    });
  });

  it('scores are normalized 0-100', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    result.scores.forEach(s => {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    });
  });

  it('scores are sorted descending', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1].score).toBeGreaterThanOrEqual(result.scores[i].score);
    }
  });

  it('applies seasonal multiplier for January (month=1)', () => {
    const inputs: SectorEnergyInput[] = [
      { name: '반도체',          return4w: 5, volumeChangePct: 10, foreignConcentration: 50 },
      { name: '바이오/헬스케어', return4w: 5, volumeChangePct: 10, foreignConcentration: 50 },
    ];
    const result = evaluateSectorEnergy(inputs, 1); // JAN
    // 바이오/헬스케어 1월 multiplier = 1.2, 반도체 = 1.0 → 바이오 에너지 점수가 더 높아야 함
    const semiBio = result.scores.find(s => s.name === '바이오/헬스케어');
    const semi = result.scores.find(s => s.name === '반도체');
    expect(semiBio?.energyScore).toBeGreaterThan(semi?.energyScore ?? 0);
  });

  it('returns correct currentSeason', () => {
    expect(evaluateSectorEnergy(makeSample(), 1).currentSeason).toBe('JAN');
    expect(evaluateSectorEnergy(makeSample(), 4).currentSeason).toBe('APR_MAY');
    expect(evaluateSectorEnergy(makeSample(), 10).currentSeason).toBe('OCT_NOV');
    expect(evaluateSectorEnergy(makeSample(), 8).currentSeason).toBe('OTHER');
  });

  it('works correctly with fewer than 6 sectors', () => {
    const small: SectorEnergyInput[] = [
      { name: 'A', return4w: 10, volumeChangePct: 20, foreignConcentration: 70 },
      { name: 'B', return4w: 5,  volumeChangePct: 10, foreignConcentration: 40 },
      { name: 'C', return4w: -5, volumeChangePct: -5, foreignConcentration: 10 },
    ];
    const result = evaluateSectorEnergy(small, 6);
    // Top 3 = all three (size <= 6)
    expect(result.scores).toHaveLength(3);
  });
});

// ─── getSectorGate2Adjustment ─────────────────────────────────────────────────

describe('getSectorGate2Adjustment', () => {
  it('returns -1 for a leading sector', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    const leadingName = result.leadingSectors[0].name;
    expect(getSectorGate2Adjustment(leadingName, result)).toBe(-1);
  });

  it('returns 0 for a neutral or lagging sector', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    const laggingName = result.laggingSectors[0].name;
    expect(getSectorGate2Adjustment(laggingName, result)).toBe(0);
  });

  it('returns 0 when result is null', () => {
    expect(getSectorGate2Adjustment('반도체', null)).toBe(0);
  });
});

// ─── getSectorPositionLimit ───────────────────────────────────────────────────

describe('getSectorPositionLimit', () => {
  it('returns 40 for a lagging sector', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    const laggingName = result.laggingSectors[0].name;
    expect(getSectorPositionLimit(laggingName, result)).toBe(40);
  });

  it('returns 100 for a leading sector', () => {
    const result = evaluateSectorEnergy(makeSample(), 6);
    const leadingName = result.leadingSectors[0].name;
    expect(getSectorPositionLimit(leadingName, result)).toBe(100);
  });

  it('returns 100 when result is null', () => {
    expect(getSectorPositionLimit('반도체', null)).toBe(100);
  });
});
