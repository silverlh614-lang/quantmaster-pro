/**
 * @responsibility ADR-0451 — Empty Scan Must Not Force SELL_ONLY During Regular Market.
 *
 * emptyScanLivenessPolicy.ts (ADR-0451)
 * =====================================
 *
 * 핵심 명제 (사용자 §"한 줄 정의" — 절대 변경 금지):
 *   "ADR-0451 은 '빈스캔 연속 발생' 을 SELL_ONLY hard 전환 사유로 쓰지 않고,
 *    DEGRADED/OBSERVE/RETRY 상태로 처리하여 Trading Engine liveness 를 유지하는 패치다."
 *
 * 운영 증상 (사용자 §1, 2026-05-08 14:30 KST):
 *   `[Orchestrator] 스캔 실행: 오후 재개장 | R2_BULL(x1) | 빈스캔×3→SELL_ONLY | 포지션 0/6`
 *   - 14:30 은 점심시간 아님, 시스템도 "오후 재개장" 정상 인식.
 *   - 그런데 emptyScanStreak >= 3 만으로 SELL_ONLY 전환 → 신규 매수 중단.
 *   - ADR-0448 원칙 (Trading Engine liveness first) 정면 위반.
 *
 * 빈스캔 4 종류 (사용자 §2 — 절대 변경 금지):
 *   1. TRUE_NO_CANDIDATE         정말 시장에 매수 후보 없음.
 *   2. DATA_UNAVAILABLE_EMPTY    데이터 공급자 문제로 후보 없음.
 *   3. GATE_TOO_STRICT_EMPTY     Gate/entry/recheck 가 너무 많이 후보를 걸러냄.
 *   4. TEMPORARY_SESSION_EMPTY   장전/점심/장후/오후 재개장 직후 등 일시 공백.
 *
 * 어느 것도 단독으로 SELL_ONLY 강제 금지.
 *
 * SELL_ONLY 가 가능한 경우 (사용자 §2 — 핵심 경계):
 *   - 운영자 수동 설정
 *   - emergencyStop
 *   - market closed / lunch break / after-hours policy
 *   - R6_DEFENSE
 *   - FOMC / risk-off hard block
 *   - order safety / cash / position risk
 *   - true systemic risk mode
 *
 * 빈스캔은 SELL_ONLY 가 아니라:
 *   - scan interval 확대
 *   - OBSERVE_ONLY
 *   - DEGRADED
 *   - RETRY_LATER
 *   - Shadow / counterfactual learning
 *   - KIS-WS 재배치
 *   로 처리.
 *
 * 외부 의존성 0 — 순수 함수만.
 */

/* ───────── 6-value cause union (사용자 §4 정합 — 절대 변경 금지) ───────── */

export type EmptyScanCause =
  | 'TRUE_NO_CANDIDATE'
  | 'DATA_UNAVAILABLE_EMPTY'
  | 'GATE_TOO_STRICT_EMPTY'
  | 'TEMPORARY_SESSION_EMPTY'
  | 'AUXILIARY_DATA_EMPTY'
  | 'UNKNOWN';

/* ───────── 6-value action union (사용자 §4 정합 — 절대 변경 금지) ───────── */

export type EmptyScanLivenessAction =
  | 'KEEP_ENGINE_ALIVE'
  | 'RETRY_NEXT_SCAN'
  | 'EXPAND_SCAN_INTERVAL'
  | 'OBSERVE_ONLY_TEMPORARY'
  | 'KEEP_SHADOW_LEARNING'
  | 'ALLOW_SELL_ONLY_EXISTING_REASON';

/* ───────── 6-value market session union ───────── */

export type EmptyScanMarketSession =
  | 'REGULAR'
  | 'OPEN_AUCTION'
  | 'LUNCH_BREAK'
  | 'AFTER_HOURS'
  | 'CLOSED'
  | 'UNKNOWN';

/* ───────── Input schema (사용자 §4 정합) ───────── */

export interface EmptyScanLivenessInput {
  marketSession: EmptyScanMarketSession;
  emptyScanStreak: number;
  liveEligibleCount?: number;
  shadowObservableCount?: number;
  watchlistCount?: number;
  dataUnavailableCount?: number;
  providerDegradedCount?: number;
  trueGateFailCount?: number;
  hardRiskBlockCount?: number;
  gate1PassCount?: number;
  sellOnlyAlreadyActive?: boolean;
  sellOnlyReason?: string;
  emergencyStop?: boolean;
  r6Defense?: boolean;
  riskHardBlock?: boolean;
}

