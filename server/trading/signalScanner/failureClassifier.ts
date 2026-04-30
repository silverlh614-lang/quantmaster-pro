// @responsibility 진입 실패 사유의 Critical/Non-critical 분류 SSOT — failCount 증가 정책
/**
 * failureClassifier.ts (ADR-0115) — 진입 실패 사유 분류 단일 진실.
 *
 * 사용자 18단계 설계안 §11 "failCount 구조 수정" + §10 "Pre-breakout WAIT 상태화"
 * 직접 반영. 기존 perSymbolEvaluation 은 비치명 사유 (pre-breakout / 거래량 /
 * Gate 재검증 / drift WARN) 도 모두 failCount 누적 → 임계 도달 시 자동 제거 →
 * "탐지는 되지만 매수 0" 상태 발생.
 *
 * Critical Failure (failCount++): 종목 자체 데이터·상태 문제
 *   - SPLIT_ANOMALY / KIS_MISMATCH / STALE_BASE / TRADING_HALT / CORPORATE_ACTION
 *
 * Non-Critical (WAIT): 일시적 조건 미충족 — 다음 사이클 재시도 가능
 *   - PRE_BREAKOUT_MISS / VOLUME_DECREASE / GATE_REVALIDATION_FAIL / DRIFT_WARN /
 *     ENTRY_PRICE_DEVIATION
 *
 * ENV `PRE_BREAKOUT_FAILCOUNT_DISABLED=false` 명시 시 레거시 동작 (모든 사유 카운트).
 */

export type FailureSeverity = 'CRITICAL' | 'NON_CRITICAL';

export type FailureReason =
  // Critical — 종목 자체 데이터 오염 / 상태 이상
  | 'SPLIT_ANOMALY'
  | 'KIS_MISMATCH'
  | 'STALE_BASE'
  | 'TRADING_HALT'
  | 'CORPORATE_ACTION'
  // Non-critical — 일시적 조건 미충족
  | 'PRE_BREAKOUT_MISS'
  | 'VOLUME_DECREASE'
  | 'GATE_REVALIDATION_FAIL'
  | 'DRIFT_WARN'
  | 'ENTRY_PRICE_DEVIATION';

const CRITICAL_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  'SPLIT_ANOMALY',
  'KIS_MISMATCH',
  'STALE_BASE',
  'TRADING_HALT',
  'CORPORATE_ACTION',
]);

const NON_CRITICAL_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  'PRE_BREAKOUT_MISS',
  'VOLUME_DECREASE',
  'GATE_REVALIDATION_FAIL',
  'DRIFT_WARN',
  'ENTRY_PRICE_DEVIATION',
]);

/**
 * 분류 SSOT — 알려지지 않은 reason 은 보수적으로 CRITICAL (실패 누적 안전).
 */
export function classifyFailureSeverity(reason: FailureReason): FailureSeverity {
  if (NON_CRITICAL_REASONS.has(reason)) return 'NON_CRITICAL';
  if (CRITICAL_REASONS.has(reason)) return 'CRITICAL';
  // 미분류 → 보수적 CRITICAL
  return 'CRITICAL';
}

/**
 * 호출자가 failCount 증가 직전에 호출. ENV 우회 시 모든 사유 카운트 (ADR-0113 동작).
 */
export function shouldIncrementFailCount(reason: FailureReason): boolean {
  if (isPreBreakoutFailCountDisabled() === false) {
    // ENV 명시 비활성 (false) — 레거시 동작
    return true;
  }
  return classifyFailureSeverity(reason) === 'CRITICAL';
}

/** ADR-0115 정책 활성 여부 — default true (정책 적용). */
export function isPreBreakoutFailCountDisabled(): boolean {
  // 환경변수 미설정 또는 'true' → 정책 적용 (Non-critical 미증가)
  // 명시 'false' → 레거시 동작 (모든 사유 증가)
  return process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED !== 'false';
}

/** ENV `ENTRY_PRICE_AUTO_CORRECT_DISABLED` — default true (자동보정 차단). */
export function isEntryPriceAutoCorrectDisabled(): boolean {
  return process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED !== 'false';
}

/** ENV `EXECUTION_RELAXATION_ENABLED` — default false (Gate3 임계 그대로). */
export function isExecutionRelaxationEnabled(): boolean {
  return process.env.EXECUTION_RELAXATION_ENABLED === 'true';
}

/** ENV `DRIFT_INVALID_UNIVERSE_EXCLUDE` — default true (universe 격리 정책 활성). */
export function isDriftInvalidUniverseExcludeEnabled(): boolean {
  return process.env.DRIFT_INVALID_UNIVERSE_EXCLUDE !== 'false';
}
