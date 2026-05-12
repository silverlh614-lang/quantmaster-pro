// @responsibility Position Card 6 ENV 헬퍼 SSOT — ADR-0157 정확 비교 의무 (ADR-0504).
/**
 * positionCardEnvHelpers.ts — Position Card ENV gate SSOT (ADR-0504).
 *
 * 6 ENV 헬퍼 (사용자 명시 매트릭스):
 *   isPositionCardEnabled               default ON  (`!== 'false'`)
 *   isShadowPositionCardEnabled         default ON  (`!== 'false'`)
 *   isMorningPositionCardEnabled        default ON  (`!== 'false'`)
 *   isSendEmptyPositionCardEnabled      default OFF (`=== 'true'`)
 *   isPositionCardSourceValidationEnabled default ON  (`!== 'false'`)
 *   isPositionCardFallbackForbidden     default ON  (`!== 'false'`)
 *
 * ADR-0157 정확 비교 의무: '1' / 'TRUE' / 'yes' / 빈 문자열 모두 거부.
 * 호출자 측 inline `process.env.X === 'true'` 검사 0건 — SSOT 위임 의무.
 */

/** Position Card 발송 자체 활성화 — default ON. `=false` 1줄 즉시 모든 카드 차단. */
export function isPositionCardEnabled(): boolean {
  return process.env.TELEGRAM_POSITION_CARD_ENABLED !== 'false';
}

/** Shadow Position Card 발송 활성화 — default ON. */
export function isShadowPositionCardEnabled(): boolean {
  return process.env.TELEGRAM_SHADOW_POSITION_CARD_ENABLED !== 'false';
}

/** Morning Position Card (09:05 KST cron) 발송 활성화 — default ON. */
export function isMorningPositionCardEnabled(): boolean {
  return process.env.TELEGRAM_MORNING_POSITION_CARD_ENABLED !== 'false';
}

/**
 * 빈 보유 시 카드 발송 — **default OFF** (사용자 결정).
 * ON 시 "현재 Shadow 보유 포지션 없음 / executionImpact=NONE" 명시 카드 발송.
 */
export function isSendEmptyPositionCardEnabled(): boolean {
  return process.env.TELEGRAM_SEND_EMPTY_POSITION_CARD === 'true';
}

/**
 * Payload validation 활성화 — default ON. 회귀 위험 시 ENV 1줄 즉시 우회.
 */
export function isPositionCardSourceValidationEnabled(): boolean {
  return process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE !== 'false';
}

/**
 * Fallback 금지 정책 활성화 — default ON. 호출자가 lastKnown / previousTelegramCache
 * 등 fallback 패턴 도입 시 정적 grep 가드와 함께 차단.
 */
export function isPositionCardFallbackForbidden(): boolean {
  return process.env.TELEGRAM_POSITION_CARD_FALLBACK_FORBIDDEN !== 'false';
}
