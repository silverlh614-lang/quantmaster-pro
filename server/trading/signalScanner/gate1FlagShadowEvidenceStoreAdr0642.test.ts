// @responsibility ADR-0642 회귀 — flag shadow 증거 세션 누적 영속: append 멱등(동일 sessionKey upsert)·세션 합산·FIFO window·재부팅 안전(손상 fallback).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  appendGate1FlagShadowEvidenceSession,
  buildCumulativeGate1FlagShadowEvidenceBoard,
  __resetGate1FlagShadowEvidenceStoreForTests,
} from "./gate1FlagShadowEvidenceStoreAdr0642.js";
import type { Gate1FlagShadowEvidenceBoard } from "./gate1FlagShadowEvidenceAdr0642.js";

let TMP: string;

function board(passCount: number, generatedAt = "2026-06-21T00:00:00.000Z"): Gate1FlagShadowEvidenceBoard {
  const mk = (adr: string, flagId: string) => ({
    flagId,
    adr,
    sessionsObserved: 1,
    legacyPassCount: 1,
    flagOnHypotheticalPassCount: passCount,
    passCountDelta: passCount - 1,
    inputCoveragePct: 50,
    reviewBy: "2026-09-19",
    status: "SHADOW_OFF" as const,
    flagActive: false,
    clampBindingCount: adr === "0640" ? 1 : 0,
    executionImpact: "NONE" as const,
  });
  return {
    generatedAt,
    flags: [
      mk("0546", "GATE1_REGIME_AWARE_REQUIRED"),
      mk("0611", "GATE1_SECTOR_RS_COMPONENT_ENABLED"),
      mk("0613", "GATE1_POSITIVE_CEILING_WIRING_ENABLED"),
      mk("0627", "GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED"),
      mk("0640", "GATE1_DENOMINATOR_NORMALIZATION_ENABLED"),
    ],
    liveScoringChanged: false,
    operatorApprovalRequired: true,
    executionImpact: "NONE",
  };
}

beforeEach(() => {
  TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "adr0642-")), "evidence.json");
});

afterEach(() => {
  __resetGate1FlagShadowEvidenceStoreForTests(TMP);
});

describe("ADR-0642 Store A. append + cumulative", () => {
  it("A1 단일 세션 append → cumulative 5 flag · sessions=1", () => {
    appendGate1FlagShadowEvidenceSession(board(2), "scan-1", TMP);
    const b = buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)!;
    expect(b.flags).toHaveLength(5);
    for (const f of b.flags) expect(f.sessionsObserved).toBe(1);
    const f0611 = b.flags.find((x) => x.adr === "0611")!;
    expect(f0611.legacyPassCount).toBe(1);
    expect(f0611.flagOnHypotheticalPassCount).toBe(2);
  });

  it("A2 2개 distinct 세션 → 누적 합산 · sessions=2", () => {
    appendGate1FlagShadowEvidenceSession(board(2), "scan-1", TMP);
    appendGate1FlagShadowEvidenceSession(board(3), "scan-2", TMP);
    const b = buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)!;
    const f = b.flags.find((x) => x.adr === "0611")!;
    expect(f.sessionsObserved).toBe(2);
    expect(f.legacyPassCount).toBe(2); // 1+1
    expect(f.flagOnHypotheticalPassCount).toBe(5); // 2+3
    expect(f.passCountDelta).toBe(3);
  });
});

describe("ADR-0642 Store B. 멱등성 (동일 sessionKey upsert)", () => {
  it("B1 같은 sessionKey 재append → 누적 중복 0 (교체)", () => {
    appendGate1FlagShadowEvidenceSession(board(2), "scan-1", TMP);
    appendGate1FlagShadowEvidenceSession(board(2), "scan-1", TMP); // 재실행
    appendGate1FlagShadowEvidenceSession(board(2), "scan-1", TMP);
    const b = buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)!;
    const f = b.flags.find((x) => x.adr === "0611")!;
    expect(f.sessionsObserved).toBe(1);
    expect(f.legacyPassCount).toBe(1); // 누적 1회만
    expect(f.flagOnHypotheticalPassCount).toBe(2);
  });

  it("B2 같은 sessionKey 값 갱신 → 최신값 반영 (upsert)", () => {
    appendGate1FlagShadowEvidenceSession(board(2), "scan-1", TMP);
    appendGate1FlagShadowEvidenceSession(board(4), "scan-1", TMP); // 동일 세션 재계산
    const b = buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)!;
    const f = b.flags.find((x) => x.adr === "0611")!;
    expect(f.sessionsObserved).toBe(1);
    expect(f.flagOnHypotheticalPassCount).toBe(4);
  });
});

describe("ADR-0642 Store C. 경계·재부팅 안전", () => {
  it("C1 데이터 없음 → null", () => {
    expect(buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)).toBeNull();
  });

  it("C2 손상 JSON → 빈 fallback(null), 무중단", () => {
    fs.writeFileSync(TMP, "{not-json");
    expect(buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)).toBeNull();
  });

  it("C3 0640 clampBindingCount 누적", () => {
    appendGate1FlagShadowEvidenceSession(board(2), "s1", TMP);
    appendGate1FlagShadowEvidenceSession(board(2), "s2", TMP);
    const b = buildCumulativeGate1FlagShadowEvidenceBoard(new Date(), TMP)!;
    expect(b.flags.find((x) => x.adr === "0640")!.clampBindingCount).toBe(2);
  });
});
