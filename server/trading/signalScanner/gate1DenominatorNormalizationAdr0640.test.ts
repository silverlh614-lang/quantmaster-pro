// @responsibility ADR-0640 회귀 — Gate1 분모 정합: flag OFF byte-identical·결손 분모 제외·requiredScore 비례 축소(절대 인상 금지·floor clamp)·관측 ledger stamp·불변식 #6.
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimumSignalScoreTrace } from "./minimumSignalScoreTrace.js";
import {
  resolveEffectiveRequiredScore,
  computeConfiguredPositiveMax,
  computeAvailableMaxScore,
  computeDenominatorNormalizationHypothetical,
  type DenominatorNormalizationComponent,
} from "./gate1DenominatorNormalizationAdr0640.js";

const ENABLED = "GATE1_DENOMINATOR_NORMALIZATION_ENABLED";

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

// configuredPositiveMax 108 가정: VERIFIED 92 + UNKNOWN 8 + UNKNOWN 8.
const fullData: DenominatorNormalizationComponent[] = [
  { weightedScore: 60, maxScore: 92, confidence: "VERIFIED" },
  { weightedScore: 5, maxScore: 8, confidence: "VERIFIED" },
  { weightedScore: 6, maxScore: 8, confidence: "VERIFIED" },
];

// SUPPLY_CONFLUENCE(8) + INVESTOR_FLOW(8) UNKNOWN → available 92, configured 108.
const missingData: DenominatorNormalizationComponent[] = [
  { weightedScore: 60, maxScore: 92, confidence: "VERIFIED" },
  { weightedScore: 0, maxScore: 8, confidence: "UNKNOWN" }, // SUPPLY_CONFLUENCE
  { weightedScore: 0, maxScore: 8, confidence: "UNKNOWN" }, // INVESTOR_FLOW
];

afterEach(() => {
  delete process.env[ENABLED];
});

// ADR-0644 — denominator-normalization flag 는 default ON 승격. explicit `=false`
// kill-switch 만 byte-identical OFF(레거시 70 고정). 미설정=ON 케이스는 아래 A' 블록.
describe("ADR-0640 A. flag explicit =false byte-identical (ADR-0644 kill-switch)", () => {
  it("A1 =false + full-data → requiredScore 그대로", () => {
    process.env[ENABLED] = "false";
    expect(resolveEffectiveRequiredScore(70, fullData)).toBe(70);
  });

  it("A2 =false + 결손-data → requiredScore 그대로 (분모 미축소)", () => {
    process.env[ENABLED] = "false";
    expect(resolveEffectiveRequiredScore(70, missingData)).toBe(70);
  });

  it("A3 =false + 전체 scorer → passed/scoreGap/requiredScore baseline 동일", () => {
    const patch = { rsRankPct: 80, currentPrice: 100, high20: 99, return20d: 12 };
    process.env[ENABLED] = "false";
    const off = trace(patch);
    const baseline = trace(patch);
    expect(off.passed).toBe(baseline.passed);
    expect(off.scoreGap).toBe(baseline.scoreGap);
    expect(off.requiredScore).toBe(70);
    // scoreGap 은 OFF 에서 actualScore - 70 과 동일(effective===required).
    expect(off.scoreGap).toBe(Math.round((off.actualScore - 70) * 10) / 10);
  });

  it("A4 '1'/'TRUE'/'yes'/'on' 은 ON 취급(ADR-0157·0644 — 정확히 'false' 만 OFF)", () => {
    // ADR-0644: `!== 'false'` → 'false' 외 모든 값은 ON → 결손 분모 축소(effective<70).
    for (const v of ["1", "TRUE", "yes", "on"]) {
      process.env[ENABLED] = v;
      expect(resolveEffectiveRequiredScore(70, missingData)).toBeLessThan(70);
      delete process.env[ENABLED];
    }
  });
});

describe("ADR-0644 A'. flag 미설정(default ON) → 분모 정합 발화", () => {
  it("A'1 미설정 + full-data → requiredScore 그대로(결손 없음 → 인상 없음)", () => {
    expect(resolveEffectiveRequiredScore(70, fullData)).toBe(70);
  });

  it("A'2 미설정 + 결손-data → effective < 70 (분모 축소 발화)", () => {
    const effective = resolveEffectiveRequiredScore(70, missingData);
    expect(effective).toBeCloseTo(59.6, 1);
    expect(effective).toBeLessThan(70);
  });

  it("A'3 미설정(default ON) == explicit ='true' byte-identical", () => {
    const dflt = resolveEffectiveRequiredScore(70, missingData);
    process.env[ENABLED] = "true";
    const explicitOn = resolveEffectiveRequiredScore(70, missingData);
    expect(dflt).toBe(explicitOn);
  });
});

