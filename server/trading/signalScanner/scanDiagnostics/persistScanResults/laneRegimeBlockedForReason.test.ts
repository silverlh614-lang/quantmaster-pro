// @responsibility ADR-0630 follow-up — provisional/counterfactual lane noEligibleReason regime 게이트 정합 테스트.

import { describe, it, expect } from 'vitest';
import { laneRegimeBlockedForReason } from './helpers.js';

describe('laneRegimeBlockedForReason — lane 게이트 변수(learningRegime) 정합', () => {
  it('learningRegime=R3_EARLY 면 LIVE-clamp regime(R4_NEUTRAL) 이어도 차단 아님 (오표시 해소)', () => {
    // 06-22 거래일 장중 시나리오: 라이브 clamp 로 routerInput.regime=R4_NEUTRAL,
    // 그러나 실제 shadow lane 게이트는 learningRegime=R3_EARLY 로 통과한다.
    expect(laneRegimeBlockedForReason('R3_EARLY', 'R4_NEUTRAL')).toBe(false);
  });

  it('learningRegime 부재 시 routerInput.regime 으로 폴백 — R4_NEUTRAL → 차단', () => {
    expect(laneRegimeBlockedForReason(undefined, 'R4_NEUTRAL')).toBe(true);
  });

  it('learningRegime 부재 + routerInput.regime=R3_EARLY → 차단 아님 (06-21 휴장 시나리오)', () => {
    expect(laneRegimeBlockedForReason(undefined, 'R3_EARLY')).toBe(false);
  });

  it('learningRegime 이 진짜 R3_EARLY 밖(R2_BULL/R5_CAUTION) → 차단 유지 (게이트 진실 보존)', () => {
    expect(laneRegimeBlockedForReason('R2_BULL', 'R3_EARLY')).toBe(true);
    expect(laneRegimeBlockedForReason('R5_CAUTION', 'R4_NEUTRAL')).toBe(true);
  });

  it('둘 다 부재 → 차단 (UNKNOWN 보수적 처리)', () => {
    expect(laneRegimeBlockedForReason(undefined, undefined)).toBe(true);
  });
});
