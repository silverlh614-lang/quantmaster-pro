// @responsibility ADR-0642 5개 default-OFF Gate1 flag shadow 증거 공통 스키마 + ledger·survivor 집계 + 렌더 SSOT — 관측 전용, flag flip 0, executionImpact=NONE.

import type { Gate1DryRunObservationRow } from "./gate1DryRunObservationLedgerAdr0476.js";
import type { Gate1RegimeAwareSurvivorObservation } from "./gate1RegimeAwareSurvivorAdr0546.js";
import type { MinimumSignalScoreTrace } from "./minimumSignalScoreTrace/types.js";

/** 0.7× 하한 clamp 비율 (ADR-0640 REQUIRED_SCORE_FLOOR_RATIO 정합). */
const DENOM_NORM_FLOOR_RATIO = 0.7;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * minimumSignalScoreTrace stamp(force-ON hypothetical 4종)에서 ledger carry 용 부분 객체를 추출한다.
 * 신규 산식 0 — trace 에 이미 산출된 hypothetical 필드만 복사 + coverage flag 파생. flag flip 0.
 * denomNormDeficitPresent = effectiveRequired < required(결손 분모 발생).
 * denomNormClampBinding = effectiveRequired == required×0.7(catastrophic 동시 결손 하한 binding).
 */
export function extractGate1FlagHypotheticalCarry(trace: MinimumSignalScoreTrace): {
  ceilingWiringHypotheticalActualScore?: number;
  ceilingWiringHypotheticalPassed?: boolean;
  rsContinuousHypotheticalActualScore?: number;
  rsContinuousHypotheticalPassed?: boolean;
  denomNormEffectiveRequiredScore?: number;
  denomNormHypotheticalPassed?: boolean;
  sectorRsHypotheticalActualScore?: number;
  sectorRsHypotheticalPassed?: boolean;
  sectorRsInputPresent?: boolean;
  ceilingWiringInputPresent?: boolean;
  rsContinuousInputPresent?: boolean;
  denomNormDeficitPresent?: boolean;
  denomNormClampBinding?: boolean;
} {
  const required = trace.requiredScore;
  // 0613 coverage: ceilingWiring delta 3종 중 하나라도 비-0 이면 OHLCV/RS hydration 입력이 있었다.
  const ceilingWiringInputPresent =
    finite(trace.ceilingWiringRsPercentileDelta) || finite(trace.ceilingWiringBreakoutDelta)
      ? (trace.ceilingWiringRsPercentileDelta ?? 0) !== 0 ||
        (trace.ceilingWiringBreakoutDelta ?? 0) !== 0
      : undefined;
  // 0627 coverage: rsContinuous delta 가 산출됐으면(필드 존재) rsRankPct 입력이 있었다(delta!=0).
  const rsContinuousInputPresent = finite(trace.rsContinuousPromotionDelta)
    ? trace.rsContinuousPromotionDelta !== 0
    : undefined;
  // 0640 coverage: effective < required → 결손 분모 발생(deficit). effective==required×0.7 → clamp binding.
  const denomNormDeficitPresent = finite(trace.denomNormEffectiveRequiredScore)
    ? trace.denomNormEffectiveRequiredScore < required
    : undefined;
  const denomNormClampBinding = finite(trace.denomNormEffectiveRequiredScore)
    ? trace.denomNormEffectiveRequiredScore === round1(required * DENOM_NORM_FLOOR_RATIO)
    : undefined;
  return {
    ...(finite(trace.ceilingWiringHypotheticalActualScore) ? { ceilingWiringHypotheticalActualScore: trace.ceilingWiringHypotheticalActualScore } : {}),
    ...(typeof trace.ceilingWiringHypotheticalPassed === "boolean" ? { ceilingWiringHypotheticalPassed: trace.ceilingWiringHypotheticalPassed } : {}),
    ...(finite(trace.rsContinuousHypotheticalActualScore) ? { rsContinuousHypotheticalActualScore: trace.rsContinuousHypotheticalActualScore } : {}),
    ...(typeof trace.rsContinuousHypotheticalPassed === "boolean" ? { rsContinuousHypotheticalPassed: trace.rsContinuousHypotheticalPassed } : {}),
    ...(finite(trace.denomNormEffectiveRequiredScore) ? { denomNormEffectiveRequiredScore: trace.denomNormEffectiveRequiredScore } : {}),
    ...(typeof trace.denomNormHypotheticalPassed === "boolean" ? { denomNormHypotheticalPassed: trace.denomNormHypotheticalPassed } : {}),
    ...(finite(trace.sectorRsHypotheticalActualScore) ? { sectorRsHypotheticalActualScore: trace.sectorRsHypotheticalActualScore } : {}),
    ...(typeof trace.sectorRsHypotheticalPassed === "boolean" ? { sectorRsHypotheticalPassed: trace.sectorRsHypotheticalPassed } : {}),
    ...(typeof trace.sectorRsInputPresent === "boolean" ? { sectorRsInputPresent: trace.sectorRsInputPresent } : {}),
    ...(ceilingWiringInputPresent !== undefined ? { ceilingWiringInputPresent } : {}),
    ...(rsContinuousInputPresent !== undefined ? { rsContinuousInputPresent } : {}),
    ...(denomNormDeficitPresent !== undefined ? { denomNormDeficitPresent } : {}),
    ...(denomNormClampBinding !== undefined ? { denomNormClampBinding } : {}),
  };
}

