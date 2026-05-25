// @responsibility ADR-0526 per-candidate Gate0/1/2/3 evaluation SSOT contract — formatters read this view, never re-infer from raw traces.

import type { CanonicalScope, ScopedCount } from '../../../telegram/renderers/canonicalDebugRawView.js';

export type { CanonicalScope, ScopedCount };

/** 게이트 통과 상태 (정본 판정 — formatter 재추론 금지). */
export type GateEvaluationStatus =
  | 'PASS'
  | 'PASS_WEAK'
  | 'WATCH'
  | 'FAIL'
  | 'DATA_INCOMPLETE'
  | 'SKIPPED'
  | 'UNKNOWN';

/** Gate3 타이밍 준비 상태 (정본 판정). */
export type Gate3TimingReadiness =
  | 'READY'
  | 'SETUP_READY'
  | 'TRIGGER_WAIT'
  | 'TIMING_FAIL'
  | 'DATA_INCOMPLETE'
  | 'SKIPPED';

/** 단일 게이트 판정. permission(boolean) 은 status 와 별도로 명시한다 (ADR-0527 정렬). */
export interface GateLayerVerdict {
  status: GateEvaluationStatus;
  /** 본 게이트를 통과했는가 (정본 boolean). status 와 중복이 아니라 명시적 권한 신호. */
  passPermission: boolean;
  /** 본 게이트의 정본 top block reason (정본이 계산 — formatter 아님). */
  topBlockReason: string;
}

/** Gate3 전용 판정 — 타이밍 readiness + permission 분리. */
export interface Gate3LayerVerdict {
  readiness: Gate3TimingReadiness;
  /** 타이밍 준비 완료 권한 (boolean). 집계 count 와 이름 분리. */
  timingReadyPermission: boolean;
  topBlockReason: string;
}

/**
 * ADR-0526 per-candidate Gate0/1/2/3 판단 정본. formatter 는 본 view 만 읽는다.
 * candidateTraces (rich/raw trace) 에서 pass/fail/topBlockReason 을 재추론하지 않는다.
 */
export interface CandidateGateEvaluationView {
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  asOf: string;
  scope: CanonicalScope;
  gate0: GateLayerVerdict;
  gate1: GateLayerVerdict;
  gate2: GateLayerVerdict;
  gate3: Gate3LayerVerdict;
  /** 전 게이트 통합 top block reason (우선순위 레지스트리 정본 계산). */
  topBlockReason: string;
}

/**
 * per-candidate view 의 roll-up 집계. 모든 필드는 *Count 접미사 (count) 이며
 * permission(boolean) 과 이름이 분리된다 (ADR-0526 §Decision.2, ADR-0527 정렬).
 */
export interface CandidateGateEvaluationAggregate {
  evaluatedCount: ScopedCount;
  gate1PassCount: ScopedCount;
  gate2PassStrongCount: ScopedCount;
  gate2PassWeakCount: ScopedCount;
  gate2WatchCount: ScopedCount;
  gate2FailCount: ScopedCount;
  gate3ReadyCount: ScopedCount;
  gate3TriggerWaitCount: ScopedCount;
  gate3TimingFailCount: ScopedCount;
  /** 통합 top block reason 분포 (정본 계산). */
  topBlockReasonDistribution: Record<string, number>;
}

/**
 * TODO(ADR-0526 engine-dev): persisted ScanSummary 의 정본 슬라이스(gate2 confluence,
 * gate3 closure, gate1 survival)에서 per-candidate view 를 결정론적으로 빌드한다.
 * 더미 시각 재판정 금지 — 동일 입력에 대해 항상 동일 출력.
 * candidateTraces 는 입력 raw 기질로만 사용하고, 판정(status/permission/topBlockReason)은
 * persisted 정본 카운터/closure 에서 도출한다.
 *
 * 본 시그니처는 engine-dev 가 채운다. 컴파일을 위해 export 만 선언한다.
 */
export declare function buildCandidateGateEvaluationViews(
  summary: import('./scanSummaryTypes.js').ScanSummary | null,
): CandidateGateEvaluationView[];

export declare function aggregateCandidateGateEvaluationViews(
  views: CandidateGateEvaluationView[],
): CandidateGateEvaluationAggregate;
