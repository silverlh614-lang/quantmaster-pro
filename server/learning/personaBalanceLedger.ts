// @responsibility 페르소나 매수/매도 균형 자가 검증 SSOT (ADR-0329 Phase 1 — pure)
/**
 * personaBalanceLedger.ts (ADR-0329 Phase 1) — 페르소나 매수/매도 균형 자가 검증.
 *
 * 사용자 5/6 명시 — 페르소나 원칙 2 (`매수보다 매도 우선`) 가 너무 강하게 적용되어
 * 매수가 거의 안 되는 상태인지 자동 검증. 균형 자체의 자가 검증.
 *
 * 본 PR scope (Phase 1, pure SSOT only):
 *   - classifyPersonaBalance 순수 함수 — 4 카운트 입력 → 4 분기 분류
 *   - ENV `PERSONA_BALANCE_LEDGER_DISABLED=true` 우회
 *   - **데이터 수집 함수 미수행** — 사용자 spec 의 `calculateBuyConversionRate` /
 *     `calculateSellConversionRate` 는 후속 PR (scanTracer + shadowTrade 통합 wiring)
 *   - cron + 텔레그램 알림 wiring 후속 PR
 *
 * 분류 규칙:
 *   - INSUFFICIENT_SAMPLE — buyEvaluations 또는 sellEvaluations < MIN_EVAL_SAMPLE
 *   - OVER_CONSERVATIVE_BUY — buyConversionRate < 0.02 AND sellConversionRate > 0.5
 *   - OVER_AGGRESSIVE_SELL — sellConversionRate > 0.8 (매도가 지나치게 잦음)
 *   - HEALTHY — 그 외
 *
 * 주의: 페르소나 원칙은 *매도 > 매수* 가 정상. 본 분류는 그 비율이 *극단적인* 경우만
 * 시스템 결함으로 분류. HEALTHY 는 정상적인 매도 우세 포함.
 */

export const PERSONA_MIN_EVAL_SAMPLE = 30;
export const OVER_CONSERVATIVE_BUY_RATE = 0.02;
export const OVER_CONSERVATIVE_SELL_RATE = 0.5;
export const OVER_AGGRESSIVE_SELL_RATE = 0.8;

type PersonaBalanceVerdict =
  | 'HEALTHY'
  | 'OVER_CONSERVATIVE_BUY'
  | 'OVER_AGGRESSIVE_SELL'
  | 'INSUFFICIENT_SAMPLE'
  | 'DISABLED';

export interface PersonaBalanceInput {
  /** 매수 평가 진입 시도 횟수 (signalScanner 매수 후보 검토) */
  buyEvaluations: number;
  /** 실제 매수 체결 횟수 */
  buyExecuted: number;
  /** 매도 평가 진입 시도 (exitEngine 청산 평가) */
  sellEvaluations: number;
  /** 실제 매도 체결 횟수 */
  sellExecuted: number;
}

export interface PersonaBalanceLedger extends PersonaBalanceInput {
  buyConversionRate: number;
  sellConversionRate: number;
  verdict: PersonaBalanceVerdict;
}

/** ENV `PERSONA_BALANCE_LEDGER_DISABLED=true` → 우회 (ADR-0157 정확 비교). */
export function isPersonaBalanceLedgerDisabled(): boolean {
  return process.env.PERSONA_BALANCE_LEDGER_DISABLED === 'true';
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0 || !Number.isFinite(denominator)) return 0;
  if (!Number.isFinite(numerator) || numerator < 0) return 0;
  return numerator / denominator;
}

/**
 * 4 카운트 입력 → 페르소나 균형 ledger 분류.
 *
 * 분기 우선순위 SSOT:
 *   1. ENV DISABLED → DISABLED
 *   2. 양쪽 표본 < MIN_EVAL_SAMPLE → INSUFFICIENT_SAMPLE
 *   3. buy < 0.02 AND sell > 0.5 → OVER_CONSERVATIVE_BUY (매수 거의 차단)
 *   4. sell > 0.8 → OVER_AGGRESSIVE_SELL (매도 지나치게 잦음)
 *   5. 그 외 → HEALTHY (페르소나 정상 작동)
 */
export function classifyPersonaBalance(input: PersonaBalanceInput): PersonaBalanceLedger {
  if (isPersonaBalanceLedgerDisabled()) {
    return {
      ...input,
      buyConversionRate: 0,
      sellConversionRate: 0,
      verdict: 'DISABLED',
    };
  }
  const buyRate = safeRate(input.buyExecuted, input.buyEvaluations);
  const sellRate = safeRate(input.sellExecuted, input.sellEvaluations);
  const enoughBuy = input.buyEvaluations >= PERSONA_MIN_EVAL_SAMPLE;
  const enoughSell = input.sellEvaluations >= PERSONA_MIN_EVAL_SAMPLE;
  if (!enoughBuy || !enoughSell) {
    return {
      ...input,
      buyConversionRate: buyRate,
      sellConversionRate: sellRate,
      verdict: 'INSUFFICIENT_SAMPLE',
    };
  }
  if (buyRate < OVER_CONSERVATIVE_BUY_RATE && sellRate > OVER_CONSERVATIVE_SELL_RATE) {
    return {
      ...input,
      buyConversionRate: buyRate,
      sellConversionRate: sellRate,
      verdict: 'OVER_CONSERVATIVE_BUY',
    };
  }
  if (sellRate > OVER_AGGRESSIVE_SELL_RATE) {
    return {
      ...input,
      buyConversionRate: buyRate,
      sellConversionRate: sellRate,
      verdict: 'OVER_AGGRESSIVE_SELL',
    };
  }
  return {
    ...input,
    buyConversionRate: buyRate,
    sellConversionRate: sellRate,
    verdict: 'HEALTHY',
  };
}
