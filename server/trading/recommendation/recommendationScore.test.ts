// @responsibility scoreRecommendationCandidate 단위 테스트 — clamp 0~100·tier 경계·감산 음수·GateScore 역류 0·분리 SSOT(freeze) 검증.

import { describe, expect, it } from 'vitest';
import type { CandidateSnapshot } from '../signalScanner/entryFilterDecomposition/types.js';
import { scoreRecommendationCandidate, type RecommendationScoreInput } from './recommendationScore.js';
import type { MarketRallyLens } from './recommendationTypes.js';

function lens(overrides: Partial<MarketRallyLens> = {}): MarketRallyLens {
  return {
    enabled: true,
    reason: 'KOSPI_RALLY_1_5',
    kospiReturnPct: 2,
    kosdaqReturnPct: null,
    marketBreadth: null,
    investorFlow: { foreignNetBuy5d: 1000, marketInstitutionNetBuyApprox: 500, label: 'BULLISH' },
    executionImpact: 'NONE',
    recommendationOnly: true,
    snapshotId: 'snap_test',
    asOf: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function input(s: CandidateSnapshot, overrides: Partial<RecommendationScoreInput> = {}): RecommendationScoreInput {
  return { snapshot: s, rallyLens: lens(), ...overrides };
}

describe('scoreRecommendationCandidate', () => {
  // ── T5: clamp / tier 경계 / 감산 음수 / gateScore 역류 0 ──
  describe('T5 clamp / tier / 감산', () => {
    it('total 은 0~100 clamp (최대 가산 입력도 100 초과 금지)', () => {
      const maxed: CandidateSnapshot = {
        symbol: 'A',
        gateScore: 95,
        marketRelativeReturn: 100,
        supplyConfluenceState: 'BULLISH',
        breakoutScore: 1000,
        return5d: 50,
        relativeStrengthScore: 1000,
        volumeRatio: 100,
      };
      const r = scoreRecommendationCandidate(input(maxed));
      expect(r.total).toBeLessThanOrEqual(100);
      expect(r.total).toBeGreaterThanOrEqual(0);
    });

    it('입력 전부 부재 + 감산 → total 음수 아닌 0 clamp', () => {
      const empty: CandidateSnapshot = {
        symbol: 'A',
        priceDataFresh: false,
        supplyConfluenceState: 'UNKNOWN',
      };
      // market-level 가산도 0 이 되도록 비활성/투자흐름 없는 lens 사용 (가산 0 + 감산 -18 → clamp 0)
      const flatLens = lens({
        enabled: false,
        kospiReturnPct: null,
        investorFlow: { foreignNetBuy5d: null, marketInstitutionNetBuyApprox: null, label: 'UNKNOWN' },
      });
      const r = scoreRecommendationCandidate(input(empty, { rallyLens: flatLens, providerIssue: true }));
      // 가산 0, 감산 staleData(-10) + providerUncertainty(-8) = -18 → clamp 0
      expect(r.breakdown.staleDataPenalty).toBe(-10);
      expect(r.breakdown.providerUncertaintyPenalty).toBe(-8);
      expect(r.total).toBe(0);
      expect(r.tier).toBe('LOW_PRIORITY');
    });

    it('감산 항목은 음수 (bearish 변환 아님 — 단순 점수 차감)', () => {
      const s: CandidateSnapshot = { symbol: 'A', gateScore: 90, supplyConfluenceState: 'UNAVAILABLE' };
      const r = scoreRecommendationCandidate(input(s));
      expect(r.breakdown.providerUncertaintyPenalty).toBeLessThan(0);
    });

    it('tier 경계: total 별 STRONG_WATCH/WATCH/SOFT_WATCH/OBSERVE/LOW_PRIORITY', () => {
      // total 은 내부 산식 합이므로 경계를 직접 검증하기 위해 가산 항목을 조정.
      // kospiRallyAlignment = clamp(0,15, kospiReturnPct*5); foreign+inst = 16; accumulation=10 ...
      // 여기서는 tier 함수의 경계 동작을 합산 결과로 간접 확인.
      const strong: CandidateSnapshot = {
        symbol: 'S',
        gateScore: 90,
        marketRelativeReturn: 4,
        supplyConfluenceState: 'BULLISH',
        breakoutScore: 120,
        return5d: 5,
        relativeStrengthScore: 60,
        volumeRatio: 3,
      };
      const r = scoreRecommendationCandidate(input(strong, { rallyLens: lens({ kospiReturnPct: 3 }) }));
      expect(['STRONG_WATCH', 'WATCH', 'SOFT_WATCH']).toContain(r.tier);
      // tier 가 total 과 정합
      if (r.total >= 80) expect(r.tier).toBe('STRONG_WATCH');
      else if (r.total >= 60) expect(r.tier).toBe('WATCH');
      else if (r.total >= 40) expect(r.tier).toBe('SOFT_WATCH');
      else if (r.total >= 20) expect(r.tier).toBe('OBSERVE');
      else expect(r.tier).toBe('LOW_PRIORITY');
    });

    it('GateScore 역류 0 — gateScore 입력은 참조만, mutate 0', () => {
      const s: CandidateSnapshot = { symbol: 'A', gateScore: 77, supplyConfluenceState: 'BULLISH' };
      const before = s.gateScore;
      const r = scoreRecommendationCandidate(input(s));
      // gateScore 미변경
      expect(s.gateScore).toBe(before);
      // recommendation total 은 gateScore 와 별도 척도 (동일값 강제 아님)
      expect(r.total).not.toBe(s.gateScore); // 우연 일치 방지 — 산식상 다름
      expect(r.executionImpact).toBe('NONE');
    });
  });

  // ── T7: 분리 SSOT — Gate1 finalScore mutate 0, 입력 객체 불변 ──
  describe('T7 분리 SSOT (mutate 0)', () => {
    it('frozen snapshot 입력에도 throw 없이 산출 (입력 mutate 0 증명)', () => {
      const frozen = Object.freeze<CandidateSnapshot>({
        symbol: 'A',
        gateScore: 80,
        gate1Passed: true,
        minSignalScorePassed: true,
        supplyConfluenceState: 'BULLISH',
        return5d: 3,
      });
      expect(() => scoreRecommendationCandidate(input(frozen))).not.toThrow();
      const r = scoreRecommendationCandidate(input(frozen));
      // 입력 필드 그대로
      expect(frozen.gateScore).toBe(80);
      expect(frozen.gate1Passed).toBe(true);
      expect(frozen.minSignalScorePassed).toBe(true);
      expect(r.executionImpact).toBe('NONE');
    });

    it('frozen rallyLens 입력에도 mutate 없이 산출', () => {
      const frozenLens = Object.freeze(lens());
      const s: CandidateSnapshot = { symbol: 'A', gateScore: 60 };
      expect(() => scoreRecommendationCandidate({ snapshot: s, rallyLens: frozenLens })).not.toThrow();
      expect(frozenLens.enabled).toBe(true);
      expect(frozenLens.kospiReturnPct).toBe(2);
    });

    it('동일 입력 반복 호출 → total 결정적 동일 (부작용 없음)', () => {
      const s: CandidateSnapshot = { symbol: 'A', gateScore: 70, supplyConfluenceState: 'BULLISH', return5d: 2 };
      const r1 = scoreRecommendationCandidate(input(s));
      const r2 = scoreRecommendationCandidate(input(s));
      expect(r1.total).toBe(r2.total);
      expect(r1.tier).toBe(r2.tier);
    });
  });
});
