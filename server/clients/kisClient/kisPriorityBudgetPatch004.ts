/**
 * @responsibility KIS TR priority budget + TTL dedup SSOT (Patch-004 직속 후속, ADR-0146 PR 자가 review 정합)
 *
 * Patch ID: KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001
 *
 * 사용자 5/14 운영 보고 직접 반영 — Railway 로그 `[KIS_TR_THROTTLE_APPLIED] level=SOFT/HARD` + `[KIS_CALL_DEFERRED] reason=TR_CIRCUIT_OPEN_OR_THROTTLED`
 * 시점 P0 보유 매도 관리 vs P3 scan diagnostic 호출이 동등 priority 로 KIS quota 소모 → 보유 관리 지연 위험 +
 * bearish signal 오해석 위험 차단.
 *
 * Safety invariants (절대 변경 금지):
 *   - P0_POSITION_EXIT 는 항상 allowed=true (보유 매도 절대 차단 금지)
 *   - marketSignal: false literal type 강제 (KIS 장애 ≠ bearish signal)
 *   - executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' literal 강제
 *   - engineAlive: true / shadowLearning: true literal 강제
 *   - KIS 주문 함수 5종 import 0건 (정적 grep 가드)
 *   - assessKisTrPressure 본체 무수정 (read-only consumer)
 *   - LIVE 매매 본체 0줄 변경
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

import type { KisCallPriority, KisFallbackConfidence, KisFallbackProvider, KisThrottleLevel, KisTrCircuitStateName } from './errorTaxonomy.js';

// 사용자 명시 P0~P4 라벨 union (절대 변경 금지)
export type KisCallPriorityV2 =
  | 'P0_POSITION_EXIT'
  | 'P1_SHADOW_POSITION_MANAGEMENT'
  | 'P2_READY_CANDIDATE_CONFIRM'
  | 'P3_SCAN_DIAGNOSTIC'
  | 'P4_TELEMETRY_VERBOSE';

// V1 (기존 errorTaxonomy) → V2 (사용자 명시 라벨) 매핑 SSOT
export const PRIORITY_V1_TO_V2: Readonly<Record<KisCallPriority, KisCallPriorityV2>> = Object.freeze({
  REAL_POSITION: 'P0_POSITION_EXIT',
  SHADOW_OPEN: 'P1_SHADOW_POSITION_MANAGEMENT',
  READY_CANDIDATE: 'P2_READY_CANDIDATE_CONFIRM',
  SCAN_DIAGNOSTIC: 'P3_SCAN_DIAGNOSTIC',
  WATCHLIST: 'P4_TELEMETRY_VERBOSE',
});

// V2 → V1 역매핑 (기존 호출자 호환)
export const PRIORITY_V2_TO_V1: Readonly<Record<KisCallPriorityV2, KisCallPriority>> = Object.freeze({
  P0_POSITION_EXIT: 'REAL_POSITION',
  P1_SHADOW_POSITION_MANAGEMENT: 'SHADOW_OPEN',
  P2_READY_CANDIDATE_CONFIRM: 'READY_CANDIDATE',
  P3_SCAN_DIAGNOSTIC: 'SCAN_DIAGNOSTIC',
  P4_TELEMETRY_VERBOSE: 'WATCHLIST',
});

export function mapPriorityV1ToV2(p: KisCallPriority): KisCallPriorityV2 {
  return PRIORITY_V1_TO_V2[p];
}

export function mapPriorityV2ToV1(p: KisCallPriorityV2): KisCallPriority {
  return PRIORITY_V2_TO_V1[p];
}

// 60초당 priority별 budget SSOT (절대 변경 금지)
export const PER_PRIORITY_BUDGET_60S: Readonly<Record<KisCallPriorityV2, number>> = Object.freeze({
  P0_POSITION_EXIT: Number.POSITIVE_INFINITY, // 보유 매도 무제한 보장
  P1_SHADOW_POSITION_MANAGEMENT: 30,
  P2_READY_CANDIDATE_CONFIRM: 20,
  P3_SCAN_DIAGNOSTIC: 5,
  P4_TELEMETRY_VERBOSE: 2,
});

export const PRIORITY_TTL_DEDUP_MS = 5_000; // 5초 — P3/P4 noise burst 차단

// 8-value reason union SSOT
export type KisPriorityBudgetReason =
  | 'EXIT_MANAGEMENT_PROTECTED'         // P0 항상 통과
  | 'BUDGET_OK'                          // budget 잔여
  | 'BUDGET_EXCEEDED'                    // 60s budget 초과
  | 'TR_CIRCUIT_OPEN_OR_THROTTLED'       // circuit OPEN 또는 HARD/SOFT throttle
  | 'TTL_DEDUP_DUPLICATE'                // 5s TTL 내 중복 호출
  | 'ENV_DISABLED'                       // ENV gate 비활성
  | 'KIS_TR_HARD_THROTTLED'              // 사용자 §HARD throttle 시 새 매수 후보 보류
  | 'P0_BUDGET_OK_INFINITE';             // P0 무제한 명시

export type KisPriorityBudgetAction = 'ALLOW' | 'DEFER' | 'SUPPRESS' | 'DROP' | 'SUPPRESS_DIAGNOSTIC_ONLY';

// Decision schema (literal type 강제)
export interface KisPriorityBudgetDecision {
  readonly priority: KisCallPriorityV2;
  readonly allowed: boolean;
  readonly deferred: boolean;
  readonly dropped: boolean;
  readonly reason: KisPriorityBudgetReason;
  readonly fallbackProvider?: KisFallbackProvider;
  readonly fallbackReason?: string;
  readonly confidence?: KisFallbackConfidence;
  readonly diagnosticSuppressed?: boolean;
  readonly blocking?: boolean;
  readonly dataVacuum?: boolean;
  readonly throttleLevel: KisThrottleLevel;
  readonly circuitState: KisTrCircuitStateName;
  readonly sameSecondCalls: number;
  readonly sameMinuteCalls: number;
  readonly budgetUsed60s: number;
  readonly budgetLimit60s: number;
  // 절대 불변식 literal types (TypeScript 컴파일 타임 강제):
  readonly marketSignal: false;
  readonly executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY';
  readonly engineAlive: true;
  readonly shadowLearning: true;
  readonly action: KisPriorityBudgetAction;
  readonly trId: string;
  readonly symbol?: string;
  readonly decidedAtMs: number;
}

// ENV gate SSOT (ADR-0157 정확 비교)
export function isKisPriorityBudgetDisabled(): boolean {
  return process.env.KIS_PRIORITY_BUDGET_PATCH_004_DISABLED === 'true';
}

export function isKisPriorityTtlDedupDisabled(): boolean {
  return process.env.KIS_PRIORITY_TTL_DEDUP_DISABLED === 'true';
}

// per-priority budget tracking (in-memory ring)
interface CallRecord {
  trId: string;
  priority: KisCallPriorityV2;
  atMs: number;
}
const _budgetEvents: CallRecord[] = [];

function pruneBudgetEvents(nowMs: number): void {
  const oneMinuteAgo = nowMs - 60_000;
  while (_budgetEvents.length > 0 && _budgetEvents[0]!.atMs < oneMinuteAgo) _budgetEvents.shift();
}

export function countPriorityBudgetUsed60s(priority: KisCallPriorityV2, nowMs = Date.now()): number {
  pruneBudgetEvents(nowMs);
  return _budgetEvents.filter((e) => e.priority === priority).length;
}

export function recordPriorityBudgetCall(trId: string, priority: KisCallPriorityV2, nowMs = Date.now()): void {
  if (isKisPriorityBudgetDisabled()) return;
  pruneBudgetEvents(nowMs);
  _budgetEvents.push({ trId, priority, atMs: nowMs });
}

// TTL dedup tracking
const _ttlDedupStore = new Map<string, number>(); // key -> lastCalledAtMs

export function buildTtlDedupKey(trId: string, symbol: string | undefined, priority: KisCallPriorityV2): string {
  return `${trId}:${symbol ?? 'NO_SYMBOL'}:${priority}`;
}

export function isPriorityCallDeduped(trId: string, symbol: string | undefined, priority: KisCallPriorityV2, nowMs = Date.now()): boolean {
  if (isKisPriorityTtlDedupDisabled()) return false;
  // P0 dedup 적용 안 함 (보유 매도 절대 보호)
  if (priority === 'P0_POSITION_EXIT') return false;
  const key = buildTtlDedupKey(trId, symbol, priority);
  const lastAt = _ttlDedupStore.get(key);
  if (lastAt === undefined) return false;
  return nowMs - lastAt < PRIORITY_TTL_DEDUP_MS;
}

export function recordPriorityCallTtl(trId: string, symbol: string | undefined, priority: KisCallPriorityV2, nowMs = Date.now()): void {
  if (isKisPriorityTtlDedupDisabled()) return;
  if (priority === 'P0_POSITION_EXIT') return;
  const key = buildTtlDedupKey(trId, symbol, priority);
  _ttlDedupStore.set(key, nowMs);
  // light prune: 만료 키 제거 (호출당 random 1건)
  if (_ttlDedupStore.size > 200 && Math.random() < 0.1) {
    const cutoff = nowMs - PRIORITY_TTL_DEDUP_MS * 2;
    for (const [k, t] of _ttlDedupStore) {
      if (t < cutoff) _ttlDedupStore.delete(k);
    }
  }
}

export interface EvaluatePriorityBudgetInput {
  readonly trId: string;
  readonly symbol?: string;
  readonly priority: KisCallPriorityV2;
  readonly throttleLevel: KisThrottleLevel;
  readonly circuitState: KisTrCircuitStateName;
  readonly sameSecondCalls: number;
  readonly sameMinuteCalls: number;
  readonly cacheAvailable: boolean; // CACHE fallback 가용 여부
  readonly nowMs?: number;
}

/**
 * priority budget 결정 트리 SSOT (사용자 §우선순위 정책 절대 변경 금지)
 *
 * 우선순위:
 *   1. ENV DISABLED → allowed=true (Patch-003 동작 보존)
 *   2. P0_POSITION_EXIT → 항상 allowed=true (절대 불변식)
 *   3. TTL dedup → deferred=true + reason='TTL_DEDUP_DUPLICATE'
 *   4. circuit OPEN/HARD throttle:
 *      - P1/P2 → allowed=true (보유 + READY 보호)
 *      - P3/P4 → deferred=true + reason='TR_CIRCUIT_OPEN_OR_THROTTLED'
 *      - HARD throttle + P2 new buy candidate → blockReason='KIS_TR_HARD_THROTTLED' + executionImpact='NEW_BUY_BLOCKED_ONLY'
 *   5. SOFT throttle:
 *      - P0/P1/P2 → allowed=true
 *      - P3 → 60s budget 잔여 → 초과 시 deferred
 *      - P4 → 60s budget 잔여 → 초과 시 dropped (suppress)
 *   6. NONE throttle: 60s budget 잔여만 check
 */
