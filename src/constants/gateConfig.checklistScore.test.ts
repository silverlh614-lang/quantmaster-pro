// @responsibility normalizeChecklistScore / isChecklistConditionMet 회귀 테스트
// checklist 가 boolean(AI) · 0/1(enrichment) · 0~10(점수) 어느 척도로 와도
// 게이트 통과 판정이 일관되도록 보장한다 (3-Gate "항상 0점" 결함 재발 방지).
import { describe, it, expect } from 'vitest';
import {
  normalizeChecklistScore,
  isChecklistConditionMet,
  CONDITION_PASS_THRESHOLD,
} from './gateConfig';

describe('normalizeChecklistScore', () => {
  it('boolean true 는 통과 점수(10)로 승격된다', () => {
    expect(normalizeChecklistScore(true)).toBe(10);
    expect(isChecklistConditionMet(true)).toBe(true);
  });

  it('이진 숫자 1(통과 플래그)은 10으로 승격된다 — 1 < 5 로 인한 오탈락 방지', () => {
    expect(normalizeChecklistScore(1)).toBe(10);
    expect(isChecklistConditionMet(1)).toBe(true);
  });

  it('false / 0 / null / undefined 는 0점 미통과', () => {
    for (const v of [false, 0, null, undefined]) {
      expect(normalizeChecklistScore(v)).toBe(0);
      expect(isChecklistConditionMet(v)).toBe(false);
    }
  });

  it('이미 0~10 점수는 보존된다 (manual quant 경로 호환)', () => {
    expect(normalizeChecklistScore(4)).toBe(4); // < 5 → 미통과 유지
    expect(isChecklistConditionMet(4)).toBe(false);
    expect(normalizeChecklistScore(7)).toBe(7); // ≥ 5 → 통과 유지
    expect(isChecklistConditionMet(7)).toBe(true);
    expect(normalizeChecklistScore(CONDITION_PASS_THRESHOLD)).toBe(5);
    expect(isChecklistConditionMet(CONDITION_PASS_THRESHOLD)).toBe(true);
  });

  it('10 초과 점수는 10으로 clamp', () => {
    expect(normalizeChecklistScore(42)).toBe(10);
  });

  it('비정상 타입(string 등)은 0점 처리', () => {
    expect(normalizeChecklistScore('yes' as unknown)).toBe(0);
    expect(normalizeChecklistScore({} as unknown)).toBe(0);
  });
});
