// @responsibility ADR-0325 Phase 1 gateThresholdAutoTuning 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateThresholdShift,
  findOptimalThreshold,
  isGateThresholdAutoTuningDisabled,
  ROC_MIN_SAMPLE,
  ROC_MIN_SHIFT_PCT,
  type ScoredOutcome,
} from './gateThresholdAutoTuning.js';

const ORIGINAL_DISABLED = process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED;

beforeEach(() => {
  delete process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED;
  else process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = ORIGINAL_DISABLED;
});

describe('SSOT 상수 (ADR-0325)', () => {
  it('ROC_MIN_SAMPLE = 30', () => {
    expect(ROC_MIN_SAMPLE).toBe(30);
  });
  it('ROC_MIN_SHIFT_PCT = 5', () => {
    expect(ROC_MIN_SHIFT_PCT).toBe(5);
  });
});

describe('isGateThresholdAutoTuningDisabled — ENV (ADR-0157)', () => {
  it('미설정 → false', () => {
    expect(isGateThresholdAutoTuningDisabled()).toBe(false);
  });
  it('"true" → true', () => {
    process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = 'true';
    expect(isGateThresholdAutoTuningDisabled()).toBe(true);
  });
  it('"1" / "TRUE" → false (정확 비교)', () => {
    process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = '1';
    expect(isGateThresholdAutoTuningDisabled()).toBe(false);
    process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = 'TRUE';
    expect(isGateThresholdAutoTuningDisabled()).toBe(false);
  });
});

function makeSamples(wins: number[], losses: number[]): ScoredOutcome[] {
  return [
    ...wins.map(score => ({ score, outcome: 'WIN' as const })),
    ...losses.map(score => ({ score, outcome: 'LOSS' as const })),
  ];
}

describe('findOptimalThreshold', () => {
  it('빈 표본 → null + INSUFFICIENT', () => {
    const r = findOptimalThreshold([]);
    expect(r.threshold).toBeNull();
    expect(r.youdenJ).toBeNull();
    expect(r.winSample).toBe(0);
    expect(r.lossSample).toBe(0);
  });

  it('표본 < 30 → null', () => {
    const r = findOptimalThreshold(makeSamples([3, 4, 5], [1, 2]));
    expect(r.threshold).toBeNull();
    expect(r.winSample).toBe(3);
    expect(r.lossSample).toBe(2);
  });

  it('완벽 분리 — WIN 모두 score≥3 / LOSS 모두 score<3 → 권장 임계=3', () => {
    const wins = Array(20).fill(0).map((_, i) => 3 + (i % 3));   // score 3,4,5,...
    const losses = Array(20).fill(0).map((_, i) => i % 3);        // score 0,1,2,...
    const r = findOptimalThreshold(makeSamples(wins, losses));
    expect(r.threshold).toBe(3);
    expect(r.youdenJ).toBe(1);
    expect(r.confusion).toEqual({ tp: 20, fp: 0, fn: 0, tn: 20 });
  });

  it('NaN/Infinity score → 자동 제외', () => {
    const samples: ScoredOutcome[] = [
      { score: NaN, outcome: 'WIN' },
      { score: Infinity, outcome: 'LOSS' },
      ...makeSamples(Array(15).fill(5), Array(15).fill(1)),
    ];
    const r = findOptimalThreshold(samples);
    expect(r.winSample).toBe(15);
    expect(r.lossSample).toBe(15);
    expect(r.threshold).not.toBeNull();
  });

  it('alocator 표본 — 30건 정확 → 산출 (boundary)', () => {
    const r = findOptimalThreshold(makeSamples(Array(15).fill(5), Array(15).fill(1)));
    expect(r.winSample + r.lossSample).toBe(30);
    expect(r.threshold).not.toBeNull();
  });

  it('29건 → INSUFFICIENT (boundary 미만)', () => {
    const r = findOptimalThreshold(makeSamples(Array(15).fill(5), Array(14).fill(1)));
    expect(r.threshold).toBeNull();
  });

  it('ENV DISABLED → null (양 표본 충분해도)', () => {
    process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = 'true';
    const r = findOptimalThreshold(makeSamples(Array(20).fill(5), Array(20).fill(1)));
    expect(r.threshold).toBeNull();
    expect(r.winSample).toBe(0);
  });

  it('tie-break — 동일 J 최대 시 가장 낮은 임계 선택 (보수적 진입 보존)', () => {
    // WIN/LOSS 모두 score 5 — 어떤 임계든 J=0
    const r = findOptimalThreshold(makeSamples(Array(15).fill(5), Array(15).fill(5)));
    expect(r.threshold).toBe(5);
  });

  it('outcome 외 값 자동 제외 (타입 안전)', () => {
    // ADR-0418 baseline cleanup — `@ts-expect-error` 가 더 이상 필요하지 않은 정합 상태로
    // 진화함에 따라 명시적 cast 로 대체. 의도된 잘못된 outcome 시나리오는 보존.
    const samples = [
      ...makeSamples(Array(15).fill(5), Array(15).fill(1)),
      { score: 100, outcome: 'PENDING' as unknown as 'WIN' | 'LOSS' },
    ];
    const r = findOptimalThreshold(samples);
    expect(r.winSample).toBe(15);
    expect(r.lossSample).toBe(15);
  });
});

