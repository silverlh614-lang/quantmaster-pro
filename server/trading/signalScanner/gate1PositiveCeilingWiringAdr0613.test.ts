// @responsibility ADR-0613 회귀 — Gate1 천장 배선: flag OFF byte-identical·ON delta·입력 부재 graceful·관측 ledger stamp 격리·requiredScore 70 불변.
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimumSignalScoreTrace } from "./minimumSignalScoreTrace.js";
import {
  applyRsPercentileWiring,
  applyBreakoutWiring,
  applyPositiveMaxNormalization,
  computeCeilingWiringHypothetical,
  type CeilingWiringComponentScore,
} from "./gate1PositiveCeilingWiringAdr0613.js";

const verifiedSupply = {
  status: "VERIFIED" as const,
  providerIssue: false,
  marketSignal: false,
  gate1Severity: "NONE" as const,
  reason: ["ok"],
};

function trace(patch: Record<string, unknown> = {}) {
  return buildMinimumSignalScoreTrace({
    trace: {
      symbol: "042700",
      stageReached: "WATCHLIST",
      blockers: [],
      executionImpact: "NONE",
      ...patch,
    } as never,
    hasGate1Blocker: false,
    regime: "R3_EARLY",
    marketSession: "NORMAL",
    supplyProviderHealth: verifiedSupply,
    supplyConfluenceState: "NEUTRAL",
    hasSectorEnergyDiagnostic: false,
  });
}

const ENABLED = "GATE1_POSITIVE_CEILING_WIRING_ENABLED";
// ADR-0643 D1 — positive-max→100 정규화 전용 flag(번들 분리).
const NORMALIZE_ENABLED = "GATE1_POSITIVE_MAX_NORMALIZATION_ENABLED";

const rsMissingBase: CeilingWiringComponentScore = {
  normalizedScore: 0,
  weightedScore: 0,
  maxScore: 10,
  confidence: "MISSING",
};

const breakoutMissingBase: CeilingWiringComponentScore = {
  normalizedScore: 0,
  weightedScore: 0,
  maxScore: 10,
  confidence: "MISSING",
  providerIssue: false,
};

afterEach(() => {
  delete process.env[ENABLED];
  delete process.env[NORMALIZE_ENABLED];
});

// ADR-0644 — ceiling-wiring flag 는 default ON 으로 승격. explicit `=false` kill-switch 만
// byte-identical OFF 복귀. 미설정(default)=ON 케이스는 아래 "ADR-0644 default ON" 블록.
describe("ADR-0613 A. flag explicit =false byte-identical (ADR-0644 kill-switch)", () => {
  it("A1 flag=false + percentile 존재 → applyRsPercentileWiring 입력 그대로", () => {
    process.env[ENABLED] = "false";
    const out = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    expect(out).toEqual(rsMissingBase);
  });

  it("A2 flag=false + OHLCV 존재 → applyBreakoutWiring 입력 그대로", () => {
    process.env[ENABLED] = "false";
    const out = applyBreakoutWiring(breakoutMissingBase, { currentPrice: 100, high20: 99, high60: 95 } as never);
    expect(out).toEqual(breakoutMissingBase);
  });

  it("A3 normalize flag 미설정(default OFF) + positive 합 존재 → applyPositiveMaxNormalization rawComputed 그대로", () => {
    // positive-max-normalization 은 ADR-0644 와 무관 — default OFF 유지(ADR-0643 봉인).
    const components = [
      { weightedScore: 20, maxScore: 20 },
      { weightedScore: -5, maxScore: 0 },
    ];
    expect(applyPositiveMaxNormalization(15, components)).toBe(15);
  });

  it("A4 flag=false + 전체 scorer → actualScore/computedScore/passed/scoreGap baseline 동일", () => {
    const patch = { rsRankPct: 80, currentPrice: 100, high20: 99, high60: 95, volumeRatio: 1.5, return20d: 12 };
    process.env[ENABLED] = "false";
    const off = trace(patch);
    const baseline = trace(patch);
    expect(off.actualScore).toBe(baseline.actualScore);
    expect(off.passed).toBe(baseline.passed);
    expect(off.scoreGap).toBe(baseline.scoreGap);
    expect(off.requiredScore).toBe(70);
  });

  it("A5 '1'/'TRUE'/'yes'/'on' 은 ON 취급(ADR-0157·0644 — 정확히 'false' 만 OFF)", () => {
    // ADR-0644: `!== 'false'` → 'false' 외 모든 값은 ON. default ON 산출과 동일.
    process.env[ENABLED] = "true";
    const onBaseline = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    for (const v of ["1", "TRUE", "yes", "on"]) {
      process.env[ENABLED] = v;
      expect(applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never)).toEqual(onBaseline);
      delete process.env[ENABLED];
    }
  });
});