export type Gate1FlagShadowStatus = "SHADOW_OFF" | "ON" | "SUNSET";

/** 5개 flag 모두 동일 형태로 환원되는 공통 per-flag 증거 (단일 소스). */
export interface Gate1FlagShadowEvidence {
  flagId: string; // ENV flag 이름 (SSOT = gate_flag_lifecycle.json)
  adr: string; // '0546' 등
  sessionsObserved: number; // 본 flag 증거가 누적된 distinct scan 세션 수
  legacyPassCount: number; // flag OFF(현행) 로 Gate1 통과한 후보 누적 수
  flagOnHypotheticalPassCount: number; // flag ON 가정(force-ON) 시 통과 후보 누적 수
  passCountDelta: number; // flagOnHypotheticalPassCount - legacyPassCount (양수=완화 여지)
  inputCoveragePct: number; // 본 flag 입력 가용 후보 비율 0~100
  reviewBy: string; // gate_flag_lifecycle.json reviewBy (YYYY-MM-DD)
  status: Gate1FlagShadowStatus; // gate_flag_lifecycle.json status
  flagActive: boolean; // 현재 ENV ON/OFF (관측만 — 토글 X)
  /** ADR-0640 전용 — 0.7× 하한 clamp binding 후보 수 (그 외 flag 는 0). */
  clampBindingCount: number;
  executionImpact: "NONE"; // 항상 고정 (불변식 backstop)
}

export interface Gate1FlagShadowEvidenceBoard {
  generatedAt: string;
  flags: Gate1FlagShadowEvidence[]; // 정확히 5개
  liveScoringChanged: false; // 항상 고정 backstop
  operatorApprovalRequired: true; // 항상 고정 backstop
  executionImpact: "NONE";
}

/** gate_flag_lifecycle.json 전사 메타 — 정적 SSOT (런타임 fetch 0). reviewBy/status 동기화 의무. */
interface FlagLifecycleMeta {
  flagId: string;
  adr: string;
  reviewBy: string;
  status: Gate1FlagShadowStatus;
}

