// @responsibility emptyScanPostmortem 오케스트레이터 모듈
/**
 * emptyScanPostmortem.ts — 정상성/병리 자가판별기
 *
 * 빈 스캔 3회 누적 시마다 자동 실행하여 "이 상황이 기능인지 버그인지"를
 * 엔진 스스로 판정한다. 단순 백오프보다 먼저 원인을 구분하여 HEALTHY_REJECTION
 * (레짐에 따른 정상 거부)과 PATHOLOGICAL_BLOCK(게이트 과도 타이트 등 병리)
 * 을 분리한다.
 *
 * 입력:
 *   - 최근 3회 스캔의 trace 묶음 (scanTracer)
 *   - 현재 live regime (regimeBridge)
 *   - gate audit 당일 집계 (gateAuditRepo)
 *
 * 판정 규칙:
 *   1) RISK_OFF (R5_CAUTION / R6_DEFENSE) AND scanCandidates == 0
 *      → HEALTHY_REJECTION: 레짐이 거부한 것. 백오프 대신 대기가 맞음.
 *   2) RISK_ON (R1_TURBO / R2_BULL / R3_EARLY) AND
 *      gateReached > 0 AND (gateFail / gateReached) > 0.95
 *      → PATHOLOGICAL_BLOCK: 시장은 열려있는데 게이트가 닫혀있다.
 *   3) 그 외: 지배 원인(dominantCause)을 산출 — Yahoo 장애, 특정 조건 과도 타이트,
 *      RRR 미달 등을 스캔 trace + gate audit top-blocker 교차로 추정.
 */

