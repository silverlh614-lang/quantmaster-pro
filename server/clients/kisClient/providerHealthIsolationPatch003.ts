/**
 * @responsibility KIS RealData Provider Health Isolation — Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003
 *
 * Patch-001 (`realDataNoiseStore.ts`) 가 분류 + per-key cooldown + 반복 로그 suppress 를 정착시켰지만,
 * KIS500 이 (1) circuit breaker state machine 으로 격상되어 OPEN/HALF_OPEN/CLOSED 자동 전이가
 * 일어나지 않고, (2) Last Good Value 가 메모리에 캐싱되지 않아 즉시 null 반환이 강제되며,
 * (3) fallback provider 선택 SSOT 가 부재해 호출자 측 ad-hoc 분기가 누적되고, (4) Shadow case
 * recording 이 누락되어 학습 표본이 누적되지 않고, (5) InvestorFlowProviderRouter (ADR-0477) 가
 * providerIssue=true 데이터를 BULLISH/BEARISH 신호로 잘못 해석할 위험이 남아있는 5 결함 차단.
 *
 * 핵심 원칙 (사용자 명시 절대 변경 금지):
 *   - KIS500 은 매매 신호가 아니다 → `marketSignal: false` literal type 강제.
 *   - KIS500 으로 Trading Engine 중단 금지 → 본 SSOT 는 read-only state + 호출자 결정.
 *   - LIVE order path 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient/auth /
 *     kisClient/orders / kisClient/holdings / kisClient/query / orchestrator / autoTradeEngine /
 *     trancheExecutor / buyPipeline 모두 0줄).
 *   - KIS 주문 함수 5종 (placeKisMarketOrder / placeKisSellOrder / placeKisStopLossOrder /
 *     placeKisTakeProfitOrder / cancelKisOrder) import 0건 (정적 grep 가드).
 *   - autoTradeEngine / orderExecutor / trancheExecutor / setGateThreshold / GATE_RELAX /
 *     STRONG_BUY_OVERRIDE / requiredScore / UNKNOWN penalty / SectorEnergy 본체 0 변경.
 *   - 외부 fetch / axios / node-fetch / 외부 API 신규 호출 0건 — read-only in-memory state.
 *   - ENV `KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED=true` (default OFF, ADR-0157 정확 비교 —
 *     `'1'`/`'TRUE'`/`'yes'`/빈값 모두 거부) 1줄 즉시 Patch-001 직후 동작 100% 복원.
 *   - 호출자 측 inline ENV 검사 0건 — `isProviderHealthIsolationDisabled()` SSOT 위임 의무.
 *   - emergencyStop / SELL_ONLY / SHADOW_ONLY 자동 전환 0건 — KIS RealData 단독 실패는 engineMode
 *     변경 0 (`engineModeImpact: 'NONE'` literal).
 *   - Shadow learning 흐름 변경 0 — `shadowLearningAllowed: true` literal 강제.
 *   - virtual account holdings / cash 무수정.
 *   - Telegram 자동 발송 0건 — provider noise summary 는 console.info 만, 텔레그램 알림 영구 차단.
 */

// 동일 directory SSOT (Patch-001) 의 분류/cooldown 인프라 재사용 — drift 차단.
import {
  classifyKisRealDataError,
  type KisRealDataErrorKind,
  type KisRealDataNoiseClassification,
} from './realDataNoiseStore.js';

/* ─────────────────────────── 1. Schema / literal types ────────────────────────── */

/** Circuit breaker 3-value state machine SSOT. */
export type ProviderCircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

/** Provider health 4-value union SSOT. */
export type ProviderHealthStatus = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING';

/** Last Good Value confidence 5-value SSOT (사용자 §J #5). */
export type LastGoodValueConfidence = 'HIGH' | 'DEGRADED' | 'STALE' | 'LOW' | 'MISSING';

