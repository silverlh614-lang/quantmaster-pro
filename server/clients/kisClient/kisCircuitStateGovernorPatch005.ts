/**
 * @responsibility KIS circuit×priority enforcement SSOT (Patch-005 직속, Patch-004 priority budget 직속 후속)
 *
 * Patch ID: KIS-CIRCUIT-OPEN-ENFORCEMENT-AND-DATA-EVAL-STATE-001
 *
 * 사용자 5/14 운영 보고 직접 차단 — Patch-004 적용 후에도 Railway 로그에서:
 *   - TR_CIRCUIT_OPEN_OR_THROTTLED 상태에서 P2 READY_CANDIDATE_CONFIRM 호출 계속 생성
 *   - deferred queue 적재 + retry 루프
 *   - [KIS_FALLBACK_SELECTED] fallbackProvider=NONE 반복 로그
 *
 * 사용자 §"긴급 수정 목표" 직접 인용:
 *   *"TR_CIRCUIT_OPEN_OR_THROTTLED 상태에서는 신규 KIS 호출 생성을 전역 차단한다.
 *   P0_POSITION_EXIT와 P1_SHADOW_POSITION_MANAGEMENT만 최소 필수 호출로 허용한다."*
 *
 * Safety invariants (절대 변경 금지):
 *   - READY_CANDIDATE(P2) 는 OPEN/HARD_OPEN 시 deferred queue 적재 금지
 *   - P0_POSITION_EXIT 는 HARD_OPEN 에서도 제한적 허용 (보유 매도 절대 보호)
 *   - errorTaxonomy.ts KisTrCircuitStateName 5-state union 본체 무수정 (read-only consumer)
 *   - assessKisTrPressure / providerHealthIsolationPatch003 본체 무수정
 *   - LIVE 매매 본체 0줄 변경
 *   - KIS 주문 함수 5종 import 0건 (정적 grep 가드)
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 *   - 호출자 측 inline ENV 검사 0건 (SSOT 헬퍼 위임 의무)
 */

import type { KisThrottleLevel, KisTrCircuitStateName } from './errorTaxonomy.js';
import type { KisCallPriorityV2 } from './kisPriorityBudgetPatch004.js';

// 4-state enforcement union SSOT (사용자 명시, 절대 변경 금지)
export type KisCircuitEnforcementState =
  | 'CLOSED'           // 정상 — 모든 priority 통과
  | 'SOFT_THROTTLED'   // SOFT throttle — P0/P1 통과, P2 cache-only, P3/P4 suppress
  | 'OPEN'             // P0/P1 최소 허용, P2 skip/block, P3/P4 suppress
  | 'HARD_OPEN';       // 모든 신규 호출 차단, P0 exit 만 제한적 허용

// 7-value action union SSOT
export type KisCircuitEnforcementAction =
  | 'ALLOW'                     // 정상 호출 (P0/P1)
  | 'ALLOW_LIVE'                // P2 CLOSED 시 live call
  | 'ALLOW_CACHE_ONLY'          // P2 SOFT_THROTTLED — cache hit 시만 통과
  | 'ALLOW_LIMITED'             // P0 HARD_OPEN — 보유 매도 최소 허용
  | 'SKIP'                      // P1 HARD_OPEN skip — deferred queue 적재 0
  | 'SKIP_WITH_STALE_OR_BLOCK'  // P2 OPEN/HARD_OPEN skip — 사용자 §3 정합
  | 'SUPPRESS';                 // P3/P4 suppress (Patch-004 정합)

// 5-value blocking reason union SSOT
export type KisCircuitBlockingReason =
  | 'CIRCUIT_OPEN_CACHE_ONLY'        // SOFT_THROTTLED + P2 cache miss
  | 'CIRCUIT_OPEN_SKIP_WITH_STALE'   // OPEN + P2 cache available
  | 'CIRCUIT_OPEN_NEW_BUY_BLOCKED'   // OPEN + P2 cache miss + live data 요구
  | 'HARD_OPEN_GLOBAL_BLOCK'         // HARD_OPEN + P1~P4
  | 'HARD_OPEN_LIMITED_EXIT_ONLY';   // HARD_OPEN + P0 — limited allow

