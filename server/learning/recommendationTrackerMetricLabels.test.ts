import { describe, expect, it } from 'vitest';
import { formatTransitionProgressMessage } from './recommendationTracker.js';

describe('Patch SHADOW-METRIC-LABEL-CLARITY-001 transition formatter labels', () => {
  it('전환심사 승률 분자/분모와 Shadow 전체 승률이 아님 note를 표시하고 계산값은 그대로 둔다', () => {
    const msg = formatTransitionProgressMessage({
      passCount: 2,
      totalChecks: 6,
      evaluatedSamples: 12,
      requiredSamples: 30,
      winRatePct: 41.7,
      weightedWins: 5,
      winRateTargetPct: 55,
      winRatePassed: false,
      profitFactor: 1.66,
      profitFactorPassed: true,
      mddPct: -19.58,
      mddPassed: false,
      avgHoldingDays: 6.0,
      holdingPeriodPassed: true,
      maxConsecLoss: 7,
      consecLossPassed: false,
      sampleSizePassed: false,
    });

    expect(msg).toContain('[실거래 전환 진행률]');
    expect(msg).toContain('평가 완료 샘플: 12/30');
    expect(msg).toContain('전환심사 승률: 41.7% = 5승 / 12평가 / 목표 55% ❌');
    expect(msg).toContain('전체 Shadow 승률이 아니라 실거래 전환 심사 대상 기준입니다.');
    expect(msg).toContain('전체 Shadow 종료 샘플 승률과 다를 수 있습니다.');
    expect(msg).toContain('전환심사 기준이므로 Shadow 전체 샘플 수와 다를 수 있습니다.');
    expect(msg).toContain('PF: 1.66 / 1.5 ✅');
    expect(msg).toContain('MDD: -19.58% / -10% ❌');
    expect(msg).toContain('보유기간: 6.0일 / 3~15일 ✅');
    expect(msg).toContain('연속손절: 7회 / ≤3회 ❌');
  });
});