export function evaluatePriorityBudget(input: EvaluatePriorityBudgetInput): KisPriorityBudgetDecision {
  const nowMs = input.nowMs ?? Date.now();
  const budgetLimit60s = PER_PRIORITY_BUDGET_60S[input.priority];
  const budgetUsed60s = countPriorityBudgetUsed60s(input.priority, nowMs);

  const baseDecision = {
    priority: input.priority,
    throttleLevel: input.throttleLevel,
    circuitState: input.circuitState,
    sameSecondCalls: input.sameSecondCalls,
    sameMinuteCalls: input.sameMinuteCalls,
    budgetUsed60s,
    budgetLimit60s,
    marketSignal: false as const,
    engineAlive: true as const,
    shadowLearning: true as const,
    trId: input.trId,
    symbol: input.symbol,
    decidedAtMs: nowMs,
    blocking: false as const,
    dataVacuum: false as const,
  };

  // 1. ENV DISABLED → allowed=true (Patch-003 동작 보존)
  if (isKisPriorityBudgetDisabled()) {
    return {
      ...baseDecision,
      allowed: true,
      deferred: false,
      dropped: false,
      reason: 'ENV_DISABLED',
      executionImpact: 'NONE',
      action: 'ALLOW',
    };
  }

  // 2. P0_POSITION_EXIT → 항상 allowed=true (절대 불변식)
  if (input.priority === 'P0_POSITION_EXIT') {
    return {
      ...baseDecision,
      allowed: true,
      deferred: false,
      dropped: false,
      reason: 'EXIT_MANAGEMENT_PROTECTED',
      executionImpact: 'NONE',
      action: 'ALLOW',
    };
  }

  // 2b. P1_SHADOW_POSITION_MANAGEMENT → throttle/budget 상황에서도 항상 allowed=true (보유 관리/Shadow 보호)
  if (input.priority === 'P1_SHADOW_POSITION_MANAGEMENT') {
    return {
      ...baseDecision,
      allowed: true,
      deferred: false,
      dropped: false,
      reason: 'BUDGET_OK',
      executionImpact: 'NONE',
      action: 'ALLOW',
    };
  }

  // 3. TTL dedup → deferred=true
  if (isPriorityCallDeduped(input.trId, input.symbol, input.priority, nowMs)) {
    return {
      ...baseDecision,
      allowed: false,
      deferred: true,
      dropped: false,
      reason: 'TTL_DEDUP_DUPLICATE',
      executionImpact: 'NONE',
      action: 'DEFER',
    };
  }

  const circuitOpen = input.circuitState === 'OPEN';
  const hardThrottle = input.throttleLevel === 'HARD';
  const softThrottle = input.throttleLevel === 'SOFT';

  // 4. circuit OPEN/HARD throttle
  if (circuitOpen || hardThrottle) {
    // P2 보호 (READY 후보)
    if (input.priority === 'P2_READY_CANDIDATE_CONFIRM') {
      // HARD throttle + P2 신규 매수 후보 → blockReason 명시
      if (hardThrottle) {
        const fallback = computeFallbackForDeferred(input.cacheAvailable);
        return {
          ...baseDecision,
          allowed: false,
          deferred: true,
          dropped: false,
          reason: 'KIS_TR_HARD_THROTTLED',
          ...fallback,
          executionImpact: 'NEW_BUY_BLOCKED_ONLY',
          action: 'DEFER',
        };
      }
      // circuit OPEN + P2: 제한적 허용
      return {
        ...baseDecision,
        allowed: true,
        deferred: false,
        dropped: false,
        reason: 'BUDGET_OK',
        executionImpact: 'NONE',
        action: 'ALLOW',
      };
    }
    // P3/P4 → 진단/텔레메트리 전용 suppress. execution confidence / DATA_VACUUM 으로 전파 금지.
    return buildDiagnosticSuppressedDecision(baseDecision, 'TR_CIRCUIT_OPEN_OR_THROTTLED');
  }

  // 5. SOFT throttle
  if (softThrottle) {
    if (input.priority === 'P2_READY_CANDIDATE_CONFIRM') {
      // budget check
      if (budgetUsed60s >= budgetLimit60s) {
        const fallback = computeFallbackForDeferred(input.cacheAvailable);
        return {
          ...baseDecision,
          allowed: false,
          deferred: true,
          dropped: false,
          reason: 'BUDGET_EXCEEDED',
          ...fallback,
          executionImpact: 'NONE',
          action: 'DEFER',
        };
      }
      return {
        ...baseDecision,
        allowed: true,
        deferred: false,
        dropped: false,
        reason: 'BUDGET_OK',
        executionImpact: 'NONE',
        action: 'ALLOW',
      };
    }
    // P3 → budget 초과 시 defer
    if (input.priority === 'P3_SCAN_DIAGNOSTIC') {
      if (budgetUsed60s >= budgetLimit60s) {
        return buildDiagnosticSuppressedDecision(baseDecision, 'BUDGET_EXCEEDED');
      }
      return {
        ...baseDecision,
        allowed: true,
        deferred: false,
        dropped: false,
        reason: 'BUDGET_OK',
        executionImpact: 'NONE',
        action: 'ALLOW',
      };
    }
    // P4 → budget 초과 시 telemetry-only suppress
    if (budgetUsed60s >= budgetLimit60s) {
      return buildDiagnosticSuppressedDecision(baseDecision, 'BUDGET_EXCEEDED');
    }
    return {
      ...baseDecision,
      allowed: true,
      deferred: false,
      dropped: false,
      reason: 'BUDGET_OK',
      executionImpact: 'NONE',
      action: 'ALLOW',
    };
  }

  // 6. NONE throttle: budget 잔여만 check
  if (budgetUsed60s >= budgetLimit60s) {
    if (input.priority === 'P4_TELEMETRY_VERBOSE') {
      return buildDiagnosticSuppressedDecision(baseDecision, 'BUDGET_EXCEEDED');
    }
    if (input.priority === 'P3_SCAN_DIAGNOSTIC') {
      return buildDiagnosticSuppressedDecision(baseDecision, 'BUDGET_EXCEEDED');
    }
    const fallback = computeFallbackForDeferred(input.cacheAvailable);
    return {
      ...baseDecision,
      allowed: false,
      deferred: true,
      dropped: false,
      reason: 'BUDGET_EXCEEDED',
      ...fallback,
      executionImpact: 'NONE',
      action: 'DEFER',
    };
  }

  // P0 는 라인 ~163 early return 으로 이미 처리됨 — 여기서는 P1~P4 만 도달.
  return {
    ...baseDecision,
    allowed: true,
    deferred: false,
    dropped: false,
    reason: 'BUDGET_OK',
    executionImpact: 'NONE',
    action: 'ALLOW',
  };
}


