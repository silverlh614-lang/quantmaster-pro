// @responsibility ADR-0627 회귀 — Gate1 RS percentile 연속 승격(GAP-A)·breakout OHLCV high20d 필드 정정(GAP-B)·D3 관측 hypothetical: 양 flag OFF byte-identical·weight/required/천장 불변.
import { afterEach, describe, expect, it } from "vitest";
import { buildEntryFilterDecomposition } from "./entryFilterDecomposition.js";
import { buildMinimumSignalScoreTrace } from "./minimumSignalScoreTrace.js";
import {
  applyBreakoutWiring,
  computeRsContinuousHypothetical,
  type CeilingWiringComponentScore,
} from "./gate1PositiveCeilingWiringAdr0613.js";

const RS_CONTINUOUS = "GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED";
const CEILING_WIRING = "GATE1_POSITIVE_CEILING_WIRING_ENABLED";

const now = new Date("2026-06-18T01:00:00.000Z");

function macro() {
  return {
    emergencyStop: false,
    autoTradeEnabled: true,
    regime: "R3_EARLY",
    kellyMultiplierFromRegime: 0.7,
    fomcPhase: "NORMAL",
    fomcKellyMultiplier: 1,
    finalKellyMultiplier: 0.26,
    vixGatingActive: false,
    bearDefenseMode: false,
    mhsBelow30: false,
    watchlistEmpty: false,
    sellOnlyMode: false,
  };
}

// 5종목 횡단면 universe — relativeReturn20d 강→약으로 rsRankPct 100/75/50/25/0 산출.
// (pct = ((N-1 - index)/(N-1))*100, N=5 → 100,75,50,25,0)
function rsUniverse() {
  return [
    { symbol: "U1", quoteFeatures: { relativeReturn20d: 20 } },
    { symbol: "U2", quoteFeatures: { relativeReturn20d: 12 } },
    { symbol: "U3", quoteFeatures: { relativeReturn20d: 6 } },
    { symbol: "U4", quoteFeatures: { relativeReturn20d: 2 } },
    { symbol: "U5", quoteFeatures: { relativeReturn20d: -4 } },
  ];
}

function decomposition() {
  return buildEntryFilterDecomposition({
    now,
    universeCandidates: 5,
    watchlistCandidates: 5,
    entries: 0,
    macroGateState: macro(),
    candidateSnapshots: rsUniverse(),
  });
}

function rsScoreByRank(d: ReturnType<typeof buildEntryFilterDecomposition>) {
  const map: Record<string, { rsRankPct: number; relativeStrengthScore: number }> = {};
  for (const t of d.candidateTraces) {
    map[t.symbol] = {
      rsRankPct: Number(t.rsRankPct),
      relativeStrengthScore: Number(t.relativeStrengthScore),
    };
  }
  return map;
}

afterEach(() => {
  delete process.env[RS_CONTINUOUS];
  delete process.env[CEILING_WIRING];
});