export interface KisCircuitEnforcementDecision {
  readonly priority: KisCallPriorityV2;
  readonly enforcementState: KisCircuitEnforcementState;
  readonly action: KisCircuitEnforcementAction;
  readonly allowed: boolean;
  readonly blockingReason: KisCircuitBlockingReason | null;
  readonly deferredQueued: false;  // literal type 강제 — deferred queue 적재 영구 금지
  // 절대 불변식 literal types (TypeScript 컴파일 타임 강제):
  readonly marketSignal: false;
  readonly executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY';
  readonly engineAlive: true;
  readonly shadowLearning: true;
  readonly newKisCallsAllowed: boolean;
  readonly trId: string;
  readonly symbol?: string;
  readonly decidedAtMs: number;
}

// ENV gate SSOT (ADR-0157 정확 비교)
export function isKisCircuitGovernorDisabled(): boolean {
  return process.env.KIS_CIRCUIT_GOVERNOR_PATCH_005_DISABLED === 'true';
}

/**
 * KisTrCircuitStateName 5-state → KisCircuitEnforcementState 4-state 매핑 SSOT.
 *
 * errorTaxonomy.ts 본체 무수정 — 본 SSOT 는 read-only consumer.
 *
 * 매핑 정책 (절대 변경 금지):
 *   CLOSED → CLOSED
 *   SOFT_THROTTLED → SOFT_THROTTLED
 *   OPEN → OPEN
 *   HALF_OPEN → OPEN (보수적, 회복 중 신규 호출 차단)
 *   CLOSED_RECOVERED → CLOSED
 */
export function mapTrCircuitStateToEnforcement(
  trState: KisTrCircuitStateName,
  throttleLevel: KisThrottleLevel,
  options?: { distinctOpenTrIds?: number; recent5xxBurst?: boolean },
): KisCircuitEnforcementState {
  // HARD_OPEN 진입 조건 (사용자 §"긴급 수정 목표" §3):
  //   - 연속 5xx burst (provider health isolation 의 HTTP_500_BURST_60S trip)
  //   - OR 다중 trId 회로 OPEN (≥ 3 distinct trId in OPEN state)
  if (options?.recent5xxBurst === true) return 'HARD_OPEN';
  if ((options?.distinctOpenTrIds ?? 0) >= 3) return 'HARD_OPEN';

  if (throttleLevel === 'CIRCUIT_OPEN') return 'OPEN';
  if (trState === 'OPEN') return 'OPEN';
  if (trState === 'HALF_OPEN') return 'OPEN'; // 보수적
  if (trState === 'SOFT_THROTTLED' || throttleLevel === 'SOFT' || throttleLevel === 'HARD') {
    return throttleLevel === 'HARD' ? 'OPEN' : 'SOFT_THROTTLED';
  }
  return 'CLOSED';
}

/**
 * 4 × 5 enforcement 매트릭스 SSOT (사용자 명시, 절대 변경 금지).
 *
 * | state           | P0           | P1     | P2                       | P3       | P4       |
 * | --------------- | ------------ | ------ | ------------------------ | -------- | -------- |
 * | CLOSED          | ALLOW        | ALLOW  | ALLOW_LIVE               | ALLOW    | ALLOW    |
 * | SOFT_THROTTLED  | ALLOW        | ALLOW  | ALLOW_CACHE_ONLY         | SUPPRESS | SUPPRESS |
 * | OPEN            | ALLOW        | ALLOW  | SKIP_WITH_STALE_OR_BLOCK | SUPPRESS | SUPPRESS |
 * | HARD_OPEN       | ALLOW_LIMITED| SKIP   | SKIP_WITH_STALE_OR_BLOCK | SUPPRESS | SUPPRESS |
 */
export const ENFORCEMENT_MATRIX: Readonly<
  Record<KisCircuitEnforcementState, Readonly<Record<KisCallPriorityV2, KisCircuitEnforcementAction>>>
