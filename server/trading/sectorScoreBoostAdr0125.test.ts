/**
 * @responsibility ADR-0125 PR-1 sectorEnergy dataQuality wiring 회귀 테스트
 *
 * 사용자 후속 PR-1: applySectorScoreBoost 에 dataQuality 4값 분기 추가.
 *   - OK / 미전달 → boost full (기본)
 *   - PARTIAL    → boost × 0.5 → Math.round
 *   - STALE      → boost 0
 *   - FAILED     → boost 0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySectorScoreBoost,
  getSectorBoostMultiplier,
  SECTOR_BOOST_LEADING,
  SECTOR_BOOST_LAGGING_BEAR,
} from './sectorScoreBoost.js';
import type { SectorEnergyResult } from '../../src/types/sectorEnergy.js';

const baseResult: SectorEnergyResult = {
  leadingSectors: [{ name: '반도체', energyScore: 85 } as never],
  laggingSectors: [{ name: '건설/부동산', energyScore: 25 } as never],
  neutralSectors: [],
  topMomentum: [],
  rotationCycle: 'NEUTRAL',
} as unknown as SectorEnergyResult;

describe('getSectorBoostMultiplier — dataQuality 4값 SSOT', () => {
  it('undefined → 1 (기본 OK 동작)', () => {
    expect(getSectorBoostMultiplier(undefined)).toBe(1);
  });

  it('OK → 1', () => {
    expect(getSectorBoostMultiplier('OK')).toBe(1);
  });

  it('PARTIAL → 0.5', () => {
    expect(getSectorBoostMultiplier('PARTIAL')).toBe(0.5);
  });

  it('STALE → 0', () => {
    expect(getSectorBoostMultiplier('STALE')).toBe(0);
  });

  it('FAILED → 0', () => {
    expect(getSectorBoostMultiplier('FAILED')).toBe(0);
  });
});

describe('applySectorScoreBoost — dataQuality 분기', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.SECTOR_SCORE_BOOST_DISABLED;
    delete process.env.SECTOR_SCORE_BOOST_DISABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SECTOR_SCORE_BOOST_DISABLED;
    else process.env.SECTOR_SCORE_BOOST_DISABLED = original;
  });

  it('OK + LEADING → +2 (full)', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL', 'OK')).toBe(SECTOR_BOOST_LEADING);
  });

  it('PARTIAL + LEADING → +1 (×0.5 round)', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL', 'PARTIAL')).toBe(1);
  });

  it('STALE + LEADING → 0', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL', 'STALE')).toBe(0);
  });

  it('FAILED + LEADING → 0', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL', 'FAILED')).toBe(0);
  });

  it('OK + LAGGING + Bear → -1 (full)', () => {
    expect(applySectorScoreBoost('건설/부동산', baseResult, 'R6_DEFENSE', 'OK')).toBe(SECTOR_BOOST_LAGGING_BEAR);
  });

  it('PARTIAL + LAGGING + Bear → 0 (Math.round(-0.5) === -0, ±0 동등)', () => {
    // JavaScript Math.round(-0.5) === -0 (negative zero) — Object.is 와 다르나 산술적 동등.
    // 매트릭스 의도: PARTIAL × -1 boost = -0.5 → round → 0 (실질적 "보너스 없음").
    const result = applySectorScoreBoost('건설/부동산', baseResult, 'R6_DEFENSE', 'PARTIAL');
    expect(Math.abs(result)).toBe(0); // ±0 양쪽 허용
  });

  it('STALE + LAGGING → 0 (multiplier 0)', () => {
    expect(applySectorScoreBoost('건설/부동산', baseResult, 'R6_DEFENSE', 'STALE')).toBe(0);
  });

  it('미전달 (undefined) → OK 기본 동작 (후방호환)', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL')).toBe(SECTOR_BOOST_LEADING);
  });

  it('NEUTRAL 섹터 → 0 (dataQuality 무관)', () => {
    expect(applySectorScoreBoost('자동차', baseResult, 'R2_BULL', 'OK')).toBe(0);
    expect(applySectorScoreBoost('자동차', baseResult, 'R2_BULL', 'PARTIAL')).toBe(0);
    expect(applySectorScoreBoost('자동차', baseResult, 'R2_BULL', 'STALE')).toBe(0);
  });

  it('ENV SECTOR_SCORE_BOOST_DISABLED=true → 0 (dataQuality 무관)', () => {
    process.env.SECTOR_SCORE_BOOST_DISABLED = 'true';
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL', 'OK')).toBe(0);
    expect(applySectorScoreBoost('반도체', baseResult, 'R2_BULL', 'PARTIAL')).toBe(0);
  });

  it('sectorName 부재 → 0 (조기 반환, dataQuality 무관)', () => {
    expect(applySectorScoreBoost(null, baseResult, 'R2_BULL', 'OK')).toBe(0);
    expect(applySectorScoreBoost(undefined, baseResult, 'R2_BULL', 'PARTIAL')).toBe(0);
  });

  it('sectorResult null → 0 (조기 반환, dataQuality 무관)', () => {
    expect(applySectorScoreBoost('반도체', null, 'R2_BULL', 'OK')).toBe(0);
  });

  it('LAGGING + Bull regime → 0 (Bear 만 차감, dataQuality 분기 적용 후도 0)', () => {
    expect(applySectorScoreBoost('건설/부동산', baseResult, 'R2_BULL', 'OK')).toBe(0);
    expect(applySectorScoreBoost('건설/부동산', baseResult, 'R2_BULL', 'PARTIAL')).toBe(0);
  });
});

describe('PR-1 사용자 시나리오 재현', () => {
  it('사용자 §1 OK → full boost', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R3_EARLY', 'OK')).toBe(2);
  });

  it('사용자 §1 PARTIAL → 50% (보수 적용)', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R3_EARLY', 'PARTIAL')).toBe(1);
  });

  it('사용자 §1 STALE → 0 + sectorEnergyResult 는 보존 (이전 캐시 reference)', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R3_EARLY', 'STALE')).toBe(0);
    // sectorEnergyResult 는 인자 그대로 보존 (mutate 안 됨) — 호출자가 reference 표시 가능
    expect(baseResult.leadingSectors).toBeDefined();
  });

  it('사용자 §1 FAILED → 0', () => {
    expect(applySectorScoreBoost('반도체', baseResult, 'R3_EARLY', 'FAILED')).toBe(0);
  });
});
