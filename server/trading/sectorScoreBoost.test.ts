/**
 * @responsibility sectorScoreBoost (ADR-0075) 강세 섹터 Gate Score 가산점 단위 테스트
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  applySectorScoreBoost,
  classifySectorTier,
  describeSectorBoost,
  SECTOR_BOOST_LEADING,
  SECTOR_BOOST_LAGGING_BEAR,
} from './sectorScoreBoost.js';
import type { SectorEnergyResult } from '../../src/types/sectorEnergy.js';

/** 테스트용 SectorEnergyResult 픽스처 */
function makeResult(opts: {
  leading?: string[];
  lagging?: string[];
  neutral?: string[];
} = {}): SectorEnergyResult {
  const mkTier = (name: string, energyScore: number, isLagging = false) => ({
    name, energyScore, tier: isLagging ? 'LAGGING' as const : 'LEADING' as const,
    gate2Adjustment: isLagging ? 0 : -1,
    positionSizeLimit: isLagging ? 40 : 100,
  });
  return {
    scores: [],
    leadingSectors: (opts.leading ?? []).map(n => mkTier(n, 80)),
    laggingSectors: (opts.lagging ?? []).map(n => ({ ...mkTier(n, 20, true), tier: 'LAGGING' as const })),
    neutralSectors: (opts.neutral ?? []).map(n => ({ ...mkTier(n, 50), tier: 'NEUTRAL' as const })),
    currentSeason: 'OTHER',
    calculatedAt: new Date().toISOString(),
    summary: 'test fixture',
  };
}