/** Fallback provider 6-value SSOT (사용자 §J #4). */
export type FallbackProviderId =
  | 'KIS_QUOTE'        // 동일 KIS 의 일반 quote/price endpoint (RealData 가 죽어도 살아있을 수 있음)
  | 'KIS_CACHED'       // Last Good Value cache 사용
  | 'KRX'              // KRX OpenAPI fallback
  | 'YAHOO'            // Yahoo 보조 price source
  | 'CONFIDENCE_LOW'   // 모든 fallback 실패 → score axis confidence LOW
  | 'NONE';

/** InvestorFlow 신호 6-value (providerIssue 시 BULLISH/BEARISH → NEUTRAL/UNKNOWN). */
export type InvestorFlowSignalKind = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN' | 'WEAK_BULLISH' | 'WEAK_BEARISH';

/** Engine mode impact 3-value (사용자 §J #10). */
export type EngineModeImpact = 'NONE' | 'DEGRADED' | 'SELL_ONLY_CONSIDER';

/** Circuit breaker 발동 사유. */
export type ProviderCircuitTripReason =
  | 'HTTP_500_BURST_60S'
  | 'HTTP_500_BURST_5MIN'
  | 'CONSECUTIVE_FAILURES';

export interface ProviderCircuitSnapshot {
  state: ProviderCircuitState;
  consecutiveFailures: number;
  failures60s: number;
  failures5min: number;
  tripReason: ProviderCircuitTripReason | null;
  openedAt: string | null;
  cooldownUntil: string | null;
  halfOpenTestAt: string | null;
  /** Patch-003 invariant — provider 단독 실패는 매매 신호 아님. */
  providerIssue: true;
  marketSignal: false;
  executionImpact: 'NONE';
  shadowLearningAllowed: true;
  engineModeImpact: EngineModeImpact;
}

export interface LastGoodValueEntry {
  symbol: string;
  provider: 'KIS_REALDATA';
  value: number;
  receivedAt: string;
  ttlSec: number;
  confidence: LastGoodValueConfidence;
  staleAgeSec: number;
  providerIssue: false; // 정상 응답으로 캐싱된 값 — Patch-003 SSOT 가 stale 격하 시점에 정책 적용
  marketSignal: true;   // 정상 시점 캐싱된 값이므로 marketSignal 자체는 true
  executionImpact: 'NONE'; // 캐시 사용은 LIVE 진입 의사결정 입력 아님 (DEGRADED 시점 정합)
  shadowLearningAllowed: true;
}

export interface FallbackProviderDecision {
  failedProvider: 'KIS_REALDATA';
  selectedFallback: FallbackProviderId;
  confidence: LastGoodValueConfidence;
  reason: string;
  /** 사용자 §J #4 invariant. */
  marketSignalAllowed: boolean;
  executionImpact: 'NONE';
  shadowLearningAllowed: true;
}

export interface ShadowCaseInput {
  symbol?: string;
  endpoint: string;
  errorKind: KisRealDataErrorKind;
  httpStatus?: number;
  providerHealth: ProviderHealthStatus;
  fallbackUsed: boolean;
  fallbackProvider: FallbackProviderId;
  confidenceLevel: LastGoodValueConfidence;
}

export interface ShadowCaseRecord {
  recordedAt: string;
  learningTag: 'CASE_KIS_REALDATA_500';
  symbol?: string;
  endpoint: string;
  errorKind: KisRealDataErrorKind;
  httpStatus?: number;
  providerHealth: ProviderHealthStatus;
  fallbackUsed: boolean;
  fallbackProvider: FallbackProviderId;
  confidenceLevel: LastGoodValueConfidence;
  providerIssue: true;
  marketSignal: false;
  executionImpact: 'NONE';
  shadowLearningAllowed: true;
}

export interface InvestorFlowProviderIssueOverrideInput {
  originalSignal: InvestorFlowSignalKind;
  providerIssue: boolean;
  providerHealth?: ProviderHealthStatus;
}

export interface InvestorFlowProviderIssueOverrideResult {
  resolvedSignal: InvestorFlowSignalKind;
  overrideApplied: boolean;
  reason: string;
  providerIssue: boolean;
  marketSignal: boolean;
  executionImpact: 'NONE';
  shadowLearningAllowed: true;
}

