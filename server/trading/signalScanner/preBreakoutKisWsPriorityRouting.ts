/**
 * @responsibility ADR-0450 — Pre-Breakout WAIT decision → KIS-WS priority routing SSOT.
 *
 * preBreakoutKisWsPriorityRouting.ts (ADR-0450)
 * ==============================================
 *
 * 목적
 * ----
 * ADR-0449 PreBreakoutWaitDecision (7-state) 을 ADR-0437 KIS-WebSocket
 * subscription priority queue 의 SubscriptionPriorityReason 로 매핑한다.
 *
 * 사용자 핵심 의도 (절대 변경 금지):
 *   "ADR-0450은 매수 조건을 낮추는 패치가 아니라, '지금 매수에 가장 가까운 후보'가
 *    KIS-WS 실시간 슬롯을 먼저 받게 하는 패치다."
 *
 * 결정 규칙 (사용자 §"결정 규칙" 정합 — 절대 변경 금지):
 *   - WAIT_RETRY_ELIGIBLE       → PRE_BREAKOUT_RETRY_ELIGIBLE (priority 850, WATCHLIST 500 보다 ↑)
 *   - WAIT_PRICE_TOO_FAR        → WAIT_PRICE_TOO_FAR        (priority 300, WATCHLIST 보다 ↓)
 *   - WAIT_VOLUME_WEAK          → WAIT_VOLUME_WEAK          (priority 300)
 *   - WAIT_GATE_RECHECK_FAILED  → WAIT_GATE_RECHECK_FAILED  (priority 300)
 *   - WAIT_COOLDOWN             → WAIT_COOLDOWN             (priority 250)
 *   - WAIT_SHADOW_ONLY          → SHADOW_OBSERVABLE         (priority 700, 학습 보존)
 *   - WAIT_REJECTED             → shouldRequestSubscription=false (KIS-WS 호출 미요청)
 *
 * 핵심 불변식:
 *   - WAIT_RETRY_ELIGIBLE 만 WATCHLIST 보다 *상향* (850 > 500).
 *   - 먼/약한/탈락 후보는 WATCHLIST 보다 *하향* (300/250 < 500).
 *   - WAIT_REJECTED 는 KIS-WS 요청 자체 차단 (priorityHint 0).
 *   - 호출자 (buyListLoop) 의 요구사항: subscribeStock 직접 import 0건, requestKisWsSubscription
 *     SSOT 만 사용 (ADR-0437 정합).
 *   - ENV `PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED=true` 1줄로 WATCHLIST 500 fallback 복귀.
 *
 * 외부 의존성 0 — 순수 함수만.
 */

import {
  SUBSCRIPTION_PRIORITY_TABLE,
  type SubscriptionPriorityReason,
} from '../../clients/kisWebSocketSubscriptionManager.js';
import type {
  PreBreakoutWaitDecision,
  PreBreakoutWaitState,
} from './preBreakoutWaitPolicy.js';

/* ───────── 4-state routing mode union ───────── */

type PreBreakoutKisWsRoutingMode =
  | 'PROMOTE_TO_PRE_BREAKOUT_RETRY'  // WAIT_RETRY_ELIGIBLE → 850
  | 'KEEP_WATCHLIST'                  // ENV DISABLED fallback → 500
  | 'DOWNGRADE_TO_OBSERVE'            // WAIT_PRICE_TOO_FAR / VOLUME_WEAK / GATE_RECHECK_FAILED / COOLDOWN / SHADOW_ONLY
  | 'REJECT_LOW_PRIORITY';            // WAIT_REJECTED → KIS-WS 요청 미수행

/* ───────── 결정 결과 schema ───────── */

export interface PreBreakoutKisWsRoutingDecision {
  state: PreBreakoutWaitState;
  reason: SubscriptionPriorityReason;
  priorityHint: number;
  mode: PreBreakoutKisWsRoutingMode;
  shouldRequestSubscription: boolean;
  operatorMessage: string;
}

/* ───────── ENV gate SSOT (ADR-0157 정확 비교) ───────── */

/**
 * ENV `PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED=true` (default OFF).
 *
 * 활성 시 본 SSOT 는 WATCHLIST priority 500 fallback 으로 복귀 — 호출자가 ADR-0437 의
 * 기존 WATCHLIST 동작을 유지. ADR-0157 정확 비교: '1' / 'TRUE' / 'yes' 모두 거부.
 */
export function isPreBreakoutKisWsPriorityRoutingDisabled(): boolean {
  return process.env.PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED === 'true';
}

/* ───────── 결정 트리 SSOT (사용자 §"결정 규칙" 정합 — 절대 변경 금지) ───────── */

/**
 * ADR-0449 decision → KIS-WS priority routing 결정.
 *
 * 호출자 (buyListLoop) 가 evaluatePreBreakoutWait(...) 결과를 받은 직후, 본 함수의
 * 반환값으로 requestKisWsSubscription({code, priority: priorityHint, reasons: [reason], ...})
 * 호출. shouldRequestSubscription=false 시 호출 자체 skip.
 *
 * 우선순위 (위에서 아래 첫 매칭):
 *   1. ENV DISABLED → KEEP_WATCHLIST (priority 500, WATCHLIST fallback)
 *   2. WAIT_RETRY_ELIGIBLE → PROMOTE_TO_PRE_BREAKOUT_RETRY (priority 850, WATCHLIST 보다 ↑)
 *   3. WAIT_SHADOW_ONLY → DOWNGRADE_TO_OBSERVE (priority 700 SHADOW_OBSERVABLE, 학습 보존)
 *   4. WAIT_PRICE_TOO_FAR / VOLUME_WEAK / GATE_RECHECK_FAILED → DOWNGRADE_TO_OBSERVE (priority 300)
 *   5. WAIT_COOLDOWN → DOWNGRADE_TO_OBSERVE (priority 250)
 *   6. WAIT_REJECTED → REJECT_LOW_PRIORITY (priority 0, KIS-WS 요청 미수행)
 *
 * 모든 분기에서 *진입 조건 / Gate threshold / STRONG_BUY 변경 0* — 본 SSOT 는 KIS-WS
 * 슬롯 자원 배분 결정만 산출, 매매 결정 무관.
 */