// gate_flag_lifecycle.json 전사 (2026-06-21 기준). flip 시 본 표 + lifecycle JSON 동시 갱신.
const FLAG_LIFECYCLE: Record<string, FlagLifecycleMeta> = {
  "0546": { flagId: "GATE1_REGIME_AWARE_REQUIRED", adr: "0546", reviewBy: "2026-09-19", status: "SHADOW_OFF" },
  "0611": { flagId: "GATE1_SECTOR_RS_COMPONENT_ENABLED", adr: "0611", reviewBy: "2026-09-19", status: "SHADOW_OFF" },
  "0613": { flagId: "GATE1_POSITIVE_CEILING_WIRING_ENABLED", adr: "0613", reviewBy: "2026-09-19", status: "SHADOW_OFF" },
  "0627": { flagId: "GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED", adr: "0627", reviewBy: "2026-09-19", status: "SHADOW_OFF" },
  "0640": { flagId: "GATE1_DENOMINATOR_NORMALIZATION_ENABLED", adr: "0640", reviewBy: "2026-09-19", status: "SHADOW_OFF" },
};

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? round1((numerator / denominator) * 100) : 0;
}

/** ledger row 의 현행(flag OFF) Gate1 통과 여부 — finalGate1Score≥requiredScore 우선, hardPass fallback. */
function legacyPassed(row: Gate1DryRunObservationRow): boolean {
  const score = finite(row.finalGate1Score)
    ? row.finalGate1Score
    : finite(row.actualScore)
      ? row.actualScore
      : undefined;
  if (finite(score)) return score >= row.requiredScore;
  return row.hardPass === true;
}

/**
 * 단일 scan 의 ledger rows(+survivor)를 5개 flag 별 single-session 증거로 환원한다(순수 함수).
 * sessionsObserved 는 항상 1(본 함수는 1세션 입력) — 세션 누적은 store 가 담당.
 * legacyPass/coverage 는 ledger carry(0642 stamp)·survivor(0546) 재사용 — 신규 산식 0·flag flip 0.
 */
export function buildGate1FlagShadowEvidenceBoard(input: {
  rows: readonly Gate1DryRunObservationRow[];
  survivor?: Gate1RegimeAwareSurvivorObservation | null;
  flagActiveByFlagId?: Readonly<Record<string, boolean>>;
  now?: Date;
}): Gate1FlagShadowEvidenceBoard {
  const rows = input.rows;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const legacyPassCount = rows.filter(legacyPassed).length;
  const active = (flagId: string): boolean => input.flagActiveByFlagId?.[flagId] === true;

  const base = (adr: string, perFlag: Omit<Gate1FlagShadowEvidence, "flagId" | "adr" | "reviewBy" | "status" | "flagActive" | "executionImpact" | "sessionsObserved">): Gate1FlagShadowEvidence => {
    const meta = FLAG_LIFECYCLE[adr];
    return {
      flagId: meta.flagId,
      adr,
      sessionsObserved: 1,
      reviewBy: meta.reviewBy,
      status: meta.status,
      flagActive: active(meta.flagId),
      executionImpact: "NONE",
      ...perFlag,
    };
  };

  // 0546 — survivor 재사용. legacyPass = score≥70, flagOnPass = score≥regimeAwareRequired (window 추가 통과).
  const survivor = input.survivor;
  const flag0546 = base("0546", {
    legacyPassCount,
    flagOnHypotheticalPassCount: legacyPassCount + (survivor?.regimeAwareWouldPassCount ?? 0),
    passCountDelta: survivor?.regimeAwareWouldPassCount ?? 0,
    inputCoveragePct: survivor ? pct(survivor.scoredCandidateCount, rows.length) : 0,
    clampBindingCount: 0,
  });

  // 0611 — sectorRsHypotheticalPassed. coverage = sectorRsInputPresent 비율.
  const flag0611On = rows.filter((r) => r.sectorRsHypotheticalPassed === true).length;
  const flag0611 = base("0611", {
    legacyPassCount,
    flagOnHypotheticalPassCount: flag0611On,
    passCountDelta: flag0611On - legacyPassCount,
    inputCoveragePct: pct(rows.filter((r) => r.sectorRsInputPresent === true).length, rows.length),
    clampBindingCount: 0,
  });

  // 0613 — ceilingWiringHypotheticalPassed. coverage = ceilingWiringInputPresent 비율.
  const flag0613On = rows.filter((r) => r.ceilingWiringHypotheticalPassed === true).length;
  const flag0613 = base("0613", {
    legacyPassCount,
    flagOnHypotheticalPassCount: flag0613On,
    passCountDelta: flag0613On - legacyPassCount,
    inputCoveragePct: pct(rows.filter((r) => r.ceilingWiringInputPresent === true).length, rows.length),
    clampBindingCount: 0,
  });

  // 0627 — rsContinuousHypotheticalPassed. coverage = rsContinuousInputPresent 비율.
  const flag0627On = rows.filter((r) => r.rsContinuousHypotheticalPassed === true).length;
  const flag0627 = base("0627", {
    legacyPassCount,
    flagOnHypotheticalPassCount: flag0627On,
    passCountDelta: flag0627On - legacyPassCount,
    inputCoveragePct: pct(rows.filter((r) => r.rsContinuousInputPresent === true).length, rows.length),
    clampBindingCount: 0,
  });

  // 0640 — denomNormHypotheticalPassed. coverage = denomNormDeficitPresent 비율. clamp binding 별도 카운트.
  const flag0640On = rows.filter((r) => r.denomNormHypotheticalPassed === true).length;
  const flag0640 = base("0640", {
    legacyPassCount,
    flagOnHypotheticalPassCount: flag0640On,
    passCountDelta: flag0640On - legacyPassCount,
    inputCoveragePct: pct(rows.filter((r) => r.denomNormDeficitPresent === true).length, rows.length),
    clampBindingCount: rows.filter((r) => r.denomNormClampBinding === true).length,
  });

  return {
    generatedAt,
    flags: [flag0546, flag0611, flag0613, flag0627, flag0640],
    liveScoringChanged: false,
    operatorApprovalRequired: true,
    executionImpact: "NONE",
  };
}

