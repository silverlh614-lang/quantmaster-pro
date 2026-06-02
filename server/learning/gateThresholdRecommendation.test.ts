import { describe, expect, it } from 'vitest';
import {
  GATE2_PASS_THRESHOLD,
  buildGateThresholdRecommendationReport,
  buildGateThresholdRecommendations,
  formatGateThresholdRecommendationLines,
} from './gateThresholdRecommendation.js';
import { GATE2_PASS_WEAK_MIN_SCORE } from '../quant/gate2ConfluenceScore.js';
import type { GateScoredOutcome } from './gateScoredOutcomeProjection.js';

function g1(outcome: 'WIN' | 'LOSS', scalar: number, regime = 'R3_EARLY'): GateScoredOutcome {
  return { gate: 'GATE1', scalar, scale: 10, outcome, regime, forwardReturnD5Pct: outcome === 'WIN' ? 5 : -1, symbol: 'X' };
}
function g3(outcome: 'WIN' | 'LOSS', scalar: number): GateScoredOutcome {
  return { gate: 'GATE3', scalar, scale: 1, outcome, regime: 'UNKNOWN', forwardReturnD5Pct: outcome === 'WIN' ? 5 : -1, symbol: 'Y' };
}

describe('counterfacture_gate Phase C — gateThresholdRecommendation', () => {
  it('Gate1: ≥30 clean-separated samples → tighten 권고, current=70(SSOT)', () => {
    const recs = buildGateThresholdRecommendations([
      ...Array.from({ length: 20 }, () => g1('WIN', 75)),
      ...Array.from({ length: 20 }, () => g1('LOSS', 60)),
    ]);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    expect(rec).toMatchObject({ gate: 'GATE1', regime: 'R3_EARLY', scale: 10, sampleSize: 40 });
    expect(rec.shift.currentThreshold).toBe(70); // resolveGate1RequiredScore SSOT (flag OFF), 하드코딩 아님
    expect(rec.shift.suggestedThreshold).toBe(75);
    expect(rec.shift.decision).toBe('tighten');
    expect(rec.liveThresholdAutoChanged).toBe(false);
    expect(rec.operatorApprovalRequired).toBe(true);
    expect(rec.executionImpact).toBe('NONE');
  });

  it('Gate3: rrrPassMin=2 SSOT 사용, clean samples → tighten to 3', () => {
    const recs = buildGateThresholdRecommendations([
      ...Array.from({ length: 16 }, () => g3('WIN', 3)),
      ...Array.from({ length: 16 }, () => g3('LOSS', 1.5)),
    ]);
    const g3rec = recs.find((r) => r.gate === 'GATE3');
    expect(g3rec?.shift.currentThreshold).toBe(2);
    expect(g3rec?.shift.suggestedThreshold).toBe(3);
    expect(g3rec?.shift.decision).toBe('tighten');
  });

  it('표본 < 30 → insufficient_sample, 임계 변경 없음', () => {
    const recs = buildGateThresholdRecommendations([g1('WIN', 75), g1('LOSS', 60)]);
    expect(recs[0].shift.decision).toBe('insufficient_sample');
    expect(recs[0].shift.suggestedThreshold).toBeNull();
  });

  it('Gate2 — confluence 임계(65) 경유 권고 생성(표본 부족 시 insufficient_sample)', () => {
    const g2: GateScoredOutcome = { gate: 'GATE2', scalar: 70, scale: 10, outcome: 'WIN', regime: 'R3_EARLY', forwardReturnD5Pct: 5, symbol: 'Z' };
    const recs = buildGateThresholdRecommendations([g2]);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ gate: 'GATE2' });
    expect(recs[0].shift.currentThreshold).toBe(65);
    expect(recs[0].shift.decision).toBe('insufficient_sample');
  });

  it('Phase H: Gate2 임계는 gate2ConfluenceScore SSOT 와 단일 출처(drift 불가)', () => {
    expect(GATE2_PASS_THRESHOLD).toBe(GATE2_PASS_WEAK_MIN_SCORE);
    expect(GATE2_PASS_THRESHOLD).toBe(65);
  });

  it('report builder + formatter — 안전 footer 와 verdict 렌더', async () => {
    const report = await buildGateThresholdRecommendationReport({
      outcomes: [
        ...Array.from({ length: 20 }, () => g1('WIN', 75)),
        ...Array.from({ length: 20 }, () => g1('LOSS', 60)),
      ],
      generatedAtKst: '2026-06-02T16:00:00+09:00',
    });
    expect(report.liveThresholdAutoChanged).toBe(false);
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.executionImpact).toBe('NONE');
    const text = formatGateThresholdRecommendationLines(report).join('\n');
    expect(text).toContain('Gate Threshold ROC 권고');
    expect(text).toContain('liveThresholdAutoChanged=false');
    expect(text).toContain('GATE1 / R3_EARLY');
    expect(text).toContain('TIGHTEN');
  });

  it('mature 표본 없음 → 빈 권고 + 안내 라인', async () => {
    const report = await buildGateThresholdRecommendationReport({ outcomes: [], generatedAtKst: '2026-06-02T16:00:00+09:00' });
    expect(report.recommendations).toHaveLength(0);
    expect(formatGateThresholdRecommendationLines(report).join('\n')).toContain('mature 표본 없음');
  });
});