/* ─────────────────────────── 2. Constants (absolute SSOT) ──────────────────────── */

/** 60초 내 3회 5xx → circuit OPEN (사용자 §J #3). */
const CIRCUIT_TRIP_BURST_WINDOW_60S_MS = 60_000;
const CIRCUIT_TRIP_BURST_THRESHOLD_60S = 3;
/** 5분 내 10회 5xx → circuit OPEN. */
const CIRCUIT_TRIP_BURST_WINDOW_5MIN_MS = 300_000;
const CIRCUIT_TRIP_BURST_THRESHOLD_5MIN = 10;
/** 연속 실패 5회 → circuit OPEN. */
const CIRCUIT_TRIP_CONSECUTIVE_THRESHOLD = 5;
/** OPEN 상태 cooldown — error kind 와 무관하게 통일 60초. */
const CIRCUIT_OPEN_COOLDOWN_MS = 60_000;
/** HALF_OPEN 테스트 후 추가 cooldown — 실패 시 다시 OPEN. */
const CIRCUIT_HALF_OPEN_TEST_GAP_MS = 30_000;

/** Last Good Value TTL — 정상 ≤30s, STALE ≤180s, 그 외 MISSING (사용자 §J #5). */
const LGV_TTL_FRESH_SEC = 30;
const LGV_TTL_STALE_SEC = 180;

export const PROVIDER_HEALTH_ISOLATION_CONSTANTS = Object.freeze({
  CIRCUIT_TRIP_BURST_WINDOW_60S_MS,
  CIRCUIT_TRIP_BURST_THRESHOLD_60S,
  CIRCUIT_TRIP_BURST_WINDOW_5MIN_MS,
  CIRCUIT_TRIP_BURST_THRESHOLD_5MIN,
  CIRCUIT_TRIP_CONSECUTIVE_THRESHOLD,
  CIRCUIT_OPEN_COOLDOWN_MS,
  CIRCUIT_HALF_OPEN_TEST_GAP_MS,
  LGV_TTL_FRESH_SEC,
  LGV_TTL_STALE_SEC,
});

/* ─────────────────────────── 3. ENV gate SSOT ──────────────────────────────────── */

/**
 * Patch-003 전체 격리 비활성 — ADR-0157 정확 비교 의무. 호출자 측 inline 검사 영구 금지.
 * Default OFF (`!== 'true'` 시 항상 활성). `'1'`/`'TRUE'`/`'yes'`/빈값 모두 거부.
 */
export function isProviderHealthIsolationDisabled(): boolean {
  return process.env.KIS500_PROVIDER_HEALTH_ISOLATION_DISABLED === 'true';
}

/* ─────────────────────────── 4. Internal state SSOT ────────────────────────────── */

interface CircuitInternalState {
  state: ProviderCircuitState;
  consecutiveFailures: number;
  failureTimestamps: number[]; // 5분 sliding window 용
  tripReason: ProviderCircuitTripReason | null;
  openedAt: number | null;
  cooldownUntil: number | null;
  halfOpenTestAt: number | null;
}

const _circuit: CircuitInternalState = {
  state: 'CLOSED',
  consecutiveFailures: 0,
  failureTimestamps: [],
  tripReason: null,
  openedAt: null,
  cooldownUntil: null,
  halfOpenTestAt: null,
};

const _lastGoodValues = new Map<string, LastGoodValueEntry>();
const _shadowCases: ShadowCaseRecord[] = [];
let _shadowCasesMaxRetained = 500; // FIFO trim

/* ─────────────────────────── 5. Circuit breaker SSOT ───────────────────────────── */

/**
 * 5xx 또는 연속 실패 발생 시 circuit state 갱신. 결정 트리 우선순위 SSOT (절대 변경 금지):
 *   1. ENV disabled → CLOSED 강제 + state 갱신 0건 (Patch-001 동작 그대로).
 *   2. consecutiveFailures + 1
 *   3. failureTimestamps push (now), 60s/5min window 외 항목 prune
 *   4. trip 조건 평가 (60s burst → 5min burst → consecutive)
 *   5. trip 충족 → state=OPEN + openedAt + cooldownUntil + halfOpenTestAt
 */
