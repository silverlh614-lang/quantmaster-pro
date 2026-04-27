// @responsibility sectorCycleClassifier 회귀 테스트
import { describe, it, expect } from 'vitest';
import {
  deriveSectorCycle,
  SECTOR_CYCLE_THRESHOLDS,
} from './sectorCycleClassifier.js';
import type {
  SectorEnergyResult,
  SectorTierResult,
} from '../../src/types/sectorEnergy.js';

function makeTier(name: string, energyScore: number, tier: 'LEADING' | 'NEUTRAL' | 'LAGGING' = 'LEADING'): SectorTierResult {
  return {
    name,
    energyScore,
    tier,
    gate2Adjustment: tier === 'LEADING' ? -1 : 0,
    positionSizeLimit: tier === 'LAGGING' ? 40 : 100,
  };
}

function makeResult(
  leading: SectorTierResult[],
  lagging: SectorTierResult[] = [],
): SectorEnergyResult {
  return {
    scores: [],
    leadingSectors: leading,
    laggingSectors: lagging,
    neutralSectors: [],
    currentSeason: 'OTHER',
    calculatedAt: new Date().toISOString(),
    summary: '',
  };
}

describe('sectorCycleClassifier', () => {
  describe('SECTOR_CYCLE_THRESHOLDS SSOT', () => {
    it('LATE > MID > EARLY 임계값 단조 정합', () => {
      expect(SECTOR_CYCLE_THRESHOLDS.LATE_SCORE_MIN).toBeGreaterThan(SECTOR_CYCLE_THRESHOLDS.MID_SCORE_MIN);
      expect(SECTOR_CYCLE_THRESHOLDS.MID_SCORE_MIN).toBeGreaterThan(SECTOR_CYCLE_THRESHOLDS.EARLY_SCORE_MIN);
      expect(SECTOR_CYCLE_THRESHOLDS.LATE_RATIO_MIN).toBeGreaterThanOrEqual(SECTOR_CYCLE_THRESHOLDS.MID_RATIO_MIN);
    });
  });

  describe('null/empty 입력', () => {
    it('null 입력 → null', () => {
      expect(deriveSectorCycle(null)).toBeNull();
    });

    it('undefined 입력 → null', () => {
      expect(deriveSectorCycle(undefined)).toBeNull();
    });

    it('leadingSectors=[] → null (이전 값 보존)', () => {
      expect(deriveSectorCycle(makeResult([]))).toBeNull();
    });
  });

  describe('LATE 분기 (강세 + 광범위)', () => {
    it('avgScore=80 + ratio=3 (leading 3, lagging 1) → LATE', () => {
      const result = makeResult(
        [makeTier('A', 80), makeTier('B', 80), makeTier('C', 80)],
        [makeTier('D', 20, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('LATE');
      expect(out?.leadingSectorRS).toBe(80);
    });

    it('avgScore=70 정확 boundary + ratio=2 정확 → LATE', () => {
      const result = makeResult(
        [makeTier('A', 70), makeTier('B', 70)],
        [makeTier('C', 30, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('LATE');
    });

    it('avgScore=70 + ratio=1.5 (LATE 비율 미달) → MID', () => {
      const result = makeResult(
        [makeTier('A', 70), makeTier('B', 70), makeTier('C', 70)],
        [makeTier('D', 30, 'LAGGING'), makeTier('E', 25, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('MID');
    });
  });

  describe('MID 분기 (안정 강세)', () => {
    it('avgScore=60 + ratio=2 → MID (LATE score 미달)', () => {
      const result = makeResult(
        [makeTier('A', 60), makeTier('B', 60)],
        [makeTier('C', 30, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('MID');
      expect(out?.leadingSectorRS).toBe(60);
    });

    it('avgScore=55 정확 boundary + ratio=1 정확 → MID', () => {
      const result = makeResult(
        [makeTier('A', 55)],
        [makeTier('B', 30, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('MID');
    });
  });

  describe('EARLY 분기 (회복 초기)', () => {
    it('avgScore=50 → EARLY', () => {
      const result = makeResult([makeTier('A', 50)]);
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('EARLY');
      expect(out?.leadingSectorRS).toBe(50);
    });

    it('avgScore=40 정확 boundary → EARLY', () => {
      const result = makeResult([makeTier('A', 40)]);
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('EARLY');
    });

    it('avgScore=55 + ratio=0.5 (MID 비율 미달) → EARLY', () => {
      const result = makeResult(
        [makeTier('A', 55)],
        [makeTier('B', 30, 'LAGGING'), makeTier('C', 25, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('EARLY');
    });
  });

  describe('TURNING 분기 (혼조)', () => {
    it('avgScore=39 (EARLY 미달) → TURNING', () => {
      const result = makeResult([makeTier('A', 39)]);
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('TURNING');
      expect(out?.leadingSectorRS).toBe(39);
    });

    it('avgScore=10 → TURNING', () => {
      const result = makeResult([makeTier('A', 10)]);
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('TURNING');
      expect(out?.leadingSectorRS).toBe(10);
    });
  });

  describe('leadingSectorRS 반올림 + clamp', () => {
    it('avgScore=72.7 → leadingSectorRS=73 (반올림)', () => {
      const result = makeResult(
        [makeTier('A', 72.7), makeTier('B', 72.7)],
        [makeTier('C', 30, 'LAGGING')],
      );
      const out = deriveSectorCycle(result);
      expect(out?.leadingSectorRS).toBe(73);
    });

    it('avgScore=120 → leadingSectorRS=100 (상한 clamp)', () => {
      const result = makeResult([makeTier('A', 120)]);
      const out = deriveSectorCycle(result);
      expect(out?.leadingSectorRS).toBe(100);
    });

    it('NaN energyScore → 0 fallback (TURNING)', () => {
      const result = makeResult([makeTier('A', NaN)]);
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('TURNING');
      expect(out?.leadingSectorRS).toBe(0);
    });
  });

  describe('lagging=0 ratio 안전 처리', () => {
    it('lagging=0 시 ratio = leading.length (Math.max(1, 0)=1 분모)', () => {
      const result = makeResult(
        [makeTier('A', 75), makeTier('B', 75)],
        [],
      );
      // ratio = 2/1 = 2 → LATE 임계 충족
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('LATE');
    });

    it('leading=1 + lagging=0 시 ratio=1 → LATE 임계 미달 → MID', () => {
      const result = makeResult([makeTier('A', 75)], []);
      const out = deriveSectorCycle(result);
      expect(out?.sectorCycleStage).toBe('MID');
    });
  });
});