function buildDiagnosticSuppressedDecision(
  baseDecision: Omit<KisPriorityBudgetDecision, 'allowed' | 'deferred' | 'dropped' | 'reason' | 'executionImpact' | 'action'>,
  reason: KisPriorityBudgetReason,
): KisPriorityBudgetDecision {
  const isP4 = baseDecision.priority === 'P4_TELEMETRY_VERBOSE';
  return {
    ...baseDecision,
    allowed: false,
    deferred: false,
    dropped: true,
    reason,
    fallbackProvider: 'NONE',
    fallbackReason: 'DIAGNOSTIC_SUPPRESSED_NO_EXECUTION_FALLBACK_REQUIRED',
    confidence: 'NOT_APPLICABLE',
    diagnosticSuppressed: true,
    blocking: false,
    dataVacuum: false,
    executionImpact: 'NONE',
    action: isP4 || baseDecision.priority === 'P3_SCAN_DIAGNOSTIC' ? 'SUPPRESS_DIAGNOSTIC_ONLY' : 'SUPPRESS',
  };
}

/**
 * fallbackProvider CACHE/NONE 분리 + confidence DEGRADED/MISSING 결정 SSOT
 * (사용자 §6/§7 정합)
 */
export function computeFallbackForDeferred(cacheAvailable: boolean): {
  fallbackProvider: KisFallbackProvider;
  fallbackReason: string;
  confidence: KisFallbackConfidence;
} {
  if (cacheAvailable) {
    return {
      fallbackProvider: 'CACHE',
      fallbackReason: 'LGV_USED_FOR_DEFERRED_PRIORITY',
      confidence: 'DEGRADED',
    };
  }
  return {
    fallbackProvider: 'NONE',
    fallbackReason: 'NO_FALLBACK_AVAILABLE',
    confidence: 'MISSING',
  };
}