> = Object.freeze({
  CLOSED: Object.freeze({
    P0_POSITION_EXIT: 'ALLOW',
    P1_SHADOW_POSITION_MANAGEMENT: 'ALLOW',
    P2_READY_CANDIDATE_CONFIRM: 'ALLOW_LIVE',
    P3_SCAN_DIAGNOSTIC: 'ALLOW',
    P4_TELEMETRY_VERBOSE: 'ALLOW',
  }),
  SOFT_THROTTLED: Object.freeze({
    P0_POSITION_EXIT: 'ALLOW',
    P1_SHADOW_POSITION_MANAGEMENT: 'ALLOW',
    P2_READY_CANDIDATE_CONFIRM: 'ALLOW_CACHE_ONLY',
    P3_SCAN_DIAGNOSTIC: 'SUPPRESS',
    P4_TELEMETRY_VERBOSE: 'SUPPRESS',
  }),
  OPEN: Object.freeze({
    P0_POSITION_EXIT: 'ALLOW',
    P1_SHADOW_POSITION_MANAGEMENT: 'ALLOW',
    P2_READY_CANDIDATE_CONFIRM: 'SKIP_WITH_STALE_OR_BLOCK',
    P3_SCAN_DIAGNOSTIC: 'SUPPRESS',
    P4_TELEMETRY_VERBOSE: 'SUPPRESS',
  }),
  HARD_OPEN: Object.freeze({
    P0_POSITION_EXIT: 'ALLOW_LIMITED',
    P1_SHADOW_POSITION_MANAGEMENT: 'SKIP',
    P2_READY_CANDIDATE_CONFIRM: 'SKIP_WITH_STALE_OR_BLOCK',
    P3_SCAN_DIAGNOSTIC: 'SUPPRESS',
    P4_TELEMETRY_VERBOSE: 'SUPPRESS',
  }),
});

export interface EvaluateCircuitEnforcementInput {
  readonly trId: string;
  readonly symbol?: string;
  readonly priority: KisCallPriorityV2;
  readonly trCircuitState: KisTrCircuitStateName;
  readonly throttleLevel: KisThrottleLevel;
  readonly cacheAvailable: boolean;
  readonly distinctOpenTrIds?: number;
  readonly recent5xxBurst?: boolean;
  readonly nowMs?: number;
}

/**
 * Enforcement 결정 SSOT — circuit × priority × cache → action.
 *
 * 결정 트리 우선순위 (절대 변경 금지):
 *   1. ENV DISABLED → ALLOW (PR #965/#967 동작 보존)
 *   2. enforcementState 산출 (mapTrCircuitStateToEnforcement)
 *   3. ENFORCEMENT_MATRIX[state][priority] → action
 *   4. P2 ALLOW_CACHE_ONLY + cache miss → SKIP_WITH_STALE_OR_BLOCK 격하
 *   5. blockingReason 결정 (action 기반):
 *      - ALLOW_CACHE_ONLY → null (cache hit 시 통과)
 *      - SKIP_WITH_STALE_OR_BLOCK + cacheAvailable → CIRCUIT_OPEN_SKIP_WITH_STALE
 *      - SKIP_WITH_STALE_OR_BLOCK + !cacheAvailable → CIRCUIT_OPEN_NEW_BUY_BLOCKED
 *      - SKIP (P1) → HARD_OPEN_GLOBAL_BLOCK
 *      - ALLOW_LIMITED (P0) → HARD_OPEN_LIMITED_EXIT_ONLY (info)
 *   6. executionImpact: 'NEW_BUY_BLOCKED_ONLY' if P2 blocked, else 'NONE'
 *   7. deferredQueued: false (literal) — 절대 불변식
 */