/* ───────── Decision schema (사용자 §4 정합 — literal type 강제) ───────── */

export interface EmptyScanLivenessDecision {
  cause: EmptyScanCause;
  action: EmptyScanLivenessAction;
  allowSellOnlyTransition: boolean;
  preserveExistingSellOnly: boolean;
  /** 절대 불변식 — emptyScan 만으로 engine 종료 금지 (ADR-0448 정합) */
  engineShouldContinue: true;
  /** 절대 불변식 — Shadow learning 차단 금지 (ADR-0173 정합) */
  shadowLearningAllowed: true;
  /** 절대 불변식 — counterfactual learning 차단 금지 */
  counterfactualLearningAllowed: true;
  scanIntervalMayExpand: boolean;
  operatorMessage: string;
}

/* ───────── 임계 SSOT (사용자 §"빈스캔 4 종류" 정합 — 절대 변경 금지) ───────── */

export const EMPTY_SCAN_LIVENESS_THRESHOLDS = Object.freeze({
  /** 사용자 §11 테스트 — emptyScanStreak >= 3 → REGULAR session 에서도 SELL_ONLY 금지 */
  EMPTY_STREAK_BACKOFF_MIN: 3,
  /** Gate 너무 엄격 판정 — trueGateFailCount / max(1, gate1PassCount + trueGateFailCount) */
  GATE_TOO_STRICT_RATIO: 0.7,
} as const);

/* ───────── ENV gate SSOT (ADR-0157 정확 비교) ───────── */

/**
 * ENV `EMPTY_SCAN_LIVENESS_POLICY_DISABLED=true` (default OFF).
 *
 * 활성 시 본 SSOT 의 결정은 *호출자 측 fallback* 으로 이양 — 호출자가 ADR-0157 정확 비교
 * (`'1'` / `'TRUE'` / `'yes'` 모두 거부) 와 함께 legacy `emptyBackoff > 1 → SELL_ONLY` 동작 복원.
 *
 * **장기적으로 사용 비권장** — 본 ENV 는 긴급 rollback 용. 정상 운영에서는 default OFF 유지.
 */
export function isEmptyScanLivenessPolicyDisabled(): boolean {
  return process.env.EMPTY_SCAN_LIVENESS_POLICY_DISABLED === 'true';
}

/* ───────── 결정 트리 SSOT (사용자 §5 정합 — 절대 변경 금지) ───────── */

/**
 * 빈스캔 streak 와 시장 세션을 입력으로 받아 SELL_ONLY 전환 허용 여부 + Trading Engine
 * liveness action 을 결정한다.
 *
 * **절대 규칙 (사용자 §5 마지막)**:
 *   Regular session + emptyScanStreak only → SELL_ONLY 금지.
 *
 * 우선순위 (위에서 아래 첫 매칭):
 *   1. emergencyStop / r6Defense / riskHardBlock → ALLOW_SELL_ONLY_EXISTING_REASON
 *      (ADR-0448 Core Execution Signals — hard-block 가능, 그대로 유지)
 *   2. LUNCH_BREAK / AFTER_HOURS / CLOSED + sellOnlyAlreadyActive
 *      → preserveExistingSellOnly=true, action=ALLOW_SELL_ONLY_EXISTING_REASON
 *      (market policy SELL_ONLY 보존, 시장 정책)
 *   3. REGULAR + emptyScanStreak >= 3 → 핵심 분기 (사용자 §5 핵심):
 *      allowSellOnlyTransition=false, scanIntervalMayExpand=true,
 *      sub-cause 결정 (TRUE / DATA_UNAVAILABLE / GATE_TOO_STRICT / SHADOW)
 *   4. REGULAR + emptyScanStreak < 3 → 정상 운영 (KEEP_ENGINE_ALIVE)
 *   5. OPEN_AUCTION → TEMPORARY_SESSION_EMPTY + RETRY
 *   6. UNKNOWN session → 보수 fallback (KEEP_ENGINE_ALIVE)
 *
 * Shadow / counterfactual learning 은 *모든 분기에서* 항상 true.
 * engineShouldContinue 는 *모든 분기에서* 항상 true (literal type 강제).
 *
 * 호출자 정책:
 *   - allowSellOnlyTransition=true 시 호출자가 자체 SELL_ONLY 정책 (phase-based forceSellOnly,
 *     emergencyStop 등) 을 그대로 적용 가능.
 *   - allowSellOnlyTransition=false 시 호출자가 *emptyScanStreak 만으로* SELL_ONLY 전환 금지.
 *   - scanIntervalMayExpand=true 시 호출자가 scan interval 확대 가능 (Yahoo / KIS quota 보호).
 */