/**
 * `[KIS_PRIORITY_BUDGET]` Railway 진단 로그 SSOT (사용자 §기대 로그 예시 정확 형식)
 */
export function formatKisPriorityBudgetLog(decision: KisPriorityBudgetDecision): string {
  const parts = [
    `[KIS_PRIORITY_BUDGET]`,
    `priority=${decision.priority}`,
    `allowed=${decision.allowed}`,
    `reason=${decision.reason}`,
    `action=${decision.action}`,
    `blocking=${decision.blocking ?? false}`,
    `dataVacuum=${decision.dataVacuum ?? false}`,
    `executionImpact=${decision.executionImpact}`,
  ];
  if (decision.fallbackProvider) parts.push(`fallbackProvider=${decision.fallbackProvider}`);
  if (decision.confidence) parts.push(`confidence=${decision.confidence}`);
  return parts.join(' ');
}

/**
 * compact 1-line summary for /scan_blockers runtime section
 */
export function formatKisPriorityBudgetCompactLine(nowMs = Date.now()): string {
  const counts = {
    P0_POSITION_EXIT: countPriorityBudgetUsed60s('P0_POSITION_EXIT', nowMs),
    P1_SHADOW_POSITION_MANAGEMENT: countPriorityBudgetUsed60s('P1_SHADOW_POSITION_MANAGEMENT', nowMs),
    P2_READY_CANDIDATE_CONFIRM: countPriorityBudgetUsed60s('P2_READY_CANDIDATE_CONFIRM', nowMs),
    P3_SCAN_DIAGNOSTIC: countPriorityBudgetUsed60s('P3_SCAN_DIAGNOSTIC', nowMs),
    P4_TELEMETRY_VERBOSE: countPriorityBudgetUsed60s('P4_TELEMETRY_VERBOSE', nowMs),
  };
  return `[PATCH-RUNTIME] (Patch-004) KIS Priority Budget 60s: P0=${counts.P0_POSITION_EXIT} P1=${counts.P1_SHADOW_POSITION_MANAGEMENT}/${PER_PRIORITY_BUDGET_60S.P1_SHADOW_POSITION_MANAGEMENT} P2=${counts.P2_READY_CANDIDATE_CONFIRM}/${PER_PRIORITY_BUDGET_60S.P2_READY_CANDIDATE_CONFIRM} P3=${counts.P3_SCAN_DIAGNOSTIC}/${PER_PRIORITY_BUDGET_60S.P3_SCAN_DIAGNOSTIC} P4=${counts.P4_TELEMETRY_VERBOSE}/${PER_PRIORITY_BUDGET_60S.P4_TELEMETRY_VERBOSE} marketSignal=false executionImpact=NONE engineAlive=true shadowLearning=true`;
}

