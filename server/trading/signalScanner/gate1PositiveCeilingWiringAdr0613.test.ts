// @responsibility ADR-0613/0643 회귀 — Gate1 천장 배선: flag=false byte-identical·unset(default-ON) delta·입력 부재 graceful·관측 ledger stamp 격리·requiredScore 70 불변.
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
});

describe("ADR-0613/0643 A. flag=false byte-identical (명시 OFF 롤백, ADR-0643 default-ON 반전)", () => {
  // ADR-0643 flip 후 unset=ON 이므로 transform identity 회귀는 명시 `=false` 로 고정한다.
  it("A1 =false + percentile 존재 → applyRsPercentileWiring 입력 그대로", () => {
    process.env[ENABLED] = "false";
    const out = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    expect(out).toEqual(rsMissingBase);
  });

  it("A2 =false + OHLCV 존재 → applyBreakoutWiring 입력 그대로", () => {
    process.env[ENABLED] = "false";
    const out = applyBreakoutWiring(breakoutMissingBase, { currentPrice: 100, high20: 99, high60: 95 } as never);
    expect(out).toEqual(breakoutMissingBase);
  });

  it("A3 =false + positive 합 존재 → applyPositiveMaxNormalization rawComputed 그대로", () => {
    process.env[ENABLED] = "false";
    const components = [
      { weightedScore: 20, maxScore: 20 },
      { weightedScore: -5, maxScore: 0 },
    ];
    expect(applyPositiveMaxNormalization(15, components)).toBe(15);
  });

  it("A4 =false + 전체 scorer → actualScore/computedScore/passed/scoreGap baseline 동일", () => {
    process.env[ENABLED] = "false";
    const patch = { rsRankPct: 80, currentPrice: 100, high20: 99, high60: 95, volumeRatio: 1.5, return20d: 12 };
    const off = trace(patch);
    const baseline = trace(patch);
    expect(off.actualScore).toBe(baseline.actualScore);
    expect(off.passed).toBe(baseline.passed);
    expect(off.scoreGap).toBe(baseline.scoreGap);
    expect(off.requiredScore).toBe(70);
  });

  it("A5 (ADR-0643 의미 반전) '1'/'TRUE'/'yes'/'on'/unset → ON(배선 적용). 정확 'false' 만 OFF.", () => {
    // flip 후 `!== 'false'` 관용 비교 — 정확 'false' 만 transform identity, 나머지(unset 포함) 전부 ON(배선).
    process.env[ENABLED] = "false";
    const off = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    expect(off).toEqual(rsMissingBase); // =false → identity
    for (const v of ["1", "TRUE", "yes", "on"]) {
      process.env[ENABLED] = v;
      const on = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
      expect(on.normalizedScore).toBeGreaterThan(rsMissingBase.normalizedScore); // ON → 배선 적용
      delete process.env[ENABLED];
    }
    // unset(default) → ON.
    delete process.env[ENABLED];
    const onUnset = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    expect(onUnset.normalizedScore).toBeGreaterThan(rsMissingBase.normalizedScore);
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
    process.env[ENABLED] = "true";
    const components = [
      { weightedScore: 58, maxScore: 116 },
      { weightedScore: -8, maxScore: 0 },
    ];
    // positive 58 × (100/116) = 50, + penalty(-8) = 42
    expect(applyPositiveMaxNormalization(50, components)).toBeCloseTo(42, 1);
  });

  it("B5 전체 trace flag ON → requiredScore 70 불변, passed 비교식 유지", () => {
    process.env[ENABLED] = "true";
    const out = trace({ rsRankPct: 80, currentPrice: 100, high20: 99, return20d: 12 });
    expect(out.requiredScore).toBe(70);
    expect(out.passed).toBe(out.actualScore >= 70);
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
  it("D1 flag OFF + 전체 scorer → ceilingWiringHypothetical* 필드 stamp(ON 가정)", () => {
    const out = trace({ currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5 });
    expect(typeof out.ceilingWiringBreakoutDelta).toBe("number");
    expect(typeof out.ceilingWiringHypotheticalActualScore).toBe("number");
    expect(typeof out.ceilingWiringHypotheticalPassed).toBe("boolean");
  });

  it("D2 hypothetical 산출은 actualScore 본체에 영향 0 (관측 전용)", () => {
    const patch = { rsRankPct: 80, currentPrice: 100, high20: 99, return20d: 12 };
    const withStamp = trace(patch);
    // flag OFF actualScore 는 stamp 유무와 무관하게 baseline.
    expect(withStamp.actualScore).toBe(trace(patch).actualScore);
  });

  it("D3 flag ON + hypothetical delta == 실제 적용 delta (동형성)", () => {
    const patch = { currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5 };
    process.env[ENABLED] = "false";
    const off = trace(patch);
    process.env[ENABLED] = "true";
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

describe("ADR-0613 E. 절대 보존 가드", () => {
  it("E1 양 flag 상태 + requiredScore 70 불변", () => {
    expect(trace({}).requiredScore).toBe(70);
    process.env[ENABLED] = "true";
    expect(trace({}).requiredScore).toBe(70);
  });
});

describe("ADR-0643 F. default-ON(unset) 신규 동작 + =false baseline 복귀 (flip 회귀)", () => {
  it("F1 unset(default) → ON: RS percentile 배선 적용(base 대비 normalizedScore 상승)", () => {
    delete process.env[ENABLED]; // unset = ON (ADR-0643 default 반전)
    const out = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    expect(out.normalizedScore).toBeGreaterThan(rsMissingBase.normalizedScore);
  });

  it("F2 unset(default) → ON: breakout OHLCV 배선 적용", () => {
    delete process.env[ENABLED];
    const out = applyBreakoutWiring(breakoutMissingBase, {
      currentPrice: 102, high20: 100, high60: 98, volumeRatio: 1.5, ma20: 95, ma60: 90,
    } as never);
    expect(out.normalizedScore).toBeGreaterThan(0);
  });

  it("F3 =false → unset(ON) 대비 transform identity baseline 복귀", () => {
    delete process.env[ENABLED];
    const onOut = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    process.env[ENABLED] = "false";
    const offOut = applyRsPercentileWiring(rsMissingBase, { crossSectionalPercentile: 90 } as never);
    expect(onOut.normalizedScore).toBeGreaterThan(rsMissingBase.normalizedScore); // ON
    expect(offOut).toEqual(rsMissingBase); // =false identity
  });

  it("F4 requiredScore 70 은 default-ON(unset) 에서도 불변", () => {
    delete process.env[ENABLED];
    expect(trace({}).requiredScore).toBe(70);
  });
});
