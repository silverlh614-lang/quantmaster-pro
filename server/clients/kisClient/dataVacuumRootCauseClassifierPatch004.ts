/**
 * @responsibility DATA_VACUUM root cause 4분류 SSOT (Patch-004 직속 후속)
 *
 * Patch ID: KIS-TR-PRIORITY-BUDGET-AND-SAFE-DEGRADE-001
 *
 * 사용자 §10 정합 — DATA_VACUUM 원인을 4분류로 세분화:
 *   - KIS_TR_THROTTLED
 *   - KIS_SERVER_ERROR_WITH_CACHE
 *   - KIS_SERVER_ERROR_NO_CACHE
 *   - UPSTREAM_CANDIDATE_HYDRATION_FAILED
 *
 * Safety invariants (절대 변경 금지):
 *   - marketSignal: false literal 강제 (DATA_VACUUM ≠ bearish signal)
 *   - executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY' literal 강제
 *   - shadowLearning: true literal 강제
 *   - engineAlive: true literal 강제
 *   - 보유 매도 관리 / Shadow learning / case recording 차단 0 (사용자 §9)
 *   - KIS 주문 함수 import 0건 (정적 grep 가드)
 *   - LIVE 매매 본체 0줄 변경
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

import type { KisFallbackConfidence, KisFallbackProvider, KisThrottleLevel, KisTrCircuitStateName } from './errorTaxonomy.js';

// DATA_VACUUM root cause SSOT — UNKNOWN 금지, diagnostic/non-blocking 과 execution data gap 분리.
export type DataVacuumRootCause =
  | 'KIS_TR_THROTTLED'
  | 'KIS_SERVER_ERROR_WITH_CACHE'
  | 'KIS_SERVER_ERROR_NO_CACHE'
  | 'UPSTREAM_CANDIDATE_HYDRATION_FAILED'
  | 'P3_DIAGNOSTIC_BUDGET_SUPPRESSED'
  | 'P4_TELEMETRY_SUPPRESSED'
  | 'SHORT_LAYER_NOT_MATERIALIZED'
  | 'UNCLASSIFIED_NON_BLOCKING_DIAGNOSTIC'
  | 'UNCLASSIFIED_EXECUTION_DATA_GAP';

// nextAction 6-value union (사용자 §"기대 로그 예시" 참조)
export type DataVacuumNextAction =
  | 'REDUCE_SCAN_DIAGNOSTIC_CALLS_AND_USE_BATCH_CACHE'
  | 'WAIT_FOR_PROVIDER_RECOVERY'
  | 'RETRY_AFTER_COOLDOWN'
  | 'CHECK_UPSTREAM_PROVIDER'
  | 'KEEP_OBSERVING_NO_ACTION'
  | 'UNKNOWN_INVESTIGATE_RAILWAY_LOG'
  | 'KEEP_DIAGNOSTIC_SUPPRESSED';

export interface ClassifyDataVacuumInput {
  readonly throttleLevel: KisThrottleLevel;
  readonly circuitState: KisTrCircuitStateName;
  readonly hasRecent5xx: boolean;          // 직전 1분 내 5xx 발생 여부
  readonly cacheAvailable: boolean;        // LGV CACHE 가용
  readonly upstreamHydrationFailed: boolean; // candidate 합성 단계 실패
  readonly priority?: import('./kisPriorityBudgetPatch004.js').KisCallPriorityV2;
  readonly trId?: string;
  readonly budgetExceeded?: boolean;
  readonly shortLayerMaterializeSkipped?: boolean;
}

// Classification result schema (literal type 강제)
export interface DataVacuumClassification {
  readonly rootCause: DataVacuumRootCause;
  readonly fallbackProvider: KisFallbackProvider;
  readonly confidence: KisFallbackConfidence;
  // 절대 불변식:
  readonly marketSignal: false;
  readonly executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY';
  readonly engineAlive: true;
  readonly shadowLearning: true;
  readonly nextAction: DataVacuumNextAction;
  readonly classifiedAtMs: number;
  readonly priority?: import('./kisPriorityBudgetPatch004.js').KisCallPriorityV2;
  readonly trId?: string;
  readonly blocking: boolean;
  readonly dataVacuum: boolean;
  readonly useForExecution: boolean;
  readonly useForShadow: boolean;
}

export function isDataVacuumClassifierDisabled(): boolean {
  return process.env.DATA_VACUUM_CLASSIFIER_PATCH_004_DISABLED === 'true';
}

/**
 * 결정 트리 SSOT (사용자 §10 정합, 절대 변경 금지)
 *
 * 우선순위:
 *   1. ENV DISABLED → UNKNOWN fallback
 *   2. upstreamHydrationFailed=true → UPSTREAM_CANDIDATE_HYDRATION_FAILED
 *      (Gate1 candidate 합성 자체가 실패, KIS provider 와 무관)
 *   3. circuit OPEN/CLOSED_RECOVERED + hasRecent5xx:
 *      - cacheAvailable=true → KIS_SERVER_ERROR_WITH_CACHE + DEGRADED
 *      - cacheAvailable=false → KIS_SERVER_ERROR_NO_CACHE + MISSING
 *   4. throttle SOFT/HARD + hasRecent5xx=false → KIS_TR_THROTTLED
 *   5. 그 외 → UNKNOWN
 */
