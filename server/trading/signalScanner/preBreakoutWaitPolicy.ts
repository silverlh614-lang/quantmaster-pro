/**
 * @responsibility ADR-0449 — Pre-Breakout WAIT 후보 상태 분류 SSOT.
 *
 * preBreakoutWaitPolicy.ts (ADR-0449)
 * ====================================
 *
 * 목적
 * ----
 * ADR-0448 Phase 0 적용 후 매매엔진은 다시 살아났으나, 다수 후보가 *진입가 미도달
 * pre-breakout WAIT* 상태에서 무한 대기. WAIT 자체는 정상 (ADR-0115 — failCount
 * 증가 금지) 이지만, 무한 대기가 되면 KIS-WS 30 슬롯 점유 + 운영자 진단 가시성
 * 부족으로 엔진 liveness 가 다시 저하.
 *
 * 사용자 핵심 의도 (절대 변경 금지):
 *   "Pre-Breakout WAIT 는 실패가 아니다. 하지만 무한 대기도 아니다."
 *
 * 7-state 모델 (사용자 §"권장 상태"):
 *   - WAIT_RETRY_ELIGIBLE       — 진입가 근접 + 조건 살아 있음, 다음 루프 재검증.
 *   - WAIT_PRICE_TOO_FAR        — 현재가가 진입가에서 너무 멀다.
 *   - WAIT_VOLUME_WEAK          — 가격은 근접하지만 거래량 약함.
 *   - WAIT_GATE_RECHECK_FAILED  — 직전 진입 전 재검증 탈락.
 *   - WAIT_COOLDOWN             — 반복 WAIT/재검증 탈락 → 일정 시간 관망.
 *   - WAIT_SHADOW_ONLY          — Live 후보 아님 + 관측/학습 가치.
 *   - WAIT_REJECTED             — 진입가 괴리 과대/리스크 훼손/조건 붕괴.
 *
 * 핵심 불변식 (사용자 §"중요"):
 *   - `increaseFailCount: false` literal type (ADR-0115 보호 유지).
 *   - waitCount / recheckFailCount / lastWaitAt 별도 카운터.
 *   - Live 진입 조건 변경 0 / Gate threshold 변경 0 / STRONG_BUY 조건 변경 0.
 *   - SectorEnergy / 수급 / Yahoo / FSS 보수 0 (out of scope).
 *   - ADR-0437 KIS-WS subscription priority queue 와 priority routing 만 연동.
 *
 * 외부 의존성 0 — 순수 함수만, KIS/KRX/Yahoo/Naver outbound 0.
 */

/* ───────── 7-state union (사용자 §"권장 상태" 정합) ───────── */

export type PreBreakoutWaitState =
  | 'WAIT_RETRY_ELIGIBLE'
  | 'WAIT_PRICE_TOO_FAR'
  | 'WAIT_VOLUME_WEAK'
  | 'WAIT_GATE_RECHECK_FAILED'
  | 'WAIT_COOLDOWN'
  | 'WAIT_SHADOW_ONLY'
  | 'WAIT_REJECTED';

/* ───────── 9-value reason union ───────── */

export type PreBreakoutWaitReason =
  | 'ENTRY_PRICE_NOT_REACHED'
  | 'PRICE_DISTANCE_TOO_FAR'
  | 'VOLUME_BELOW_THRESHOLD'
  | 'GATE_RECHECK_FAILED'
  | 'REPEATED_WAIT'
  | 'STALE_QUOTE'
  | 'RISK_RULE_BLOCKED'
  | 'SHADOW_OBSERVABLE_ONLY'
  | 'UNKNOWN';

/* ───────── KIS-WS priority adjustment (ADR-0437 연동) ───────── */

export type PreBreakoutKisWsPriorityAdjustment =
  | 'KEEP'
  | 'DOWNGRADE_TO_WATCHLIST'
  | 'DOWNGRADE_TO_OBSERVE_ONLY'
  | 'UNSUBSCRIBE_IF_LOW_PRIORITY';

/* ───────── 입력/결과 schema ───────── */