export function routePreBreakoutWaitToKisWs(
  decision: PreBreakoutWaitDecision,
): PreBreakoutKisWsRoutingDecision {
  // (1) ENV DISABLED — WATCHLIST fallback (ADR-0437 기존 동작 100% 복원).
  if (isPreBreakoutKisWsPriorityRoutingDisabled()) {
    return {
      state: decision.state,
      reason: 'WATCHLIST',
      priorityHint: SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST,
      mode: 'KEEP_WATCHLIST',
      shouldRequestSubscription: true,
      operatorMessage: 'PRE_BREAKOUT_KIS_WS_PRIORITY_ROUTING_DISABLED env active — WATCHLIST fallback.',
    };
  }

  switch (decision.state) {
    case 'WAIT_RETRY_ELIGIBLE':
      // (2) PROMOTE — 진입가 근접 + 조건 살아 있음 → 850 우선순위 격상
      return {
        state: decision.state,
        reason: 'PRE_BREAKOUT_RETRY_ELIGIBLE',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.PRE_BREAKOUT_RETRY_ELIGIBLE,
        mode: 'PROMOTE_TO_PRE_BREAKOUT_RETRY',
        shouldRequestSubscription: true,
        operatorMessage: `${decision.reason} → KIS-WS PRE_BREAKOUT_RETRY_ELIGIBLE (priority 850, WATCHLIST↑)`,
      };

    case 'WAIT_SHADOW_ONLY':
      // (3) SHADOW_OBSERVABLE — 학습 후보 보존 (priority 700)
      return {
        state: decision.state,
        reason: 'SHADOW_OBSERVABLE',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.SHADOW_OBSERVABLE,
        mode: 'DOWNGRADE_TO_OBSERVE',
        shouldRequestSubscription: true,
        operatorMessage: `${decision.reason} → KIS-WS SHADOW_OBSERVABLE (priority 700, 학습 보존)`,
      };

    case 'WAIT_PRICE_TOO_FAR':
      // (4a) priceDistance > 3% — WATCHLIST 보다 ↓ (priority 300)
      return {
        state: decision.state,
        reason: 'WAIT_PRICE_TOO_FAR',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.WAIT_PRICE_TOO_FAR,
        mode: 'DOWNGRADE_TO_OBSERVE',
        shouldRequestSubscription: true,
        operatorMessage: `${decision.reason} → KIS-WS WAIT_PRICE_TOO_FAR (priority 300, WATCHLIST↓)`,
      };

    case 'WAIT_VOLUME_WEAK':
      // (4b) volumeRatio < 0.4 — WATCHLIST 보다 ↓ (priority 300)
      return {
        state: decision.state,
        reason: 'WAIT_VOLUME_WEAK',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.WAIT_VOLUME_WEAK,
        mode: 'DOWNGRADE_TO_OBSERVE',
        shouldRequestSubscription: true,
        operatorMessage: `${decision.reason} → KIS-WS WAIT_VOLUME_WEAK (priority 300, WATCHLIST↓)`,
      };

    case 'WAIT_GATE_RECHECK_FAILED':
      // (4c) Gate 재검증 탈락 — WATCHLIST 보다 ↓ (priority 300)
      return {
        state: decision.state,
        reason: 'WAIT_GATE_RECHECK_FAILED',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.WAIT_GATE_RECHECK_FAILED,
        mode: 'DOWNGRADE_TO_OBSERVE',
        shouldRequestSubscription: true,
        operatorMessage: `${decision.reason} → KIS-WS WAIT_GATE_RECHECK_FAILED (priority 300, WATCHLIST↓)`,
      };

    case 'WAIT_COOLDOWN':
      // (5) waitCount ≥ 3 cooldown — WATCHLIST 보다 ↓ (priority 250, 가장 낮음)
      return {
        state: decision.state,
        reason: 'WAIT_COOLDOWN',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.WAIT_COOLDOWN,
        mode: 'DOWNGRADE_TO_OBSERVE',
        shouldRequestSubscription: true,
        operatorMessage: `${decision.reason} → KIS-WS WAIT_COOLDOWN (priority 250, WATCHLIST↓↓)`,
      };

    case 'WAIT_REJECTED':
      // (6) REJECTED — KIS-WS 요청 미수행 (priority 0).
      //   riskBlocked=true 같은 명백한 차단 시점 — manager 재호출 부담 차단.
      return {
        state: decision.state,
        reason: 'UNKNOWN',
        priorityHint: 0,
        mode: 'REJECT_LOW_PRIORITY',
        shouldRequestSubscription: false,
        operatorMessage: `${decision.reason} → KIS-WS 요청 미수행 (priority 0, REJECTED)`,
      };

    default: {
      // 컴파일 타임 exhaustive check — 신규 state 추가 시 자동 fail.
      const _exhaustive: never = decision.state;
      // 런타임 fallback (도달 불가, 안전 기본값).
      return {
        state: _exhaustive,
        reason: 'UNKNOWN',
        priorityHint: SUBSCRIPTION_PRIORITY_TABLE.UNKNOWN,
        mode: 'KEEP_WATCHLIST',
        shouldRequestSubscription: false,
        operatorMessage: `unknown PreBreakoutWaitState — fallback REJECT`,
      };
    }
  }
}