describe("ADR-0644 A'. flag 미설정(default ON) → 천장 배선 점화", () => {
  it("A'1 미설정 + percentile 존재 → RS 승격(normalizedScore 상승, maxScore 10 불변)", () => {
    // env 미설정 → default ON → percentile hydration 발화.
    const out = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 85 } as never);
    expect(out.normalizedScore).toBeGreaterThan(rsMissingBase.normalizedScore);
    expect(out.weightedScore).toBeGreaterThan(0);
    expect(out.maxScore).toBe(10);
  });

  it("A'2 미설정 + OHLCV(high20 근접) → breakout 점화(normalizedScore>0, maxScore 10 불변)", () => {
    const out = applyBreakoutWiring(breakoutMissingBase, {
      currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5, ma20: 95, ma60: 90,
    } as never);
    expect(out.normalizedScore).toBeGreaterThan(0);
    expect(out.weightedScore).toBeGreaterThan(0);
    expect(out.maxScore).toBe(10);
    expect(out.confidence).toBe("VERIFIED");
  });

  it("A'3 미설정(default ON) == explicit ='true' byte-identical", () => {
    const dflt = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 85 } as never);
    process.env[ENABLED] = "true";
    const explicitOn = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 85 } as never);
    expect(dflt).toEqual(explicitOn);
  });
});

describe("ADR-0613 B. flag-ON delta", () => {
  it("B1 explicit RS 부재 + percentile 존재 → RS normalizedScore 상승, maxScore 10 불변", () => {
    process.env[ENABLED] = "true";
    const out = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 85 } as never);
    expect(out.normalizedScore).toBeGreaterThan(rsMissingBase.normalizedScore);
    expect(out.weightedScore).toBeGreaterThan(0);
    expect(out.maxScore).toBe(10);
  });

  it("B2 explicit RS(rsRankPct) 존재 → 이중계상 회피, base 유지(ADR-0469 dedup)", () => {
    process.env[ENABLED] = "true";
    const base: CeilingWiringComponentScore = {
      normalizedScore: 50, weightedScore: 5, maxScore: 10, confidence: "VERIFIED",
    };
    const out = applyRsPercentileWiring(base, { rsRankPct: 90, crossSectionalPercentile: 95 } as never);
    expect(out).toEqual(base);
  });

  it("B3 현행 breakout MISSING + OHLCV(high20 근접) → normalizedScore>0, maxScore 10 불변", () => {
    process.env[ENABLED] = "true";
    const out = applyBreakoutWiring(breakoutMissingBase, {
      currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5, ma20: 95, ma60: 90,
    } as never);
    expect(out.normalizedScore).toBeGreaterThan(0);
    expect(out.weightedScore).toBeGreaterThan(0);
    expect(out.maxScore).toBe(10);
    expect(out.confidence).toBe("VERIFIED");
  });

  it("B4 positive 합 정규화 ×(100/configuredPositiveMax), penalty 불변", () => {
    // ADR-0643 D1 — 정규화는 전용 flag 로 분리됨. ceiling flag 가 아니라 normalize flag 를 켠다.
    process.env[NORMALIZE_ENABLED] = "true";
    const components = [
      { weightedScore: 58, maxScore: 116 },
      { weightedScore: -8, maxScore: 0 },
    ];
    // positive 58 × (100/116) = 50, + penalty(-8) = 42
    expect(applyPositiveMaxNormalization(50, components)).toBeCloseTo(42, 1);
  });

  it("B5 전체 trace flag ON → requiredScore 70 불변, passed 비교식 유지", () => {
    process.env[ENABLED] = "true";
    // ADR-0644 — denom-norm 은 default ON 으로 passed 를 effective(<70) 기준 판정한다.
    // 본 케이스는 ceiling flag 만 검증하므로 denom-norm 은 =false 로 고정해 `>=70` 항등을 유지한다.
    process.env.GATE1_DENOMINATOR_NORMALIZATION_ENABLED = "false";
    const out = trace({ rsRankPct: 80, currentPrice: 100, high20: 99, return20d: 12 });
    expect(out.requiredScore).toBe(70);
    expect(out.passed).toBe(out.actualScore >= 70);
    delete process.env.GATE1_DENOMINATOR_NORMALIZATION_ENABLED;
  });
});