describe("ADR-0640 B. flag-ON 분모 정합", () => {
  it("B1 ON + 결손 없음(available==configured) → requiredScore 그대로 (인상 없음)", () => {
    process.env[ENABLED] = "true";
    expect(resolveEffectiveRequiredScore(70, fullData)).toBe(70);
  });

  it("B2 ON + SUPPLY+INVESTOR UNKNOWN(8+8 제외, configured 108) → effective ≈ 59.6, required 보다 낮음", () => {
    process.env[ENABLED] = "true";
    const effective = resolveEffectiveRequiredScore(70, missingData);
    // round1(70 × 92/108) = round1(59.62..) = 59.6
    expect(effective).toBeCloseTo(59.6, 1);
    expect(effective).toBeLessThan(70);
  });

  it("B3 절대 인상 안 됨 — 어떤 입력에도 effective <= requiredScore", () => {
    process.env[ENABLED] = "true";
    const inputs: DenominatorNormalizationComponent[][] = [
      fullData,
      missingData,
      [{ weightedScore: 0, maxScore: 50, confidence: "VERIFIED" }],
      [{ weightedScore: 0, maxScore: 200, confidence: "DEGRADED" }],
      [],
    ];
    for (const comps of inputs) {
      expect(resolveEffectiveRequiredScore(70, comps)).toBeLessThanOrEqual(70);
    }
  });

  it("B4 catastrophic 결손 → floor(0.7×required) 로 clamp", () => {
    process.env[ENABLED] = "true";
    // configured 108, available 8 → proportional 5.2 < floor 49 → clamp 49.
    const catastrophic: DenominatorNormalizationComponent[] = [
      { weightedScore: 0, maxScore: 100, confidence: "UNKNOWN" },
      { weightedScore: 0, maxScore: 8, confidence: "VERIFIED" },
    ];
    const effective = resolveEffectiveRequiredScore(70, catastrophic);
    expect(effective).toBe(49); // round1(70 × 0.7)
  });
});

describe("ADR-0640 C. computeAvailableMaxScore 결손 분류", () => {
  it("C1 UNKNOWN/MISSING/STALE 제외, VERIFIED/DEGRADED/DIAGNOSTIC_ONLY 포함", () => {
    const comps: DenominatorNormalizationComponent[] = [
      { maxScore: 10, confidence: "VERIFIED" },
      { maxScore: 10, confidence: "DEGRADED" },
      { maxScore: 10, confidence: "DIAGNOSTIC_ONLY" },
      { maxScore: 10, confidence: "UNKNOWN" },
      { maxScore: 10, confidence: "MISSING" },
      { maxScore: 10, confidence: "STALE" },
    ];
    expect(computeConfiguredPositiveMax(comps)).toBe(60);
    expect(computeAvailableMaxScore(comps)).toBe(30); // VERIFIED+DEGRADED+DIAGNOSTIC_ONLY
  });

  it("C2 maxScore<=0 component 는 분모/가용 둘 다 제외", () => {
    const comps: DenominatorNormalizationComponent[] = [
      { maxScore: 0, confidence: "VERIFIED" },
      { maxScore: -5, confidence: "VERIFIED" },
      { maxScore: 20, confidence: "VERIFIED" },
    ];
    expect(computeConfiguredPositiveMax(comps)).toBe(20);
    expect(computeAvailableMaxScore(comps)).toBe(20);
  });
});

describe("ADR-0640 D. 관측 hypothetical 순수 산출", () => {
  it("D1 결손 시 effective<required, passed 는 actualScore>=effective", () => {
    const hyp = computeDenominatorNormalizationHypothetical({
      components: missingData,
      requiredScore: 70,
      actualScore: 62,
    });
    expect(hyp.denomNormConfiguredPositiveMax).toBe(108);
    expect(hyp.denomNormAvailableMaxScore).toBe(92);
    expect(hyp.denomNormEffectiveRequiredScore).toBeCloseTo(59.6, 1);
    // actualScore 62 >= effective 59.6 → true (OFF 에서 70 미달로 탈락하던 종목이 통과).
    expect(hyp.denomNormHypotheticalPassed).toBe(true);
  });

  it("D2 결손 없음 → effective==required, passed 는 actualScore>=required", () => {
    const hyp = computeDenominatorNormalizationHypothetical({
      components: fullData,
      requiredScore: 70,
      actualScore: 62,
    });
    expect(hyp.denomNormEffectiveRequiredScore).toBe(70);
    expect(hyp.denomNormHypotheticalPassed).toBe(false);
  });
});

