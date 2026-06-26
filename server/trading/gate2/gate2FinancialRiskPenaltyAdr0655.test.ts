// @responsibility ADR-0655 Gate2 재무위험 순수 평가 테스트 — trigger/scoreCap/graceful 결손/불변식 #6 literal.

import { describe, expect, it } from 'vitest';
import { assessGate2FinancialRisk } from './gate2FinancialRiskPenaltyAdr0655.js';

describe('assessGate2FinancialRisk (ADR-0655)', () => {
  it('ICR<1 단독 → ELEVATED·triggers=[ICR_BELOW_1]·scoreCap=30', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 0.5, debtRatio: 100 });
    expect(r.riskLevel).toBe('ELEVATED');
    expect(r.triggers).toEqual(['ICR_BELOW_1']);
    expect(r.scoreCap).toBe(30);
    expect(r.icrAvailability).toBe('PRESENT');
    expect(r.debtRatioAvailability).toBe('PRESENT');
  });

  it('debtRatio>200 단독 → ELEVATED·triggers=[DEBT_RATIO_EXCESS]·scoreCap=30', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 5, debtRatio: 250 });
    expect(r.riskLevel).toBe('ELEVATED');
    expect(r.triggers).toEqual(['DEBT_RATIO_EXCESS']);
    expect(r.scoreCap).toBe(30);
  });

  it('ICR<1 AND debtRatio>200 → CRITICAL·triggers 2개·scoreCap=15', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 0.3, debtRatio: 300 });
    expect(r.riskLevel).toBe('CRITICAL');
    expect(r.triggers).toEqual(['ICR_BELOW_1', 'DEBT_RATIO_EXCESS']);
    expect(r.scoreCap).toBe(15);
  });

  it('둘 다 null → NONE·scoreCap=null (graceful 결손, 페널티 미적용)', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: null, debtRatio: null });
    expect(r.riskLevel).toBe('NONE');
    expect(r.triggers).toEqual([]);
    expect(r.scoreCap).toBeNull();
    expect(r.icrAvailability).toBe('MISSING');
    expect(r.debtRatioAvailability).toBe('MISSING');
  });

  it('둘 다 정상(ICR=1.5·debtRatio=150) → NONE·scoreCap=null', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 1.5, debtRatio: 150 });
    expect(r.riskLevel).toBe('NONE');
    expect(r.triggers).toEqual([]);
    expect(r.scoreCap).toBeNull();
  });

  it('한쪽 결손(ICR<1·debtRatio=null) → ELEVATED (가용 trigger 만)', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 0.8, debtRatio: null });
    expect(r.riskLevel).toBe('ELEVATED');
    expect(r.triggers).toEqual(['ICR_BELOW_1']);
    expect(r.scoreCap).toBe(30);
    expect(r.debtRatioAvailability).toBe('MISSING');
  });

  it('한쪽 결손(debtRatio>200·ICR=null) → ELEVATED (debtRatio 결손 아님, ICR graceful skip)', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: null, debtRatio: 250 });
    expect(r.riskLevel).toBe('ELEVATED');
    expect(r.triggers).toEqual(['DEBT_RATIO_EXCESS']);
    expect(r.scoreCap).toBe(30);
    expect(r.icrAvailability).toBe('MISSING');
  });

  it('경계값 — ICR=1(임계 동일)·debtRatio=200(임계 동일) → NONE (strict < / > )', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 1, debtRatio: 200 });
    expect(r.riskLevel).toBe('NONE');
    expect(r.triggers).toEqual([]);
    expect(r.scoreCap).toBeNull();
  });

  it('불변식 #6 — entryHardBlock=false·marketSignal=false·executionImpact=NONE 항상 (위험 종목)', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 0.1, debtRatio: 999 });
    expect(r.entryHardBlock).toBe(false);
    expect(r.marketSignal).toBe(false);
    expect(r.executionImpact).toBe('NONE');
  });

  it('불변식 #6 — 결손/정상 종목도 literal 보존', () => {
    for (const r of [
      assessGate2FinancialRisk({ interestCoverageRatio: null, debtRatio: null }),
      assessGate2FinancialRisk({ interestCoverageRatio: 3, debtRatio: 50 }),
    ]) {
      expect(r.entryHardBlock).toBe(false);
      expect(r.marketSignal).toBe(false);
      expect(r.executionImpact).toBe('NONE');
    }
  });

  it('evidence trace 에 riskLevel·triggers·실측 ICR/부채값 노출', () => {
    const r = assessGate2FinancialRisk({ interestCoverageRatio: 0.5, debtRatio: 300 });
    expect(r.evidence).toContain('gate2FinancialRisk=CRITICAL');
    expect(r.evidence).toContain('riskTriggers=[ICR_BELOW_1,DEBT_RATIO_EXCESS]');
    expect(r.evidence).toContain('riskIcr=0.5');
    expect(r.evidence).toContain('riskDebtRatio=300');
    expect(r.evidence).toContain('riskScoreCap=15');
  });
});