export interface PreBreakoutWaitInput {
  symbol: string;
  name?: string;
  /** 현재가 — undefined 시 분류 보수적 fallback. */
  currentPrice?: number;
  /** 워치리스트 진입가. */
  entryPrice?: number;
  /** 전일 종가 (옵셔널, 진단 정보). */
  previousClose?: number;
  /** 진입가 대비 현재가 괴리 % — 호출자 측 산출 가능. 미전달 시 currentPrice/entryPrice 로 자동 산출. */
  priceDistancePct?: number;
  /** 거래량 비율 (당일 / 평균 20일) — 미전달 시 1.0 가정. */
  volumeRatio?: number;
  /** Gate 1 통과 여부. */
  gate1Passed?: boolean;
  /** Live Gate Score — 디버깅·진단용. */
  liveGateScore?: number;
  /** 통과 조건 수 — 진단용. */
  conditionsPassed?: number;
  /** 직전 진입 직전 재검증 통과 여부. false = 탈락 / undefined = 미평가. */
  recheckPassed?: boolean;
  /** 누적 wait 카운트 (호출자가 영속 누적 후 전달). */
  waitCount?: number;
  /** 재검증 탈락 누적 카운트. */
  recheckFailCount?: number;
  /** 마지막 wait 시각 (ISO). */
  lastWaitAt?: string;
  /** Counterfactual / shadow observable 후보 여부. */
  shadowObservable?: boolean;
  /** Live 진입 후보 여부 (ADR-0436 GateEligibility). */
  liveEligible?: boolean;
  /** 리스크 룰 차단 (R6 / EmergencyStop / hard risk block). */
  riskBlocked?: boolean;
  /** 가격 데이터 stale (Yahoo timestamps stale / FrozenQuote STALE). */
  quoteStale?: boolean;
}

export interface PreBreakoutWaitDecision {
  state: PreBreakoutWaitState;
  reason: PreBreakoutWaitReason;
  retryAllowed: boolean;
  /** ADR-0115 — 진입가 미도달은 매매 실패 아님. literal type 강제. */
  increaseFailCount: false;
  increaseWaitCount: boolean;
  increaseRecheckFailCount: boolean;
  kisWsPriorityAdjustment: PreBreakoutKisWsPriorityAdjustment;
  shadowLearningAllowed: boolean;
  counterfactualLearningAllowed: boolean;
  operatorMessage: string;
  /** ADR-P0-8 — concrete diagnostic context so REPEATED_WAIT is not opaque UNKNOWN. */
  originalConditionGap?: string;
  allReasons?: PreBreakoutWaitReason[];
}

/* ───────── 정책 임계값 SSOT (사용자 §"권장 상수" 정합) ───────── */

export const PRE_BREAKOUT_WAIT_POLICY = Object.freeze({
  NEAR_ENTRY_DISTANCE_PCT: 1.0,
  FAR_ENTRY_DISTANCE_PCT: 3.0,
  MIN_VOLUME_RATIO: 0.4,
  MAX_WAIT_COUNT_BEFORE_COOLDOWN: 3,
  COOLDOWN_MINUTES: 30,
} as const);

/* ───────── ENV 우회 SSOT (ADR-0157 정확 비교) ───────── */

/**
 * ENV `PRE_BREAKOUT_WAIT_POLICY_DISABLED=true` (default OFF).
 *
 * 활성 시 본 SSOT 는 *기존 ADR-0115 WAIT 동작* (단순 WAIT, 분류 부재) 으로 복귀하기
 * 위해 `evaluatePreBreakoutWait` 가 보수 fallback (UNKNOWN + retry false + KIS-WS KEEP)
 * 을 반환. 호출자 (buyListLoop) 가 본 fallback 을 받아 기존 단순 console.log 만
 * 출력하도록 동작 보존.
 */
export function isPreBreakoutWaitPolicyDisabled(): boolean {
  return process.env.PRE_BREAKOUT_WAIT_POLICY_DISABLED === 'true';
}

/* ───────── 결정 트리 SSOT (사용자 §"결정 규칙" 정합 — 절대 변경 금지) ───────── */

