// @responsibility counterfacture_gate Phase C — gate×regime ROC 임계 권고 리포트 생성(read-only, liveThresholdAutoChanged=false, executionImpact=NONE).
/**
 * gateThresholdRecommendation.ts (counterfacture_gate Phase C)
 *
 * Phase B 투영(gateScoredOutcomeProjection)을 gate×regime 으로 묶어 기존 ROC 분석기
 * (gateThresholdAutoTuning.evaluateThresholdShift, ADR-0325)에 먹여 임계 이동 권고를
 * 산출한다. ADR-0546 의 regime-aware window verdict 패턴을 3게이트로 일반화.
 *
 * 현재 임계는 하드코딩하지 않고 실 SSOT 경유:
 *   - GATE1 — resolveGate1RequiredScore(regime) (gateConfig, ×10; flag OFF=70)
 *   - GATE3 — DEFAULT_GATE3_THRESHOLD_CONFIG.rrrPassMin (×1; =2)
 *   - GATE2 — 스칼라 임계 미정의(확장점) → 권고 생성 안 함
 *
 * 안전 — 어떤 임계도 변경하지 않는다. liveThresholdAutoChanged=false /
 * operatorApprovalRequired=true / executionImpact=NONE. ENV
 * GATE_THRESHOLD_AUTO_TUNING_DISABLED=true 면 분석기가 decision='disabled' 반환.
 */

import {
  ROC_MIN_SAMPLE,
  evaluateThresholdShift,
  type ScoredOutcome,
  type ThresholdShiftResult,
} from './gateThresholdAutoTuning.js';
import {
  collectGateScoredOutcomes,
  groupScoredOutcomesByGateRegime,
  type GateOutcomeGate,
  type GateScoredOutcome,
} from './gateScoredOutcomeProjection.js';
import { resolveGate1RequiredScore } from '../trading/gateConfig.js';
import { DEFAULT_GATE3_THRESHOLD_CONFIG } from '../quant/gate3EvidenceScore.js';

export interface GateThresholdRecommendation {
  gate: GateOutcomeGate;
  regime: string;
  /** 스칼라/임계 스케일 — ×10(G1) | ×1(G3). */
  scale: 1 | 10;
  sampleSize: number;
  shift: ThresholdShiftResult;
  liveThresholdAutoChanged: false;
  operatorApprovalRequired: true;
  executionImpact: 'NONE';
}

export interface GateThresholdRecommendationReport {
  /** 호출자가 stamp(Date.now 미사용 정책 정합) — 미전달 시 null. */
  generatedAtKst: string | null;
  recommendations: GateThresholdRecommendation[];
  minSample: number;
  liveThresholdAutoChanged: false;
  operatorApprovalRequired: true;
  executionImpact: 'NONE';
}

/**
 * Gate2 confluence 통과 임계 — gate2ConfluenceScore 의 GATE2_PASS_WEAK 경계
 * (coverageAdjustedScore ≥ 65, 0~100 scale)를 미러. 값 drift 시 양쪽 동기 의무.
 */
export const GATE2_PASS_THRESHOLD = 65;

/** gate×regime 현재 임계 — 실 SSOT 경유(G1/G3) + G2 confluence 경계 미러. */
function currentThresholdFor(gate: GateOutcomeGate, regime: string): number | null {
  if (gate === 'GATE1') return resolveGate1RequiredScore(regime);
  if (gate === 'GATE2') return GATE2_PASS_THRESHOLD;
  if (gate === 'GATE3') return DEFAULT_GATE3_THRESHOLD_CONFIG.rrrPassMin;
  return null;
}

function toScoredOutcomes(outcomes: readonly GateScoredOutcome[]): ScoredOutcome[] {
  return outcomes.map((outcome) => ({ score: outcome.scalar, outcome: outcome.outcome }));
}