export function evaluateCircuitEnforcement(
  input: EvaluateCircuitEnforcementInput,
): KisCircuitEnforcementDecision {
  const nowMs = input.nowMs ?? Date.now();

  const base = {
    priority: input.priority,
    trId: input.trId,
    symbol: input.symbol,
    decidedAtMs: nowMs,
    deferredQueued: false as const,
    marketSignal: false as const,
    engineAlive: true as const,
    shadowLearning: true as const,
  };

  // 1. ENV DISABLED → ALLOW (legacy 동작 복원)
  if (isKisCircuitGovernorDisabled()) {
    return {
      ...base,
      enforcementState: 'CLOSED',
      action: 'ALLOW',
      allowed: true,
      blockingReason: null,
      executionImpact: 'NONE',
      newKisCallsAllowed: true,
    };
  }

  // 2. enforcementState 산출
  const enforcementState = mapTrCircuitStateToEnforcement(input.trCircuitState, input.throttleLevel, {
    distinctOpenTrIds: input.distinctOpenTrIds,
    recent5xxBurst: input.recent5xxBurst,
  });

  // 3. matrix lookup
  let action = ENFORCEMENT_MATRIX[enforcementState][input.priority];

  // 4. P2 ALLOW_CACHE_ONLY + cache miss → SKIP_WITH_STALE_OR_BLOCK
  if (action === 'ALLOW_CACHE_ONLY' && !input.cacheAvailable) {
    action = 'SKIP_WITH_STALE_OR_BLOCK';
  }

  // 5/6. blockingReason + executionImpact 결정
  let blockingReason: KisCircuitBlockingReason | null = null;
  let executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' = 'NONE';
  let allowed = true;
  let newKisCallsAllowed = true;

  switch (action) {
    case 'ALLOW':
    case 'ALLOW_LIVE':
      break;
    case 'ALLOW_CACHE_ONLY':
      blockingReason = 'CIRCUIT_OPEN_CACHE_ONLY';
      newKisCallsAllowed = false; // cache 만 허용
      break;
    case 'ALLOW_LIMITED':
      blockingReason = 'HARD_OPEN_LIMITED_EXIT_ONLY';
      break;
    case 'SKIP':
      allowed = false;
      newKisCallsAllowed = false;
      blockingReason = 'HARD_OPEN_GLOBAL_BLOCK';
      break;
    case 'SKIP_WITH_STALE_OR_BLOCK':
      allowed = false;
      newKisCallsAllowed = false;
      if (input.cacheAvailable) {
        blockingReason = 'CIRCUIT_OPEN_SKIP_WITH_STALE';
        executionImpact = 'NEW_BUY_BLOCKED_ONLY';
      } else {
        blockingReason = 'CIRCUIT_OPEN_NEW_BUY_BLOCKED';
        executionImpact = 'NEW_BUY_BLOCKED_ONLY';
      }
      break;
    case 'SUPPRESS':
      allowed = false;
      newKisCallsAllowed = false;
      break;
  }

  return {
    ...base,
    enforcementState,
    action,
    allowed,
    blockingReason,
    executionImpact,
    newKisCallsAllowed,
  };
}

/**
 * `[KIS_CIRCUIT_STATE]` 진단 로그 SSOT (사용자 §"기대 로그" 정확 형식).
 *
 * 60s window throttle 동반 (logThrottle 분리 — Patch-004 hotfix 패턴 차용).
 */
export function formatKisCircuitStateLog(decision: KisCircuitEnforcementDecision): string {
  const allowedPriorities = listAllowedPriorities(decision.enforcementState);
  const blockedPriorities = listBlockedPriorities(decision.enforcementState);
  return [
    `[KIS_CIRCUIT_STATE]`,
    `state=${decision.enforcementState}`,
    `reason=${decision.blockingReason ?? 'NORMAL_OPERATION'}`,
    `allowedPriorities=${allowedPriorities.join(',')}`,
    `blockedPriorities=${blockedPriorities.join(',')}`,
    `newKisCallsAllowed=${decision.newKisCallsAllowed}`,
  ].join(' ');
}

/**
 * `[KIS_READY_CANDIDATE_SKIPPED]` 진단 로그 SSOT — P2 SKIP 분기 전용.
 */
export function formatKisReadyCandidateSkippedLog(decision: KisCircuitEnforcementDecision): string {
  return [
    `[KIS_READY_CANDIDATE_SKIPPED]`,
    `reason=${decision.blockingReason ?? 'CIRCUIT_OPEN_CACHE_ONLY'}`,
    `deferred=false`,
    `queued=false`,
    `executionImpact=${decision.executionImpact}`,
    `shadowLearning=true`,
  ].join(' ');
}

/**
 * `/scan_blockers runtime` compact 1-line summary (PATCH-RUNTIME 태그).
 */
export function formatKisCircuitEnforcementCompactLine(state: KisCircuitEnforcementState): string {
  const allowed = listAllowedPriorities(state);
  const blocked = listBlockedPriorities(state);
  return [
    `[PATCH-RUNTIME] (Patch-005)`,
    `KisCircuit state=${state}`,
    `allowed=[${allowed.join(',')}]`,
    `blocked=[${blocked.join(',')}]`,
    `marketSignal=false`,
    `executionImpact=NONE`,
    `engineAlive=true`,
    `shadowLearning=true`,
  ].join(' ');
}

