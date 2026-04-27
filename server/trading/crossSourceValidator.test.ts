/**
 * @responsibility crossSourceValidator SSOT 회귀 테스트 (ADR-0071)
 *
 * 검증:
 *   1) computeDivergencePct: 정상/null/0 분모/NaN/Infinity
 *   2) evaluateCrossSource 6 tier (AGREED / WARN / CRITICAL / PRIMARY_ONLY / SECONDARY_ONLY / NO_DATA)
 *   3) 사용자 보고 시나리오: Yahoo 1380 vs ECOS 1474 격차 6.81% → CRITICAL
 *   4) 임계 경계값 정확성 (3% / 5%)
 *   5) ECOS_API_KEY 미설정 (secondary=null) graceful fallback
 *   6) formatDivergenceTier 한국어 라벨
 */
import { describe, expect, it } from 'vitest';

import {
  computeDivergencePct,
  DEFAULT_DIVERGENCE_THRESHOLDS,
  evaluateCrossSource,
  formatDivergenceTier,
  type DivergenceTier,
} from './crossSourceValidator';

describe('computeDivergencePct — 격차 % 계산', () => {
  it('정상: 100 vs 95 → 5.263%', () => {
    expect(computeDivergencePct(100, 95)).toBeCloseTo(5.263, 2);
  });
  it('동일 값 → 0%', () => {
    expect(computeDivergencePct(1474, 1474)).toBe(0);
  });
  it('사용자 시나리오 Yahoo 1380 vs ECOS 1474 → 6.378%', () => {
    expect(computeDivergencePct(1380, 1474)).toBeCloseTo(6.378, 2);
  });
  it('primary null → null', () => {
    expect(computeDivergencePct(null, 1474)).toBeNull();
  });
  it('secondary null → null', () => {
    expect(computeDivergencePct(1380, null)).toBeNull();
  });
  it('secondary 0 → null (분모 방어)', () => {
    expect(computeDivergencePct(1380, 0)).toBeNull();
  });
  it('NaN → null', () => {
    expect(computeDivergencePct(NaN, 1474)).toBeNull();
    expect(computeDivergencePct(1380, NaN)).toBeNull();
  });
  it('Infinity → null', () => {
    expect(computeDivergencePct(Infinity, 1474)).toBeNull();
  });
  it('소수점 3자리 정확 round', () => {
    const pct = computeDivergencePct(100, 99);
    expect(pct).toBe(1.01);  // |100-99|/99*100 = 1.0101...
  });
});

