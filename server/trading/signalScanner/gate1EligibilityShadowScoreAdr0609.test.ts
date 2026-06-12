// @responsibility ADR-0609 Gate1 상수블록 eligibility shadow 판정 순수 산출 회귀 (적격성 진리표·결손 보류·market-only/percentile 경계·관측 마커).
import { describe, expect, it } from 'vitest';
import {
  buildGate1EligibilityShadowReportAdr0609,
  judgeGate1EligibilityAdr0609,
  GATE1_ELIGIBILITY_SHADOW_THRESHOLDS,
  type Gate1EligibilityShadowInputRow,
} from './gate1EligibilityShadowScoreAdr0609.js';

function row(
  overrides: Partial<Gate1EligibilityShadowInputRow> & { symbol?: string } = {},
): Gate1EligibilityShadowInputRow {
  return {
    symbol: 'A',
    marketBlockScore: 50,
    totalPercentile: 80,
    ...overrides,
  };
}

function components(
  watchlist?: number,
  regime?: number,
  investor?: number,
  providerIssue?: { watchlist?: boolean; regime?: boolean; investor?: boolean },
): { code: string; weightedScore: number; providerIssue?: boolean }[] {
  const out: { code: string; weightedScore: number; providerIssue?: boolean }[] = [];
  if (watchlist !== undefined) out.push({ code: 'WATCHLIST_PRIORITY', weightedScore: watchlist, providerIssue: providerIssue?.watchlist });
  if (regime !== undefined) out.push({ code: 'MARKET_REGIME', weightedScore: regime, providerIssue: providerIssue?.regime });
  if (investor !== undefined) out.push({ code: 'INVESTOR_FLOW', weightedScore: investor, providerIssue: providerIssue?.investor });
  return out;
}

describe('judgeGate1EligibilityAdr0609 — eligibility 진리표', () => {
  it('완전 적격 — WATCHLIST 8 && REGIME 6 && INVESTOR 8 → eligible (비결손)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: components(8, 6, 8) }));
    expect(j.eligible).toBe(true);
    expect(j.eligibilityDegraded).toBe(false);
  });

  it('WATCHLIST_PRIORITY 0(심볼 무효 등) → 부적격 (존재하는 명시 값으로 탈락)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: components(0, 6, 8) }));
    expect(j.eligible).toBe(false);
    expect(j.eligibilityDegraded).toBe(false);
  });

  it('MARKET_REGIME 음수(emergencyStop -6) → 부적격', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: components(8, -6, 8) }));
    expect(j.eligible).toBe(false);
  });

  it('INVESTOR_FLOW 음수 + providerIssue=true(UNKNOWN/STALE penalty -8) → 보류(eligible 유지, 불변식 #6)', () => {
    const j = judgeGate1EligibilityAdr0609(
      row({ eligibilityComponents: components(8, 6, -8, { investor: true }) }),
    );
    expect(j.eligible).toBe(true); // provider 장애를 bearish/부적격으로 변환 금지
    expect(j.eligibilityDegraded).toBe(true);
  });

  it('INVESTOR_FLOW 음수 + providerIssue=false(실제 매도 우위 가정) → 부적격', () => {
    const j = judgeGate1EligibilityAdr0609(
      row({ eligibilityComponents: components(8, 6, -3, { investor: false }) }),
    );
    expect(j.eligible).toBe(false);
  });

  it('MARKET_REGIME 0(경계, 비emergency) && INVESTOR 0 → 적격 (>=0 통과)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: components(8, 0, 0) }));
    expect(j.eligible).toBe(true);
    expect(j.eligibilityDegraded).toBe(false);
  });
});

