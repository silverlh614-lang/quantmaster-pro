// @responsibility ADR-0642 Gate1 flag shadow 증거 세션 누적 영속 SSOT — per-scan 5-flag 1행 append + 세션 합산 board, 멱등·재부팅 안전, executionImpact=NONE.

import fs from "fs";
import { GATE1_FLAG_SHADOW_EVIDENCE_FILE, ensureDataDir } from "../../persistence/paths.js";
import type {
  Gate1FlagShadowEvidence,
  Gate1FlagShadowEvidenceBoard,
  Gate1FlagShadowStatus,
} from "./gate1FlagShadowEvidenceAdr0642.js";

/** 세션 누적 window 상한 — flip 결정에 충분한 N세션 보관(120 ≈ 6개월 영업일). FIFO eviction. */
export const GATE1_FLAG_SHADOW_EVIDENCE_WINDOW_SESSIONS = 120;

/** per-scan 영속 행 — single-session board flag 1개 분 + 세션 식별자. */
interface Gate1FlagShadowEvidenceSessionRow {
  sessionKey: string; // distinct scan 세션 식별자(scanId 또는 forDate+ts) — 멱등 upsert key
  appendedAt: string;
  flagId: string;
  adr: string;
  legacyPassCount: number;
  flagOnHypotheticalPassCount: number;
  coverageNumerator: number; // inputCoveragePct 환산 전 분자(가용 후보 수)
  coverageDenominator: number; // 분모(scored/total 후보 수)
  clampBindingCount: number;
  reviewBy: string;
  status: Gate1FlagShadowStatus;
  flagActive: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isValidRow(row: unknown): row is Gate1FlagShadowEvidenceSessionRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.sessionKey === "string" &&
    typeof r.flagId === "string" &&
    typeof r.adr === "string" &&
    typeof r.legacyPassCount === "number" &&
    typeof r.flagOnHypotheticalPassCount === "number" &&
    typeof r.coverageDenominator === "number"
  );
}

function loadAll(filePath = GATE1_FLAG_SHADOW_EVIDENCE_FILE): Gate1FlagShadowEvidenceSessionRow[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRow);
  } catch {
    // 손상 JSON → 빈 배열 fallback (시스템 무중단, 재부팅 안전).
    return [];
  }
}

function saveAll(
  rows: Gate1FlagShadowEvidenceSessionRow[],
  filePath = GATE1_FLAG_SHADOW_EVIDENCE_FILE,
): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, filePath);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* SDS-ignore: tmp cleanup best-effort, idempotent */
    }
  }
}

/** distinct 세션 수 — sessionKey 고유값 개수. */
function distinctSessionCount(rows: readonly Gate1FlagShadowEvidenceSessionRow[]): number {
  return new Set(rows.map((r) => r.sessionKey)).size;
}

/**
 * single-scan board 를 세션 레지스트리에 append(멱등 upsert by sessionKey).
 * 같은 sessionKey 의 5-flag 행은 통째로 교체(중복 누적 방지 — 동일 scan 재실행 안전).
 * FIFO window 캡(세션 단위). 신규 fetch 0 — board 는 호출자가 이미 산출. flag flip 0.
 *
 * @param sessionKey distinct scan 식별자 (scanId/sourceSnapshotId). 미지정 시 generatedAt 사용.
 */