/**
 * Railway 로그 도배 차단 — Patch-001 (`realDataNoiseStore`) 60s window throttle 패턴 차용.
 *
 * 사용자 5/14 운영 보고 직접 차단 — Patch-004 wiring 이 `realDataKisGet` 매 호출마다
 * `[KIS_PRIORITY_BUDGET]` + `[DATA_VACUUM_ROOT_CAUSE]` 2 라인을 console.warn 으로
 * emit → throttle/circuit 활성 시 분당 수십~수백 라인 폭주.
 *
 * 정책: (trId, reason) 별 60s window 내 첫 emit 1회만 detail 출력, 후속은 suppress +
 *   카운트 누적. 60s 경과 후 다음 emit 에 `suppressedCount=N` suffix 부착.
 *
 * P0_POSITION_EXIT 또는 EXIT_MANAGEMENT_PROTECTED 는 throttle 적용 안 함 (보유 매도
 * 관련 알림은 항상 통과 — 절대 불변식). 다만 EXIT 는 reason=EXIT_MANAGEMENT_PROTECTED
 * 가 `decision.allowed=true` 인 정상 통과라 애초에 `formatKisPriorityBudgetLog` 호출
 * 경로에 진입하지 않음 (http.ts:374 `if (!budgetDecision.allowed)` 분기 안).
 *
 * Safety invariants:
 *   - throttle state in-memory only (process restart 시 자연 리셋, 영속 부재)
 *   - LIVE 매매 본체 0줄 변경 (caller wiring 만 throttled API 로 교체)
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

const PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS = 60_000;

interface PriorityBudgetLogThrottleEntry {
  lastEmittedAtMs: number;
  suppressedCount: number;
}

const _priorityBudgetLogThrottle = new Map<string, PriorityBudgetLogThrottleEntry>();

export interface ShouldEmitPriorityBudgetLogResult {
  readonly emit: boolean;
  readonly suppressedSinceLast: number;
  readonly windowMs: number;
}

export function isPriorityBudgetLogThrottleDisabled(): boolean {
  return process.env.KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED === 'true';
}

export function buildPriorityBudgetLogThrottleKey(trId: string, reason: KisPriorityBudgetReason): string {
  return `${trId}:${reason}`;
}

/**
 * Throttle 결정 SSOT — 60s window 내 첫 호출만 emit=true, 후속은 suppress + 카운트.
 *
 * ENV `KIS_PRIORITY_BUDGET_LOG_THROTTLE_DISABLED=true` 시 항상 emit=true + suppressed=0
 * (회귀 즉시 롤백).
 */
