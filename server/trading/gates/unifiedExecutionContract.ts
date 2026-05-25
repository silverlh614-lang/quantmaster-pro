// @responsibility ADR-0527 unified execution-permission contract pins — type-level union of two resolvers plus PositionPolicyDecision, permission separated from count.

import type { ExecutionPermissionResolution } from '../../runtime/executionPermissionResolver.js';
import type { FinalDecision } from './finalDecisionResolver.js';
import type { ConvictionLabel } from './simpleDecision.js';

export type { ExecutionPermissionResolution };

/**
 * ADR-0527 통합 실행 허가 계약. 두 resolver 의 합집합 필드를 단일 표면으로 정의한다:
 * - runtime/executionPermissionResolver (P0 SSOT) 의 permission/sizing/provider 필드
 * - gates/finalDecisionResolver 의 decision/conviction 판단 필드
 * permission(boolean) 군과 라벨 군을 명시 분리한다. 집계 count 는 본 타입에 두지 않는다.
 */
export interface UnifiedExecutionPermissionResolution {
  sourceSnapshotId: string;
  asOf: string;
  // --- permission 군 (boolean) — count 와 이름 분리 ---
  liveOrderAllowed: boolean;
  liveSellAllowed: boolean;
  shadowPermissionAllowed: boolean;
  counterfactualAllowed: boolean;
  paperFillAllowed: boolean;
  learningAllowed: boolean;
  // --- 판단 라벨 군 ---
  decision: FinalDecision;
  convictionLabel: ConvictionLabel;
  strongBuyAsLabelOnly: true;
  liveBlockReason: ExecutionPermissionResolution['liveBlockReason'];
  executionImpact: ExecutionPermissionResolution['executionImpact'];
  // --- 사이징 군 ---
  sizingMultiplier: number;
  scorePenalty: number;
  // --- provider/signal 군 (불변식 #6) ---
  marketSignal: boolean;
  providerIssueIsolated: boolean;
  // --- 진단 라벨 ---
  policyLabels: string[];
  learningLabels: string[];
  reasonCodes: string[];
}

/** scope 태그된 진단 count (집계 정본 전용). permission 과 절대 같은 이름을 쓰지 않는다. */
export interface ExecutionScopedCount {
  scope: 'ALL_CANDIDATES' | 'GATE3_TIMING_SAMPLE' | 'PAPER_OBSERVATIONAL' | 'LIVE_SAMPLE';
  value: number;
}

/**
 * per-candidate UnifiedExecutionPermissionResolution 의 roll-up.
 * 모든 필드는 *Count / *Created (건수) — permission(boolean) 과 명명 분리 (ADR-0527 §Decision.2).
 * 예: shadowPermissionAllowed(boolean) ≠ shadowOrderCreated(count).
 */
export interface UnifiedExecutionPermissionAggregate {
  entryReadyCount: ExecutionScopedCount;
  liveBuyAllowedCount: ExecutionScopedCount;
  liveBuyBlockedCount: ExecutionScopedCount;
  shadowOrderCreated: ExecutionScopedCount;
  observeOnlyCount: ExecutionScopedCount;
  blockedCount: ExecutionScopedCount;
  providerIssueIsolatedCount: ExecutionScopedCount;
  blockReasonDistribution: Record<string, number>;
  topBlockReason: string;
}

/** PositionPolicyDecision 의 표본 구분 — 진단 전용인지 LIVE 적용인지. */
export type PositionPolicyMode = 'DIAGNOSTIC' | 'LIVE';

/** 포지션 사이징 tier (regime × current positions). */
export type PositionPolicyTier =
  | 'R1_STRONG_BULL'
  | 'R2_BULL'
  | 'R3_EARLY'
  | 'R4_NEUTRAL'
  | 'R5_STABILIZING'
  | 'R6_DEFENSE'
  | 'UNKNOWN';

/**
 * ADR-0527 포지션 정책 정본. regimePositionPolicy 산출을 명명·표본 정본화한다.
 * formatter 는 mode(diagnosticVsLive) 로 표본을 구분한다.
 */
export interface PositionPolicyDecision {
  sourceSnapshotId: string;
  symbol?: string;
  tier: PositionPolicyTier;
  /** per-position 비중 (%) — perPositionPct 정본. */
  posPct: number;
  maxPositions: number;
  maxGrossExposurePct: number;
  /** 현 정책상 Kelly 비활성 (number | null). finalKelly 정본. */
  finalKelly: number | null;
  /** 본 결정이 진단 전용인지 LIVE 적용인지 (표본 구분 discriminator). */
  diagnosticVsLive: PositionPolicyMode;
  executionImpact: 'NONE';
}

/**
 * TODO(ADR-0527 engine-dev): runtime/executionPermissionResolver 와
 * gates/finalDecisionResolver 를 본 통합 계약으로 수렴한다. legacy resolver 는
 * 입력 어댑터로 흡수하되 허가 산출 로직은 byte-equivalent 유지 (회귀 테스트로 고정).
 * PositionPolicyDecision 은 regimePositionPolicy.calculateRegimePositionSizing 결과를
 * 정본 형상으로 매핑하며 diagnosticVsLive 를 명시한다.
 *
 * 본 시그니처는 engine-dev 가 채운다. 컴파일을 위해 export 만 선언한다.
 */
export declare function toUnifiedExecutionPermission(
  permission: ExecutionPermissionResolution,
  decision: { decision: FinalDecision; convictionLabel: ConvictionLabel; reasonCodes: string[] },
): UnifiedExecutionPermissionResolution;
