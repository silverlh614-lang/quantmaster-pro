// @responsibility ADR-0611/0643 회귀 — SECTOR_RELATIVE_STRENGTH 재활성: flag=false byte-equivalent·unset(default-ON) capacity 복원·입력 부재 graceful·RS 이중계상 회피.
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimumSignalScoreTrace } from "./minimumSignalScoreTrace.js";

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

function sectorRsComponent(patch: Record<string, unknown> = {}) {
  return trace(patch).components.find((c) => c.code === "SECTOR_RELATIVE_STRENGTH")!;
}

describe("ADR-0611 SECTOR_RELATIVE_STRENGTH re-activation", () => {
  afterEach(() => {
    delete process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED;
    delete process.env.GATE1_POSITIVE_CEILING_WIRING_ENABLED;
  });

  it("flag=false → maxScore 0·weightedScore 0 (byte-equivalent advisory-only, ADR-0643 명시 OFF 롤백)", () => {
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "false";
    const c = sectorRsComponent({ sectorRelativeReturn20d: 12 });
    expect(c.maxScore).toBe(0);
    expect(c.weightedScore).toBe(0);
    expect(c.message).toContain("advisory-only (ADR-0467)");
  });

  it("flag ON + 섹터상대수익 존재 → 8pt capacity 복원 + 양수 점수", () => {
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "true";
    const c = sectorRsComponent({ sectorRelativeReturn20d: 12 }); // +12% → (12+10)/20*100=110→clamp100 → 8.0
    expect(c.maxScore).toBe(8);
    expect(c.weightedScore).toBeCloseTo(8, 1);
    expect(c.confidence).toBe("VERIFIED");
    expect(c.message).toContain("ADR-0611");
  });

  it("flag ON + 약한 섹터상대수익 → 비례 점수 (음수 입력도 0 바닥)", () => {
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "true";
    expect(sectorRsComponent({ sectorRelativeReturn20d: 0 }).weightedScore).toBeCloseTo(4, 1); // (0+10)/20=50%→4
    expect(sectorRsComponent({ sectorRelativeReturn20d: -15 }).weightedScore).toBe(0); // clamp 0
  });

  it("flag ON + 입력 부재 → weightedScore 0 graceful, maxScore 8 (denominator만, 결손≠페널티)", () => {
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "true";
    const c = sectorRsComponent({});
    expect(c.maxScore).toBe(8);
    expect(c.weightedScore).toBe(0);
    expect(c.confidence).toBe("MISSING");
    expect(c.penaltyApplied).toBe(false);
  });

  it("RS 이중계상 회피 — rsRankPct/시장상대만 있고 sector-relative 부재면 활성 시에도 0", () => {
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "true";
    const c = sectorRsComponent({ rsRankPct: 90, relativeReturn20d: 15 });
    expect(c.weightedScore).toBe(0); // sector-relative 입력만 소비
  });

  it("actualScore 영향 — flag ON 시 섹터상대수익 종목의 라이브 점수가 =false 대비 상승", () => {
    // ADR-0643 — 0613 positive-max 정규화(default-ON)는 합을 100-스케일 재정규화해 raw +8 capacity 를
    // 흡수하므로, additive +8 delta 는 정규화 transform 을 끈 채(=false) 격리 측정한다.
    process.env.GATE1_POSITIVE_CEILING_WIRING_ENABLED = "false";
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "false";
    const off = trace({ sectorRelativeReturn20d: 12 }).actualScore;
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "true";
    const on = trace({ sectorRelativeReturn20d: 12 }).actualScore;
    expect(on).toBeGreaterThan(off);
    expect(on - off).toBeCloseTo(8, 0);
  });

  it("default-ON(unset) → maxScore 8·weightedScore 양수 (ADR-0643 flip 신규 동작)", () => {
    delete process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED; // unset = ON
    const c = sectorRsComponent({ sectorRelativeReturn20d: 12 });
    expect(c.maxScore).toBe(8);
    expect(c.weightedScore).toBeCloseTo(8, 1);
    expect(c.confidence).toBe("VERIFIED");
  });

  it("default-ON(unset) → =false baseline 복귀(maxScore 0·weightedScore 0)", () => {
    delete process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED;
    const on = sectorRsComponent({ sectorRelativeReturn20d: 12 });
    expect(on.maxScore).toBe(8); // unset = ON
    process.env.GATE1_SECTOR_RS_COMPONENT_ENABLED = "false";
    const off = sectorRsComponent({ sectorRelativeReturn20d: 12 });
    expect(off.maxScore).toBe(0); // =false baseline
    expect(off.weightedScore).toBe(0);
  });
});