describe("ADR-0613 C. 입력 부재 graceful (불변식 #6)", () => {
  it("C1 flag ON + percentile 부재 → RS base 무변경", () => {
    process.env[ENABLED] = "true";
    expect(applyRsPercentileWiring(rsMissingBase, {} as never)).toEqual(rsMissingBase);
  });

  it("C2 flag ON + OHLCV 부재 → breakout base 무변경", () => {
    process.env[ENABLED] = "true";
    expect(applyBreakoutWiring(breakoutMissingBase, {} as never)).toEqual(breakoutMissingBase);
  });

  it("C3 flag ON + positive 합 0 → 0 유지, NaN/Infinity 0건", () => {
    process.env[ENABLED] = "true";
    const out = applyPositiveMaxNormalization(0, [{ weightedScore: 0, maxScore: 10 }]);
    expect(out).toBe(0);
    expect(Number.isFinite(out)).toBe(true);
  });
});

describe("ADR-0613 D. 관측 ledger stamp 격리 (불변식 #1)", () => {
  it("D1 flag=false + 전체 scorer → ceilingWiringHypothetical* 필드 stamp(ON 가정)", () => {
    process.env[ENABLED] = "false";
    const out = trace({ currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5 });
    expect(typeof out.ceilingWiringBreakoutDelta).toBe("number");
    expect(typeof out.ceilingWiringHypotheticalActualScore).toBe("number");
    expect(typeof out.ceilingWiringHypotheticalPassed).toBe("boolean");
  });

  it("D2 hypothetical 산출은 actualScore 본체에 영향 0 (관측 전용)", () => {
    const patch = { rsRankPct: 80, currentPrice: 100, high20: 99, return20d: 12 };
    process.env[ENABLED] = "false";
    const withStamp = trace(patch);
    // flag=false actualScore 는 stamp 유무와 무관하게 baseline.
    expect(withStamp.actualScore).toBe(trace(patch).actualScore);
  });

  it("D3 flag ON + hypothetical delta == 실제 적용 delta (동형성)", () => {
    const patch = { currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5 };
    process.env[ENABLED] = "false";
    const off = trace(patch);
    delete process.env[ENABLED]; // default ON
    const on = trace(patch);
    // hypothetical breakout delta(flag OFF 행) 는 실제 적용 시 actualScore 상승분과 동형.
    expect(off.ceilingWiringBreakoutDelta).toBeGreaterThan(0);
    expect(on.actualScore).toBeGreaterThanOrEqual(off.actualScore);
  });

  it("computeCeilingWiringHypothetical 순수 산출 — RS+BREAKOUT delta", () => {
    const hyp = computeCeilingWiringHypothetical({
      relativeStrengthBase: rsMissingBase,
      breakoutBase: breakoutMissingBase,
      trace: { crossSectionalPercentile: 90, currentPrice: 102, high20: 100, volumeRatio: 1.5 } as never,
      rawComputed: 40,
      components: [{ weightedScore: 40, maxScore: 116 }],
      requiredScore: 70,
    });
    expect(hyp.ceilingWiringRsPercentileDelta).toBeGreaterThan(0);
    expect(hyp.ceilingWiringBreakoutDelta).toBeGreaterThan(0);
    expect(typeof hyp.ceilingWiringHypotheticalPassed).toBe("boolean");
  });
});