import type { RegimeLevel } from '../../src/types/core.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import {
  loadTodayScanTraces,
  type ScanTrace,
} from '../trading/scanTracer.js';
import { loadGateAudit } from '../persistence/gateAuditRepo.js';
// ADR-0436 — Gate Eligibility Split. shadowObservable / providerDegraded 카운터 기반
// KEEP_COUNTERFACTUAL_LEARNING / PATCH_PROVIDER 신규 액션 분기.
import { getLastScanSummary, type ScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type PostmortemVerdict = 'HEALTHY_REJECTION' | 'PATHOLOGICAL_BLOCK' | 'INDETERMINATE';

export type DominantCause =
  | 'REGIME_RISK_OFF'
  | 'YAHOO_DOWN'
  | 'GATE_TIGHT'
  | 'PRICE_FAIL'
  | 'RRR_INSUFFICIENT'
  | 'NO_CANDIDATES'
  | 'UNKNOWN';

/**
 * ADR-0417 (Phase 2, 2026-05-07) — Postmortem action taxonomy split.
 *
 * 사용자 명시 핵심 불변식:
 *   `REVIEW_GATE_THRESHOLD` 는 *데이터 가용성과 evaluator 안정성이 확보된 후* 에만
 *   허용된다. `unavailable` 또는 `error` 가 우세할 때 절대 권고 금지.
 *   데이터 부재로 인한 임계 미달처럼 보이는 경우 `CHECK_DATA_SOURCE` 우선,
 *   evaluator 결함 우세 시 `PATCH_EVALUATOR`.
 *
 * 액션 분류 SSOT:
 *   - HOLD_AND_WAIT        : 레짐에 맞는 정상 거부. 대기.
 *   - CHECK_DATA_SOURCE    : 외부 데이터 부재 우세 — KIS/DART/Yahoo/KRX 점검.
 *   - PATCH_EVALUATOR      : evaluator 런타임 결함 우세 — schema drift / parsing 결함.
 *   - REVIEW_GATE_THRESHOLD: 데이터·evaluator 정상 + 진짜 임계 미달 우세 — 임계값 *검토* (즉시 완화 금지).
 *   - INSPECT_MARKET_REGIME: 레짐 분류 자체가 모호하거나 risk-off / sell-only 와 충돌.
 *   - INSPECT_CANDIDATES   : 후보 자체가 안 들어옴 — Stage1 / 워치리스트 공급 점검.
 *   - NO_ACTION            : 명확한 지배 원인 미탐지 — 추가 데이터 누적 대기.
 *
 * @deprecated `LOOSEN_GATE` — 위험한 운영 권고명. ADR-0417 에서 `REVIEW_GATE_THRESHOLD`
 * 로 rename. 신규 출력에서 사용 금지. 본 union 에 별칭으로 보존하되 결정 트리에서
 * 발생시키지 않는다 (회귀 테스트가 정적 grep 으로 차단).
 */
export type PostmortemAction =
  | 'HOLD_AND_WAIT'
  | 'CHECK_DATA_SOURCE'
  | 'PATCH_EVALUATOR'
  | 'REVIEW_GATE_THRESHOLD'
  | 'INSPECT_MARKET_REGIME'
  | 'INSPECT_CANDIDATES'
  | 'NO_ACTION'
  // ADR-0436 — Gate Eligibility Split 분기 신규 액션 2종.
  | 'KEEP_COUNTERFACTUAL_LEARNING'  // shadowObservable > 0 우세 — 학습 후보 보존, 매수 차단 유지
  | 'PATCH_PROVIDER'                 // PROVIDER_DEGRADED 우세 — sector/price provider 점검 우선
  // Legacy aliases — 후방호환만, 신규 출력에서 사용 금지 (정적 grep 가드 대상).
  | 'LOOSEN_GATE'
  | 'NONE';

/**
 * @deprecated ADR-0417 에서 `PostmortemAction` 으로 rename. 호출자 점진 마이그레이션.
 */
export type RecommendedAction = PostmortemAction;

export interface PostmortemReport {
  verdict: PostmortemVerdict;
  dominantCause: DominantCause;
  /**
   * ADR-0417 — `recommendedActions[0]` 의 후방호환 alias. 다중 액션 권고 가능
   * (예: 데이터 결손 + evaluator 결함 동시 우세).
   * @deprecated 신규 호출자는 `recommendedActions` 배열 사용 권장.
   */
  recommendedAction: PostmortemAction;
  /** ADR-0417 (Phase 2) — 다중 액션 권고. 최소 1 element 보장 (`NO_ACTION` fallback). */
  recommendedActions: PostmortemAction[];
  regime: RegimeLevel;
  metrics: {
    scanCandidates: number;
    gateReached: number;
    gateFail: number;
    gateFailRatio: number;  // 0~1 (legacy — 분모에 unavailable+error 포함)
    yahooFail: number;
    priceFail: number;
    rrrFail: number;
    buyExecuted: number;
    /**
     * ADR-0417 (Phase 2) — gate audit 전체 합산 비율 (조건별 worst 가 아닌 sum).
     *
     * - `unavailableRate`: unavailable / (passed + failed + unavailable + error).
     *   외부 데이터 부재 우세 시 → CHECK_DATA_SOURCE 트리거.
     * - `errorRate`: error / (passed + failed + unavailable + error).
     *   evaluator 결함 우세 시 → PATCH_EVALUATOR 트리거.
     * - `trueFailRate`: failed / (passed + failed). **분모에 unavailable + error 제외**.
     *   진짜 임계 미달 우세 시 → REVIEW_GATE_THRESHOLD 트리거 (다른 조건 모두 충족 시).
     */
    unavailableRate: number;
    errorRate: number;
    trueFailRate: number;
  };
  topBlockerCondition: string | null;
  topBlockerFailRate: number;  // 0~1 (THRESHOLD_NOT_MET — 진짜 임계 미달)
  /** ADR-0387 — 데이터 부재 비율 (DATA_UNAVAILABLE/PROVIDER_DEGRADED/SKIPPED_BY_POLICY/SANITY_REJECTED, 0~1). */
  topBlockerUnavailableRate?: number;
  /** ADR-0387 — 가장 데이터 부재율 높은 조건 키. */
  topUnavailableCondition?: string | null;
  /** ADR-0388 — evaluator 런타임 결함 비율 (ERROR, 0~1). failed 와 분리 의무. */
  topBlockerErrorRate?: number;
  /** ADR-0388 — 가장 evaluator 결함률 높은 조건 키. */
  topErrorCondition?: string | null;
  /**
   * ADR-0417 (Phase 2) — 가장 진짜 임계 미달율 높은 조건 (분모: passed + failed, unavailable + error 제외).
   * `topBlockerCondition`/`topBlockerFailRate` 는 legacy denominator 이라 데이터 결손
   * 종목이 섞여 잘못된 진단 가능. `topTrueFailCondition` 은 깨끗한 분모.
   */
  topTrueFailCondition?: string | null;
  /** ADR-0417 (Phase 2) — `topTrueFailCondition` 의 trueFailRate (0~1). */
  topTrueFailRate?: number;
  reason: string;
  analyzedAt: string;  // ISO
}

// ── 레짐 분류 ─────────────────────────────────────────────────────────────────

const RISK_OFF_REGIMES: readonly RegimeLevel[] = ['R5_CAUTION', 'R6_DEFENSE'];
const RISK_ON_REGIMES:  readonly RegimeLevel[] = ['R1_TURBO', 'R2_BULL', 'R3_EARLY'];

function isRiskOff(r: RegimeLevel): boolean { return RISK_OFF_REGIMES.includes(r); }
function isRiskOn(r: RegimeLevel):  boolean { return RISK_ON_REGIMES.includes(r); }

// ── 누적 상태: 빈 스캔 3회 도달 시에만 포스트모템 수행 ───────────────────────

let _emptyScanCount = 0;
let _lastReport: PostmortemReport | null = null;

const POSTMORTEM_TRIGGER_EVERY = 3;

/** 외부에서 빈 스캔 발생을 통지. 3회마다 자동 분석 수행. */
export function notifyEmptyScan(): PostmortemReport | null {
  _emptyScanCount++;
  if (_emptyScanCount % POSTMORTEM_TRIGGER_EVERY !== 0) return null;
  const report = runPostmortem();
  _lastReport = report;
  return report;
}

/** 신호가 발생하면 카운터 리셋. */
export function resetEmptyScanCounter(): void {
  _emptyScanCount = 0;
}

/** 최근 리포트 조회 (진단 API 용). */
export function getLastPostmortemReport(): PostmortemReport | null {
  return _lastReport;
}

/** 테스트·진단용 카운터 값. */
export function getEmptyScanCount(): number {
  return _emptyScanCount;
}

// ── 유틸: 최근 N회 스캔 trace 묶음 ──────────────────────────────────────────

/**
 * 오늘 trace 중 최근 구간을 추출한다.
 * scanTracer는 스캔 배치 경계를 명시적으로 저장하지 않으므로, 한 배치가
 * 통상 20~80 종목이라는 점에 기대어 마지막 RECENT_TRACE_WINDOW 개를 근사치로 사용한다.
 * (빈 스캔 3회 트리거 시점의 "직전 3회" 샘플과 대체로 일치.)
 */
const RECENT_TRACE_WINDOW = 240;
function recentTraces(all: ScanTrace[]): ScanTrace[] {
  if (all.length <= RECENT_TRACE_WINDOW) return all;
  return all.slice(-RECENT_TRACE_WINDOW);
}

// ── 지배 원인 + 추천 액션 결정 ────────────────────────────────────────────────

interface Metrics {
  scanCandidates: number;
  gateReached:   number;
  gateFail:      number;
  gateFailRatio: number;
  yahooFail:     number;
  priceFail:     number;
  rrrFail:       number;
  buyExecuted:   number;
}

function summarize(traces: ScanTrace[]): Metrics {
  let priceFail = 0, rrrFail = 0, gateFail = 0, yahooFail = 0, buyExecuted = 0;
  for (const t of traces) {
    if (t.stages.buy === 'SHADOW' || t.stages.buy === 'LIVE') { buyExecuted++; continue; }
    if (t.stages.price?.startsWith('FAIL'))                   { priceFail++;   continue; }
    if (t.stages.rrr?.startsWith('FAIL'))                     { rrrFail++;     continue; }
    if (t.stages.gate?.startsWith('FAIL(yahoo'))              { yahooFail++;   continue; }
    if (t.stages.gate?.startsWith('FAIL'))                    { gateFail++;    continue; }
  }
  const scanCandidates = traces.length;
  const gateReached    = scanCandidates - yahooFail;
  const gateFailRatio  = gateReached > 0 ? gateFail / gateReached : 0;
  return { scanCandidates, gateReached, gateFail, gateFailRatio, yahooFail, priceFail, rrrFail, buyExecuted };
}

/**
 * ADR-0387 — failRate (THRESHOLD_NOT_MET) + unavailableRate (DATA_UNAVAILABLE) 분리 보고.
 *
 * 두 비율을 별도 추적해 운영자가 *진짜 종목 결함* 과 *데이터 부재* 구분 가능.
 * 기존 `gate_audit.json` 영속 파일은 unavailable 부재 가능 → `?? 0` 안전 fallback.
 */
/**
 * ADR-0387 + ADR-0388 + ADR-0417 — failRate / unavailableRate / errorRate / trueFailRate 4분리 추적.
 *
 * 기존 `gate_audit.json` 영속 파일은 unavailable / error 부재 가능 → `?? 0` 안전 fallback.
 *
 * ADR-0417 추가:
 *   - `trueFailRate` = failed / (passed + failed). **분모에 unavailable + error 제외**.
 *     데이터 결손 종목과 evaluator 결함 종목을 분모에서 빼야 *진짜 임계 미달* 비율
 *     산출 가능. legacy `failRate` 는 분모에 모두 포함이라 데이터 부재 우세 시
 *     "Gate 가 너무 엄격" 으로 잘못 보임 → REVIEW_GATE_THRESHOLD 잘못된 권고 위험.
 *   - 전체 audit 합산 (sumPassed/sumFailed/sumUnavailable/sumError) — 권고 결정 트리 입력.
 */
function findTopBlocker(): {
  key: string | null;
  failRate: number;
  trueFailKey: string | null;
  trueFailRate: number;
  unavailableKey: string | null;
  unavailableRate: number;
  errorKey: string | null;
  errorRate: number;
  // ADR-0417 — 전체 합산 (action 결정 입력)
  aggregateUnavailableRate: number;
  aggregateErrorRate: number;
  aggregateTrueFailRate: number;
} {
  const audit = loadGateAudit();
  let worstFailKey: string | null = null;
  let worstFailRate = 0;
  let worstTrueFailKey: string | null = null;
  let worstTrueFailRate = 0;
  let worstUnavailableKey: string | null = null;
  let worstUnavailableRate = 0;
  let worstErrorKey: string | null = null;
  let worstErrorRate = 0;

  // ADR-0417 — 전체 audit 합산 (action 결정 입력).
  let sumPassed = 0;
  let sumFailed = 0;
  let sumUnavailable = 0;
  let sumError = 0;

  for (const [key, s] of Object.entries(audit)) {
    const unavailable = s.unavailable ?? 0;
    const error = s.error ?? 0;
    const total = s.passed + s.failed + unavailable + error;
    if (total < 5) continue; // 샘플 부족 — 무시

    // 누적 합산.
    sumPassed += s.passed;
    sumFailed += s.failed;
    sumUnavailable += unavailable;
    sumError += error;

    // legacy failRate (분모: total) — 후방호환 보존.
    const failRate = s.failed / total;
    if (failRate > worstFailRate) {
      worstFailRate = failRate;
      worstFailKey = key;
    }
    // ADR-0417 trueFailRate (분모: passed + failed, unavailable + error 제외).
    const evaluatedTotal = s.passed + s.failed;
    const trueFailRate = evaluatedTotal > 0 ? s.failed / evaluatedTotal : 0;
    if (trueFailRate > worstTrueFailRate) {
      worstTrueFailRate = trueFailRate;
      worstTrueFailKey = key;
    }
    // 데이터 부재율
    const unavailableRate = unavailable / total;
    if (unavailableRate > worstUnavailableRate) {
      worstUnavailableRate = unavailableRate;
      worstUnavailableKey = key;
    }
    // evaluator 결함률 (ADR-0388)
    const errorRate = error / total;
    if (errorRate > worstErrorRate) {
      worstErrorRate = errorRate;
      worstErrorKey = key;
    }
  }

  const aggregateTotal = sumPassed + sumFailed + sumUnavailable + sumError;
  const aggregateEvaluated = sumPassed + sumFailed;
  return {
    key: worstFailKey,
    failRate: worstFailRate,
    trueFailKey: worstTrueFailKey,
    trueFailRate: worstTrueFailRate,
    unavailableKey: worstUnavailableKey,
    unavailableRate: worstUnavailableRate,
    errorKey: worstErrorKey,
    errorRate: worstErrorRate,
    aggregateUnavailableRate: aggregateTotal > 0 ? sumUnavailable / aggregateTotal : 0,
    aggregateErrorRate: aggregateTotal > 0 ? sumError / aggregateTotal : 0,
    aggregateTrueFailRate: aggregateEvaluated > 0 ? sumFailed / aggregateEvaluated : 0,
  };
}

// ── ADR-0417 권고 액션 결정 SSOT ─────────────────────────────────────────────

/**
 * ADR-0417:
 * Postmortem actions must distinguish data availability failures,
 * evaluator implementation failures, and true threshold failures.
 *
 * CHECK_DATA_SOURCE is emitted when DATA_UNAVAILABLE dominates.
 * PATCH_EVALUATOR is emitted when evaluator errors dominate.
 * REVIEW_GATE_THRESHOLD is only allowed when true threshold failures dominate
 * after excluding unavailable/error buckets from the denominator.
 *
 * Never recommend threshold review based on missing external data.
 */
const UNAVAILABLE_DOMINANT_THRESHOLD = 0.5;
const ERROR_DOMINANT_THRESHOLD = 0.3;
const TRUE_FAIL_DOMINANT_THRESHOLD = 0.95;

/**
 * ADR-0417 — 권고 액션 결정 우선순위 SSOT.
 *
 * 사용자 명시 (절대 변경 금지):
 *   1. unavailableRate > 0.5 → CHECK_DATA_SOURCE (데이터 결손 우세)
 *   2. errorRate > 0.3 → PATCH_EVALUATOR (evaluator 결함 우세)
 *   3. trueFailRate > 0.95 AND unavailableRate ≤ 0.5 AND errorRate ≤ 0.3
 *      → REVIEW_GATE_THRESHOLD (데이터·evaluator 정상 + 진짜 임계 미달 우세)
 *   4. 그 외 → 호출자 fallback (HOLD_AND_WAIT / INSPECT_CANDIDATES / NO_ACTION).
 *
 * 다중 액션 동시 추가 가능 (복합 장애 시나리오).
 */
export function deriveActionsByRates(input: {
  unavailableRate: number;
  errorRate: number;
  trueFailRate: number;
}): PostmortemAction[] {
  const actions: PostmortemAction[] = [];
  if (input.unavailableRate > UNAVAILABLE_DOMINANT_THRESHOLD) {
    actions.push('CHECK_DATA_SOURCE');
  }
  if (input.errorRate > ERROR_DOMINANT_THRESHOLD) {
    actions.push('PATCH_EVALUATOR');
  }
  if (
    input.trueFailRate > TRUE_FAIL_DOMINANT_THRESHOLD &&
    input.unavailableRate <= UNAVAILABLE_DOMINANT_THRESHOLD &&
    input.errorRate <= ERROR_DOMINANT_THRESHOLD
  ) {
    actions.push('REVIEW_GATE_THRESHOLD');
  }
  return actions;
}

// ── ADR-0436 권고 액션 결정 SSOT (Gate Eligibility Split) ────────────────────

/**
 * ADR-0436 — Gate Eligibility Split 카운터 기반 신규 액션 결정 SSOT.
 *
 * 사용자 §4 핵심 원칙 (절대 변경 금지):
 *   1. shadowObservableCount > 0 + dataUnavailableBlockedCount 우세 →
 *      KEEP_COUNTERFACTUAL_LEARNING + CHECK_DATA_SOURCE (보존 + 점검)
 *   2. providerDegradedObservableCount > 0 + DEGRADED 우세 → PATCH_PROVIDER
 *   3. 두 분기 모두 LOOSEN_GATE / REVIEW_GATE_THRESHOLD 절대 권고 금지
 *      (DATA_UNAVAILABLE/PROVIDER_DEGRADED 우세 시 임계 완화는 결함 은폐).
 */
export function deriveGateEligibilityActions(input: {
  shadowObservableCount: number;
  liveEligibleCount: number;
  dataUnavailableBlockedCount: number;
  providerDegradedObservableCount: number;
  trueGateFailCount: number;
  hardRiskBlockedCount: number;
}): PostmortemAction[] {
  const actions: PostmortemAction[] = [];

  // total — 분류된 모든 종목 (live + shadow + trueGateFail + hardRisk + providerDegraded).
  // providerDegraded 도 포함 — 분모 계산이 자체 비율 검증할 때 정합 (우세 판단).
  const total =
    input.liveEligibleCount +
    input.shadowObservableCount +
    input.trueGateFailCount +
    input.hardRiskBlockedCount +
    input.providerDegradedObservableCount;

  // shadowObservable 존재 + dataUnavailable 우세 → 학습 보존 + 데이터 점검
  if (input.shadowObservableCount > 0 && input.dataUnavailableBlockedCount > 0) {
    actions.push('KEEP_COUNTERFACTUAL_LEARNING');
    actions.push('CHECK_DATA_SOURCE');
  }

  // providerDegraded 우세 (>30%) → provider 점검 우선
  // Total>0 가드로 0/0 분모 차단.
  if (
    total > 0 &&
    input.providerDegradedObservableCount / total > 0.3
  ) {
    if (!actions.includes('PATCH_PROVIDER')) {
      actions.push('PATCH_PROVIDER');
    }
    // shadowObservable > 0 일 때만 KEEP_COUNTERFACTUAL_LEARNING 추가 (학습 후보 존재 의미)
    if (
      !actions.includes('KEEP_COUNTERFACTUAL_LEARNING') &&
      input.shadowObservableCount > 0
    ) {
      actions.push('KEEP_COUNTERFACTUAL_LEARNING');
    }
  }

  return actions;
}

/**
 * ADR-0417 — 권고 메시지 SSOT.
 *
 * 사용자 명시 절대 금지 (문구 자체는 본 주석에 echo 하지 않음 — 정적 grep 가드 회피):
 *   ① 위험 권고 (즉시 완화·강제 완화·낮추기 권고) — buildActionGuidance 본체에 등장 금지.
 *   ② legacy 액션 라벨 그대로 노출 — *Action* 으로만 표시.
 *
 * 허용 문구:
 *   - REVIEW_GATE_THRESHOLD / "임계값 검토" / "데이터 소스 점검 우선" / "evaluator 패치 우선".
 */
function buildActionGuidance(actions: PostmortemAction[]): string {
  const guidance: string[] = [];
  if (actions.includes('CHECK_DATA_SOURCE')) {
    guidance.push(
      '외부 데이터 부재율이 높아 Gate 임계값을 평가할 수 없습니다. ' +
      'KIS/DART/Yahoo/KRX 데이터 소스를 먼저 점검하십시오.',
    );
  }
  if (actions.includes('PATCH_EVALUATOR')) {
    guidance.push(
      'evaluator 오류율이 높아 postmortem 판단 신뢰도가 낮습니다. ' +
      'evaluator status wiring 또는 schema drift 를 점검하십시오.',
    );
  }
  if (actions.includes('REVIEW_GATE_THRESHOLD')) {
    guidance.push(
      '데이터 가용성과 evaluator 안정성이 확보된 상태에서 진짜 threshold failure 가 ' +
      '우세합니다. Gate threshold 또는 regime-specific weights 를 검토하십시오 ' +
      '(즉시 완화 금지 — 운영자 명시 검토 후).',
    );
  }
  // ADR-0436 — KEEP_COUNTERFACTUAL_LEARNING: 학습 후보 보존, 매수 차단 유지.
  if (actions.includes('KEEP_COUNTERFACTUAL_LEARNING')) {
    guidance.push(
      '실매수 후보는 0이지만 학습/관측 후보는 존재합니다. ' +
      'DATA_UNAVAILABLE/PROVIDER_DEGRADED 우세 — counterfactual ledger 보존 유지하고 ' +
      '매수 임계 검토는 데이터 안정화 후로 미룹니다.',
    );
  }
  // ADR-0436 — PATCH_PROVIDER: sector/price provider 점검 우선.
  if (actions.includes('PATCH_PROVIDER')) {
    guidance.push(
      'provider 강등 (sector STALE/DEGRADED 또는 price PROVIDER_DEGRADED) 우세입니다. ' +
      'sector index code coverage / KIS↔Yahoo 가격 정합 / 프로바이더 캐시 안정성 점검 우선 — ' +
      '임계값 완화는 결함 은폐 위험.',
    );
  }
  return guidance.join(' ');
}

// ── 메인 분석 ─────────────────────────────────────────────────────────────────

/**
 * 현재 상태의 스냅샷 기반 포스트모템 실행.
 * 외부에서 직접 호출 가능 (예: 진단 API).
 */
export function runPostmortem(): PostmortemReport {
  const regime   = getLiveRegime(loadMacroState());
  const traces   = recentTraces(loadTodayScanTraces());
  const summary  = summarize(traces);
  const blocker  = findTopBlocker();

  // ADR-0417 — 합산 unavailableRate / errorRate / trueFailRate 우선 결정.
  const aggregateActions = deriveActionsByRates({
    unavailableRate: blocker.aggregateUnavailableRate,
    errorRate: blocker.aggregateErrorRate,
    trueFailRate: blocker.aggregateTrueFailRate,
  });

  // ── 판정 ────────────────────────────────────────────────────────────────
  let verdict: PostmortemVerdict;
  let cause:   DominantCause;
  let primaryAction: PostmortemAction;
  let reason:  string;

  if (isRiskOff(regime) && summary.scanCandidates === 0) {
    verdict = 'HEALTHY_REJECTION';
    cause   = 'REGIME_RISK_OFF';
    primaryAction = 'HOLD_AND_WAIT';
    reason  = `${regime} 레짐 — 매수 거부는 설계대로의 기능 동작. 백오프 불필요, 대기.`;
  } else if (isRiskOn(regime) && summary.gateReached > 0 && summary.gateFailRatio > 0.95) {
    verdict = 'PATHOLOGICAL_BLOCK';
    cause   = 'GATE_TIGHT';
    // ADR-0417 — gate 타이트 외관이지만 *실제 원인* 은 unavailable/error/trueFail 합산이 결정.
    // 데이터 부재 우세 시 절대 REVIEW_GATE_THRESHOLD 권고 금지.
    primaryAction = aggregateActions[0] ?? 'NO_ACTION';
    reason  = (
      `${regime}에서 gateFail/gateReached=${(summary.gateFailRatio * 100).toFixed(1)}% — ` +
      `레짐은 매수 가능인데 게이트 통과율 낮음.` +
      (blocker.trueFailKey
        ? ` 진짜 임계 미달 top: ${blocker.trueFailKey} (trueFailRate ${(blocker.trueFailRate * 100).toFixed(1)}%).`
        : '') +
      // ADR-0387: 데이터 부재 비율 별도 보고 — *진짜 결함* vs *데이터 부재* 구분.
      (blocker.unavailableKey && blocker.unavailableRate > 0.3
        ? ` ⚠️ 데이터 부재 의심: ${blocker.unavailableKey} 는 top unavailable condition 입니다 ` +
          `(부재율 ${(blocker.unavailableRate * 100).toFixed(1)}% — 종목 수급 미달이 아니라 외부 데이터 부재 가능성).`
        : '') +
      // ADR-0388: evaluator 결함 비율 별도 보고 — *evaluator 깨짐* 즉시 식별.
      (blocker.errorKey && blocker.errorRate > 0.1
        ? ` ❌ evaluator 결함 의심: ${blocker.errorKey} (오류율 ${(blocker.errorRate * 100).toFixed(1)}% — patch 또는 schema drift).`
        : '') +
      ' ' + buildActionGuidance(aggregateActions)
    );
  } else if (summary.scanCandidates > 0 && summary.yahooFail === summary.scanCandidates) {
    verdict = 'PATHOLOGICAL_BLOCK';
    cause   = 'YAHOO_DOWN';
    primaryAction = 'CHECK_DATA_SOURCE';
    reason  = 'Yahoo API가 모든 후보에서 실패 — 외부 데이터 소스 장애.';
  } else if (summary.scanCandidates === 0) {
    // 레짐이 RISK_ON/NEUTRAL인데도 후보 자체가 없음 — Stage1 점검 필요
    verdict = isRiskOn(regime) || regime === 'R4_NEUTRAL' ? 'PATHOLOGICAL_BLOCK' : 'INDETERMINATE';
    cause   = 'NO_CANDIDATES';
    primaryAction = 'INSPECT_CANDIDATES';
    reason  = `${regime}인데 스캔 후보 0개 — Stage1 / 워치리스트 공급 점검.`;
  } else if (summary.priceFail > summary.gateFail && summary.priceFail > summary.rrrFail) {
    verdict = 'INDETERMINATE';
    cause   = 'PRICE_FAIL';
    primaryAction = 'CHECK_DATA_SOURCE';
    reason  = `가격 조회 실패가 지배적 (${summary.priceFail}/${summary.scanCandidates}) — 시세 공급 점검.`;
  } else if (summary.rrrFail > summary.gateFail) {
    verdict = 'INDETERMINATE';
    cause   = 'RRR_INSUFFICIENT';
    primaryAction = 'NO_ACTION';
    reason  = `RRR 미달이 지배적 (${summary.rrrFail}/${summary.scanCandidates}) — 목표가/손절가 계산 정상성 검토.`;
  } else {
    verdict = 'INDETERMINATE';
    cause   = 'UNKNOWN';
    primaryAction = 'NO_ACTION';
    reason  = `명확한 지배 원인 미탐지 — scan=${summary.scanCandidates}, gateFail=${summary.gateFail}/${summary.gateReached}.`;
  }

  // ADR-0436 — Gate Eligibility Split 기반 액션 도출 (KEEP_COUNTERFACTUAL_LEARNING /
  // PATCH_PROVIDER). 직전 ScanSummary 의 6 카운터를 입력으로 받음. 부재 시 빈 배열.
  // try/catch 격리 — getLastScanSummary throw 시 postmortem 자체 차단 안 함.
  let gateEligibilityActions: PostmortemAction[] = [];
  let lastSummary: ScanSummary | null = null;
  try {
    lastSummary = getLastScanSummary();
    if (lastSummary && lastSummary.shadowObservableCount !== undefined) {
      gateEligibilityActions = deriveGateEligibilityActions({
        shadowObservableCount: lastSummary.shadowObservableCount ?? 0,
        liveEligibleCount: lastSummary.liveEligibleCount ?? 0,
        dataUnavailableBlockedCount: lastSummary.dataUnavailableBlockedCount ?? 0,
        providerDegradedObservableCount: lastSummary.providerDegradedObservableCount ?? 0,
        trueGateFailCount: lastSummary.trueGateFailCount ?? 0,
        hardRiskBlockedCount: lastSummary.hardRiskBlockedCount ?? 0,
      });
    }
  } catch (err) {
    console.warn('[Adr0436Postmortem] gate eligibility actions 도출 실패 (postmortem 무영향):', err);
  }

  // ADR-0417 — recommendedActions 배열 합성: aggregateActions 가 실제 원인을 더 잘
  // 표현하면 우선, primaryAction 은 fallback 으로 첨부. NO_ACTION 만 있는 경우 제거.
  const allActions = new Set<PostmortemAction>();
  // ADR-0436 — Gate Eligibility 기반 액션 우선 (shadowObservable 우세 시 학습 보존).
  for (const a of gateEligibilityActions) allActions.add(a);
  // aggregateActions (CHECK_DATA_SOURCE / PATCH_EVALUATOR / REVIEW_GATE_THRESHOLD) 추가.
  for (const a of aggregateActions) allActions.add(a);
  // primaryAction 도 추가 (HOLD_AND_WAIT / INSPECT_CANDIDATES 등 시나리오).
  if (primaryAction !== 'NO_ACTION' && primaryAction !== 'NONE') allActions.add(primaryAction);
  // 모두 비어있으면 NO_ACTION fallback.
  const recommendedActions: PostmortemAction[] = allActions.size === 0 ? ['NO_ACTION'] : Array.from(allActions);
  // 후방호환 alias: recommendedActions[0].
  const recommendedAction = recommendedActions[0];

  return {
    verdict,
    dominantCause: cause,
    recommendedAction,
    recommendedActions,
    regime,
    metrics: {
      ...summary,
      // ADR-0417 — 합산 분리 비율.
      unavailableRate: blocker.aggregateUnavailableRate,
      errorRate: blocker.aggregateErrorRate,
      trueFailRate: blocker.aggregateTrueFailRate,
    },
    topBlockerCondition: blocker.key,
    topBlockerFailRate:  blocker.failRate,
    // ADR-0387 — 데이터 부재 별도 보고 필드.
    topBlockerUnavailableRate: blocker.unavailableRate,
    topUnavailableCondition: blocker.unavailableKey,
    // ADR-0388 — evaluator 런타임 결함 별도 보고 필드.
    topBlockerErrorRate: blocker.errorRate,
    topErrorCondition: blocker.errorKey,
    // ADR-0417 — 진짜 임계 미달 top (분모: passed + failed, unavailable + error 제외).
    topTrueFailCondition: blocker.trueFailKey,
    topTrueFailRate: blocker.trueFailRate,
    reason,
    analyzedAt: new Date().toISOString(),
  };
}

/** 테스트용: 내부 상태 초기화. */
export function resetPostmortemState(): void {
  _emptyScanCount = 0;
  _lastReport = null;
}