/** 누적 증거(여러 세션 합산) 1행 → 진단 1라인 렌더 (표시 전용). */
function formatFlagLine(ev: Gate1FlagShadowEvidence): string {
  return (
    `- [${ev.adr}] ${ev.flagId} status=${ev.status} active=${ev.flagActive} ` +
    `sessions=${ev.sessionsObserved} legacyPass=${ev.legacyPassCount} flagOnPass=${ev.flagOnHypotheticalPassCount} ` +
    `Δ=${ev.passCountDelta >= 0 ? "+" : ""}${ev.passCountDelta} coverage=${ev.inputCoveragePct.toFixed(1)}% ` +
    `${ev.clampBindingCount > 0 ? `clampBind=${ev.clampBindingCount} ` : ""}` +
    `reviewBy=${ev.reviewBy}`
  );
}

/**
 * 누적 board → /promotion_readiness 5-flag 증거 섹션(표시 전용·관측 가시화).
 * coverage 결손은 결손으로만 표시 — market signal 변환 0(불변식 #6). flip 결정은 운영자 승인 필수.
 */
export function formatGate1FlagShadowEvidenceSection(
  board: Gate1FlagShadowEvidenceBoard | null | undefined,
): string {
  if (!board || board.flags.length === 0) {
    return "\n[ADR-0642] Gate1 Flag Shadow Evidence: 데이터 없음 (세션 미관측 — flip 결정 불가, 관측 전용).";
  }
  const lines = board.flags.map(formatFlagLine);
  return (
    "\n[ADR-0642] Gate1 Flag Shadow Evidence (5 default-OFF flags · 관측 전용 · executionImpact=NONE)\n" +
    lines.join("\n") +
    "\n(liveScoringChanged=false · operatorApprovalRequired=true · force-ON hypothetical 은 실채점 미반영)"
  );
}
