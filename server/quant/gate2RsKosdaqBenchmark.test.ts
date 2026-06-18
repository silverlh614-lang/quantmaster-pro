// @responsibility ADR-0621 Gate2 RS 벤치마크 이원화(KOSDAQ) 회귀 테스트.
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGate2ConfluenceSummary,
  buildGate2EvaluationResult,
  formatGate2ConfluenceCompact,
  isGate2RsKosdaqBenchmarkEnabled,
  type Gate2AxisScore,
  type Gate2EvaluationResult,
} from './gate2ConfluenceScore.js';

const FLAG = 'GATE2_RS_KOSDAQ_BENCHMARK_ENABLED';

afterEach(() => {
  delete process.env[FLAG];
});

/**
 * RS 축이 RETURN20D_MINUS_INDEX/KOSDAQ 경로로 들어가도록 rsScore/relativeReturn20d 를 비운 trace.
 * 디버전스 재현: 코스피 +1.55 / 코스닥 −1.6. 코스닥 종목 return20d=+3 이면
 *  - KOSPI 벤치마크 excess = 3 − 1.55 = 1.45 → NEUTRAL(score 50)
 *  - KOSDAQ 벤치마크 excess = 3 − (−1.6) = 4.6 → ACCUMULATING(score 70)
 */
function rsTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: '035720',
    gate1Passed: true,
    market: 'KOSDAQ',
    kospi20dReturn: 1.55,
    kosdaq20dReturn: -1.6,
    symbolFeatures: {
      return20d: 3,
    },
    ...overrides,
  };
}

function rs(result: Gate2EvaluationResult): Gate2AxisScore {
  const axis = result.axes.find(a => a.axis === 'RS_RELATIVE_STRENGTH');
  if (!axis) throw new Error('RS axis missing');
  return axis;
}