export function evaluateEmptyScanLiveness(
  input: EmptyScanLivenessInput,
): EmptyScanLivenessDecision {
  // (1) Core risk hard-block — emergencyStop / R6 / riskHardBlock (ADR-0448 정합).
  if (input.emergencyStop || input.r6Defense || input.riskHardBlock) {
    const reasonLabel =
      input.emergencyStop ? 'emergencyStop' : input.r6Defense ? 'R6_DEFENSE' : 'riskHardBlock';
    return {
      cause: 'AUXILIARY_DATA_EMPTY',
      action: 'ALLOW_SELL_ONLY_EXISTING_REASON',
      allowSellOnlyTransition: true,
      preserveExistingSellOnly: input.sellOnlyAlreadyActive === true,
      engineShouldContinue: true,
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      scanIntervalMayExpand: false,
      operatorMessage: `core risk hard-block 활성 (${reasonLabel}) — SELL_ONLY 정책 유지 (ADR-0448 정합)`,
    };
  }

  // (2) 시장 정책 SELL_ONLY 보존 — LUNCH / AFTER / CLOSED + 기존 SELL_ONLY.
  if (
    input.marketSession === 'LUNCH_BREAK' ||
    input.marketSession === 'AFTER_HOURS' ||
    input.marketSession === 'CLOSED'
  ) {
    return {
      cause: 'TEMPORARY_SESSION_EMPTY',
      action: 'ALLOW_SELL_ONLY_EXISTING_REASON',
      allowSellOnlyTransition: input.sellOnlyAlreadyActive === true,
      preserveExistingSellOnly: input.sellOnlyAlreadyActive === true,
      engineShouldContinue: true,
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      scanIntervalMayExpand: false,
      operatorMessage: `시장 세션 ${input.marketSession} — 기존 SELL_ONLY 정책 유지 (시장 정책)`,
    };
  }

  // (3) REGULAR + emptyScanStreak >= 3 — 핵심 분기.
  if (
    input.marketSession === 'REGULAR' &&
    input.emptyScanStreak >= EMPTY_SCAN_LIVENESS_THRESHOLDS.EMPTY_STREAK_BACKOFF_MIN
  ) {
    // sub-cause 결정 — shadow > 0 우선 (학습 표본 보존).
    if ((input.shadowObservableCount ?? 0) > 0) {
      return {
        cause: 'TRUE_NO_CANDIDATE',
        action: 'KEEP_SHADOW_LEARNING',
        allowSellOnlyTransition: false,
        preserveExistingSellOnly: false,
        engineShouldContinue: true,
        shadowLearningAllowed: true,
        counterfactualLearningAllowed: true,
        scanIntervalMayExpand: true,
        operatorMessage: `emptyScan×${input.emptyScanStreak} (shadow ${input.shadowObservableCount}건 관측 중) — engine alive · SELL_ONLY not forced`,
      };
    }

    // dataUnavailable / providerDegraded — 데이터 공급자 문제.
    if (
      (input.dataUnavailableCount ?? 0) > 0 ||
      (input.providerDegradedCount ?? 0) > 0
    ) {
      return {
        cause: 'DATA_UNAVAILABLE_EMPTY',
        action: 'RETRY_NEXT_SCAN',
        allowSellOnlyTransition: false,
        preserveExistingSellOnly: false,
        engineShouldContinue: true,
        shadowLearningAllowed: true,
        counterfactualLearningAllowed: true,
        scanIntervalMayExpand: true,
        operatorMessage: `emptyScan×${input.emptyScanStreak} (DATA_UNAVAILABLE ${input.dataUnavailableCount ?? 0} / DEGRADED ${input.providerDegradedCount ?? 0}) — RETRY · engine alive · SELL_ONLY not forced`,
      };
    }

    // Gate 너무 엄격 — trueGateFailCount 우세.
    const gateFails = input.trueGateFailCount ?? 0;
    const gatePasses = input.gate1PassCount ?? 0;
    const gateTotal = gateFails + gatePasses;
    const gateFailRatio = gateTotal > 0 ? gateFails / gateTotal : 0;
    if (
      gateFails > 0 &&
      gateFailRatio >= EMPTY_SCAN_LIVENESS_THRESHOLDS.GATE_TOO_STRICT_RATIO
    ) {
      return {
        cause: 'GATE_TOO_STRICT_EMPTY',
        action: 'EXPAND_SCAN_INTERVAL',
        allowSellOnlyTransition: false,
        preserveExistingSellOnly: false,
        engineShouldContinue: true,
        shadowLearningAllowed: true,
        counterfactualLearningAllowed: true,
        scanIntervalMayExpand: true,
        operatorMessage: `emptyScan×${input.emptyScanStreak} (Gate fail ${(gateFailRatio * 100).toFixed(0)}%) — interval expanded · engine alive · SELL_ONLY not forced`,
      };
    }

    // 기본 — TRUE_NO_CANDIDATE.
    return {
      cause: 'TRUE_NO_CANDIDATE',
      action: 'EXPAND_SCAN_INTERVAL',
      allowSellOnlyTransition: false,
      preserveExistingSellOnly: false,
      engineShouldContinue: true,
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      scanIntervalMayExpand: true,
      operatorMessage: `emptyScan×${input.emptyScanStreak} → interval expanded · engine alive · SELL_ONLY not forced`,
    };
  }

  // (4) REGULAR + emptyScanStreak < 3 — 정상 운영.
  if (input.marketSession === 'REGULAR') {
    return {
      cause: 'UNKNOWN',
      action: 'KEEP_ENGINE_ALIVE',
      allowSellOnlyTransition: false,
      preserveExistingSellOnly: false,
      engineShouldContinue: true,
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      scanIntervalMayExpand: false,
      operatorMessage: `REGULAR session 정상 운영 (emptyScan×${input.emptyScanStreak})`,
    };
  }

  // (5) OPEN_AUCTION — 일시 공백.
  if (input.marketSession === 'OPEN_AUCTION') {
    return {
      cause: 'TEMPORARY_SESSION_EMPTY',
      action: 'RETRY_NEXT_SCAN',
      allowSellOnlyTransition: input.sellOnlyAlreadyActive === true,
      preserveExistingSellOnly: input.sellOnlyAlreadyActive === true,
      engineShouldContinue: true,
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      scanIntervalMayExpand: false,
      operatorMessage: 'OPEN_AUCTION 시초가 공백 — RETRY · 정상 동작',
    };
  }

  // (6) UNKNOWN session — 보수 fallback.
  return {
    cause: 'UNKNOWN',
    action: 'KEEP_ENGINE_ALIVE',
    allowSellOnlyTransition: false,
    preserveExistingSellOnly: false,
    engineShouldContinue: true,
    shadowLearningAllowed: true,
    counterfactualLearningAllowed: true,
    scanIntervalMayExpand: false,
    operatorMessage: 'UNKNOWN session — 보수적 engine alive 유지',
  };
}

