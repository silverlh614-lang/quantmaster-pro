// @responsibility ADR-0541 starvation audit supply-wiring regression (persist-stage minSignalComponents).
import { describe, expect, it } from 'vitest';
import {
  buildGate1ScoreStarvationTraceFromGateResult,
  buildPositiveScoreStarvationReport,
  type Gate1ScoreStarvationTrace,
} from './gate1PositiveScoreStarvation.js';
import {
  accumulatePositiveScoreStarvation,
  createScanCounters,
} from './scanDiagnostics.js';

/**
 * Mirrors the exact call-shape that persistScanResults.ts builds from each
 * entryFilter.gate1CandidateTraces[i].minSignalScoreTrace (ADR-0541 wiring).
 *
 * Scale contract (§6.4): minSignalScoreTrace.requiredScore / actualScore / component
 * weightedScores are all ABSOLUTE 0~100-scale. scoreScale:1 keeps requiredScore and
 * rawScore unscaled; component weightedScores are used raw by the consumer. This is the
 * only coherent combination — passing gateRawScore (0~15) or scoreScale:10 would
 * double-scale and corrupt actualScore/requiredScore relative to grossPositiveScore.
 */
function buildTraceFromMinSignal(input: {
  symbol: string;
  name?: string;
  requiredScore: number;
  actualScore: number;
  components: ReadonlyArray<{ code: string; weightedScore: number; maxScore: number; confidence?: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'MISSING' | 'DIAGNOSTIC_ONLY'; message?: string }>;
  availableMaxScore?: number;
  normalizedGateScore?: number;
}): Gate1ScoreStarvationTrace {
  const watchlist = input.components.find((c) => c.code === 'WATCHLIST_UPSTREAM_SCORE')?.weightedScore;
  return buildGate1ScoreStarvationTraceFromGateResult({
    symbol: input.symbol,
    name: input.name,
    requiredScore: input.requiredScore,
    gateResult: {
      rawScore: input.actualScore,
      availableMaxScore: input.availableMaxScore,
      normalizedGateScore: input.normalizedGateScore,
    },
    minSignalComponents: input.components,
    watchlistScore: watchlist,
    upstreamScore: watchlist,
    scoreScale: 1,
  });
}

const CANONICAL_COMPONENTS = [
  { code: 'PRICE_MOMENTUM', weightedScore: 16, maxScore: 20, confidence: 'VERIFIED' as const },
  { code: 'VOLUME_LIQUIDITY', weightedScore: 9, maxScore: 12, confidence: 'VERIFIED' as const },
  { code: 'TECHNICAL_TREND', weightedScore: 11, maxScore: 14, confidence: 'VERIFIED' as const },
  { code: 'RELATIVE_STRENGTH', weightedScore: 7, maxScore: 10, confidence: 'VERIFIED' as const },
  { code: 'WATCHLIST_UPSTREAM_SCORE', weightedScore: 8, maxScore: 10, confidence: 'VERIFIED' as const },
  { code: 'BREAKOUT_STRUCTURE', weightedScore: 5, maxScore: 10, confidence: 'VERIFIED' as const },
];