export function shouldEmitPriorityBudgetLog(
  trId: string,
  reason: KisPriorityBudgetReason,
  nowMs: number = Date.now(),
): ShouldEmitPriorityBudgetLogResult {
  if (isPriorityBudgetLogThrottleDisabled()) {
    return { emit: true, suppressedSinceLast: 0, windowMs: PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS };
  }
  const key = buildPriorityBudgetLogThrottleKey(trId, reason);
  const entry = _priorityBudgetLogThrottle.get(key);
  if (!entry) {
    _priorityBudgetLogThrottle.set(key, { lastEmittedAtMs: nowMs, suppressedCount: 0 });
    return { emit: true, suppressedSinceLast: 0, windowMs: PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS };
  }
  if (nowMs - entry.lastEmittedAtMs < PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS) {
    entry.suppressedCount += 1;
    return {
      emit: false,
      suppressedSinceLast: entry.suppressedCount,
      windowMs: PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS,
    };
  }
  const suppressed = entry.suppressedCount;
  entry.lastEmittedAtMs = nowMs;
  entry.suppressedCount = 0;
  pruneLogThrottle(nowMs);
  return { emit: true, suppressedSinceLast: suppressed, windowMs: PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS };
}

function pruneLogThrottle(nowMs: number): void {
  if (_priorityBudgetLogThrottle.size < 200) return;
  const cutoff = nowMs - PRIORITY_BUDGET_LOG_THROTTLE_WINDOW_MS * 5;
  for (const [k, entry] of _priorityBudgetLogThrottle) {
    if (entry.lastEmittedAtMs < cutoff && entry.suppressedCount === 0) {
      _priorityBudgetLogThrottle.delete(k);
    }
  }
}