/**
 * 진입가 미도달 후보 상태 분류.
 *
 * 우선순위 (위에서 아래 첫 매칭):
 *   1. ENV DISABLED → 보수 fallback (UNKNOWN + retry false + KIS-WS KEEP)
 *   2. riskBlocked === true → WAIT_REJECTED
 *   3. quoteStale === true → WAIT_SHADOW_ONLY
 *   4. recheckPassed === false → WAIT_GATE_RECHECK_FAILED (recheckFailCount 증가)
 *   5. waitCount >= 3 → WAIT_COOLDOWN
 *   6. shadowObservable && !liveEligible → WAIT_SHADOW_ONLY
 *   7. priceDistance > 3% → WAIT_PRICE_TOO_FAR
 *   8. volumeRatio < 0.4 → WAIT_VOLUME_WEAK
 *   9. priceDistance ≤ 1% AND gate1Passed AND recheckPassed !== false → WAIT_RETRY_ELIGIBLE
 *  10. 그 외 → WAIT_RETRY_ELIGIBLE (보수적 — 진입가 근접 + 명백한 차단 사유 부재)
 *
 * 모든 분기에서 `increaseFailCount: false` literal — ADR-0115 보호 유지.
 */
export function evaluatePreBreakoutWait(
  input: PreBreakoutWaitInput,
): PreBreakoutWaitDecision {
  // (1) ENV DISABLED — 보수 fallback (호출자가 기존 ADR-0115 단순 WAIT 동작 유지).
  if (isPreBreakoutWaitPolicyDisabled()) {
    return {
      state: 'WAIT_RETRY_ELIGIBLE',
      reason: 'UNKNOWN',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: false,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'KEEP',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage:
        'PRE_BREAKOUT_WAIT_POLICY_DISABLED env active — fallback to legacy ADR-0115 WAIT.',
    };
  }

  // 입력 정규화 — priceDistancePct 미전달 시 currentPrice/entryPrice 로 자동 산출.
  const priceDistance = computePriceDistancePct(input);
  const volumeRatio = input.volumeRatio ?? 1.0;
  const waitCount = input.waitCount ?? 0;

  // (2) riskBlocked → WAIT_REJECTED (기존 risk hard block 그대로 — Live 차단 유지).
  if (input.riskBlocked === true) {
    return {
      state: 'WAIT_REJECTED',
      reason: 'RISK_RULE_BLOCKED',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: false,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'UNSUBSCRIBE_IF_LOW_PRIORITY',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage: `${input.symbol} risk rule blocked for live entry; Shadow/Counterfactual learning stays always-on.`,
    };
  }

  // (3) quoteStale → WAIT_SHADOW_ONLY (Yahoo timestamps stale / FrozenQuote STALE).
  if (input.quoteStale === true) {
    return {
      state: 'WAIT_SHADOW_ONLY',
      reason: 'STALE_QUOTE',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'DOWNGRADE_TO_OBSERVE_ONLY',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage: `${input.symbol} quote stale — shadow only.`,
    };
  }

  // (4) recheckPassed === false → WAIT_GATE_RECHECK_FAILED.
  if (input.recheckPassed === false) {
    return {
      state: 'WAIT_GATE_RECHECK_FAILED',
      reason: 'GATE_RECHECK_FAILED',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: true,
      kisWsPriorityAdjustment: 'DOWNGRADE_TO_WATCHLIST',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage: `${input.symbol} gate recheck failed — recheckFailCount++.`,
    };
  }

  // (5) waitCount >= 3 → WAIT_COOLDOWN.
  if (waitCount >= PRE_BREAKOUT_WAIT_POLICY.MAX_WAIT_COUNT_BEFORE_COOLDOWN) {
    return {
      state: 'WAIT_COOLDOWN',
      reason: 'REPEATED_WAIT',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'DOWNGRADE_TO_OBSERVE_ONLY',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage:
        `${input.symbol} wait cooldown — waitCount=${waitCount} ≥ ` +
        `${PRE_BREAKOUT_WAIT_POLICY.MAX_WAIT_COUNT_BEFORE_COOLDOWN}; ` +
        `distance=${priceDistance.toFixed(2)}%, volume=${volumeRatio.toFixed(2)}.`,
      originalConditionGap: `distance=${priceDistance.toFixed(2)}%, volume=${volumeRatio.toFixed(2)}`,
      allReasons: ['REPEATED_WAIT', priceDistance > PRE_BREAKOUT_WAIT_POLICY.NEAR_ENTRY_DISTANCE_PCT ? 'ENTRY_PRICE_NOT_REACHED' : 'ENTRY_PRICE_NOT_REACHED'],
    };
  }

  // (6) shadowObservable=true AND liveEligible=false → WAIT_SHADOW_ONLY.
  if (input.shadowObservable === true && input.liveEligible === false) {
    return {
      state: 'WAIT_SHADOW_ONLY',
      reason: 'SHADOW_OBSERVABLE_ONLY',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'DOWNGRADE_TO_OBSERVE_ONLY',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage: `${input.symbol} shadow observable only — live ineligible.`,
    };
  }

  // (7) priceDistance > 3% → WAIT_PRICE_TOO_FAR.
  if (priceDistance > PRE_BREAKOUT_WAIT_POLICY.FAR_ENTRY_DISTANCE_PCT) {
    return {
      state: 'WAIT_PRICE_TOO_FAR',
      reason: 'PRICE_DISTANCE_TOO_FAR',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'DOWNGRADE_TO_WATCHLIST',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage:
        `${input.symbol} price distance ${priceDistance.toFixed(2)}% > ` +
        `${PRE_BREAKOUT_WAIT_POLICY.FAR_ENTRY_DISTANCE_PCT}%.`,
    };
  }

  // (8) volumeRatio < 0.4 → WAIT_VOLUME_WEAK.
  if (volumeRatio < PRE_BREAKOUT_WAIT_POLICY.MIN_VOLUME_RATIO) {
    return {
      state: 'WAIT_VOLUME_WEAK',
      reason: 'VOLUME_BELOW_THRESHOLD',
      retryAllowed: false,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'DOWNGRADE_TO_OBSERVE_ONLY',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage:
        `${input.symbol} volume ratio ${volumeRatio.toFixed(2)} < ` +
        `${PRE_BREAKOUT_WAIT_POLICY.MIN_VOLUME_RATIO}.`,
    };
  }

  // (9) priceDistance ≤ 1% AND gate1Passed → WAIT_RETRY_ELIGIBLE.
  //   recheckPassed === false 는 위 (4) 분기에서 이미 처리됨 (이 시점 true | undefined).
  if (
    priceDistance <= PRE_BREAKOUT_WAIT_POLICY.NEAR_ENTRY_DISTANCE_PCT &&
    input.gate1Passed === true
  ) {
    return {
      state: 'WAIT_RETRY_ELIGIBLE',
      reason: 'ENTRY_PRICE_NOT_REACHED',
      retryAllowed: true,
      increaseFailCount: false,
      increaseWaitCount: true,
      increaseRecheckFailCount: false,
      kisWsPriorityAdjustment: 'KEEP',
      shadowLearningAllowed: true,
      counterfactualLearningAllowed: true,
      operatorMessage:
        `${input.symbol} retry eligible — distance ${priceDistance.toFixed(2)}% ≤ ` +
        `${PRE_BREAKOUT_WAIT_POLICY.NEAR_ENTRY_DISTANCE_PCT}%.`,
    };
  }

  // (10) 그 외 — 보수적 RETRY_ELIGIBLE (진입가 근접 1~3% + 명백한 차단 부재).
  //   사용자 §"결정 규칙" 명시 케이스 외 — KEEP retry로 후보 보존, watchlist 영구 제외 차단.
  return {
    state: 'WAIT_RETRY_ELIGIBLE',
    reason: 'ENTRY_PRICE_NOT_REACHED',
    retryAllowed: true,
    increaseFailCount: false,
    increaseWaitCount: true,
    increaseRecheckFailCount: false,
    kisWsPriorityAdjustment: 'KEEP',
    shadowLearningAllowed: true,
    counterfactualLearningAllowed: true,
    operatorMessage:
      `${input.symbol} retry eligible (default) — distance ${priceDistance.toFixed(2)}%.`,
  };
}

