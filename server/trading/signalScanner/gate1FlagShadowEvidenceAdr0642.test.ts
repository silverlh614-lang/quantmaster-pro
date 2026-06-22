// @responsibility ADR-0642 회귀 — 5-flag 공통 증거 집계: legacyPass/flagOnPass/delta/coverage/clampBinding 정확성·carry 추출·렌더·executionImpact NONE backstop.
import { describe, expect, it } from "vitest";
import {
  buildGate1FlagShadowEvidenceBoard,
  extractGate1FlagHypotheticalCarry,
  formatGate1FlagShadowEvidenceSection,
} from "./gate1FlagShadowEvidenceAdr0642.js";
import type { Gate1DryRunObservationRow } from "./gate1DryRunObservationLedgerAdr0476.js";
import type { MinimumSignalScoreTrace } from "./minimumSignalScoreTrace/types.js";

function row(patch: Partial<Gate1DryRunObservationRow>): Gate1DryRunObservationRow {
  return {
    id: "r",
    createdAt: "2026-06-21T00:00:00.000Z",
    forDate: "2026-06-21",
    source: "GATE1_SCORE_OBSERVATION_V2",
    symbol: "000001",
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: "WOULD_STILL_FAIL",
    dryRunScenario: "obs",
    requiredScore: 70,
    providerIssue: false,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    status: "PENDING",
    executionImpact: "NONE",
    liveExecutionAllowed: false,
    policyPromotionMode: "SHADOW_ONLY",
    ...patch,
  } as Gate1DryRunObservationRow;
}

describe("ADR-0642 A. 5-flag 증거 집계 정확성", () => {
  const rows: Gate1DryRunObservationRow[] = [
    // legacyPass (score 72>=70), 모든 flag-on 도 통과.
    row({ finalGate1Score: 72, sectorRsHypotheticalPassed: true, ceilingWiringHypotheticalPassed: true, rsContinuousHypotheticalPassed: true, denomNormHypotheticalPassed: true, sectorRsInputPresent: true, ceilingWiringInputPresent: true, rsContinuousInputPresent: true, denomNormDeficitPresent: true }),
    // legacy fail(65), force-ON 으로 sector/denom 통과.
    row({ finalGate1Score: 65, sectorRsHypotheticalPassed: true, denomNormHypotheticalPassed: true, sectorRsInputPresent: true, denomNormDeficitPresent: true, denomNormClampBinding: true }),
    // legacy fail(40), 입력 부재 — 어떤 force-ON 도 미통과.
    row({ finalGate1Score: 40 }),
  ];

  const board = buildGate1FlagShadowEvidenceBoard({ rows, survivor: null });

  it("A1 정확히 5개 flag · executionImpact NONE backstop", () => {
    expect(board.flags).toHaveLength(5);
    expect(board.liveScoringChanged).toBe(false);
    expect(board.operatorApprovalRequired).toBe(true);
    expect(board.executionImpact).toBe("NONE");
    expect(board.flags.every((f) => f.executionImpact === "NONE")).toBe(true);
  });

  it("A2 legacyPassCount = score>=70 후보 수 (1)", () => {
    for (const f of board.flags) expect(f.legacyPassCount).toBe(1);
  });

  it("A3 0611 flagOnPass=2, delta=+1, coverage 2/3", () => {
    const f = board.flags.find((x) => x.adr === "0611")!;
    expect(f.flagOnHypotheticalPassCount).toBe(2);
    expect(f.passCountDelta).toBe(1);
    expect(f.inputCoveragePct).toBeCloseTo(66.7, 1);
  });

  it("A4 0640 flagOnPass=2 + clampBindingCount=1", () => {
    const f = board.flags.find((x) => x.adr === "0640")!;
    expect(f.flagOnHypotheticalPassCount).toBe(2);
    expect(f.clampBindingCount).toBe(1);
  });

  it("A5 0613 flagOnPass=1 (legacy 통과 1행만)", () => {
    const f = board.flags.find((x) => x.adr === "0613")!;
    expect(f.flagOnHypotheticalPassCount).toBe(1);
    expect(f.passCountDelta).toBe(0);
  });

  it("A6 sessionsObserved single-scan=1, status SHADOW_OFF, reviewBy 전사", () => {
    const f = board.flags.find((x) => x.adr === "0546")!;
    expect(f.sessionsObserved).toBe(1);
    expect(f.status).toBe("SHADOW_OFF");
    expect(f.reviewBy).toBe("2026-09-19");
  });

  it("A6b (ADR-0643) flip 4개(0611/0613/0627/0640) status ON 전사 동기화, 0546 만 SHADOW_OFF", () => {
    for (const adr of ["0611", "0613", "0627", "0640"]) {
      expect(board.flags.find((x) => x.adr === adr)!.status).toBe("ON");
    }
    expect(board.flags.find((x) => x.adr === "0546")!.status).toBe("SHADOW_OFF");
  });

  it("A7 0546 survivor 재사용 — regimeAwareWouldPassCount 가 delta 로 환원", () => {
    const b = buildGate1FlagShadowEvidenceBoard({
      rows,
      survivor: {
        regime: "R3_EARLY",
        legacyRequiredScore: 70,
        regimeAwareRequiredScore: 60,
        regimeAwareGap: 10,
        scoredCandidateCount: 3,
        regimeAwareWouldPassCount: 2,
        regimeAwareWouldPassSymbols: ["000002", "000003"],
        regimeAwareRequiredActive: false,
        executionImpact: "NONE",
      },
    });
    const f = b.flags.find((x) => x.adr === "0546")!;
    expect(f.passCountDelta).toBe(2);
    expect(f.flagOnHypotheticalPassCount).toBe(3); // legacyPass 1 + survivor 2
    expect(f.inputCoveragePct).toBeCloseTo(100, 1);
  });
});