/**
 * Throttled `[KIS_PRIORITY_BUDGET]` 진단 로그 SSOT — suppress 시 null 반환.
 *
 * 호출자 패턴:
 *   const log = formatKisPriorityBudgetLogThrottled(decision);
 *   if (log) console.warn(log);
 *
 * suppress 직후 첫 emit 에 `suppressedSinceLastMs=60000 suppressedCount=N` suffix 부착.
 */
export function formatKisPriorityBudgetLogThrottled(
  decision: KisPriorityBudgetDecision,
  nowMs: number = Date.now(),
): string | null {
  const result = shouldEmitPriorityBudgetLog(decision.trId, decision.reason, nowMs);
  if (!result.emit) return null;
  const base = formatKisPriorityBudgetLog(decision);
  if (result.suppressedSinceLast > 0) {
    return `${base} suppressedSinceLastMs=${result.windowMs} suppressedCount=${result.suppressedSinceLast}`;
  }
  return base;
}

/**
 * Throttled `[KIS_PRIORITY_BUDGET]` TTL_DEDUP_DUPLICATE 분기 전용 — http.ts:425 의 inline
 * console.warn 호출자가 사용. trId+reason='TTL_DEDUP_DUPLICATE' 별 60s window 적용.
 */
export function shouldEmitTtlDedupLog(
  trId: string,
  nowMs: number = Date.now(),
): ShouldEmitPriorityBudgetLogResult {
  return shouldEmitPriorityBudgetLog(trId, 'TTL_DEDUP_DUPLICATE', nowMs);
}

// 테스트 격리 헬퍼
export function __resetKisPriorityBudgetStateForTests(): void {
  _budgetEvents.length = 0;
  _ttlDedupStore.clear();
  _priorityBudgetLogThrottle.clear();
}