/* ───────── 헬퍼 ───────── */

/**
 * priceDistancePct 자동 산출. 호출자가 명시 전달 시 그대로 사용,
 * 미전달 시 `(currentPrice - entryPrice) / entryPrice * 100` (양수만 — 미도달 시점).
 * NaN/Infinity/0 fallback → 0 (분기 우선순위는 다른 신호로 결정).
 */
export function computePriceDistancePct(input: PreBreakoutWaitInput): number {
  if (typeof input.priceDistancePct === 'number' && Number.isFinite(input.priceDistancePct)) {
    return Math.abs(input.priceDistancePct);
  }
  const cur = input.currentPrice;
  const ent = input.entryPrice;
  if (typeof cur !== 'number' || typeof ent !== 'number') return 0;
  if (!Number.isFinite(cur) || !Number.isFinite(ent) || ent === 0) return 0;
  return Math.abs(((cur - ent) / ent) * 100);
}

/* ───────── /scan_blockers compact summary SSOT ───────── */

export interface PreBreakoutWaitSummaryInput {
  /** 직전 스캔의 분류된 decision 들. */
  decisions: ReadonlyArray<PreBreakoutWaitDecision>;
}

export interface PreBreakoutWaitSummary {
  retryEligible: number;
  cooldown: number;
  shadowOnly: number;
  rejected: number;
  priceTooFar: number;
  volumeWeak: number;
  gateRecheckFailed: number;
  failCountProtected: number;
  preservedCount: number;
  topReasons: Array<{ reason: PreBreakoutWaitReason; count: number }>;
}