describe('evaluateThresholdShift', () => {
  it('표본 부족 → insufficient_sample', () => {
    const r = evaluateThresholdShift(2.0, makeSamples([3], [1]));
    expect(r.decision).toBe('insufficient_sample');
  });

  it('ENV DISABLED → disabled', () => {
    process.env.GATE_THRESHOLD_AUTO_TUNING_DISABLED = 'true';
    const r = evaluateThresholdShift(2.0, makeSamples(Array(20).fill(5), Array(20).fill(1)));
    expect(r.decision).toBe('disabled');
    expect(r.suggestedThreshold).toBeNull();
  });

  it('권장 > 현재 → tighten', () => {
    // WIN score 5 / LOSS score 1 → optimal=5. current=2 → tighten (+150%)
    const r = evaluateThresholdShift(2.0, makeSamples(Array(20).fill(5), Array(20).fill(1)));
    expect(r.decision).toBe('tighten');
    expect(r.suggestedThreshold).toBe(5);
    expect(r.shiftPct).toBeGreaterThan(0);
  });

  it('권장 < 현재 → loosen', () => {
    // WIN score 2 / LOSS score 0 → optimal=2. current=5 → loosen (-60%)
    const r = evaluateThresholdShift(5.0, makeSamples(Array(20).fill(2), Array(20).fill(0)));
    expect(r.decision).toBe('loosen');
    expect(r.suggestedThreshold).toBe(2);
    expect(r.shiftPct).toBeLessThan(0);
  });

  it('변동 < 5% → hold', () => {
    // optimal=2.0 / current=2.04 → shift = +2% < 5%
    const wins = Array(20).fill(2.0);
    const losses = Array(20).fill(0);
    const r = evaluateThresholdShift(2.04, makeSamples(wins, losses));
    expect(r.decision).toBe('hold');
  });

  it('현재 0 — divide-by-zero 방지 → shiftPct=0 → hold', () => {
    const r = evaluateThresholdShift(0, makeSamples(Array(20).fill(2), Array(20).fill(0)));
    expect(r.decision).toBe('hold');
    expect(r.shiftPct).toBe(0);
  });

  it('boundary 정확 ±5% → tighten/loosen (≥ 비교)', () => {
    // 5% 정확 — Math.abs >= 5 분기로 tighten. 4.9% 는 hold
    // 사실 코드는 abs<5 → hold, 그 외 분기. 5 정확 → 분기 통과.
    const wins = Array(20).fill(2.1);
    const losses = Array(20).fill(0);
    const r = evaluateThresholdShift(2.0, makeSamples(wins, losses));
    expect(r.decision).toBe('tighten');
    expect(r.shiftPct).toBeCloseTo(5, 0);
  });
});