describe('judgeGate1EligibilityAdr0609 — 불변식 #6 결손→보류(보수 통과, bearish 변환 0)', () => {
  it('상수 컴포넌트 전부 부재(positiveComponents 없음) → eligible 유지 + degraded 라벨', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: undefined }));
    expect(j.eligible).toBe(true); // 결손→탈락 절대 금지
    expect(j.eligibilityDegraded).toBe(true);
  });

  it('INVESTOR_FLOW 부재(UNKNOWN provider) → 나머지 정상이면 보수 통과 (bearish 변환 0)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: components(8, 6, undefined) }));
    expect(j.eligible).toBe(true);
    expect(j.eligibilityDegraded).toBe(true);
  });

  it('MARKET_REGIME 부재 + WATCHLIST 0(명시 부적격) → 명시 값이 탈락시킴 (결손은 보류, 존재값만 작동)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ eligibilityComponents: components(0, undefined, 8) }));
    expect(j.eligible).toBe(false);
    expect(j.eligibilityDegraded).toBe(true);
  });

  it('비유한 weightedScore(NaN) → 결손과 동일 보류 처리 (탈락 금지)', () => {
    const j = judgeGate1EligibilityAdr0609(
      row({ eligibilityComponents: [{ code: 'WATCHLIST_PRIORITY', weightedScore: Number.NaN }] }),
    );
    expect(j.eligible).toBe(true);
    expect(j.eligibilityDegraded).toBe(true);
  });
});

describe('judgeGate1EligibilityAdr0609 — marketOnlyPassed 42 경계 + null(결손≠탈락)', () => {
  it('marketBlockScore=42(임계 동일) → 통과', () => {
    expect(GATE1_ELIGIBILITY_SHADOW_THRESHOLDS.marketOnlyMinScore).toBe(42);
    const j = judgeGate1EligibilityAdr0609(row({ marketBlockScore: 42, eligibilityComponents: components(8, 6, 8) }));
    expect(j.marketOnlyPassed).toBe(true);
  });

  it('marketBlockScore=41.9 → 미통과', () => {
    const j = judgeGate1EligibilityAdr0609(row({ marketBlockScore: 41.9 }));
    expect(j.marketOnlyPassed).toBe(false);
  });

  it('marketBlockScore=null(시장 컴포넌트 결손) → null(미평가), false 아님 (불변식 #6)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ marketBlockScore: null }));
    expect(j.marketOnlyPassed).toBeNull();
  });
});

describe('judgeGate1EligibilityAdr0609 — percentilePassed 70 경계', () => {
  it('totalPercentile=70(임계 동일) → 통과', () => {
    expect(GATE1_ELIGIBILITY_SHADOW_THRESHOLDS.percentileMinPercentile).toBe(70);
    const j = judgeGate1EligibilityAdr0609(row({ totalPercentile: 70 }));
    expect(j.percentilePassed).toBe(true);
  });

  it('totalPercentile=69.9 → 미통과', () => {
    const j = judgeGate1EligibilityAdr0609(row({ totalPercentile: 69.9 }));
    expect(j.percentilePassed).toBe(false);
  });

  it('totalPercentile 비유한 → 미통과 (안전)', () => {
    const j = judgeGate1EligibilityAdr0609(row({ totalPercentile: Number.NaN }));
    expect(j.percentilePassed).toBe(false);
  });
});

describe('buildGate1EligibilityShadowReportAdr0609 — 집계 + 관측 마커', () => {
  it('eligibleCount/marketOnlyPassCount/percentilePassCount + degraded/unevaluated 집계', () => {
    const report = buildGate1EligibilityShadowReportAdr0609([
      row({ symbol: 'A', marketBlockScore: 50, totalPercentile: 90, eligibilityComponents: components(8, 6, 8) }),
      row({ symbol: 'B', marketBlockScore: 30, totalPercentile: 60, eligibilityComponents: components(0, 6, 8) }),
      row({ symbol: 'C', marketBlockScore: null, totalPercentile: 75, eligibilityComponents: undefined }),
    ]);
    expect(report.candidates).toBe(3);
    expect(report.eligibleCount).toBe(2); // A eligible, C 보류 통과, B 부적격
    expect(report.eligibilityDegradedCount).toBe(1); // C
    expect(report.marketOnlyPassCount).toBe(1); // A(50>=42)
    expect(report.marketOnlyUnevaluatedCount).toBe(1); // C(null)
    expect(report.percentilePassCount).toBe(2); // A(90), C(75)
  });

  it('빈 심볼 무시 + 관측 전용 마커 고정', () => {
    const report = buildGate1EligibilityShadowReportAdr0609([
      { symbol: '', marketBlockScore: 50, totalPercentile: 80 },
      row({ symbol: 'A', eligibilityComponents: components(8, 6, 8) }),
    ]);
    expect(report.candidates).toBe(1);
    expect(report.executionImpact).toBe('NONE');
    expect(report.thresholdAutoChanged).toBe(false);
    expect(report.operatorApprovalRequired).toBe(true);
  });
});