export function recordProviderFailure(
  classification: KisRealDataNoiseClassification,
  now: Date = new Date(),
): ProviderCircuitSnapshot {
  if (isProviderHealthIsolationDisabled()) {
    return snapshotCircuit(now);
  }
  const nowMs = now.getTime();
  _circuit.consecutiveFailures += 1;
  _circuit.failureTimestamps.push(nowMs);

  // Window prune (5min cutoff).
  const cutoff5min = nowMs - CIRCUIT_TRIP_BURST_WINDOW_5MIN_MS;
  _circuit.failureTimestamps = _circuit.failureTimestamps.filter((t) => t >= cutoff5min);

  const failures60s = _circuit.failureTimestamps.filter(
    (t) => t >= nowMs - CIRCUIT_TRIP_BURST_WINDOW_60S_MS,
  ).length;
  const failures5min = _circuit.failureTimestamps.length;

  let tripReason: ProviderCircuitTripReason | null = null;
  if (failures60s >= CIRCUIT_TRIP_BURST_THRESHOLD_60S) {
    tripReason = 'HTTP_500_BURST_60S';
  } else if (failures5min >= CIRCUIT_TRIP_BURST_THRESHOLD_5MIN) {
    tripReason = 'HTTP_500_BURST_5MIN';
  } else if (_circuit.consecutiveFailures >= CIRCUIT_TRIP_CONSECUTIVE_THRESHOLD) {
    tripReason = 'CONSECUTIVE_FAILURES';
  }

  if (tripReason && _circuit.state !== 'OPEN') {
    _circuit.state = 'OPEN';
    _circuit.tripReason = tripReason;
    _circuit.openedAt = nowMs;
    _circuit.cooldownUntil = nowMs + CIRCUIT_OPEN_COOLDOWN_MS;
    _circuit.halfOpenTestAt = nowMs + CIRCUIT_OPEN_COOLDOWN_MS;
    // 의도된 진단 로그 — `[KIS_CIRCUIT_OPEN]` 사용자 §J 정확 형식.
    console.info(
      `[KIS_CIRCUIT_OPEN] provider=KIS_REALDATA reason=${tripReason} `
      + `failures60s=${failures60s} failures5min=${failures5min} `
      + `consecutiveFailures=${_circuit.consecutiveFailures} `
      + `cooldownSec=${Math.round(CIRCUIT_OPEN_COOLDOWN_MS / 1000)} `
      + `providerIssue=true marketSignal=false executionImpact=NONE`,
    );
  }

  // Suppress 분류 input 사용 (불필요한 unused import 차단).
  void classification;
  return snapshotCircuit(now);
}

/**
 * 성공 응답 시 circuit reset + LastGoodValue 갱신과 별개 진행.
 * HALF_OPEN → CLOSED 전이 진단 로그 1줄.
 */
export function recordProviderSuccess(now: Date = new Date()): ProviderCircuitSnapshot {
  if (isProviderHealthIsolationDisabled()) {
    return snapshotCircuit(now);
  }
  const wasHalfOpen = _circuit.state === 'HALF_OPEN';
  const wasOpen = _circuit.state === 'OPEN';
  _circuit.state = 'CLOSED';
  _circuit.consecutiveFailures = 0;
  _circuit.failureTimestamps = [];
  _circuit.tripReason = null;
  _circuit.openedAt = null;
  _circuit.cooldownUntil = null;
  _circuit.halfOpenTestAt = null;
  if (wasHalfOpen || wasOpen) {
    console.info(`[KIS_CIRCUIT_CLOSED] provider=KIS_REALDATA status=VERIFIED`);
  }
  return snapshotCircuit(now);
}

/**
 * cooldown 만료 시 OPEN → HALF_OPEN 자동 전이. 호출자가 1회 test 요청 가능 여부 결정.
 * HALF_OPEN 상태에서 다시 실패하면 OPEN 으로 재진입.
 */
