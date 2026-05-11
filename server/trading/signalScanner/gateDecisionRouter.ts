// @responsibility gateDecisionRouter — Gate 판단 결과 7-tier 분류 SSOT.
//
// ADR-0425:
// Gate failures are not a single semantic class.
// The router separates true risk blocks, true technical weakness, data-quality
// soft degradation, watch-only states, and shadow-eligible provisional states.
//
// This module must not lower gate thresholds, change weights, or open LIVE
// trading. It only classifies decision semantics so Shadow/Watch learning can
// survive soft-degrade conditions without weakening real-money risk controls.
//
// 핵심 불변식 (사용자 명시 절대 변경 금지):
//   1. Gate threshold 변경 0
//   2. LIVE/실주문 정책 0
//   3. HARD_BLOCK 은 Shadow 도 차단
//   4. SOFT_DEGRADE 는 실매수 차단 + Shadow/Watch 보존
//   5. DATA_UNAVAILABLE 은 failed 가 아니다
//   6. STALE 은 failed 가 아니다
//   7. SectorEnergy STALE 은 true no-leadership 이 아니다
//   8. 본 PR 은 Gate 완화가 아니라 decision semantics 분리
//
// 외부 의존성 0 (KIS/Yahoo/외부 API 0건). 순수 함수 SSOT.

import type { FreshScanBlockerAttribution } from './freshScanBlockerAttribution.js';
import type { Gate2FreshAttribution } from './gate2LeadershipAttribution.js';
import type { SectorEnergyQualityDiagnostic } from '../../clients/sectorEnergyQualityDiagnostic.js';

/**
 * 7-tier severity (사용자 명시 union, 절대 변경 금지).
 *
 * 우선순위 (HARD_BLOCK 가장 강함):
 *   HARD_BLOCK > TRUE_WEAKNESS > SOFT_DEGRADE > WATCH_ONLY >
 *   SHADOW_ENTRY_ALLOWED > REDUCED_ENTRY_CANDIDATE > FULL_ENTRY_CANDIDATE
 */
export type GateDecisionSeverity =
  | 'HARD_BLOCK'
  | 'SELL_ONLY'
  | 'TRUE_WEAKNESS'
  | 'SOFT_DEGRADE'
  | 'WATCH_ONLY'
  | 'SHADOW_ENTRY_ALLOWED'
  | 'REDUCED_ENTRY_CANDIDATE'
  | 'FULL_ENTRY_CANDIDATE';

/** 17-value reason union (사용자 명시, 절대 변경 금지). */
export type GateDecisionReason =
  | 'EMERGENCY_STOP'
  | 'SELL_ONLY'
  | 'R6_DEFENSE'
  | 'VIX_BLOCK'
  | 'FOMC_BLOCK'
  | 'LIQUIDITY_BLOCK'
  | 'RRR_BLOCK'
  | 'SIZING_BLOCKED'
  | 'TECHNICAL_BREAKDOWN'
  | 'TRUE_GATE_REJECTION'
  | 'TRUE_NO_LEADERSHIP'
  | 'SECTOR_DATA_STALE'
  | 'DATA_UNAVAILABLE'
  | 'EVALUATOR_ERROR'
  | 'PRE_BREAKOUT_WAIT'
  | 'GATE_RECHECK_MISS'
  | 'PROVISIONAL_LEADER'
  | 'UNKNOWN';

/** 8-value label (사용자 명시 §F 출력 정합). */
export type GateDecisionLabel =
  | 'BLOCK_RISK'
  | 'BLOCK_TRUE_WEAKNESS'
  | 'SOFT_DEGRADE_DATA'
  | 'WATCH_PRE_BREAKOUT'
  | 'SHADOW_PROVISIONAL'
  | 'REDUCED_CANDIDATE'
  | 'FULL_CANDIDATE'
  | 'UNKNOWN';

export interface GateDecisionLanes {
  live: boolean;
  paper: boolean;
  shadow: boolean;
  watch: boolean;
  learning: boolean;
  counterfactual: boolean;
}

