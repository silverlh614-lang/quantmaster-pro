/**
 * Tests for contradictionDetector.ts — 조건 간 상충 감지기
 */
import { describe, it, expect } from 'vitest';
import {
  detectContradictions,
  CONTRADICTION_GATE3_PENALTY,
} from '../../src/services/quant/contradictionDetector';
import type { ConditionId } from '../../src/types/quant';

// ─── 기본 벡터 헬퍼 ────────────────────────────────────────────────────────────

/** 모든 조건이 중립(5점)인 기본 벡터 */
function makeNeutralScores(): Record<ConditionId, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 27; i++) scores[i] = 5;
  return scores as Record<ConditionId, number>;
}

// ─── detectContradictions ────────────────────────────────────────────────────

describe('detectContradictions', () => {
  it('상충 없음 — 모든 조건이 통과점(5) 이상일 때', () => {
    const scores = makeNeutralScores();
    const result = detectContradictions(scores);
    expect(result.hasContradiction).toBe(false);
    expect(result.detectedCount).toBe(0);
    expect(result.gate3PenaltyMultiplier).toBe(1.0);
    expect(result.strongBuyBlocked).toBe(false);
    expect(result.contradictionPairs).toHaveLength(3);
  });

  it('상충 없음 — 모든 조건이 낮을 때도 상충 쌍 논리 미충족', () => {
    // B 조건(매수신호)이 낮으면 상충 미발생
    const scores = makeNeutralScores();
    scores[19 as ConditionId] = 3; // psychologicalObjectivity 낮음 (FOMO)
    scores[20 as ConditionId] = 3; // turtleBreakout도 낮음 → 상충 미발생
    const result = detectContradictions(scores);
    const pair = result.contradictionPairs.find(p => p.id === 'RSI_OVERBOUGHT_VS_TURTLE');
    expect(pair?.detected).toBe(false);
  });

  describe('상충 쌍 1: RSI 과매수 ↔ 터틀 돌파', () => {
    it('psychologicalObjectivity < 5 AND turtleBreakout >= 5 → 상충 감지', () => {
      const scores = makeNeutralScores();
      scores[19 as ConditionId] = 3;  // FOMO 고점 (낮음)
      scores[20 as ConditionId] = 8;  // 터틀 돌파 (높음)
      const result = detectContradictions(scores);
      expect(result.hasContradiction).toBe(true);
      expect(result.detectedCount).toBeGreaterThanOrEqual(1);
      const pair = result.contradictionPairs.find(p => p.id === 'RSI_OVERBOUGHT_VS_TURTLE');
      expect(pair?.detected).toBe(true);
    });

    it('psychologicalObjectivity >= 5 → 상충 미발생 (FOMO 없음)', () => {
      const scores = makeNeutralScores();
      scores[19 as ConditionId] = 6;  // FOMO 없음
      scores[20 as ConditionId] = 8;  // 터틀 돌파
      const result = detectContradictions(scores);
      const pair = result.contradictionPairs.find(p => p.id === 'RSI_OVERBOUGHT_VS_TURTLE');
      expect(pair?.detected).toBe(false);
    });
  });

  describe('상충 쌍 2: 다이버전스 경고 ↔ 거래량 급증', () => {
    it('divergenceCheck < 5 AND volumeSurgeVerified >= 5 → 상충 감지', () => {
      const scores = makeNeutralScores();
      scores[26 as ConditionId] = 2;  // 다이버전스 경고 존재 (낮음)
      scores[11 as ConditionId] = 7;  // 거래량 급증 (높음)
      const result = detectContradictions(scores);
      expect(result.hasContradiction).toBe(true);
      const pair = result.contradictionPairs.find(p => p.id === 'DIVERGENCE_VS_VOLUME_SURGE');
      expect(pair?.detected).toBe(true);
    });

    it('divergenceCheck >= 5 → 상충 미발생 (다이버전스 없음)', () => {
      const scores = makeNeutralScores();
      scores[26 as ConditionId] = 8;  // 다이버전스 없음 (건전)
      scores[11 as ConditionId] = 9;  // 거래량 급증
      const result = detectContradictions(scores);
      const pair = result.contradictionPairs.find(p => p.id === 'DIVERGENCE_VS_VOLUME_SURGE');
      expect(pair?.detected).toBe(false);
    });
  });

  describe('상충 쌍 3: 엘리엇 5파 완성 ↔ VCP 매수', () => {
    it('elliottWaveVerified < 5 AND vcpPattern >= 5 → 상충 감지', () => {
      const scores = makeNeutralScores();
      scores[22 as ConditionId] = 3;  // 엘리엇 비우호적 (5파 완성)
      scores[25 as ConditionId] = 7;  // VCP 매수
      const result = detectContradictions(scores);
      expect(result.hasContradiction).toBe(true);
      const pair = result.contradictionPairs.find(p => p.id === 'ELLIOTT_5WAVE_VS_VCP');
      expect(pair?.detected).toBe(true);
    });

    it('elliottWaveVerified >= 5 → 상충 미발생 (파동 우호적)', () => {
      const scores = makeNeutralScores();
      scores[22 as ConditionId] = 7;  // 엘리엇 우호적 (3파 진입)
      scores[25 as ConditionId] = 8;  // VCP 매수
      const result = detectContradictions(scores);
      const pair = result.contradictionPairs.find(p => p.id === 'ELLIOTT_5WAVE_VS_VCP');
      expect(pair?.detected).toBe(false);
    });
  });

  describe('패널티 규칙', () => {
    it('상충 감지 시 gate3PenaltyMultiplier = 0.8', () => {
      const scores = makeNeutralScores();
      scores[19 as ConditionId] = 2;
      scores[20 as ConditionId] = 8;
      const result = detectContradictions(scores);
      expect(result.gate3PenaltyMultiplier).toBe(CONTRADICTION_GATE3_PENALTY);
      expect(result.gate3PenaltyMultiplier).toBe(0.8);
    });

    it('상충 없을 때 gate3PenaltyMultiplier = 1.0', () => {
      const scores = makeNeutralScores();
      const result = detectContradictions(scores);
      expect(result.gate3PenaltyMultiplier).toBe(1.0);
    });

    it('상충 감지 시 strongBuyBlocked = true', () => {
      const scores = makeNeutralScores();
      scores[26 as ConditionId] = 1;
      scores[11 as ConditionId] = 9;
      const result = detectContradictions(scores);
      expect(result.strongBuyBlocked).toBe(true);
    });

    it('상충 없을 때 strongBuyBlocked = false', () => {
      const scores = makeNeutralScores();
      const result = detectContradictions(scores);
      expect(result.strongBuyBlocked).toBe(false);
    });
  });

  describe('복수 상충 쌍', () => {
    it('여러 상충 쌍 동시 감지', () => {
      const scores = makeNeutralScores();
      // 쌍 1
      scores[19 as ConditionId] = 3;
      scores[20 as ConditionId] = 7;
      // 쌍 2
      scores[26 as ConditionId] = 2;
      scores[11 as ConditionId] = 8;
      const result = detectContradictions(scores);
      expect(result.detectedCount).toBeGreaterThanOrEqual(2);
      expect(result.hasContradiction).toBe(true);
    });
  });

  describe('메시지', () => {
    it('상충 없을 때 메시지에 "일관성" 포함', () => {
      const scores = makeNeutralScores();
      const result = detectContradictions(scores);
      expect(result.message).toContain('일관성');
    });

    it('상충 감지 시 메시지에 "-20%" 및 쌍 이름 포함', () => {
      const scores = makeNeutralScores();
      scores[19 as ConditionId] = 2;
      scores[20 as ConditionId] = 8;
      const result = detectContradictions(scores);
      expect(result.message).toContain('-20%');
      expect(result.message).toContain('RSI 과매수');
    });
  });

  describe('모든 조건 0점', () => {
    it('B 조건(높아야 발동)이 0점 → 상충 미발생', () => {
      const scores = makeNeutralScores();
      // A: psychologicalObjectivity=0 (낮음=FOMO)
      // B: turtleBreakout=0 (낮음=돌파 없음) → 상충 미발생
      scores[19 as ConditionId] = 0;
      scores[20 as ConditionId] = 0;
      const result = detectContradictions(scores);
      const pair = result.contradictionPairs.find(p => p.id === 'RSI_OVERBOUGHT_VS_TURTLE');
      expect(pair?.detected).toBe(false);
    });
  });
});