describe('evaluateCrossSource — tier 분기 (ADR-0071 §2.1)', () => {
  it('AGREED: 격차 1% (warn 임계 미만) → primary 사용', () => {
    const r = evaluateCrossSource(100, 99, 'TEST');
    expect(r.tier).toBe('AGREED');
    expect(r.selected).toBe(100);
    expect(r.selectedSource).toBe('PRIMARY');
    expect(r.diverged).toBe(false);
    expect(r.message).toBe('');
  });

  it('AGREED boundary: 격차 정확히 3% 미만 (2.99%) → primary', () => {
    const r = evaluateCrossSource(100.01, 100 / (1 - 0.0299), 'TEST');
    // computeDivergencePct: (100.01 - 100/(0.9701)) / abs(...) ~ very small
    // 단순화: 100 vs 102.99 — 격차 = 2.903%
    const r2 = evaluateCrossSource(100, 102.99, 'TEST');
    expect(r2.tier).toBe('AGREED');
  });

  it('WARN: 격차 정확히 3% → secondary 우선', () => {
    const r = evaluateCrossSource(100, 103, 'TEST');
    // 격차 = |100-103|/103*100 = 2.913%
    // 정확히 3% 만들려면: secondary=100, primary=103 → 3%
    const r2 = evaluateCrossSource(103, 100, 'TEST');
    expect(r2.tier).toBe('WARN');
    expect(r2.selectedSource).toBe('SECONDARY');
    expect(r2.selected).toBe(100);
    expect(r2.diverged).toBe(false);  // WARN 은 alert trigger 아님
  });

  it('WARN: 격차 4% → secondary 우선', () => {
    const r = evaluateCrossSource(104, 100, 'USD/KRW');
    expect(r.tier).toBe('WARN');
    expect(r.divergencePct).toBe(4);
    expect(r.message).toContain('격차');
    expect(r.message).toContain('USD/KRW');
  });

  it('CRITICAL: 격차 정확히 5% → secondary + diverged=true (alert trigger)', () => {
    const r = evaluateCrossSource(105, 100, 'USD/KRW');
    expect(r.tier).toBe('CRITICAL');
    expect(r.divergencePct).toBe(5);
    expect(r.diverged).toBe(true);
    expect(r.selected).toBe(100);
    expect(r.selectedSource).toBe('SECONDARY');
  });

  it('CRITICAL 사용자 보고 시나리오: Yahoo 1380 vs ECOS 1474 → ECOS 우선', () => {
    const r = evaluateCrossSource(1380, 1474, 'USD/KRW');
    expect(r.tier).toBe('CRITICAL');
    expect(r.divergencePct).toBeCloseTo(6.378, 2);
    expect(r.selected).toBe(1474);
    expect(r.selectedSource).toBe('SECONDARY');
    expect(r.diverged).toBe(true);
    expect(r.message).toContain('1380');
    expect(r.message).toContain('1474');
    expect(r.message).toContain('공식');
  });

  it('PRIMARY_ONLY: secondary=null (ECOS_API_KEY 미설정) → primary 사용', () => {
    const r = evaluateCrossSource(1380, null, 'USD/KRW');
    expect(r.tier).toBe('PRIMARY_ONLY');
    expect(r.selected).toBe(1380);
    expect(r.selectedSource).toBe('PRIMARY');
    expect(r.diverged).toBe(false);
    expect(r.divergencePct).toBeNull();
  });

  it('SECONDARY_ONLY: primary=null (Yahoo fail) → secondary 사용', () => {
    const r = evaluateCrossSource(null, 1474, 'USD/KRW');
    expect(r.tier).toBe('SECONDARY_ONLY');
    expect(r.selected).toBe(1474);
    expect(r.selectedSource).toBe('SECONDARY');
    expect(r.diverged).toBe(false);
  });

  it('NO_DATA: 둘 다 null → selected=null', () => {
    const r = evaluateCrossSource(null, null, 'USD/KRW');
    expect(r.tier).toBe('NO_DATA');
    expect(r.selected).toBeNull();
    expect(r.selectedSource).toBeNull();
    expect(r.divergencePct).toBeNull();
    expect(r.diverged).toBe(false);
    expect(r.message).toContain('미수집');
  });

  it('NO_DATA fallback: secondary=0 (분모 0 방어)', () => {
    const r = evaluateCrossSource(100, 0, 'TEST');
    expect(r.tier).toBe('NO_DATA');
    expect(r.divergencePct).toBeNull();
    // 보수적 fallback: secondary 사용 (값 0 이지만 호출자가 검증)
    expect(r.selected).toBe(0);
    expect(r.selectedSource).toBe('SECONDARY');
  });
});

describe('임계값 override', () => {
  it('낮은 임계 (warn=1, critical=2) → 격차 1.5% 가 WARN', () => {
    const r = evaluateCrossSource(101.5, 100, 'TEST', { warnPct: 1, criticalPct: 2 });
    expect(r.tier).toBe('WARN');
  });
  it('높은 임계 (warn=10, critical=20) → 격차 5% 가 AGREED', () => {
    const r = evaluateCrossSource(105, 100, 'TEST', { warnPct: 10, criticalPct: 20 });
    expect(r.tier).toBe('AGREED');
  });
  it('default 임계값 검증', () => {
    expect(DEFAULT_DIVERGENCE_THRESHOLDS.warnPct).toBe(3);
    expect(DEFAULT_DIVERGENCE_THRESHOLDS.criticalPct).toBe(5);
  });
});

describe('formatDivergenceTier — 한국어 라벨', () => {
  const cases: Array<[DivergenceTier, string]> = [
    ['AGREED',         '✅ 일치'],
    ['WARN',           '🟡 격차 경고'],
    ['CRITICAL',       '❌ 격차 임계 초과'],
    ['PRIMARY_ONLY',   '🟡 primary 단독'],
    ['SECONDARY_ONLY', '🟡 secondary 단독'],
    ['NO_DATA',        '⚠️ 미수집'],
  ];
  for (const [tier, expected] of cases) {
    it(`${tier} → "${expected}"`, () => {
      expect(formatDivergenceTier(tier)).toBe(expected);
    });
  }
});

describe('thresholds 결과 노출', () => {
  it('result.thresholds 가 입력값 그대로 반영', () => {
    const r = evaluateCrossSource(100, 105, 'TEST', { warnPct: 1, criticalPct: 10 });
    expect(r.thresholds).toEqual({ warnPct: 1, criticalPct: 10 });
  });
});
