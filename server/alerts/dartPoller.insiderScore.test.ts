/**
 * dartPoller.insiderScore.test.ts — Phase 4-⑤ 내부자 매수 가산점 조건부 회귀.
 */

import { describe, it, expect } from 'vitest';
import { computeInsiderBuyScore } from './dartPoller.js';

describe('computeInsiderBuyScore — 임원 직접 매수 vs 일반 지분공시', () => {
  it('임원 키워드 포함 → 4점 (고신뢰 고확신)', () => {
    expect(computeInsiderBuyScore('임원ㆍ주요주주특정증권등소유상황보고서')).toBe(4);
  });

  it('대량보유상황보고서(대주주) → 4점', () => {
    expect(computeInsiderBuyScore('주식등의 대량보유상황보고서')).toBe(4);
  });

  it('장내 취득 (대량 변동 신호) → 4점', () => {
    expect(computeInsiderBuyScore('특수관계인 장내매수 취득')).toBe(4);
  });

  it('단순 변동보고서 → 2점 (일반 확인 신호)', () => {
    expect(computeInsiderBuyScore('특정증권등 소유상황 변동보고서')).toBe(2);
  });

  it('소규모 지분 이동 → 2점', () => {
    expect(computeInsiderBuyScore('주요주주 소액 지분 변경')).toBe(2);
  });
});