export interface GateDecisionRouterResult {
  severity: GateDecisionSeverity;
  reasons: GateDecisionReason[];
  liveAllowed: boolean;
  paperAllowed: boolean;
  shadowAllowed: boolean;
  watchAllowed: boolean;
  /**
   * ADR-0430 — counterfactual learning lane (after-the-fact shadow record).
   *
   * 사용자 §E 정합 — HARD_BLOCK / SELL_ONLY 시점에도 학습 표본 보존 가능.
   * 옵셔널 후방호환 (ADR-0425 ~ ADR-0429 caller 무수정 안전).
   *
   * 정책 (절대 변경 금지):
   *   - HARD_BLOCK + SELL_ONLY → counterfactualLearningAllowed: true
   *   - emergencyStop → counterfactualLearningAllowed: true (ENV 로 끌 수 있음)
   *   - SOFT_DEGRADE → counterfactualLearningAllowed: true (Provisional 우선)
   *   - WATCH_ONLY → counterfactualLearningAllowed: true
   *   - SHADOW_ENTRY_ALLOWED → 기존 Provisional path 사용 (counterfactual 불필요)
   *   - REDUCED/FULL_ENTRY_CANDIDATE → 정상 매수 path (counterfactual 불필요)
   */
  counterfactualLearningAllowed?: boolean;
  /** ADR-0430 — UI 분리 표시용 alias (lane 표 시각화). counterfactualLearningAllowed 와 동의어. */
  learningShadowAllowed?: boolean;
  label: GateDecisionLabel;
  lanes?: GateDecisionLanes;
  executionImpact?: 'NONE' | 'PAPER_ONLY' | 'LIVE_ALLOWED';
  operatorMessage: string;
}

export interface GateDecisionRouterInput {
  regime?: string;
  gate1Pass?: number;
  gate2Pass?: number;
  gate3Pass?: number;
  lastTriggerPass?: number;
  entries?: number;
  freshAttribution?: FreshScanBlockerAttribution;
  gate2Attribution?: Gate2FreshAttribution;
  sectorEnergyDiagnostic?: SectorEnergyQualityDiagnostic;
  blockReasons?: {
    gateRecheckMiss?: number;
    preBreakoutWait?: number;
    sizingBlocked?: number;
    driftRemove?: number;
  };
  riskFlags?: {
    emergencyStop?: boolean;
    sellOnly?: boolean;
    r6Defense?: boolean;
    vixBlock?: boolean;
    fomcBlock?: boolean;
    liquidityBlock?: boolean;
    rrrBlock?: boolean;
  };
}

/**
 * 임계 SSOT (절대 변경 금지 — 사용자 §"절대 하지 말 것" #1/#2 정합).
 * Gate threshold 가 *아니다* — decision semantics 분리 임계만.
 */
export const GATE_DECISION_ROUTER_THRESHOLDS = Object.freeze({
  /** WATCH_ONLY 진입 — preBreakoutWait 비율 ≥ 0.5 (gate1Pass 기준). */
  WATCH_PRE_BREAKOUT_WAIT_RATIO: 0.5,
  /** TRUE_WEAKNESS 진입 — TRUE_GATE1_REJECTION 또는 TRUE_NO_LEADERSHIP 우세. */
  TRUE_WEAKNESS_FAIL_RATIO: 0.7,
  /** SOFT_DEGRADE 진입 — DATA_UNAVAILABLE 또는 SECTOR_DATA_STALE 우세. */
  SOFT_DEGRADE_DATA_RATIO: 0.5,
});

/**
 * 7-tier 결정 트리 SSOT (사용자 §C 정합, 절대 변경 금지).
 *
 * 우선순위:
 *   1. HARD_BLOCK (riskFlags 또는 SIZING_BLOCKED)
 *   2. WATCH_ONLY (preBreakoutWait 우세, gate1Pass>0)
 *   3. SOFT_DEGRADE (sectorEnergy STALE 또는 DATA_UNAVAILABLE 우세)
 *   4. TRUE_WEAKNESS (진짜 기술 미달 우세)
 *   5. FULL_ENTRY_CANDIDATE (gate1+2+3+lastTrigger 모두 pass)
 *   6. REDUCED_ENTRY_CANDIDATE (일부 pass)
 *   7. UNKNOWN (분류 데이터 부족)
 */