// ─────────────────────────────────────────────────────────────────────────
// (a) 양 flag OFF → step·기존 resolver byte-identical
// ─────────────────────────────────────────────────────────────────────────
describe("ADR-0627 (a) flag OFF byte-identical", () => {
  it("GAP-A OFF → 5단 step(0/2/5/8/10) 유지", () => {
    const d = rsScoreByRank(decomposition());
    // rsRankPct 100→step 10, 75→5, 50→2, 25→0, 0→0
    expect(d.U1.rsRankPct).toBeCloseTo(100, 0);
    expect(d.U1.relativeStrengthScore).toBe(10);
    expect(d.U2.rsRankPct).toBeCloseTo(75, 0);
    expect(d.U2.relativeStrengthScore).toBe(5); // step: 75 ∈ [60,80) → 5
    expect(d.U3.rsRankPct).toBeCloseTo(50, 0);
    expect(d.U3.relativeStrengthScore).toBe(2); // step: 50 ∈ [50,60) → 2
    expect(d.U4.rsRankPct).toBeCloseTo(25, 0);
    expect(d.U4.relativeStrengthScore).toBe(0); // step: p<50 → 0
    expect(d.U5.rsRankPct).toBeCloseTo(0, 0);
    expect(d.U5.relativeStrengthScore).toBe(0);
  });

  it("GAP-A '1'/'TRUE'/'yes' 는 OFF 취급(ADR-0157 정확 비교) → step 유지", () => {
    for (const v of ["1", "TRUE", "yes", "on"]) {
      process.env[RS_CONTINUOUS] = v;
      const d = rsScoreByRank(decomposition());
      expect(d.U2.relativeStrengthScore).toBe(5); // step, 연속이면 7.5
      delete process.env[RS_CONTINUOUS];
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) GAP-A ON → p<50 종목 RS positive >0, p=100 동일 10
// ─────────────────────────────────────────────────────────────────────────
describe("ADR-0627 (b) GAP-A 연속 승격", () => {
  it("flag ON → relativeStrengthScore = clamp(rsRankPct/10, 0, 10) 연속", () => {
    process.env[RS_CONTINUOUS] = "true";
    const d = rsScoreByRank(decomposition());
    expect(d.U1.relativeStrengthScore).toBeCloseTo(10, 1); // p=100 → 10 (step 동일·천장 무변)
    expect(d.U2.relativeStrengthScore).toBeCloseTo(7.5, 1); // p=75 → 7.5 (step 5)
    expect(d.U3.relativeStrengthScore).toBeCloseTo(5, 1); // p=50 → 5 (step 2)
    expect(d.U4.relativeStrengthScore).toBeCloseTo(2.5, 1); // p=25 → 2.5 (step 0)
  });

  it("p=100 은 step·연속 동일 10 (천장 무변)", () => {
    const stepD = rsScoreByRank(decomposition());
    process.env[RS_CONTINUOUS] = "true";
    const contD = rsScoreByRank(decomposition());
    expect(stepD.U1.relativeStrengthScore).toBe(contD.U1.relativeStrengthScore);
    expect(contD.U1.relativeStrengthScore).toBe(10);
  });

  it("연속 승격이 천장(10) 초과하지 않음", () => {
    process.env[RS_CONTINUOUS] = "true";
    const d = rsScoreByRank(decomposition());
    for (const sym of Object.keys(d)) {
      expect(d[sym].relativeStrengthScore).toBeLessThanOrEqual(10);
      expect(d[sym].relativeStrengthScore).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (c) GAP-B ON → high20d 종목 hasOhlcv=true·breakout positive 점화
// ─────────────────────────────────────────────────────────────────────────
const breakoutMissingBase: CeilingWiringComponentScore = {
  normalizedScore: 0,
  weightedScore: 0,
  maxScore: 10,
  confidence: "MISSING",
  providerIssue: false,
};

describe("ADR-0627 (c) GAP-B breakout OHLCV high20d 필드 정정", () => {
  it("flag ON + high20d(d접미) 존재 → breakout 점화(normalizedScore>0)", () => {
    process.env[CEILING_WIRING] = "true";
    const out = applyBreakoutWiring(breakoutMissingBase, {
      currentPrice: 102, high20d: 100, high60d: 98, volumeRatio: 1.5, ma20: 95, ma60: 90,
    } as never);
    expect(out.normalizedScore).toBeGreaterThan(0);
    expect(out.weightedScore).toBeGreaterThan(0);
    expect(out.maxScore).toBe(10);
    expect(out.confidence).toBe("VERIFIED");
  });

  it("flag OFF + high20d 존재 → byte-identical(transform 미실행)", () => {
    const out = applyBreakoutWiring(breakoutMissingBase, {
      currentPrice: 102, high20d: 100, high60d: 98, volumeRatio: 1.5,
    } as never);
    expect(out).toEqual(breakoutMissingBase);
  });

  it("flag ON + OHLCV 부재(high20d/high20 모두 없음) → base graceful(불변식 #6)", () => {
    process.env[CEILING_WIRING] = "true";
    expect(applyBreakoutWiring(breakoutMissingBase, { currentPrice: 100 } as never)).toEqual(
      breakoutMissingBase,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (d) dry-run hypothetical flag OFF 에서도 산출 (D3)
// ─────────────────────────────────────────────────────────────────────────
function scoreTrace(patch: Record<string, unknown>) {
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
    supplyProviderHealth: {
      status: "VERIFIED" as const,
      providerIssue: false,
      marketSignal: false,
      gate1Severity: "NONE" as const,
      reason: ["ok"],
    },
    supplyConfluenceState: "NEUTRAL",
    hasSectorEnergyDiagnostic: false,
  });
}

describe("ADR-0627 (d) D3 RS 연속 hypothetical (flag 무관 force-ON)", () => {
  it("flag OFF 에서도 rsContinuous* 필드 stamp", () => {
    // rsRankPct=45 → 연속 4.5(weighted 4.5), explicit RS 경로가 step 산출(아래는 raw rsRankPct 소비)
    const out = scoreTrace({ rsRankPct: 45 });
    expect(typeof out.rsContinuousPromotionDelta).toBe("number");
    expect(typeof out.rsContinuousHypotheticalActualScore).toBe("number");
    expect(typeof out.rsContinuousHypotheticalPassed).toBe("boolean");
  });

  it("computeRsContinuousHypothetical: p=45 → 연속 weighted 4.5, delta = 4.5 − actualWeighted", () => {
    const h = computeRsContinuousHypothetical({
      trace: { rsRankPct: 45 } as never,
      relativeStrengthActualWeighted: 0, // 현행 step 0 가정(p<50)
      actualScore: 50,
      requiredScore: 70,
    });
    expect(h.rsContinuousPromotionDelta).toBeCloseTo(4.5, 1);
    expect(h.rsContinuousHypotheticalActualScore).toBeCloseTo(54.5, 1);
    expect(h.rsContinuousHypotheticalPassed).toBe(false);
  });

  it("rsRankPct 부재 → delta 0 graceful(불변식 #6)", () => {
    const h = computeRsContinuousHypothetical({
      trace: {} as never,
      relativeStrengthActualWeighted: 3,
      actualScore: 50,
      requiredScore: 70,
    });
    expect(h.rsContinuousPromotionDelta).toBe(0);
    expect(h.rsContinuousHypotheticalActualScore).toBe(50);
  });

  it("hypothetical stamp 가 actualScore/passed 본체에 영향 0", () => {
    const out = scoreTrace({ rsRankPct: 45 });
    // actualScore 는 components 합과 정합 — hypothetical 필드는 본체에 가산되지 않는 관측 전용.
    const componentsSum =
      Math.round(out.components.reduce((s, c) => s + c.weightedScore, 0) * 10) / 10;
    expect(out.actualScore).toBe(componentsSum);
    expect(out.passed).toBe(out.actualScore >= out.requiredScore);
    // hypothetical = actualScore + promotionDelta (가산은 hypothetical 필드 안에서만).
    expect(out.rsContinuousHypotheticalActualScore).toBe(
      Math.round((out.actualScore + (out.rsContinuousPromotionDelta ?? 0)) * 10) / 10,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (e)(f) requiredScore=70·weight·116 천장 불변 / 연속이 천장 초과 안 함
// ─────────────────────────────────────────────────────────────────────────
describe("ADR-0627 (e/f) 불변 계약", () => {
  it("flag ON 전체 trace → requiredScore 70·passed 비교식 유지", () => {
    process.env[RS_CONTINUOUS] = "true";
    process.env[CEILING_WIRING] = "true";
    const out = scoreTrace({ rsRankPct: 80, currentPrice: 100, high20d: 99, return20d: 12 });
    expect(out.requiredScore).toBe(70);
    expect(out.passed).toBe(out.actualScore >= 70);
  });

  it("RELATIVE_STRENGTH maxScore=10 / weight=1 불변(flag ON/OFF 무관)", () => {
    for (const v of [undefined, "true"]) {
      if (v) process.env[RS_CONTINUOUS] = v;
      else delete process.env[RS_CONTINUOUS];
      const out = scoreTrace({ rsRankPct: 75 });
      const rs = out.components.find((c) => c.code === "RELATIVE_STRENGTH");
      expect(rs?.maxScore).toBe(10);
      expect(rs?.weight).toBe(1);
    }
  });

  it("configuredPositiveMax 합(maxScore) flag ON/OFF 동일(천장 무변)", () => {
    const off = scoreTrace({ rsRankPct: 75 });
    process.env[RS_CONTINUOUS] = "true";
    const on = scoreTrace({ rsRankPct: 75 });
    const sumMax = (t: typeof off) =>
      t.components.filter((c) => c.maxScore > 0).reduce((s, c) => s + c.maxScore, 0);
    expect(sumMax(on)).toBe(sumMax(off));
  });
});