export function classifyDataVacuumRootCause(input: ClassifyDataVacuumInput, nowMs = Date.now()): DataVacuumClassification {
  // 1. ENV DISABLED
  if (isDataVacuumClassifierDisabled()) {
    return buildClassification('UNCLASSIFIED_NON_BLOCKING_DIAGNOSTIC', 'NONE', 'NOT_APPLICABLE', 'KEEP_DIAGNOSTIC_SUPPRESSED', 'NONE', nowMs, input);
  }

  if (input.shortLayerMaterializeSkipped) {
    return buildClassification(
      'SHORT_LAYER_NOT_MATERIALIZED',
      'NONE',
      'NOT_APPLICABLE',
      'KEEP_OBSERVING_NO_ACTION',
      'NONE',
      nowMs,
      input,
    );
  }

  if (input.priority === 'P3_SCAN_DIAGNOSTIC' && input.budgetExceeded) {
    return buildClassification(
      'P3_DIAGNOSTIC_BUDGET_SUPPRESSED',
      'NONE',
      'NOT_APPLICABLE',
      'KEEP_DIAGNOSTIC_SUPPRESSED',
      'NONE',
      nowMs,
      input,
    );
  }

  if (input.priority === 'P4_TELEMETRY_VERBOSE' && input.budgetExceeded) {
    return buildClassification(
      'P4_TELEMETRY_SUPPRESSED',
      'NONE',
      'NOT_APPLICABLE',
      'KEEP_DIAGNOSTIC_SUPPRESSED',
      'NONE',
      nowMs,
      input,
    );
  }

  // 2. upstream hydration 실패 (KIS provider 무관)
  if (input.upstreamHydrationFailed) {
    return buildClassification(
      'UPSTREAM_CANDIDATE_HYDRATION_FAILED',
      'NONE',
      'MISSING',
      'CHECK_UPSTREAM_PROVIDER',
      'NEW_BUY_BLOCKED_ONLY',
      nowMs,
      input,
    );
  }

  // 3. circuit OPEN/CLOSED_RECOVERED + 5xx
  const circuitDegraded = input.circuitState === 'OPEN' || input.circuitState === 'CLOSED_RECOVERED';
  if (circuitDegraded && input.hasRecent5xx) {
    if (input.cacheAvailable) {
      return buildClassification(
        'KIS_SERVER_ERROR_WITH_CACHE',
        'CACHE',
        'DEGRADED',
        'WAIT_FOR_PROVIDER_RECOVERY',
        'NONE',
        nowMs,
        input,
      );
    }
    return buildClassification(
      'KIS_SERVER_ERROR_NO_CACHE',
      'NONE',
      'MISSING',
      'WAIT_FOR_PROVIDER_RECOVERY',
      'NEW_BUY_BLOCKED_ONLY',
      nowMs,
      input,
    );
  }

  // 4. throttle (5xx 없음, 호출 제한)
  const throttled = input.throttleLevel === 'SOFT' || input.throttleLevel === 'HARD';
  if (throttled && !input.hasRecent5xx) {
    return buildClassification(
      'KIS_TR_THROTTLED',
      input.cacheAvailable ? 'CACHE' : 'NONE',
      input.cacheAvailable ? 'DEGRADED' : 'MISSING',
      'REDUCE_SCAN_DIAGNOSTIC_CALLS_AND_USE_BATCH_CACHE',
      'NONE',
      nowMs,
      input,
    );
  }

  // 5. UNKNOWN
  return buildClassification(
    input.priority === 'P3_SCAN_DIAGNOSTIC' || input.priority === 'P4_TELEMETRY_VERBOSE'
      ? 'UNCLASSIFIED_NON_BLOCKING_DIAGNOSTIC'
      : 'UNCLASSIFIED_EXECUTION_DATA_GAP',
    input.cacheAvailable ? 'CACHE' : 'NONE',
    input.cacheAvailable ? 'DEGRADED' : 'MISSING',
    'UNKNOWN_INVESTIGATE_RAILWAY_LOG',
    'NONE',
    nowMs,
    input,
  );
}

