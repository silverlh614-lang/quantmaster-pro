// @responsibility counterfacture_gate Phase L — Phase C 권고를 Phase D 승인 store 에 커밋하는 operator-승인 seam(actionable only, live 변경 0·apply flag 별개).
/**
 * gateThresholdApproval.ts (counterfacture_gate Phase L)
 *
 * 유일하게 끊겨 있던 고리 — Phase C ROC 권고(gateThresholdRecommendation)를 Phase D 승인
 * store(gateLearnedThresholdRepo)에 *operator 명시 승인* 으로 기록한다. 기록 자체는 live 를
 * 바꾸지 않는다: 적용은 gateLearnedThresholdApply 의 2중 게이트(ENV COUNTERFACTURE_GATE_APPLY_ENABLED
 * + provider register)와 [regime floor, 70] clamp 를 모두 만족할 때만.
 *
 * 안전:
 *   - actionable(tighten|loosen) + suggestedThreshold finite 인 권고만 승인 가능.
 *     hold/insufficient_sample/disabled 는 거부(≥ROC_MIN_SAMPLE 표본·≥5% shift 아니면 기록 불가).
 *   - anchor 70 무접촉 — 승인분은 raw suggested 를 저장, clamp 는 apply 가 단독 소유(단일 출처).
 *   - GATE1 만 지원 — 유일하게 apply resolver 가 존재하는 게이트(G2/G3 은 apply 경로 부재 → 후속).
 *   - 자동 호출 금지 — operator telegram 액션 전용(approvedBy 필수).
 */

import {
  buildGateThresholdRecommendationReport,
  type GateThresholdRecommendation,
} from './gateThresholdRecommendation.js';
import type { GateScoredOutcome } from './gateScoredOutcomeProjection.js';
import {
  approveGateLearnedThreshold,
  type GateLearnedThresholdEntry,
} from '../persistence/gateLearnedThresholdRepo.js';

/** 승인 지원 게이트 — apply resolver 존재하는 GATE1 만. */
export type GateThresholdApproveGate = 'GATE1';

export interface GateThresholdApprovalResult {
  approved: boolean;
  gate: string;
  regime: string;
  /** 승인/거부 사유(사람가독 · 텔레그램 노출). */
  reason: string;
  entry: GateLearnedThresholdEntry | null;
  recommendation: GateThresholdRecommendation | null;
}

/** ROC 결정 중 실제로 임계 이동을 권고하는 것만 승인 가능. */
const APPROVABLE_DECISIONS = new Set(['tighten', 'loosen']);

/**
 * gate×regime 의 현재 Phase C 권고를 승인 store 에 기록. actionable 아니면 거부.
 * 테스트는 injected.outcomes 로 ledger I/O 를 우회한다.
 */
export async function approveGateThresholdFromRecommendation(params: {
  gate: GateThresholdApproveGate;
  regime: string;
  approvedBy: string;
  approvedAtKst: string;
  injected?: { outcomes?: readonly GateScoredOutcome[] };
}): Promise<GateThresholdApprovalResult> {
  const { gate, regime, approvedBy, approvedAtKst } = params;
  const base: Omit<GateThresholdApprovalResult, 'approved' | 'reason'> = {
    gate,
    regime,
    entry: null,
    recommendation: null,
  };

  if (!approvedBy) {
    return { ...base, approved: false, reason: 'APPROVER_REQUIRED (operator 명시 승인 전용)' };
  }

  const report = await buildGateThresholdRecommendationReport(
    params.injected?.outcomes ? { outcomes: params.injected.outcomes } : undefined,
  );
  const rec = report.recommendations.find((r) => r.gate === gate && r.regime === regime) ?? null;
  if (!rec) {
    return {
      ...base,
      approved: false,
      reason: `NO_RECOMMENDATION gate=${gate} regime=${regime} (표본 없음/미성숙)`,
    };
  }

  const decision = rec.shift.decision;
  const suggested = rec.shift.suggestedThreshold;
  if (!APPROVABLE_DECISIONS.has(decision) || suggested === null || !Number.isFinite(suggested)) {
    return {
      ...base,
      approved: false,
      recommendation: rec,
      reason: `NOT_ACTIONABLE decision=${decision} (tighten|loosen·≥${report.minSample}표본만 승인 가능)`,
    };
  }

  const entry: GateLearnedThresholdEntry = {
    gate,
    regime,
    approvedThreshold: suggested,
    scale: rec.scale,
    approvedBy,
    approvedAtKst,
    basis: {
      sampleSize: rec.sampleSize,
      winSample: rec.shift.winSample,
      lossSample: rec.shift.lossSample,
      suggestedThreshold: suggested,
      decision,
    },
  };
  approveGateLearnedThreshold(entry);
  return {
    approved: true,
    gate,
    regime,
    reason: `APPROVED decision=${decision} suggested=${suggested}`,
    entry,
    recommendation: rec,
  };
}