export function evaluateCircuitTransition(now: Date = new Date()): ProviderCircuitSnapshot {
  if (isProviderHealthIsolationDisabled()) {
    return snapshotCircuit(now);
  }
  const nowMs = now.getTime();
  if (_circuit.state === 'OPEN' && _circuit.cooldownUntil !== null && nowMs >= _circuit.cooldownUntil) {
    _circuit.state = 'HALF_OPEN';
    console.info(`[KIS_CIRCUIT_HALF_OPEN] provider=KIS_REALDATA testRequest=true`);
  }
  return snapshotCircuit(now);
}

/** Circuit 상태가 OPEN 또는 HALF_OPEN(이미 test 진행 중) — 새로운 호출 차단 결정. */
export function shouldSkipProviderCall(now: Date = new Date()): boolean {
  if (isProviderHealthIsolationDisabled()) return false;
  evaluateCircuitTransition(now);
  return _circuit.state === 'OPEN';
}

export function getProviderCircuitSnapshot(now: Date = new Date()): ProviderCircuitSnapshot {
  return snapshotCircuit(now);
}

function snapshotCircuit(now: Date): ProviderCircuitSnapshot {
  const nowMs = now.getTime();
  const failures60s = _circuit.failureTimestamps.filter(
    (t) => t >= nowMs - CIRCUIT_TRIP_BURST_WINDOW_60S_MS,
  ).length;
  const failures5min = _circuit.failureTimestamps.length;
  const out: ProviderCircuitSnapshot = {
    state: _circuit.state,
    consecutiveFailures: _circuit.consecutiveFailures,
    failures60s,
    failures5min,
    tripReason: _circuit.tripReason,
    openedAt: _circuit.openedAt ? new Date(_circuit.openedAt).toISOString() : null,
    cooldownUntil: _circuit.cooldownUntil ? new Date(_circuit.cooldownUntil).toISOString() : null,
    halfOpenTestAt: _circuit.halfOpenTestAt ? new Date(_circuit.halfOpenTestAt).toISOString() : null,
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    shadowLearningAllowed: true,
    // 사용자 §J #10 — KIS RealData 단독 실패는 engine mode 변경 0.
    engineModeImpact: 'NONE',
  };
  return out;
}

/* ─────────────────────────── 6. Last Good Value cache SSOT ─────────────────────── */

/**
 * 정상 응답 시 마지막 정상값 캐싱. value <=0 또는 NaN 은 거부 (silent skip).
 * 호출자는 confidence='HIGH' 시점에 자동 저장.
 */
export function setLastGoodValue(input: {
  symbol: string;
  value: number;
  receivedAt?: Date;
}): void {
  if (isProviderHealthIsolationDisabled()) return;
  if (!input.symbol || !Number.isFinite(input.value) || input.value <= 0) return;
  const receivedAt = input.receivedAt ?? new Date();
  const entry: LastGoodValueEntry = {
    symbol: input.symbol,
    provider: 'KIS_REALDATA',
    value: input.value,
    receivedAt: receivedAt.toISOString(),
    ttlSec: LGV_TTL_FRESH_SEC,
    confidence: 'HIGH',
    staleAgeSec: 0,
    providerIssue: false,
    marketSignal: true,
    executionImpact: 'NONE',
    shadowLearningAllowed: true,
  };
  _lastGoodValues.set(input.symbol, entry);
}

/**
 * 마지막 정상값 조회. TTL 결정 트리 SSOT (절대 변경 금지):
 *   - staleAge ≤ 30s → confidence=HIGH (provider 정상 시), DEGRADED (provider 장애 시)
 *   - staleAge 30~180s → STALE (Shadow 참고만)
 *   - staleAge > 180s → MISSING (사용 차단)
 *
 * `providerDegraded=true` 인자 시 HIGH → DEGRADED 자동 격하.
 */