export function appendGate1FlagShadowEvidenceSession(
  board: Gate1FlagShadowEvidenceBoard,
  sessionKey: string,
  filePath: string = GATE1_FLAG_SHADOW_EVIDENCE_FILE,
): void {
  const appendedAt = board.generatedAt;
  // coverage 는 board 가 pct 만 제공하므로 pct 를 세션별로 보관(coverageNumerator=pct, denominator=1)해
  // 누적 시 세션 단순 평균한다(buildCumulative). 분자/분모 분해 보관은 board 계약 밖이라 미채택.
  const newRows: Gate1FlagShadowEvidenceSessionRow[] = board.flags.map((f) => ({
    sessionKey,
    appendedAt,
    flagId: f.flagId,
    adr: f.adr,
    legacyPassCount: f.legacyPassCount,
    flagOnHypotheticalPassCount: f.flagOnHypotheticalPassCount,
    coverageNumerator: round1(f.inputCoveragePct),
    coverageDenominator: 1,
    clampBindingCount: f.clampBindingCount,
    reviewBy: f.reviewBy,
    status: f.status,
    flagActive: f.flagActive,
  }));

  const existing = loadAll(filePath).filter((r) => r.sessionKey !== sessionKey);
  const merged = [...existing, ...newRows];
  // FIFO: 가장 오래된 세션부터 제거해 window 유지.
  const sessionKeysInOrder: string[] = [];
  for (const r of merged) if (!sessionKeysInOrder.includes(r.sessionKey)) sessionKeysInOrder.push(r.sessionKey);
  const keepKeys = new Set(
    sessionKeysInOrder.slice(Math.max(0, sessionKeysInOrder.length - GATE1_FLAG_SHADOW_EVIDENCE_WINDOW_SESSIONS)),
  );
  const trimmed = merged.filter((r) => keepKeys.has(r.sessionKey));
  saveAll(trimmed, filePath);
}

/**
 * 영속된 세션 행들을 flag 별로 합산해 누적 board 를 재구성한다(렌더 입력).
 * legacyPass/flagOnPass = 세션 누적 합, coverage = 세션 가중 평균(분모 1/세션), sessions = distinct 세션 수.
 * 행 0건 → null(데이터 없음). flag flip 0·executionImpact=NONE.
 */
export function buildCumulativeGate1FlagShadowEvidenceBoard(
  now: Date = new Date(),
  filePath: string = GATE1_FLAG_SHADOW_EVIDENCE_FILE,
): Gate1FlagShadowEvidenceBoard | null {
  const rows = loadAll(filePath);
  if (rows.length === 0) return null;
  const byFlag = new Map<string, Gate1FlagShadowEvidenceSessionRow[]>();
  for (const r of rows) {
    const arr = byFlag.get(r.adr) ?? [];
    arr.push(r);
    byFlag.set(r.adr, arr);
  }
  const flags: Gate1FlagShadowEvidence[] = [];
  for (const [adr, flagRows] of [...byFlag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sessions = distinctSessionCount(flagRows);
    const legacyPassCount = flagRows.reduce((s, r) => s + r.legacyPassCount, 0);
    const flagOnHypotheticalPassCount = flagRows.reduce((s, r) => s + r.flagOnHypotheticalPassCount, 0);
    const coverageSum = flagRows.reduce((s, r) => s + r.coverageNumerator, 0);
    const coverageCount = flagRows.reduce((s, r) => s + r.coverageDenominator, 0);
    const latest = flagRows[flagRows.length - 1];
    flags.push({
      flagId: latest.flagId,
      adr,
      sessionsObserved: sessions,
      legacyPassCount,
      flagOnHypotheticalPassCount,
      passCountDelta: flagOnHypotheticalPassCount - legacyPassCount,
      inputCoveragePct: coverageCount > 0 ? round1(coverageSum / coverageCount) : 0,
      reviewBy: latest.reviewBy,
      status: latest.status,
      flagActive: latest.flagActive,
      clampBindingCount: flagRows.reduce((s, r) => s + r.clampBindingCount, 0),
      executionImpact: "NONE",
    });
  }
  return {
    generatedAt: now.toISOString(),
    flags,
    liveScoringChanged: false,
    operatorApprovalRequired: true,
    executionImpact: "NONE",
  };
}

/** 테스트 전용 — 레지스트리 파일 초기화. */
export function __resetGate1FlagShadowEvidenceStoreForTests(
  filePath: string = GATE1_FLAG_SHADOW_EVIDENCE_FILE,
): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* SDS-ignore: 미존재 파일 idempotent */
  }
}