describe('sectorScoreBoost (ADR-0075)', () => {
  const originalEnv = process.env.SECTOR_SCORE_BOOST_DISABLED;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SECTOR_SCORE_BOOST_DISABLED;
    else process.env.SECTOR_SCORE_BOOST_DISABLED = originalEnv;
  });

  // ── 상수 SSOT ──────────────────────────────────────────────────────────
  it('상수 SSOT: LEADING +2 / LAGGING (Bear) -1', () => {
    expect(SECTOR_BOOST_LEADING).toBe(2);
    expect(SECTOR_BOOST_LAGGING_BEAR).toBe(-1);
  });

  // ── 안전 fallback ──────────────────────────────────────────────────────
  describe('안전 fallback', () => {
    it('sectorName undefined → 0', () => {
      const r = makeResult({ leading: ['반도체'] });
      expect(applySectorScoreBoost(undefined, r, 'R2_BULL')).toBe(0);
    });

    it('sectorName null → 0', () => {
      const r = makeResult({ leading: ['반도체'] });
      expect(applySectorScoreBoost(null, r, 'R2_BULL')).toBe(0);
    });

    it('sectorName 빈 문자열 → 0', () => {
      const r = makeResult({ leading: ['반도체'] });
      expect(applySectorScoreBoost('', r, 'R2_BULL')).toBe(0);
    });

    it('sectorResult null → 0', () => {
      expect(applySectorScoreBoost('반도체', null, 'R2_BULL')).toBe(0);
    });

    it('sectorName 이 leading/lagging/neutral 어디에도 없음 → NEUTRAL → 0', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('알 수 없는 섹터', r, 'R2_BULL')).toBe(0);
    });
  });

  // ── LEADING +2 (모든 레짐) ─────────────────────────────────────────────
  describe('LEADING 종목: 모든 레짐 +2', () => {
    it('R1_TURBO + LEADING → +2', () => {
      const r = makeResult({ leading: ['반도체'] });
      expect(applySectorScoreBoost('반도체', r, 'R1_TURBO')).toBe(2);
    });

    it('R2_BULL + LEADING → +2', () => {
      const r = makeResult({ leading: ['이차전지'] });
      expect(applySectorScoreBoost('이차전지', r, 'R2_BULL')).toBe(2);
    });

    it('R6_DEFENSE + LEADING → +2 (방어 모드에서도 강세 섹터 우대)', () => {
      const r = makeResult({ leading: ['바이오/헬스케어'] });
      expect(applySectorScoreBoost('바이오/헬스케어', r, 'R6_DEFENSE')).toBe(2);
    });

    it('regime 미전달 + LEADING → +2 (regime 무관)', () => {
      const r = makeResult({ leading: ['금융'] });
      expect(applySectorScoreBoost('금융', r)).toBe(2);
    });
  });

  // ── LAGGING -1 (Bear 만) ───────────────────────────────────────────────
  describe('LAGGING 종목: Bear/Caution 만 -1', () => {
    it('R5_CAUTION + LAGGING → -1', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r, 'R5_CAUTION')).toBe(-1);
    });

    it('R6_DEFENSE + LAGGING → -1', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['유통/소비재'] });
      expect(applySectorScoreBoost('유통/소비재', r, 'R6_DEFENSE')).toBe(-1);
    });

    it('R1_TURBO + LAGGING → 0 (BULL 에선 차감 없음)', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r, 'R1_TURBO')).toBe(0);
    });

    it('R2_BULL + LAGGING → 0 (BULL 에선 차감 없음)', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r, 'R2_BULL')).toBe(0);
    });

    it('R3_EARLY + LAGGING → 0 (EARLY 에선 차감 없음)', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r, 'R3_EARLY')).toBe(0);
    });

    it('R4_NEUTRAL + LAGGING → 0 (NEUTRAL 에선 차감 없음)', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r, 'R4_NEUTRAL')).toBe(0);
    });

    it('regime 미전달 + LAGGING → 0 (안전 fallback)', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r)).toBe(0);
    });
  });

  // ── ENV 롤백 ───────────────────────────────────────────────────────────
  describe('SECTOR_SCORE_BOOST_DISABLED env', () => {
    it('=true → 0 (LEADING 무관)', () => {
      process.env.SECTOR_SCORE_BOOST_DISABLED = 'true';
      const r = makeResult({ leading: ['반도체'] });
      expect(applySectorScoreBoost('반도체', r, 'R2_BULL')).toBe(0);
    });

    it('=true → 0 (LAGGING + Bear 무관)', () => {
      process.env.SECTOR_SCORE_BOOST_DISABLED = 'true';
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(applySectorScoreBoost('건설/부동산', r, 'R6_DEFENSE')).toBe(0);
    });

    it('=false → 정상 동작 (env 명시 false)', () => {
      process.env.SECTOR_SCORE_BOOST_DISABLED = 'false';
      const r = makeResult({ leading: ['반도체'] });
      expect(applySectorScoreBoost('반도체', r, 'R2_BULL')).toBe(2);
    });
  });

  // ── classifySectorTier ─────────────────────────────────────────────────
  describe('classifySectorTier', () => {
    it('leadingSectors 안 → LEADING', () => {
      const r = makeResult({ leading: ['반도체', '이차전지'] });
      expect(classifySectorTier('반도체', r)).toBe('LEADING');
      expect(classifySectorTier('이차전지', r)).toBe('LEADING');
    });

    it('laggingSectors 안 → LAGGING', () => {
      const r = makeResult({ lagging: ['건설/부동산'] });
      expect(classifySectorTier('건설/부동산', r)).toBe('LAGGING');
    });

    it('어디에도 없음 → NEUTRAL', () => {
      const r = makeResult({ leading: ['반도체'], lagging: ['건설/부동산'] });
      expect(classifySectorTier('알 수 없는 섹터', r)).toBe('NEUTRAL');
    });

    it('neutralSectors 안 → NEUTRAL', () => {
      const r = makeResult({ neutral: ['금융'] });
      expect(classifySectorTier('금융', r)).toBe('NEUTRAL');
    });
  });

  // ── describeSectorBoost ─────────────────────────────────────────────────
  describe('describeSectorBoost — 진단 메시지 포맷', () => {
    it('LEADING +2 형식', () => {
      expect(describeSectorBoost('반도체', 2, 'LEADING')).toBe('반도체 +2 (LEADING)');
    });

    it('LAGGING (regime 포함) -1 형식', () => {
      expect(describeSectorBoost('건설/부동산', -1, 'LAGGING', 'R6_DEFENSE'))
        .toBe('건설/부동산 -1 (LAGGING, R6_DEFENSE)');
    });

    it('NEUTRAL 0 형식', () => {
      expect(describeSectorBoost('에너지/화학', 0, 'NEUTRAL'))
        .toBe('에너지/화학 0 (NEUTRAL)');
    });

    it('섹터 미상 0 형식', () => {
      expect(describeSectorBoost(undefined, 0, 'NEUTRAL')).toBe('섹터 미상 0');
    });

    it('UNKNOWN tier 형식', () => {
      expect(describeSectorBoost('반도체', 0, 'UNKNOWN')).toBe('반도체 0');
    });
  });

  it('KIS_STOCK_BASKET_DERIVED production source는 sector boost를 허용하지 않는다', () => {
    const r = { ...makeResult({ leading: ['반도체'] }), selectedProductionSourceTier: 'KIS_STOCK_BASKET_DERIVED' as const };
    expect(applySectorScoreBoost('반도체', r, 'R2_BULL', 'PARTIAL')).toBe(0);
  });

});