export function getLastGoodValue(input: {
  symbol: string;
  now?: Date;
  providerDegraded?: boolean;
}): LastGoodValueEntry | null {
  if (isProviderHealthIsolationDisabled()) return null;
  const entry = _lastGoodValues.get(input.symbol);
  if (!entry) return null;
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(entry.receivedAt);
  const staleAgeSec = Math.max(0, Math.round(ageMs / 1000));

  let confidence: LastGoodValueConfidence;
  if (staleAgeSec > LGV_TTL_STALE_SEC) {
    confidence = 'MISSING';
  } else if (staleAgeSec > LGV_TTL_FRESH_SEC) {
    confidence = 'STALE';
  } else if (input.providerDegraded) {
    confidence = 'DEGRADED';
  } else {
    confidence = 'HIGH';
  }
  return {
    ...entry,
    staleAgeSec,
    confidence,
  };
}

/** 외부 진단 (`/scan_blockers runtime`) 용 read-only snapshot. */
export function listLastGoodValueEntries(): readonly LastGoodValueEntry[] {
  return Array.from(_lastGoodValues.values());
}

/* ─────────────────────────── 7. Fallback Provider router SSOT ──────────────────── */

export interface SelectFallbackInput {
  symbol?: string;
  /** 호출자가 사전 검사한 fallback 가용 정보. 본 SSOT 는 외부 호출 0건. */
  kisQuoteAvailable?: boolean;
  krxAvailable?: boolean;
  yahooAvailable?: boolean;
  /** 캐시 hit 여부 — getLastGoodValue 결과 confidence 가 MISSING 이 아니면 true. */
  cachedValueAvailable?: boolean;
  cachedConfidence?: LastGoodValueConfidence;
}

/**
 * 사용자 §J #4 우선순위 SSOT (절대 변경 금지):
 *   1. KIS quote 정상 → 'KIS_QUOTE' (HIGH)
 *   2. cached value 가용 → 'KIS_CACHED' (HIGH/DEGRADED/STALE 분기)
 *   3. KRX 사용 → 'KRX' (DEGRADED)
 *   4. Yahoo 사용 → 'YAHOO' (DEGRADED)
 *   5. 모두 실패 → 'CONFIDENCE_LOW' (LOW) — 호출자 측 score axis 격하
 */