describe("ADR-0642 B. carry 추출 (extractGate1FlagHypotheticalCarry)", () => {
  function mt(patch: Partial<MinimumSignalScoreTrace>): MinimumSignalScoreTrace {
    return { symbol: "X", requiredScore: 70, actualScore: 60, ...patch } as MinimumSignalScoreTrace;
  }

  it("B1 denomNorm deficit/clamp binding 파생", () => {
    const c = extractGate1FlagHypotheticalCarry(mt({ denomNormEffectiveRequiredScore: 49 })); // 70*0.7=49
    expect(c.denomNormDeficitPresent).toBe(true);
    expect(c.denomNormClampBinding).toBe(true);
  });

  it("B2 결손 없음(effective==required) → deficit false, clamp false", () => {
    const c = extractGate1FlagHypotheticalCarry(mt({ denomNormEffectiveRequiredScore: 70 }));
    expect(c.denomNormDeficitPresent).toBe(false);
    expect(c.denomNormClampBinding).toBe(false);
  });

  it("B3 ceilingWiring delta 존재 → inputPresent true", () => {
    const c = extractGate1FlagHypotheticalCarry(mt({ ceilingWiringRsPercentileDelta: 3, ceilingWiringBreakoutDelta: 0 }));
    expect(c.ceilingWiringInputPresent).toBe(true);
  });

  it("B4 sectorRs hypothetical 필드 전사", () => {
    const c = extractGate1FlagHypotheticalCarry(mt({ sectorRsHypotheticalActualScore: 68, sectorRsHypotheticalPassed: false, sectorRsInputPresent: true }));
    expect(c.sectorRsHypotheticalActualScore).toBe(68);
    expect(c.sectorRsInputPresent).toBe(true);
  });

  it("B5 필드 부재 trace → 빈 carry (graceful)", () => {
    const c = extractGate1FlagHypotheticalCarry(mt({}));
    expect(c.denomNormDeficitPresent).toBeUndefined();
    expect(c.sectorRsHypotheticalPassed).toBeUndefined();
  });
});

describe("ADR-0642 C. 렌더", () => {
  it("C1 board null → 데이터 없음 안내", () => {
    expect(formatGate1FlagShadowEvidenceSection(null)).toContain("데이터 없음");
  });

  it("C2 board → 5라인 + backstop 문구", () => {
    const board = buildGate1FlagShadowEvidenceBoard({ rows: [row({ finalGate1Score: 72 })], survivor: null });
    const s = formatGate1FlagShadowEvidenceSection(board);
    expect(s).toContain("ADR-0642");
    expect(s).toContain("operatorApprovalRequired=true");
    expect(s).toContain("GATE1_SECTOR_RS_COMPONENT_ENABLED");
  });
});