function buildClassification(
  rootCause: DataVacuumRootCause,
  fallbackProvider: KisFallbackProvider,
  confidence: KisFallbackConfidence,
  nextAction: DataVacuumNextAction,
  executionImpact: 'NONE' | 'NEW_BUY_BLOCKED_ONLY',
  classifiedAtMs: number,
  input?: ClassifyDataVacuumInput,
): DataVacuumClassification {
  const nonBlocking = rootCause === 'P3_DIAGNOSTIC_BUDGET_SUPPRESSED'
    || rootCause === 'P4_TELEMETRY_SUPPRESSED'
    || rootCause === 'SHORT_LAYER_NOT_MATERIALIZED'
    || rootCause === 'UNCLASSIFIED_NON_BLOCKING_DIAGNOSTIC';
  return {
    rootCause,
    fallbackProvider,
    confidence,
    marketSignal: false,
    executionImpact,
    engineAlive: true,
    shadowLearning: true,
    nextAction,
    classifiedAtMs,
    priority: input?.priority,
    trId: input?.trId,
    blocking: !nonBlocking && executionImpact === 'NEW_BUY_BLOCKED_ONLY',
    dataVacuum: !nonBlocking && executionImpact === 'NEW_BUY_BLOCKED_ONLY',
    useForExecution: rootCause !== 'SHORT_LAYER_NOT_MATERIALIZED' && !nonBlocking,
    useForShadow: true,
  };
}

/**
 * `[DATA_VACUUM_ROOT_CAUSE]` Railway 진단 로그 SSOT (사용자 §"기대 로그 예시" 정확 형식)
 */
export function formatDataVacuumRootCauseLog(c: DataVacuumClassification): string {
  return [
    '[DATA_VACUUM_ROOT_CAUSE]',
    `rootCause=${c.rootCause}`,
    ...(c.priority ? [`priority=${c.priority}`] : []),
    ...(c.trId ? [`trId=${c.trId}`] : []),
    `blocking=${c.blocking}`,
    `marketSignal=${c.marketSignal}`,
    `dataVacuum=${c.dataVacuum}`,
    `executionImpact=${c.executionImpact}`,
    `shadowLearning=${c.shadowLearning}`,
    `engineAlive=${c.engineAlive}`,
    `fallbackProvider=${c.fallbackProvider}`,
    `confidence=${c.confidence}`,
    `nextAction=${c.nextAction}`,
  ].join(' ');
}

/**
 * compact summary for /scan_blockers runtime section
 */
export function formatDataVacuumCompactLine(c: DataVacuumClassification): string {
  return `[PATCH-RUNTIME] (Patch-004 DATA_VACUUM) rootCause=${c.rootCause} nextAction=${c.nextAction} marketSignal=false executionImpact=${c.executionImpact} engineAlive=true shadowLearning=true confidence=${c.confidence}`;
}