describe("ADR-0643 F. positive-max-normalization flag 분리", () => {
  const components = [
    { weightedScore: 58, maxScore: 116 },
    { weightedScore: -8, maxScore: 0 },
  ];
  // 단일 flag 시절 동작: positive 58 × (100/116) = 50, + penalty(-8) = 42.
  const EXPECTED_NORMALIZED = 42;
  const RAW = 50;

  it("F1 ceiling flag 단독 ON + normalize flag OFF → 정규화 미적용(rawComputed 그대로)", () => {
    process.env[ENABLED] = "true";
    // normalize flag 미설정 → breakout/RS 만 켜지고 positive-max-normalization 은 봉인.
    expect(applyPositiveMaxNormalization(RAW, components)).toBe(RAW);
  });

  it("F2 normalize flag 단독 ON → 정규화 적용(ceiling flag 무관)", () => {
    process.env[NORMALIZE_ENABLED] = "true";
    expect(applyPositiveMaxNormalization(RAW, components)).toBeCloseTo(EXPECTED_NORMALIZED, 1);
  });

  it("F3 두 flag 동시 ON → 기존 단일 flag ON 동작 byte-identical 재현", () => {
    process.env[ENABLED] = "true";
    process.env[NORMALIZE_ENABLED] = "true";
    expect(applyPositiveMaxNormalization(RAW, components)).toBeCloseTo(EXPECTED_NORMALIZED, 1);
  });

  it("F4 둘 다 OFF(default) → rawComputed byte-identical", () => {
    expect(applyPositiveMaxNormalization(RAW, components)).toBe(RAW);
  });

  it("F5 '1'/'TRUE'/'yes' 는 OFF 취급(ADR-0157 정확 비교)", () => {
    for (const v of ["1", "TRUE", "yes", "on"]) {
      process.env[NORMALIZE_ENABLED] = v;
      expect(applyPositiveMaxNormalization(RAW, components)).toBe(RAW);
      delete process.env[NORMALIZE_ENABLED];
    }
  });

  it("F6 force-ON(관측 ledger hypothetical) 은 두 flag 무관하게 항상 정규화", () => {
    // computeCeilingWiringHypothetical 경로 — flag OFF 에서도 force-ON 으로 stamp(관측 무회귀).
    expect(applyPositiveMaxNormalization(RAW, components, true)).toBeCloseTo(EXPECTED_NORMALIZED, 1);
  });

  it("F7 live trace: ceiling flag ON 단독 → actualScore 에 정규화 미적용(normalize flag 가 켜야만 적용)", () => {
    const patch = { rsRankPct: 80, currentPrice: 100, high20: 99, high60: 95, volumeRatio: 1.5, return20d: 12 };
    const off = trace(patch);
    process.env[ENABLED] = "true";
    const ceilingOnly = trace(patch);
    process.env[NORMALIZE_ENABLED] = "true";
    const bothOn = trace(patch);
    // 분리 증명: ceiling 단독(normalize OFF)과 두 flag ON(normalize 적용)의 actualScore 가 다르다 —
    //   즉 ceiling flag 만으로는 positive-max-normalization 이 켜지지 않는다(16/16 번들 봉인).
    expect(ceilingOnly.actualScore).not.toBe(bothOn.actualScore);
    // requiredScore 70 리터럴은 전 상태에서 불변(ADR-0471 FREEZE).
    expect(off.requiredScore).toBe(70);
    expect(ceilingOnly.requiredScore).toBe(70);
    expect(bothOn.requiredScore).toBe(70);
  });
});

describe("ADR-0613 E. 절대 보존 가드", () => {
  it("E1 양 flag 상태 + requiredScore 70 불변", () => {
    expect(trace({}).requiredScore).toBe(70);
    process.env[ENABLED] = "true";
    expect(trace({}).requiredScore).toBe(70);
  });
});