describe('ADR-0541 starvation audit supply wiring', () => {
  // T1 — supply integrity: canonical PRICE_MOMENTUM is attributed from the
  // minimumSignalScoreTrace.components source with its exact weightedScore, never
  // leaking into OTHER_POSITIVE.
  it('T1 attributes CORE_SIGNAL contributions from minSignalScoreTrace.components, not OTHER_POSITIVE', () => {
    const trace = buildTraceFromMinSignal({
      symbol: '005930',
      name: 'Samsung',
      requiredScore: 60,
      actualScore: 56,
      components: CANONICAL_COMPONENTS,
    });

    const momentum = trace.positiveComponents.find((c) => c.code === 'PRICE_MOMENTUM');
    expect(momentum?.source).toBe('minimumSignalScoreTrace.components');
    expect(momentum?.weightedScore).toBe(16);
    expect(trace.zeroContributionComponents).not.toContain('PRICE_MOMENTUM');

    // No CORE_SIGNAL value leaked into OTHER_POSITIVE.
    const otherPositive = trace.positiveComponents.find((c) => c.code === 'OTHER_POSITIVE');
    expect(otherPositive?.weightedScore ?? 0).toBe(0);

    // grossPositiveScore equals the canonical component sum (16+9+11+7+8+5 = 56).
    expect(trace.grossPositiveScore).toBe(56);
  });

  // T1b — scale coherence: with scoreScale:1, requiredScore/actualScore stay on the
  // same 0~100 scale as grossPositiveScore (no double scaling). A double-scaled
  // (scoreScale:10) build would inflate requiredScore to 600 — explicitly NOT what
  // the wiring does.
  it('T1b keeps requiredScore/actualScore coherent on the 0~100 scale (no double scale)', () => {
    const trace = buildTraceFromMinSignal({
      symbol: '000660',
      requiredScore: 60,
      actualScore: 56,
      components: CANONICAL_COMPONENTS,
    });
    expect(trace.requiredScore).toBe(60);
    expect(trace.actualScore).toBe(56);
    expect(trace.scoreGap).toBeCloseTo(-4, 5);

    // Contrast: the double-scaled variant would have corrupted these figures.
    const doubleScaled = buildGate1ScoreStarvationTraceFromGateResult({
      symbol: '000660',
      requiredScore: 60,
      gateResult: { rawScore: 56 },
      minSignalComponents: CANONICAL_COMPONENTS,
      scoreScale: 10,
    });
    expect(doubleScaled.requiredScore).toBe(600);
    expect(doubleScaled.actualScore).toBe(560);
    // grossPositiveScore stays 56 either way (components are used raw), proving the
    // mismatch the wiring avoids by choosing scoreScale:1.
    expect(doubleScaled.grossPositiveScore).toBe(56);
  });

  // T2 — fallback byte-equivalence: when minSignalComponents is absent, the legacy
  // gateResult.outputs path is preserved (PR #1316 behaviour unchanged).
  it('T2 preserves the legacy outputs path when minSignalComponents is absent', () => {
    const legacy = buildGate1ScoreStarvationTraceFromGateResult({
      symbol: '005930',
      requiredScore: 7,
      gateResult: {
        rawScore: 4,
        outputs: [
          { key: 'momentum', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
          { key: 'volume_breakout', output: { score: 0.6, status: 'PASS' } },
        ],
      },
      scoreScale: 10,
    });
    expect(legacy.positiveComponents.find((c) => c.code === 'PRICE_MOMENTUM')?.source).toBe('evaluateServerGate.outputs');
    expect(legacy.positiveComponents.find((c) => c.code === 'VOLUME_LIQUIDITY')?.weightedScore).toBe(6);
  });

  // T3 — coverage: a candidate set of N accumulated traces yields a report whose
  // totalCandidates is exactly N (candidateSet, not a buyList subset).
  it('T3 report.totalCandidates equals the accumulated candidate-set size', () => {
    const counters = createScanCounters();
    const symbols = ['000001', '000002', '000003', '000004', '000005'];
    for (const symbol of symbols) {
      accumulatePositiveScoreStarvation(
        counters,
        buildTraceFromMinSignal({ symbol, requiredScore: 60, actualScore: 50, components: CANONICAL_COMPONENTS }),
      );
    }
    const report = buildPositiveScoreStarvationReport({
      traces: counters.positiveScoreStarvationTraces,
      timestamp: '2026-05-29T00:00:00.000Z',
      forDate: '2026-05-29',
      regime: 'R4_NEUTRAL',
      marketSession: 'BUY_ALLOWED',
    });
    expect(report.totalCandidates).toBe(symbols.length);
    expect(report.requiredScoreAvg).toBe(60);
    expect(report.actualScoreAvg).toBe(50);
  });

  // T4 — exception safety: a candidate whose minSignalScoreTrace is missing is simply
  // skipped (the wiring guards `if (!minSignal) continue;`); accumulation never throws.
  it('T4 skips candidates without a minSignalScoreTrace without throwing', () => {
    const counters = createScanCounters();
    // Simulate the wiring loop guard: only candidates with a trace are accumulated.
    const candidates: Array<{ minSignal?: typeof CANONICAL_COMPONENTS }> = [
      { minSignal: CANONICAL_COMPONENTS },
      { minSignal: undefined },
      { minSignal: CANONICAL_COMPONENTS },
    ];
    expect(() => {
      for (const [i, candidate] of candidates.entries()) {
        if (!candidate.minSignal) continue;
        accumulatePositiveScoreStarvation(
          counters,
          buildTraceFromMinSignal({
            symbol: `0000${i}`,
            requiredScore: 60,
            actualScore: 50,
            components: candidate.minSignal,
          }),
        );
      }
    }).not.toThrow();
    expect(counters.positiveScoreStarvationTraces.length).toBe(2);
  });

  // T5 — executionImpact stays NONE: the report and every calibration scenario it
  // produces are advisory only.
  it('T5 report calibration results are all executionImpact NONE', () => {
    const report = buildTraceFromMinSignal({ symbol: '005930', requiredScore: 60, actualScore: 56, components: CANONICAL_COMPONENTS });
    const full = buildPositiveScoreStarvationReport({
      traces: [report],
      timestamp: '2026-05-29T00:00:00.000Z',
      forDate: '2026-05-29',
      regime: 'R4_NEUTRAL',
      marketSession: 'BUY_ALLOWED',
    });
    expect(full.calibrationResults.every((r) => r.executionImpact === 'NONE')).toBe(true);
  });
});