export function deriveGateDecisionRouterResult(
  input: GateDecisionRouterInput,
): GateDecisionRouterResult {
  const reasons: GateDecisionReason[] = [];

  // ────────────────────────────────────────────────────────
  // 1. HARD_BLOCK — riskFlags 우선 (사용자 §C 절대 원칙 #3 — Shadow 도 차단)
  // ────────────────────────────────────────────────────────
  const rf = input.riskFlags ?? {};
  if (rf.emergencyStop) reasons.push('EMERGENCY_STOP');
  if (rf.sellOnly) reasons.push('SELL_ONLY');
  if (rf.r6Defense) reasons.push('R6_DEFENSE');
  if (rf.vixBlock) reasons.push('VIX_BLOCK');
  if (rf.fomcBlock) reasons.push('FOMC_BLOCK');
  if (rf.liquidityBlock) reasons.push('LIQUIDITY_BLOCK');
  if (rf.rrrBlock) reasons.push('RRR_BLOCK');

  if (reasons.length > 0) {
    const sellOnlyOnly = reasons.length === 1 && reasons[0] === 'SELL_ONLY';
    // ADR-0430 — HARD_BLOCK / SELL_ONLY 에서도 counterfactual learning 은 365일 살아있다.
    // 단, ENV `COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true` 시 비활성.
    const learningAllowed =
      process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED !== 'true';
    return {
      severity: sellOnlyOnly ? 'SELL_ONLY' : 'HARD_BLOCK',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: !sellOnlyOnly ? false : true,
      watchAllowed: sellOnlyOnly,
      counterfactualLearningAllowed: learningAllowed,
      learningShadowAllowed: learningAllowed,
      label: 'BLOCK_RISK',
      lanes: { live: false, paper: false, shadow: sellOnlyOnly, watch: sellOnlyOnly, learning: learningAllowed, counterfactual: learningAllowed },
      executionImpact: 'NONE',
      operatorMessage: sellOnlyOnly
        ? 'SELL_ONLY — 신규 매수만 차단. 보유 관리/매도 허용, engine alive, counterfactual universe learning 유지.'
        : '리스크 차단 — 실매수/가상체결/일반 shadow 모두 차단. 단 ADR-0430 counterfactual learning 은 별도 ledger 에 365일 영속 가능.',
    };
  }

  // SIZING_BLOCKED 우세는 Live 주문만 차단하고 Shadow/Watch 관측은 보존한다.
  const blockReasons = input.blockReasons ?? {};
  const gate1Pass = input.gate1Pass ?? 0;
  if ((blockReasons.sizingBlocked ?? 0) > 0 && gate1Pass > 0 &&
      (blockReasons.sizingBlocked ?? 0) >= gate1Pass) {
    reasons.push('SIZING_BLOCKED');
    const learningAllowed =
      process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED !== 'true';
    return {
      severity: 'WATCH_ONLY',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: true,
      watchAllowed: true,
      counterfactualLearningAllowed: learningAllowed,
      learningShadowAllowed: learningAllowed,
      label: 'WATCH_PRE_BREAKOUT',
      lanes: { live: false, paper: false, shadow: true, watch: true, learning: true, counterfactual: learningAllowed },
      executionImpact: 'NONE',
      operatorMessage:
        'Sizing 불가 — Kelly/계좌 한도 초과로 Live 주문만 차단. ' +
        'SIZING_BLOCKED_SHADOW 라벨로 Shadow/Watch 학습 후보 보존 가능.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 2. WATCH_ONLY — Pre-breakout WAIT 우세 (사용자 §C)
  //    gate1Pass>0 + preBreakoutWait/gate1Pass > 0.5
  // ────────────────────────────────────────────────────────
  const preWait = blockReasons.preBreakoutWait ?? 0;
  if (gate1Pass > 0 && preWait / gate1Pass >= GATE_DECISION_ROUTER_THRESHOLDS.WATCH_PRE_BREAKOUT_WAIT_RATIO) {
    reasons.push('PRE_BREAKOUT_WAIT');
    return {
      severity: 'WATCH_ONLY',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: true,
      watchAllowed: true,
      counterfactualLearningAllowed: true,
      learningShadowAllowed: true,
      label: 'WATCH_PRE_BREAKOUT',
      operatorMessage: '돌파 대기 — early pattern 미확정. Watch/Shadow 학습 후보로 보존.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 3. SOFT_DEGRADE — SectorEnergy STALE / DATA_UNAVAILABLE 우세 (사용자 §C)
  //    실매수 차단 + Shadow/Watch 보존 (절대 원칙 #4)
  // ────────────────────────────────────────────────────────
  const sectorDiag = input.sectorEnergyDiagnostic;
  const sectorIsStale = sectorDiag !== undefined && (
    sectorDiag.dataQuality === 'STALE' ||
    sectorDiag.dataQuality === 'DEGRADED' ||
    sectorDiag.dataQuality === 'FAILED' ||
    (sectorDiag.fallbackUsed !== undefined && sectorDiag.fallbackUsed !== 'NONE')
  );
  if (sectorIsStale) {
    reasons.push('SECTOR_DATA_STALE');
  }

  // DATA_UNAVAILABLE / EVALUATOR_ERROR 우세 (gate2Attribution 또는 freshAttribution)
  const g2a = input.gate2Attribution;
  const fa = input.freshAttribution;

  // gate2Attribution 우선 (gate1Pass>0 시점) — gate2 분해 우선순위 정합.
  // metrics 산출은 buckets 직접 합산 — schema 변경 0건 (heuristic SSOT 모듈 외부 의존성 0).
  let unavailableRate = 0;
  let errorRate = 0;
  let trueFailRate = 0;
  let waitRate = 0;
  let gateRecheckRate = 0;
  let usingGate2 = false;
  let usingFresh = false;

  if (g2a !== undefined && Array.isArray(g2a.buckets) && g2a.buckets.length > 0) {
    let failed = 0, unavailable = 0, error = 0, stale = 0, wait = 0;
    for (const b of g2a.buckets) {
      failed += b.failed ?? 0;
      unavailable += b.unavailable ?? 0;
      error += b.error ?? 0;
      stale += (b as { stale?: number }).stale ?? 0;
      wait += (b as { wait?: number }).wait ?? 0;
    }
    const totalRelevant = failed + unavailable + error + stale + wait;
    if (totalRelevant > 0) {
      usingGate2 = true;
      unavailableRate = unavailable / totalRelevant;
      errorRate = error / totalRelevant;
      trueFailRate = failed / totalRelevant;
      waitRate = wait / totalRelevant;
      gateRecheckRate =
        gate1Pass > 0 ? (blockReasons.gateRecheckMiss ?? 0) / gate1Pass : 0;
    }
  } else if (fa !== undefined && Array.isArray(fa.buckets) && fa.buckets.length > 0) {
    let failed = 0, unavailable = 0, error = 0;
    for (const b of fa.buckets) {
      failed += b.failed ?? 0;
      unavailable += b.unavailable ?? 0;
      error += b.error ?? 0;
    }
    const totalRelevant = failed + unavailable + error;
    if (totalRelevant > 0) {
      usingFresh = true;
      unavailableRate = unavailable / totalRelevant;
      errorRate = error / totalRelevant;
      trueFailRate = failed / totalRelevant;
    }
  }
  void usingFresh; // mark used (분기 추적용)

  const dataUnavailableDominant =
    unavailableRate >= GATE_DECISION_ROUTER_THRESHOLDS.SOFT_DEGRADE_DATA_RATIO;
  const evaluatorErrorDominant = errorRate >= 0.3;
  const trueFailDominant =
    trueFailRate >= GATE_DECISION_ROUTER_THRESHOLDS.TRUE_WEAKNESS_FAIL_RATIO;

  if (dataUnavailableDominant) reasons.push('DATA_UNAVAILABLE');
  if (evaluatorErrorDominant) reasons.push('EVALUATOR_ERROR');

  // SOFT_DEGRADE 진입 조건 — sectorStale OR dataUnavailable OR evaluatorError 우세
  if (sectorIsStale || dataUnavailableDominant || evaluatorErrorDominant) {
    return {
      severity: 'SOFT_DEGRADE',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: true,
      watchAllowed: true,
      counterfactualLearningAllowed: true,
      learningShadowAllowed: true,
      label: 'SOFT_DEGRADE_DATA',
      lanes: { live: false, paper: false, shadow: true, watch: true, learning: true, counterfactual: true },
      executionImpact: 'NONE',
      operatorMessage:
        '실매수 차단 유지 — 데이터 품질 저하 (STALE/UNAVAILABLE/ERROR). ' +
        'Shadow/Watch 학습 후보로 보존 가능. 데이터 소스 점검 우선 (Gate 임계 변경 금지).',
    };
  }

  // ────────────────────────────────────────────────────────
  // 4. GATE_RECHECK_MISS 우세 (gate2Attribution 한정)
  // ────────────────────────────────────────────────────────
  if (usingGate2 && gate1Pass > 0 && gateRecheckRate >= 0.5) {
    reasons.push('GATE_RECHECK_MISS');
    return {
      severity: 'WATCH_ONLY',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: true,
      watchAllowed: true,
      counterfactualLearningAllowed: true,
      learningShadowAllowed: true,
      label: 'WATCH_PRE_BREAKOUT',
      operatorMessage: 'Gate 재검증 미달 우세 — minGate 임계 또는 sectorBoost 검토. Watch 보존.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 5. WATCH_ONLY — gate2Attribution waitRate 우세 (gate2 단계 PRE_BREAKOUT_WAIT)
  // ────────────────────────────────────────────────────────
  if (usingGate2 && waitRate >= 0.5) {
    reasons.push('PRE_BREAKOUT_WAIT');
    return {
      severity: 'WATCH_ONLY',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: true,
      watchAllowed: true,
      counterfactualLearningAllowed: true,
      learningShadowAllowed: true,
      label: 'WATCH_PRE_BREAKOUT',
      operatorMessage: 'Gate2 단계 돌파 대기 — early pattern 미성숙. Watch/Shadow 학습 후보.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 6. TRUE_WEAKNESS — 진짜 기술 미달 우세 (사용자 §C)
  //    Shadow 도 차단 (보수적 — R3_EARLY provisional lane 은 ADR-0426 후속)
  // ────────────────────────────────────────────────────────
  if (trueFailDominant) {
    reasons.push(usingGate2 ? 'TRUE_NO_LEADERSHIP' : 'TRUE_GATE_REJECTION');
    return {
      severity: 'TRUE_WEAKNESS',
      reasons,
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: false,
      watchAllowed: true,
      // ADR-0430 — TRUE_WEAKNESS 도 학습 표본 오염이라 counterfactual 도 차단 (사용자 §C #5 정합).
      counterfactualLearningAllowed: false,
      learningShadowAllowed: false,
      label: 'BLOCK_TRUE_WEAKNESS',
      operatorMessage:
        '진짜 기술 약세 — trend/vcp/breakout 등 임계 미달 우세. ' +
        'Watch 만 보존 (Shadow / Counterfactual 모두 차단, 학습 오염 방지). ' +
        'R3_EARLY provisional lane 은 ADR-0426.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 7. FULL_ENTRY_CANDIDATE — 모든 단계 pass (사용자 §C)
  //    본 PR 은 wrapping 만 — 기존 매수 정책 변경 0
  // ────────────────────────────────────────────────────────
  const allPass =
    (input.gate1Pass ?? 0) > 0 &&
    (input.gate2Pass ?? 0) > 0 &&
    (input.gate3Pass ?? 0) > 0 &&
    (input.lastTriggerPass ?? 0) > 0;

  if (allPass) {
    return {
      severity: 'FULL_ENTRY_CANDIDATE',
      reasons: [],
      liveAllowed: true,
      paperAllowed: true,
      shadowAllowed: true,
      watchAllowed: true,
      // ADR-0430 — Full pass 는 정상 shadow/provisional 경로 사용 (counterfactual 불필요, 사용자 §E).
      counterfactualLearningAllowed: false,
      learningShadowAllowed: false,
      label: 'FULL_CANDIDATE',
      operatorMessage:
        'Full pass — Gate 1+2+3+lastTrigger 모두 통과. ' +
        '실제 매수 진행 여부는 기존 정책 (sizing/RRR/budget) 으로 결정.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 8. REDUCED_ENTRY_CANDIDATE — 일부 pass (gate1>0)
  // ────────────────────────────────────────────────────────
  if (gate1Pass > 0) {
    return {
      severity: 'REDUCED_ENTRY_CANDIDATE',
      reasons: [],
      liveAllowed: false,
      paperAllowed: false,
      shadowAllowed: true,
      watchAllowed: true,
      // ADR-0430 — REDUCED 는 정상 shadow path 가용, counterfactual 불필요 (사용자 §E).
      counterfactualLearningAllowed: false,
      learningShadowAllowed: false,
      label: 'REDUCED_CANDIDATE',
      operatorMessage:
        '부분 pass — Gate1 통과했으나 Gate2/3/lastTrigger 미완. Shadow/Watch 보존.',
    };
  }

  // ────────────────────────────────────────────────────────
  // 9. UNKNOWN — 분류 데이터 부족
  // ────────────────────────────────────────────────────────
  reasons.push('UNKNOWN');
  return {
    severity: 'WATCH_ONLY',
    reasons,
    liveAllowed: false,
    paperAllowed: false,
    shadowAllowed: false,
    watchAllowed: true,
    // ADR-0430 — UNKNOWN 은 분류 데이터 부족 → counterfactual 표본 가치 낮음.
    counterfactualLearningAllowed: false,
    learningShadowAllowed: false,
    label: 'UNKNOWN',
    operatorMessage: '분류 데이터 부족 — 다음 스캔 후 재검토.',
  };
}

/**
 * /scan_blockers 메시지 섹션 SSOT (사용자 §F 정합).
 *
 * Router 결과를 텔레그램 HTML 형식으로 포맷.
 * 부재 시 null 반환 (호출자가 conditional concat).
 */
export function formatGateDecisionRouterSection(
  result: GateDecisionRouterResult | null | undefined,
): string | null {
  if (!result) return null;

  const lines: string[] = [];
  const sevIcon: Record<GateDecisionSeverity, string> = {
    HARD_BLOCK: '🚨',
    SELL_ONLY: '🟠',
    TRUE_WEAKNESS: '🔴',
    SOFT_DEGRADE: '🟡',
    WATCH_ONLY: '👀',
    SHADOW_ENTRY_ALLOWED: '⚫️',
    REDUCED_ENTRY_CANDIDATE: '🟠',
    FULL_ENTRY_CANDIDATE: '✅',
  };

  lines.push(`🧭 <b>Gate Decision Router (ADR-0425)</b>`);
  lines.push(`  • severity: ${sevIcon[result.severity]} <b>${result.severity}</b>`);
  lines.push(`  • label: ${result.label}`);
  // ADR-0430 — learning lane 추가 표시 (옵셔널 후방호환).
  const learningLane =
    result.counterfactualLearningAllowed === true || result.learningShadowAllowed === true;
  lines.push(
    `  • lanes: live=${result.liveAllowed ? '✅' : '❌'} ` +
    `paper=${result.paperAllowed ? '✅' : '❌'} ` +
    `shadow=${result.shadowAllowed ? '✅' : '❌'} ` +
    `watch=${result.watchAllowed ? '✅' : '❌'} ` +
    `learning=${learningLane ? '✅' : '❌'} ` +
    `counterfactual=${result.counterfactualLearningAllowed === true ? '✅' : '❌'}`,
  );
  lines.push(
    `  • executionImpact: ${result.executionImpact ?? (result.liveAllowed ? 'LIVE_ALLOWED' : result.paperAllowed ? 'PAPER_ONLY' : 'NONE')}`,
  );

  if (result.reasons.length > 0) {
    lines.push(`  • reasons:`);
    const topReasons = result.reasons.slice(0, 5);
    topReasons.forEach((r, i) => {
      lines.push(`    ${i + 1}. ${r}`);
    });
    if (result.reasons.length > 5) {
      lines.push(`    ... 외 ${result.reasons.length - 5}건`);
    }
  }

  if (result.operatorMessage) {
    lines.push(`  • operatorMessage: <i>${result.operatorMessage}</i>`);
  }

  return lines.join('\n');
}
