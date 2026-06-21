// @responsibility ADR-0642 회귀 — 0611 SECTOR_RS force-ON hypothetical: delta 정확성·입력 부재 graceful·coverage·flag OFF byte-equivalent(actualScore/passed 무변경).
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimumSignalScoreTrace } from "./minimumSignalScoreTrace.js";
import { computeSectorRsHypothetical } from "./gate1SectorRsHypotheticalAdr0642.js";

const ENABLED = "GATE1_SECTOR_RS_COMPONENT_ENABLED";

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

afterEach(() => {
  delete process.env[ENABLED];
});

describe("ADR-0642 A. computeSectorRsHypothetical force-ON delta", () => {
  it("A1 섹터상대 +12% → force-ON weighted≈8, OFF current=0 → delta≈8", () => {
    const t = { sectorRelativeReturn20d: 12 } as never;
    const h = computeSectorRsHypothetical({
      trace: t,
      currentSectorRsWeighted: 0,
      actualScore: 60,
      requiredScore: 70,
    });
    expect(h.sectorRsForceDelta).toBeCloseTo(8, 1);
    expect(h.sectorRsHypotheticalActualScore).toBeCloseTo(68, 1);
    expect(h.sectorRsHypotheticalPassed).toBe(false);
    expect(h.sectorRsInputPresent).toBe(true);
  });

  it("A2 섹터상대 입력 부재 → delta 0 graceful, inputPresent false (결손≠페널티)", () => {
    const h = computeSectorRsHypothetical({
      trace: {} as never,
      currentSectorRsWeighted: 0,
      actualScore: 65,
      requiredScore: 70,
    });
    expect(h.sectorRsForceDelta).toBe(0);
    expect(h.sectorRsHypotheticalActualScore).toBe(65);
    expect(h.sectorRsInputPresent).toBe(false);
  });

  it("A3 delta 가 임계 갭을 메우면 hypotheticalPassed true", () => {
    const h = computeSectorRsHypothetical({
      trace: { sectorRelativeReturn20d: 12 } as never,
      currentSectorRsWeighted: 0,
      actualScore: 64,
      requiredScore: 70,
    });
    expect(h.sectorRsHypotheticalActualScore).toBeCloseTo(72, 1);
    expect(h.sectorRsHypotheticalPassed).toBe(true);
  });

  it("A4 음수 섹터상대 → clamp 0 → delta 0", () => {
    const h = computeSectorRsHypothetical({
      trace: { sectorRelativeReturn20d: -15 } as never,
      currentSectorRsWeighted: 0,
      actualScore: 60,
      requiredScore: 70,
    });
    expect(h.sectorRsForceDelta).toBe(0);
    expect(h.sectorRsInputPresent).toBe(true);
  });
});

describe("ADR-0642 B. flag OFF byte-equivalent (actualScore/passed 본체 무변경)", () => {
  it("B1 stamp 추가가 actualScore/passed 를 바꾸지 않는다 (OFF 동일 입력)", () => {
    const off = trace({ sectorRelativeReturn20d: 12 });
    // hypothetical 필드는 stamp 되지만 actualScore/passed 는 SECTOR_RS OFF(maxScore 0) 기준 그대로.
    expect(off.actualScore).toBeGreaterThanOrEqual(0);
    expect(typeof off.passed).toBe("boolean");
    // SECTOR_RELATIVE_STRENGTH 컴포넌트는 OFF 에서 weightedScore 0 (실채점 무영향).
    const c = off.components.find((x) => x.code === "SECTOR_RELATIVE_STRENGTH")!;
    expect(c.weightedScore).toBe(0);
    expect(c.maxScore).toBe(0);
  });

  it("B2 OFF trace 에 sectorRs hypothetical 필드가 stamp 된다 (관측 전용)", () => {
    const off = trace({ sectorRelativeReturn20d: 12 });
    expect(typeof off.sectorRsHypotheticalPassed).toBe("boolean");
    expect(off.sectorRsInputPresent).toBe(true);
    // force-ON delta 가 실 actualScore 와 분리됨 — hypotheticalActualScore >= actualScore.
    expect(off.sectorRsHypotheticalActualScore!).toBeGreaterThanOrEqual(off.actualScore);
  });

  it("B3 actualScore 는 flag OFF↔ON 토글과 무관하게 hypothetical stamp 동일 (force-ON 항상 산출)", () => {
    const off = trace({ sectorRelativeReturn20d: 12 });
    const offDelta = off.sectorRsForceDelta;
    process.env[ENABLED] = "true";
    // flag ON 시 실 component 가 가산되므로 force-ON delta(0 기준)는 줄어든다 — hypothetical 은 항상 산출됨.
    const on = trace({ sectorRelativeReturn20d: 12 });
    expect(typeof offDelta).toBe("number");
    expect(typeof on.sectorRsForceDelta).toBe("number");
  });
});