export function selectFallbackProvider(input: SelectFallbackInput): FallbackProviderDecision {
  if (isProviderHealthIsolationDisabled()) {
    return {
      failedProvider: 'KIS_REALDATA',
      selectedFallback: 'NONE',
      confidence: 'MISSING',
      reason: 'Patch-003 ENV disabled',
      marketSignalAllowed: false,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.kisQuoteAvailable) {
    return {
      failedProvider: 'KIS_REALDATA',
      selectedFallback: 'KIS_QUOTE',
      confidence: 'HIGH',
      reason: 'KIS quote endpoint healthy; RealData provider issue isolated',
      marketSignalAllowed: true,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.cachedValueAvailable && input.cachedConfidence && input.cachedConfidence !== 'MISSING') {
    return {
      failedProvider: 'KIS_REALDATA',
      selectedFallback: 'KIS_CACHED',
      confidence: input.cachedConfidence,
      reason: `Last good value within TTL (confidence=${input.cachedConfidence})`,
      marketSignalAllowed: input.cachedConfidence !== 'LOW',
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.krxAvailable) {
    return {
      failedProvider: 'KIS_REALDATA',
      selectedFallback: 'KRX',
      confidence: 'DEGRADED',
      reason: 'KRX OpenAPI fallback; KIS RealData circuit open',
      marketSignalAllowed: true,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (input.yahooAvailable) {
    return {
      failedProvider: 'KIS_REALDATA',
      selectedFallback: 'YAHOO',
      confidence: 'DEGRADED',
      reason: 'Yahoo fallback; KIS RealData circuit open and KRX unavailable',
      marketSignalAllowed: true,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  return {
    failedProvider: 'KIS_REALDATA',
    selectedFallback: 'CONFIDENCE_LOW',
    confidence: 'LOW',
    reason: 'All fallback providers unavailable; downgrade score axis confidence',
    marketSignalAllowed: false,
    executionImpact: 'NONE',
    shadowLearningAllowed: true,
  };
}

/* ─────────────────────────── 8. InvestorFlow signal override SSOT ──────────────── */

/**
 * 사용자 §J #9 — InvestorFlowProviderRouter (ADR-0477) 가 providerIssue=true 인 데이터를
 * BULLISH/BEARISH 시장 신호로 해석하지 않도록 보장.
 *
 * 호출자는 ADR-0477 의 signal 산출 직후 본 함수에 통과시켜 NEUTRAL/UNKNOWN 격하 적용.
 *
 * 결정 트리 SSOT (절대 변경 금지):
 *   - providerIssue=false → 원본 signal 그대로 (overrideApplied=false)
 *   - providerIssue=true + originalSignal ∈ {BULLISH/WEAK_BULLISH/BEARISH/WEAK_BEARISH}
 *     → UNKNOWN (overrideApplied=true)
 *   - providerIssue=true + originalSignal ∈ {NEUTRAL/UNKNOWN}
 *     → 그대로 보존 (overrideApplied=false)
 */
export function applyInvestorFlowProviderIssueOverride(
  input: InvestorFlowProviderIssueOverrideInput,
): InvestorFlowProviderIssueOverrideResult {
  if (isProviderHealthIsolationDisabled()) {
    return {
      resolvedSignal: input.originalSignal,
      overrideApplied: false,
      reason: 'Patch-003 ENV disabled',
      providerIssue: input.providerIssue,
      marketSignal: !input.providerIssue,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  if (!input.providerIssue) {
    return {
      resolvedSignal: input.originalSignal,
      overrideApplied: false,
      reason: 'providerIssue=false; original signal preserved',
      providerIssue: false,
      marketSignal: true,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  const directionalSignals: ReadonlySet<InvestorFlowSignalKind> = new Set([
    'BULLISH',
    'WEAK_BULLISH',
    'BEARISH',
    'WEAK_BEARISH',
  ]);

  if (directionalSignals.has(input.originalSignal)) {
    return {
      resolvedSignal: 'UNKNOWN',
      overrideApplied: true,
      reason: `providerIssue=true; ${input.originalSignal} downgraded to UNKNOWN (Patch-003)`,
      providerIssue: true,
      marketSignal: false,
      executionImpact: 'NONE',
      shadowLearningAllowed: true,
    };
  }

  // NEUTRAL / UNKNOWN — 이미 안전한 상태이므로 그대로 보존.
  return {
    resolvedSignal: input.originalSignal,
    overrideApplied: false,
    reason: 'providerIssue=true but signal already non-directional',
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    shadowLearningAllowed: true,
  };
}

/* ─────────────────────────── 9. Shadow case recording SSOT ─────────────────────── */

/**
 * KIS500 발생 시 Shadow learning case 기록. 사용자 §J #8.
 *
 * appendShadowLog 호출은 호출자(다음 단계 wiring PR)가 담당 — 본 SSOT 는 schema 와
 * in-memory FIFO buffer 만 제공. 외부 fs / KIS / Telegram 호출 0건.
 *
 * 본 SSOT 의 record 배열은 `/scan_blockers runtime` 진단에서 read-only 노출 가능.
 */
export function recordShadowCaseForKis500(
  input: ShadowCaseInput,
  now: Date = new Date(),
): ShadowCaseRecord {
  const record: ShadowCaseRecord = {
    recordedAt: now.toISOString(),
    learningTag: 'CASE_KIS_REALDATA_500',
    ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
    endpoint: input.endpoint,
    errorKind: input.errorKind,
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    providerHealth: input.providerHealth,
    fallbackUsed: input.fallbackUsed,
    fallbackProvider: input.fallbackProvider,
    confidenceLevel: input.confidenceLevel,
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    shadowLearningAllowed: true,
  };
  if (isProviderHealthIsolationDisabled()) {
    return record;
  }
  _shadowCases.push(record);
  // FIFO trim — 최신 N건만 보존, 메모리 누수 차단.
  while (_shadowCases.length > _shadowCasesMaxRetained) {
    _shadowCases.shift();
  }
  console.info(
    `[SHADOW_CASE_RECORDED] learningTag=CASE_KIS_REALDATA_500 `
    + `endpoint=${input.endpoint} errorKind=${input.errorKind} `
    + `providerHealth=${input.providerHealth} fallbackUsed=${input.fallbackUsed} `
    + `fallbackProvider=${input.fallbackProvider} confidenceLevel=${input.confidenceLevel} `
    + `executionImpact=NONE shadowLearning=true`,
  );
  return record;
}

export function listShadowCaseRecords(): readonly ShadowCaseRecord[] {
  return _shadowCases.slice();
}

/* ─────────────────────────── 10. /scan_blockers runtime section SSOT ───────────── */

export interface ProviderHealthIsolationRuntimeSummary {
  circuit: ProviderCircuitSnapshot;
  lastGoodValueCount: number;
  shadowCaseCount: number;
  /** 사용자 §J #7 — Telegram 전송 영구 금지. */
  telegramAllowed: false;
}

export function buildProviderHealthIsolationRuntimeSummary(
  now: Date = new Date(),
): ProviderHealthIsolationRuntimeSummary {
  return {
    circuit: snapshotCircuit(now),
    lastGoodValueCount: _lastGoodValues.size,
    shadowCaseCount: _shadowCases.length,
    telegramAllowed: false,
  };
}

/**
 * `/scan_blockers runtime` 섹션 SSOT — PATCH-RUNTIME 태그로 sectionMatchesMode
 * 자동 통과 (ADR-0506 정합). circuit=CLOSED + lgv=0 + case=0 시 null 반환 — 잡음 차단.
 */
export function formatProviderHealthIsolationSection(
  summary: ProviderHealthIsolationRuntimeSummary = buildProviderHealthIsolationRuntimeSummary(),
): string | null {
  const { circuit, lastGoodValueCount, shadowCaseCount } = summary;
  if (circuit.state === 'CLOSED' && lastGoodValueCount === 0 && shadowCaseCount === 0) {
    return null;
  }
  const lines: string[] = [
    '🔌 KIS RealData Provider Health Isolation [PATCH-RUNTIME] (Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003)',
    `• circuit: ${circuit.state}`
    + (circuit.tripReason ? ` · trip=${circuit.tripReason}` : '')
    + ` · consecutiveFailures=${circuit.consecutiveFailures}`
    + ` · failures60s=${circuit.failures60s}`
    + ` · failures5min=${circuit.failures5min}`,
  ];
  if (circuit.cooldownUntil) {
    lines.push(`• cooldownUntil: ${circuit.cooldownUntil}`);
  }
  lines.push(`• lastGoodValues: ${lastGoodValueCount} · shadowCases: ${shadowCaseCount}`);
  lines.push('• invariants: providerIssue=true · marketSignal=false · executionImpact=NONE');
  lines.push('• engineModeImpact=NONE · shadowLearningAllowed=true · telegramAllowed=false');
  return lines.join('\n');
}

/* ─────────────────────────── 11. Test isolation helpers ────────────────────────── */

export function __resetProviderHealthIsolationForTests(): void {
  _circuit.state = 'CLOSED';
  _circuit.consecutiveFailures = 0;
  _circuit.failureTimestamps = [];
  _circuit.tripReason = null;
  _circuit.openedAt = null;
  _circuit.cooldownUntil = null;
  _circuit.halfOpenTestAt = null;
  _lastGoodValues.clear();
  _shadowCases.length = 0;
  _shadowCasesMaxRetained = 500;
}

export function __setShadowCasesMaxForTests(max: number): void {
  _shadowCasesMaxRetained = Math.max(1, max);
}

/* ─────────────────────────── 12. Re-export for convenience ─────────────────────── */

export { classifyKisRealDataError };
export type { KisRealDataErrorKind, KisRealDataNoiseClassification };
