// @responsibility Gate1 threshold sweep (survivors@70/65/60/adaptive) diagnostic 회귀 테스트

import { describe, expect, it } from 'vitest';
import {
  accumulateGateScoreCandidateBucket,
  buildGate1ThresholdSweepSummary,
  formatGate1ThresholdSweepSection,
  createScanCounters,
} from './scanDiagnostics.js';

function captureScore(counters: ReturnType<typeof createScanCounters>, raw: number, normalThreshold: number): void {
  // accumulateGateScoreCandidateBucket 는 per-candidate gate score + normalThreshold 를 받아
  // gate1SweepScores 에 raw(또는 gateScore) 를 push 한다.
  accumulateGateScoreCandidateBucket(counters, { gateScore: raw, rawScore: raw }, normalThreshold);
}

describe('buildGate1ThresholdSweepSummary', () => {
  it('survivors@{70,65,60,adaptive} + max/avg 를 산출한다', () => {
    const counters = createScanCounters();
    for (const s of [75, 68, 62, 55]) captureScore(counters, s, 70);

    const summary = buildGate1ThresholdSweepSummary(counters);
    expect(summary).toBeDefined();
    expect(summary!.totalScored).toBe(4);
    expect(summary!.adaptiveThreshold).toBe(70);
    expect(summary!.survivorsAt70).toBe(1); // 75
    expect(summary!.survivorsAt65).toBe(2); // 75,68
    expect(summary!.survivorsAt60).toBe(3); // 75,68,62
    expect(summary!.survivorsAtAdaptive).toBe(1); // >=70
    expect(summary!.maxScore).toBe(75);
    expect(summary!.avgScore).toBe(65); // (75+68+62+55)/4
  });

  it('샘플 0 이면 undefined → 미표시', () => {
    expect(buildGate1ThresholdSweepSummary(createScanCounters())).toBeUndefined();
  });
});

describe('formatGate1ThresholdSweepSection', () => {
  it('threshold 민감 — 60 에서 생존 증가 시 해석을 표시한다', () => {
    const counters = createScanCounters();
    for (const s of [75, 68, 62, 55]) captureScore(counters, s, 70);
    const section = formatGate1ThresholdSweepSection(buildGate1ThresholdSweepSummary(counters));
    expect(section).toContain('🎯 Gate1 Threshold Sweep');
    expect(section).toContain('survivors@70: 1/4');
    expect(section).toContain('survivors@60: 3/4');
    expect(section).toContain('survivors@adaptive(70): 1/4');
    expect(section).toContain('threshold 민감');
  });

  it('60 에서도 생존 0 이면 "threshold 무관" 으로 점수 산출/데이터 문제를 가리킨다', () => {
    const counters = createScanCounters();
    for (const s of [50, 45]) captureScore(counters, s, 70);
    const section = formatGate1ThresholdSweepSection(buildGate1ThresholdSweepSummary(counters));
    expect(section).toContain('survivors@60: 0/2');
    expect(section).toContain('threshold 무관');
  });

  it('샘플 0 이면 null 로 미렌더한다', () => {
    expect(formatGate1ThresholdSweepSection(buildGate1ThresholdSweepSummary(createScanCounters()))).toBeNull();
  });
});