/**
 * compact summary 합성 — /scan_blockers 출력용.
 */
export function summarizePreBreakoutWaitDecisions(
  input: PreBreakoutWaitSummaryInput,
): PreBreakoutWaitSummary {
  let retryEligible = 0;
  let cooldown = 0;
  let shadowOnly = 0;
  let rejected = 0;
  let priceTooFar = 0;
  let volumeWeak = 0;
  let gateRecheckFailed = 0;
  let failCountProtected = 0;
  let preservedCount = 0;
  const reasonCounts = new Map<PreBreakoutWaitReason, number>();
  for (const d of input.decisions) {
    // ADR-0115 보호: 본 SSOT 의 모든 decision 이 increaseFailCount=false 이므로
    // `failCountProtected = decisions.length` (호출자 운영자 가시성).
    failCountProtected += 1;
    if (d.shadowLearningAllowed || d.counterfactualLearningAllowed || d.retryAllowed) preservedCount++;
    if (d.state === 'WAIT_RETRY_ELIGIBLE') retryEligible++;
    else if (d.state === 'WAIT_COOLDOWN') cooldown++;
    else if (d.state === 'WAIT_SHADOW_ONLY') shadowOnly++;
    else if (d.state === 'WAIT_REJECTED') rejected++;
    else if (d.state === 'WAIT_PRICE_TOO_FAR') priceTooFar++;
    else if (d.state === 'WAIT_VOLUME_WEAK') volumeWeak++;
    else if (d.state === 'WAIT_GATE_RECHECK_FAILED') gateRecheckFailed++;
    reasonCounts.set(d.reason, (reasonCounts.get(d.reason) ?? 0) + 1);
    for (const reason of d.allReasons ?? []) {
      if (reason !== d.reason) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const topReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return {
    retryEligible,
    cooldown,
    shadowOnly,
    rejected,
    priceTooFar,
    volumeWeak,
    gateRecheckFailed,
    failCountProtected,
    preservedCount,
    topReasons,
  };
}

/**
 * compact summary plain text 출력 — /scan_blockers 통합용.
 *
 * 출력 예 (사용자 §"텔레그램 / 진단" 정합):
 *   🕒 Pre-Breakout WAIT (ADR-0449)
 *     • retryEligible 4 / cooldown 8 / shadowOnly 12 / rejected 3
 *     • topReason: ENTRY_PRICE_NOT_REACHED 11, GATE_RECHECK_FAILED 7
 *     • failCountProtected: 23
 *
 * decisions 빈 배열 시 null 반환 (잡음 차단).
 */
export function formatPreBreakoutWaitSummarySection(
  summary: PreBreakoutWaitSummary,
): string | null {
  if (summary.failCountProtected === 0) return null;
  const lines: string[] = ['🕒 Pre-Breakout WAIT (ADR-0449)'];
  lines.push(
    `  • retryEligible ${summary.retryEligible} / cooldown ${summary.cooldown} / ` +
      `shadowOnly ${summary.shadowOnly} / rejected ${summary.rejected}`,
  );
  if (summary.priceTooFar > 0 || summary.volumeWeak > 0 || summary.gateRecheckFailed > 0) {
    lines.push(
      `  • priceTooFar ${summary.priceTooFar} / volumeWeak ${summary.volumeWeak} / ` +
        `gateRecheckFailed ${summary.gateRecheckFailed}`,
    );
  }
  if (summary.topReasons.length > 0) {
    const reasonText = summary.topReasons.map((t) => `${t.reason} ${t.count}`).join(', ');
    lines.push(`  • topReason: ${reasonText}`);
  }
  lines.push(`  • failCountProtected: ${summary.failCountProtected}`);
  lines.push(`  • preserved: ${summary.preservedCount} (watch/provisional/near-miss observation eligible)`);
  return lines.join('\n');
}