/* ───────── /scan_blockers compact line SSOT (사용자 §7 정합) ───────── */

/**
 * `/scan_blockers` 메시지에 자동 첨부되는 ADR-0451 liveness 한 줄.
 *
 * **Telegram HTML raw 태그 금지** (사용자 §7 — plain text 우선).
 *
 * 분기:
 *   - decision 부재 → null (잡음 차단).
 *   - allowSellOnlyTransition=true + preserveExistingSellOnly=true → 시장 정책 보존 안내.
 *   - allowSellOnlyTransition=false → emptyScan 으로 SELL_ONLY 강제 안 됨 명시.
 */
export function formatEmptyScanLivenessSection(
  decision: EmptyScanLivenessDecision | null | undefined,
  emptyScanStreak: number,
): string | null {
  if (!decision) return null;

  const lines: string[] = [];
  lines.push('🫀 Trading Engine Liveness (ADR-0451)');

  if (
    decision.preserveExistingSellOnly &&
    decision.action === 'ALLOW_SELL_ONLY_EXISTING_REASON'
  ) {
    lines.push('  • SELL_ONLY preserved by existing reason');
    lines.push('  • emptyScan did not create SELL_ONLY');
    return lines.join('\n');
  }

  if (decision.allowSellOnlyTransition) {
    lines.push(`  • cause: ${decision.cause}`);
    lines.push(`  • action: ${decision.action}`);
    lines.push('  • engine: alive');
    lines.push('  • shadow/counterfactual: kept');
    return lines.join('\n');
  }

  // 핵심 — emptyScan SELL_ONLY 차단 메시지.
  lines.push(`  • emptyScan×${emptyScanStreak}: SELL_ONLY not forced`);
  lines.push(`  • cause: ${decision.cause}`);
  lines.push(`  • action: ${decision.action}`);
  lines.push('  • engine: alive');
  lines.push('  • shadow/counterfactual: kept');
  return lines.join('\n');
}