describe("ADR-0640 E. 통합(buildMinimumSignalScoreTrace)", () => {
  // INVESTOR_FLOW UNKNOWN 을 유발하는 supplyProviderHealth 비-VERIFIED 케이스.
  function traceMissing(patch: Record<string, unknown> = {}) {
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
        status: "NO_RECENT_SAMPLE" as const,
        providerName: "investor-flow",
        expectedMaxAgeMinutes: 30,
        providerIssue: true,
        marketSignal: false,
        gate1Severity: "SOFT_FAIL" as const,
        reason: ["no recent investor-flow provider sample"],
      },
      supplyConfluenceState: "UNKNOWN",
      hasSectorEnergyDiagnostic: false,
    });
  }

  it("E1 =false → 결손 종목 passed/scoreGap 가 레거시(actualScore-70)와 동일", () => {
    process.env[ENABLED] = "false";
    const out = traceMissing({ rsRankPct: 80, currentPrice: 100, high20: 99, return20d: 12 });
    expect(out.requiredScore).toBe(70);
    expect(out.passed).toBe(out.actualScore >= 70);
    expect(out.scoreGap).toBe(Math.round((out.actualScore - 70) * 10) / 10);
  });

  it("E2 denomNorm* 관측 필드는 flag 무관 항상 stamp", () => {
    const off = traceMissing({ currentPrice: 100, high20: 99 });
    expect(typeof off.denomNormConfiguredPositiveMax).toBe("number");
    expect(typeof off.denomNormAvailableMaxScore).toBe("number");
    expect(typeof off.denomNormEffectiveRequiredScore).toBe("number");
    expect(typeof off.denomNormHypotheticalPassed).toBe("boolean");
    // 결손 종목 → available < configured → effective < requiredScore.
    expect(off.denomNormAvailableMaxScore).toBeLessThan(off.denomNormConfiguredPositiveMax!);
    expect(off.denomNormEffectiveRequiredScore).toBeLessThan(70);
  });

  it("E3 ON → 결손으로 OFF 에서 탈락하던 종목이 통과(핵심 시나리오)", () => {
    // 풍부한 양수 입력 + INVESTOR_FLOW 결손 → actualScore≈62.7, effective≈57(<70).
    // OFF: 62.7 < 70 탈락 / ON: 62.7 >= 57 통과. 결손 분모 제외가 실효 문턱을 낮춘다.
    const richPatch = {
      rsRankPct: 95, relativeStrengthScore: 9, currentPrice: 110, high20: 100, high60: 95,
      high120: 90, volumeRatio: 2.5, ma20: 100, ma60: 95, return20d: 25, return5d: 8,
      volume: 5000000, priceChange: 5, technicalScore: 9, trendScore: 9,
      watchlistScore: 90, priceDataFresh: true,
    };
    // ADR-0644 — ceiling/RS flag 도 default ON 이라 actualScore 가 70 을 넘어 시나리오
    // 전제(actualScore ∈ [effective, 70))가 깨진다. denom-norm 단일 효과 격리를 위해
    // 다른 두 flag 는 =false 로 고정한다(요구사항: 결손 분모 제외만으로 통과 전환 증명).
    process.env.GATE1_POSITIVE_CEILING_WIRING_ENABLED = "false";
    process.env.GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED = "false";
    process.env[ENABLED] = "false";
    const off = traceMissing(richPatch);
    delete process.env[ENABLED]; // default ON
    const on = traceMissing(richPatch);
    delete process.env.GATE1_POSITIVE_CEILING_WIRING_ENABLED;
    delete process.env.GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED;
    // actualScore 본체는 분모 정합과 무관(관측/문턱만 변경) → OFF/ON 동일(불변식 #1·#6).
    expect(on.actualScore).toBe(off.actualScore);
    // 결손으로 effective<70 이고 actualScore 가 그 사이 → OFF 탈락 / ON 통과(핵심).
    expect(off.denomNormEffectiveRequiredScore!).toBeLessThan(70);
    expect(off.actualScore).toBeGreaterThanOrEqual(off.denomNormEffectiveRequiredScore!);
    expect(off.actualScore).toBeLessThan(70);
    expect(off.passed).toBe(false);
    expect(on.passed).toBe(true);
    // requiredScore 필드(configured 70)는 OFF/ON 모두 불변.
    expect(off.requiredScore).toBe(70);
    expect(on.requiredScore).toBe(70);
  });
});

describe("ADR-0640 F. 불변식 #6 — 결손은 문턱을 내릴 뿐 페널티가 아님", () => {
  it("F1 결손 component weightedScore 는 0 중립화(분모 정합이 점수를 깎지 않음)", () => {
    process.env[ENABLED] = "true";
    // 결손-data 의 결손 component weightedScore 는 0(페널티 음수 아님).
    const missingComps = missingData.filter((c) => c.confidence === "UNKNOWN");
    for (const c of missingComps) {
      expect(c.weightedScore).toBe(0);
    }
    // 분모 정합은 requiredScore 만 낮춤(actualScore 합에 손대지 않음).
    const effective = resolveEffectiveRequiredScore(70, missingData);
    expect(effective).toBeLessThan(70);
    expect(effective).toBeGreaterThanOrEqual(49); // floor 보장
  });
});
