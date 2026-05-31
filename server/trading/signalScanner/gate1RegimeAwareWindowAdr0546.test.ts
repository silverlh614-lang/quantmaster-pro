// @responsibility ADR-0546 Phase2 regime-aware window 회귀 — forward 통계 + 창 필터 + verdict 임계. executionImpact=NONE.

import { describe, expect, it } from 'vitest';
import {
  computeForwardWindowStats,
  buildGate1RegimeAwareWindowRollup,
  formatGate1RegimeAwareWindowLines,
} from './gate1RegimeAwareWindowAdr0546.js';
import { getRegimeAwareGate1RequiredScore, LEGACY_GATE1_REQUIRED_SCORE } from '../gateConfig.js';
import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';

function row(partial: Partial<Gate1DryRunObservationRow>): Gate1DryRunObservationRow {
  return { symbol: '000000', requiredScore: 70, ...partial } as Gate1DryRunObservationRow;
}

describe('ADR-0546 computeForwardWindowStats', () => {
  it('빈 집합 → 모든 통계 N/A, mature 0', () => {
    const s = computeForwardWindowStats([]);
    expect(s.matureD5).toBe(0);
    expect(s.avgReturnD5).toBe('N/A');
    expect(s.winRateD5).toBe('N/A');
    expect(s.expectancyR).toBe('N/A');
  });

  it('D5 평균/승률/expectancyR 산출 (R=3% 기준)', () => {
    const rows = [
      row({ forwardReturn5D: 6 }),   // win, +6 → R=2
      row({ forwardReturn5D: -3 }),  // loss
      row({ forwardReturn5D: 3 }),   // win, hit +3
    ];
    const s = computeForwardWindowStats(rows);
    expect(s.matureD5).toBe(3);
    expect(s.avgReturnD5).toBe(2);     // (6-3+3)/3
    expect(s.winRateD5).toBe(66.7);    // 2/3 > 0
    expect(s.expectancyR).toBe(0.7);   // avg(2,-1,1)=0.667→0.7
  });
});

describe('ADR-0546 buildGate1RegimeAwareWindowRollup', () => {
  const regime = 'R3_EARLY';
  const regimeReq = Math.round(getRegimeAwareGate1RequiredScore(regime) * 10) / 10;

  it('창=[regimeAwareRequired, 70) 안의 row 만 windowSampleCount 에 집계', () => {
    const rows = [
      row({ dryRunScore: regimeReq + 1, effectiveRegime: regime, forwardReturn5D: 2 }), // 창 안
      row({ dryRunScore: 69, effectiveRegime: regime, forwardReturn5D: 1 }),            // 창 안 (<70)
      row({ dryRunScore: 72, effectiveRegime: regime, forwardReturn5D: 5 }),            // 창 밖 (70+)
      row({ dryRunScore: regimeReq - 5, effectiveRegime: regime, forwardReturn5D: -1 }),// 창 밖 (미달)
    ];
    const roll = buildGate1RegimeAwareWindowRollup(rows, 0, 'N/A');
    expect(roll.regime).toBe(regime);
    expect(roll.regimeAwareRequiredScore).toBe(regimeReq);
    expect(roll.legacyRequiredScore).toBe(LEGACY_GATE1_REQUIRED_SCORE);
    expect(roll.windowSampleCount).toBe(2);
  });

  it('표본 부족(<30) → verdict INSUFFICIENT_SAMPLE', () => {
    const rows = [row({ dryRunScore: 65, effectiveRegime: regime, forwardReturn5D: 2 })];
    const roll = buildGate1RegimeAwareWindowRollup(rows, 5, 1.0);
    expect(roll.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('창 D5≥30 & 70+ 대조군 충분 → 평균 비교로 verdict 판정 (창 열위)', () => {
    const rows = Array.from({ length: 35 }, () =>
      row({ dryRunScore: 65, effectiveRegime: regime, forwardReturn5D: 0.2 }),
    );
    const roll = buildGate1RegimeAwareWindowRollup(rows, 40, 3.0); // 70+ 평균 3.0 >> 창 0.2
    expect(roll.forward.matureD5).toBe(35);
    expect(roll.verdict).toBe('WINDOW_UNDERPERFORMS_70PLUS');
  });

  it('regime 미상 → R4_NEUTRAL 폴백', () => {
    const roll = buildGate1RegimeAwareWindowRollup([], 0, 'N/A');
    expect(roll.regime).toBe('R4_NEUTRAL');
    expect(roll.windowSampleCount).toBe(0);
  });
});

describe('ADR-0546 formatGate1RegimeAwareWindowLines', () => {
  it('rollup 부재 → N/A skeleton', () => {
    const lines = formatGate1RegimeAwareWindowLines(undefined).join('\n');
    expect(lines).toContain('Regime-Aware Window (legacy70 vs regime-relaxed):');
    expect(lines).toContain('- regime: N/A');
    expect(lines).toContain('- verdict: INSUFFICIENT_SAMPLE');
    expect(lines).toContain('- executionImpact=NONE');
  });
});