/**
 * gate×regime 별 ROC 임계 권고 산출. read-only — 어떤 임계도 변경하지 않는다.
 * 표본 < ROC_MIN_SAMPLE 인 그룹은 분석기가 decision='insufficient_sample' 반환.
 */
export function buildGateThresholdRecommendations(
  outcomes: readonly GateScoredOutcome[],
): GateThresholdRecommendation[] {
  const grouped = groupScoredOutcomesByGateRegime(outcomes);
  const recommendations: GateThresholdRecommendation[] = [];
  for (const group of grouped.values()) {
    if (group.length === 0) continue;
    const { gate, regime, scale } = group[0];
    const current = currentThresholdFor(gate, regime);
    if (current === null) continue; // GATE2 등 스칼라 임계 미정의
    recommendations.push({
      gate,
      regime,
      scale,
      sampleSize: group.length,
      shift: evaluateThresholdShift(current, toScoredOutcomes(group)),
      liveThresholdAutoChanged: false,
      operatorApprovalRequired: true,
      executionImpact: 'NONE',
    });
  }
  // 게이트(G1<G3) → 표본 많은 순 정렬(읽기 편의).
  return recommendations.sort(
    (a, b) => a.gate.localeCompare(b.gate) || b.sampleSize - a.sampleSize,
  );
}

/** 영속 ledger 를 로드해 권고 리포트 생성(read-only). 테스트는 input.outcomes 주입. */
export async function buildGateThresholdRecommendationReport(input?: {
  outcomes?: readonly GateScoredOutcome[];
  generatedAtKst?: string;
}): Promise<GateThresholdRecommendationReport> {
  const outcomes = input?.outcomes ?? (await collectGateScoredOutcomes()).all;
  return {
    generatedAtKst: input?.generatedAtKst ?? null,
    recommendations: buildGateThresholdRecommendations(outcomes),
    minSample: ROC_MIN_SAMPLE,
    liveThresholdAutoChanged: false,
    operatorApprovalRequired: true,
    executionImpact: 'NONE',
  };
}

function decisionLabel(decision: ThresholdShiftResult['decision']): string {
  switch (decision) {
    case 'tighten': return 'TIGHTEN ↑ (operator 검토)';
    case 'loosen': return 'LOOSEN ↓ (operator 검토)';
    case 'hold': return 'HOLD (변동 미미)';
    case 'insufficient_sample': return `INSUFFICIENT_SAMPLE (≥${ROC_MIN_SAMPLE} 필요)`;
    case 'disabled': return 'DISABLED (ENV)';
    default: return decision;
  }
}

/** 텔레그램/리포트 렌더(표시 전용). ADR-0546 verdict 패턴 일반화. */
export function formatGateThresholdRecommendationLines(
  report: GateThresholdRecommendationReport,
): string[] {
  const lines: string[] = [
    '🎯 Gate Threshold ROC 권고 (counterfacture_gate)',
    `- minSample: ${report.minSample} · liveThresholdAutoChanged=false · operatorApprovalRequired=true · executionImpact=NONE`,
  ];
  if (report.recommendations.length === 0) {
    lines.push('- (mature 표본 없음 — D5 성숙 후 표시)');
    return lines;
  }
  for (const rec of report.recommendations) {
    const s = rec.shift;
    const suggested = s.suggestedThreshold === null ? 'N/A' : s.suggestedThreshold.toFixed(1);
    const shiftPct = s.shiftPct === null ? 'N/A' : `${s.shiftPct >= 0 ? '+' : ''}${s.shiftPct.toFixed(1)}%`;
    lines.push('');
    lines.push(`${rec.gate} / ${rec.regime}  [n=${rec.sampleSize}, W${s.winSample}/L${s.lossSample}, ×${rec.scale}]`);
    lines.push(`  current=${s.currentThreshold.toFixed(1)} suggested=${suggested} shift=${shiftPct} → ${decisionLabel(s.decision)}`);
  }
  return lines;
}