/**
 * Railway 로그 도배 차단 — Patch-004 직속 후속, 60s window throttle 패턴.
 *
 * 사용자 5/14 운영 보고 직접 차단 — `realDataKisGet` 매 호출마다 budget denial
 * 분기에서 `formatDataVacuumRootCauseLog` 가 console.warn 출력 → throttle/circuit
 * 활성 시 분당 수백 라인 폭주.
 *
 * 정책: rootCause 별 60s window 내 첫 emit 1회만 detail 출력, 후속은 suppress.
 * 60s 경과 후 다음 emit 에 suppressedCount suffix 부착.
 *
 * Safety invariants:
 *   - throttle state in-memory only (process restart 시 자연 리셋)
 *   - LIVE 매매 본체 0줄 변경
 *   - ENV `=== 'true'` 정확 비교 (ADR-0157)
 */

const DATA_VACUUM_LOG_THROTTLE_WINDOW_MS = 60_000;

interface DataVacuumLogThrottleEntry {
  lastEmittedAtMs: number;
  suppressedCount: number;
}

const _dataVacuumLogThrottle = new Map<string, DataVacuumLogThrottleEntry>();

export interface ShouldEmitDataVacuumLogResult {
  readonly emit: boolean;
  readonly suppressedSinceLast: number;
  readonly windowMs: number;
}

export function isDataVacuumLogThrottleDisabled(): boolean {
  return process.env.DATA_VACUUM_LOG_THROTTLE_DISABLED === 'true';
}

export function shouldEmitDataVacuumLog(
  rootCause: DataVacuumRootCause,
  nowMs: number = Date.now(),
  priority?: string,
  trId?: string,
): ShouldEmitDataVacuumLogResult {
  if (isDataVacuumLogThrottleDisabled()) {
    return { emit: true, suppressedSinceLast: 0, windowMs: DATA_VACUUM_LOG_THROTTLE_WINDOW_MS };
  }
  const key = `${rootCause}:${priority ?? 'NO_PRIORITY'}:${trId ?? 'NO_TRID'}`;
  const entry = _dataVacuumLogThrottle.get(key);
  if (!entry) {
    _dataVacuumLogThrottle.set(key, { lastEmittedAtMs: nowMs, suppressedCount: 0 });
    return { emit: true, suppressedSinceLast: 0, windowMs: DATA_VACUUM_LOG_THROTTLE_WINDOW_MS };
  }
  if (nowMs - entry.lastEmittedAtMs < DATA_VACUUM_LOG_THROTTLE_WINDOW_MS) {
    entry.suppressedCount += 1;
    return {
      emit: false,
      suppressedSinceLast: entry.suppressedCount,
      windowMs: DATA_VACUUM_LOG_THROTTLE_WINDOW_MS,
    };
  }
  const suppressed = entry.suppressedCount;
  entry.lastEmittedAtMs = nowMs;
  entry.suppressedCount = 0;
  return { emit: true, suppressedSinceLast: suppressed, windowMs: DATA_VACUUM_LOG_THROTTLE_WINDOW_MS };
}

/**
 * Throttled `[DATA_VACUUM_ROOT_CAUSE]` 진단 로그 SSOT — suppress 시 null 반환.
 *
 * 호출자 패턴:
 *   const log = formatDataVacuumRootCauseLogThrottled(vacuum);
 *   if (log) console.warn(log);
 */
export function formatDataVacuumRootCauseLogThrottled(
  c: DataVacuumClassification,
  nowMs: number = Date.now(),
): string | null {
  const result = shouldEmitDataVacuumLog(c.rootCause, nowMs, c.priority, c.trId);
  if (!result.emit) return null;
  const base = formatDataVacuumRootCauseLog(c);
  if (result.suppressedSinceLast > 0) {
    return `${base} suppressedSinceLastMs=${result.windowMs} suppressedCount=${result.suppressedSinceLast}`;
  }
  return base;
}

// 테스트 격리 헬퍼
export function __resetDataVacuumLogThrottleStateForTests(): void {
  _dataVacuumLogThrottle.clear();
}