function listAllowedPriorities(state: KisCircuitEnforcementState): KisCallPriorityV2[] {
  const matrix = ENFORCEMENT_MATRIX[state];
  const allowed: KisCallPriorityV2[] = [];
  for (const p of [
    'P0_POSITION_EXIT',
    'P1_SHADOW_POSITION_MANAGEMENT',
    'P2_READY_CANDIDATE_CONFIRM',
    'P3_SCAN_DIAGNOSTIC',
    'P4_TELEMETRY_VERBOSE',
  ] as const) {
    const a = matrix[p];
    if (a === 'ALLOW' || a === 'ALLOW_LIVE' || a === 'ALLOW_LIMITED') allowed.push(p);
  }
  return allowed;
}

function listBlockedPriorities(state: KisCircuitEnforcementState): KisCallPriorityV2[] {
  const matrix = ENFORCEMENT_MATRIX[state];
  const blocked: KisCallPriorityV2[] = [];
  for (const p of [
    'P0_POSITION_EXIT',
    'P1_SHADOW_POSITION_MANAGEMENT',
    'P2_READY_CANDIDATE_CONFIRM',
    'P3_SCAN_DIAGNOSTIC',
    'P4_TELEMETRY_VERBOSE',
  ] as const) {
    const a = matrix[p];
    if (a === 'SKIP' || a === 'SKIP_WITH_STALE_OR_BLOCK' || a === 'SUPPRESS') blocked.push(p);
  }
  return blocked;
}

// 60s window throttle — state 전이 시에만 emit, 동일 state 반복 suppress
interface CircuitStateLogThrottleEntry {
  lastEmittedAtMs: number;
  lastState: KisCircuitEnforcementState | null;
  suppressedCount: number;
}
const _circuitStateLogThrottle = new Map<string, CircuitStateLogThrottleEntry>();
const CIRCUIT_STATE_LOG_THROTTLE_WINDOW_MS = 60_000;

export interface ShouldEmitCircuitStateLogResult {
  readonly emit: boolean;
  readonly stateChanged: boolean;
  readonly suppressedSinceLast: number;
  readonly windowMs: number;
}

export function shouldEmitCircuitStateLog(
  trId: string,
  state: KisCircuitEnforcementState,
  nowMs: number = Date.now(),
): ShouldEmitCircuitStateLogResult {
  const entry = _circuitStateLogThrottle.get(trId);
  if (!entry) {
    _circuitStateLogThrottle.set(trId, { lastEmittedAtMs: nowMs, lastState: state, suppressedCount: 0 });
    return { emit: true, stateChanged: true, suppressedSinceLast: 0, windowMs: CIRCUIT_STATE_LOG_THROTTLE_WINDOW_MS };
  }
  const stateChanged = entry.lastState !== state;
  if (stateChanged) {
    // state 전이는 항상 emit (운영자 인지 의무)
    const suppressed = entry.suppressedCount;
    entry.lastEmittedAtMs = nowMs;
    entry.lastState = state;
    entry.suppressedCount = 0;
    return { emit: true, stateChanged: true, suppressedSinceLast: suppressed, windowMs: CIRCUIT_STATE_LOG_THROTTLE_WINDOW_MS };
  }
  if (nowMs - entry.lastEmittedAtMs < CIRCUIT_STATE_LOG_THROTTLE_WINDOW_MS) {
    entry.suppressedCount += 1;
    return { emit: false, stateChanged: false, suppressedSinceLast: entry.suppressedCount, windowMs: CIRCUIT_STATE_LOG_THROTTLE_WINDOW_MS };
  }
  const suppressed = entry.suppressedCount;
  entry.lastEmittedAtMs = nowMs;
  entry.suppressedCount = 0;
  return { emit: true, stateChanged: false, suppressedSinceLast: suppressed, windowMs: CIRCUIT_STATE_LOG_THROTTLE_WINDOW_MS };
}

// 테스트 격리 헬퍼
export function __resetKisCircuitGovernorStateForTests(): void {
  _circuitStateLogThrottle.clear();
}