describe('ADR-0621 Gate2 RS KOSDAQ benchmark dualization', () => {
  it('flag SSOT — default OFF, true 일 때만 ON', () => {
    expect(isGate2RsKosdaqBenchmarkEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isGate2RsKosdaqBenchmarkEnabled({ [FLAG]: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isGate2RsKosdaqBenchmarkEnabled({ [FLAG]: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('(a) flag OFF → KOSPI 단일 벤치마크 경로 byte-equivalent (KOSDAQ 종목)', () => {
    const result = buildGate2EvaluationResult({ trace: rsTrace(), sourceSnapshotId: 'snap' });
    const axis = rs(result);
    // KOSPI 벤치마크 excess = 3 − 1.55 = 1.45 → NEUTRAL(50)
    expect(axis.source).toBe('RETURN20D_MINUS_INDEX');
    expect(axis.status).toBe('NEUTRAL');
    expect(axis.score).toBe(50);
  });

  it('(b) flag ON + KOSDAQ 종목 → KOSDAQ 벤치마크 적용·excess 변화 (NEUTRAL→ACCUMULATING)', () => {
    process.env[FLAG] = 'true';
    const result = buildGate2EvaluationResult({ trace: rsTrace(), sourceSnapshotId: 'snap' });
    const axis = rs(result);
    // KOSDAQ 벤치마크 excess = 3 − (−1.6) = 4.6 → ACCUMULATING(70)
    expect(axis.source).toBe('RETURN20D_MINUS_KOSDAQ');
    expect(axis.status).toBe('ACCUMULATING');
    expect(axis.score).toBe(70);
    expect(axis.evidence.some(e => e.includes('benchmarkKey=KOSDAQ'))).toBe(true);
  });

  it('(c) flag ON + KOSPI 종목 → KOSPI 벤치마크 유지 (KOSDAQ 배선 무영향)', () => {
    process.env[FLAG] = 'true';
    const result = buildGate2EvaluationResult({
      trace: rsTrace({ symbol: '005930', market: 'KOSPI' }),
      sourceSnapshotId: 'snap',
    });
    const axis = rs(result);
    // KOSPI 종목 → KOSPI 벤치마크 excess = 3 − 1.55 = 1.45 → NEUTRAL(50) (현행 동치)
    expect(axis.source).toBe('RETURN20D_MINUS_INDEX');
    expect(axis.status).toBe('NEUTRAL');
    expect(axis.score).toBe(50);
  });

  it('(d) flag ON + KOSDAQ 종목인데 kosdaq20dReturn 결손 → KOSPI fallback (결손 ≠ bearish)', () => {
    process.env[FLAG] = 'true';
    const result = buildGate2EvaluationResult({
      trace: rsTrace({ kosdaq20dReturn: undefined }),
      sourceSnapshotId: 'snap',
    });
    const axis = rs(result);
    // KOSDAQ source 결손 → normalizer 가 KOSPI fallback → 현행 KOSPI 경로 유지
    expect(axis.source).toBe('RETURN20D_MINUS_INDEX');
    expect(axis.status).toBe('NEUTRAL');
    expect(axis.score).toBe(50);
  });

  it('(e) dry-run 상시 산출 (flag OFF 여도 stamp)', () => {
    const result = buildGate2EvaluationResult({ trace: rsTrace(), sourceSnapshotId: 'snap' });
    const axis = rs(result);
    expect(axis.rsKosdaqBenchmarkDryRun).toBeDefined();
    const dry = axis.rsKosdaqBenchmarkDryRun!;
    expect(dry.benchmarkKey).toBe('KOSDAQ');
    expect(dry.appliedSource).toBe('RETURN20D_MINUS_KOSDAQ');
    expect(dry.benchmarkReturn20d).toBe(-1.6);
    expect(dry.excess).toBeCloseTo(4.6, 5);
    expect(dry.score).toBe(70);
    expect(dry.status).toBe('ACCUMULATING');
    // per-symbol roll-up 동일 stamp
    expect(result.rsKosdaqBenchmarkDryRun).toEqual(dry);
  });

  it('(f) dry-run wouldChangeStatus — KOSDAQ 벤치마크가 현행 KOSPI status 를 바꿀 때만 true', () => {
    // KOSPI NEUTRAL(50) vs KOSDAQ ACCUMULATING(70) → 변경
    const changed = rs(buildGate2EvaluationResult({ trace: rsTrace(), sourceSnapshotId: 'snap' }));
    expect(changed.rsKosdaqBenchmarkDryRun!.wouldChangeStatus).toBe(true);

    // 동일 status 케이스: return20d=20 이면 KOSPI excess 18.45·KOSDAQ excess 21.6 → 둘 다 BULLISH(100)
    const unchanged = rs(buildGate2EvaluationResult({
      trace: rsTrace({ symbolFeatures: { return20d: 20 } }),
      sourceSnapshotId: 'snap',
    }));
    expect(unchanged.rsKosdaqBenchmarkDryRun!.status).toBe('BULLISH');
    expect(unchanged.rsKosdaqBenchmarkDryRun!.wouldChangeStatus).toBe(false);
  });

  it('(g) summary wouldStrong/WeakIfKosdaqBenchmark 집계 + compact 텍스트 노출 (flag OFF)', () => {
    const summary = buildGate2ConfluenceSummary({
      traces: [
        rsTrace(),                                            // NEUTRAL→ACCUMULATING : weak 집계
        rsTrace({ symbol: '247540', symbolFeatures: { return20d: 10 } }), // KOSPI excess 8.45(BULLISH)·KOSDAQ excess 11.6(BULLISH) → 무변경
        rsTrace({ symbol: '086520', symbolFeatures: { return20d: 6 } }),  // KOSPI excess 4.45(ACC)·KOSDAQ excess 7.6(ACC) → 무변경
      ],
      sourceSnapshotId: 'snap',
    });
    // 035720 만 NEUTRAL→ACCUMULATING (wouldChange + ACC) → weak 집계 1, strong 집계 0
    expect(summary.wouldWeakIfKosdaqBenchmark).toBe(1);
    expect(summary.wouldStrongIfKosdaqBenchmark).toBe(0);
    const text = formatGate2ConfluenceCompact(summary);
    expect(text).toContain('kosdaqBenchmarkDryRun:');
    expect(text).toContain('rsStrong=0');
    expect(text).toContain('rsAccumOrBetter=1');
  });

  it('(g2) summary wouldStrongIfKosdaqBenchmark — WEAK→BULLISH flip 집계', () => {
    // 코스닥 종목 return20d = 6, 코스피 +10 / 코스닥 −10:
    //  KOSPI excess = 6 − 10 = −4 → WEAK(25) / KOSDAQ excess = 6 − (−10) = 16 → BULLISH(100)
    const summary = buildGate2ConfluenceSummary({
      traces: [rsTrace({ kospi20dReturn: 10, kosdaq20dReturn: -10, symbolFeatures: { return20d: 6 } })],
      sourceSnapshotId: 'snap',
    });
    expect(summary.wouldStrongIfKosdaqBenchmark).toBe(1);
    expect(summary.wouldWeakIfKosdaqBenchmark).toBe(1); // BULLISH 도 accumOrBetter 에 포함
  });

  it('(h) RS 점수 구간/임계 불변 — 동일 excess 면 KOSPI/KOSDAQ 경로 점수 동일', () => {
    process.env[FLAG] = 'true';
    // KOSPI 종목 excess = 3 − (−5) = 8 → BULLISH(85)
    const kospi = rs(buildGate2EvaluationResult({
      trace: rsTrace({ symbol: '005930', market: 'KOSPI', kospi20dReturn: -5 }),
      sourceSnapshotId: 'snap',
    }));
    // KOSDAQ 종목 excess = 3 − (−5) = 8 → BULLISH(85) (동일 excess → 동일 점수: rsScoreFromExcess 불변)
    const kosdaq = rs(buildGate2EvaluationResult({
      trace: rsTrace({ kosdaq20dReturn: -5 }),
      sourceSnapshotId: 'snap',
    }));
    expect(kospi.score).toBe(85);
    expect(kospi.status).toBe('BULLISH');
    expect(kosdaq.score).toBe(85);
    expect(kosdaq.status).toBe('BULLISH');
  });

  it('(i) market 미상(UNKNOWN) → KOSPI fallback (현행 동치)', () => {
    process.env[FLAG] = 'true';
    const result = buildGate2EvaluationResult({
      trace: rsTrace({ symbol: 'XYZ', market: undefined }),
      sourceSnapshotId: 'snap',
    });
    const axis = rs(result);
    // market 미상 → normalizer benchmarkKey UNKNOWN → KOSPI ctx fallback → 현행 경로
    expect(axis.source).toBe('RETURN20D_MINUS_INDEX');
    expect(axis.rsKosdaqBenchmarkDryRun!.appliedSource).toBe('RETURN20D_MINUS_INDEX');
  });

  it('(j) flag OFF dry-run 은 gate2Status 에 영향 0 (dry-run 산출만)', () => {
    const off = buildGate2EvaluationResult({ trace: rsTrace(), sourceSnapshotId: 'snap' });
    // dry-run 이 ACCUMULATING(70) 을 산출해도 실제 RS 축은 NEUTRAL(50) 유지 → 점수 미반영
    expect(rs(off).score).toBe(50);
    expect(rs(off).rsKosdaqBenchmarkDryRun!.score).toBe(70);
  });
});
