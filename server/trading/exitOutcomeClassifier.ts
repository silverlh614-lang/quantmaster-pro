// @responsibility 청산 결과 WIN/LOSS/BE 분류 SSOT — 서킷 카운트·통계의 단일 진실
/**
 * exitOutcomeClassifier.ts (ADR-0112) — BREAKEVEN 분류 SSOT.
 *
 * 1차 로그(2026-04-30) 의 PROFIT_PROTECTION -0.18~-0.45% 청산 3건이 LOSS 와
 * 동일하게 카운트되어 서킷 무한 루프를 트리거하던 결함의 진짜 근본 원인 차단.
 *
 * 사용자 트레이딩 철학:
 *   "본절은 *방향 실패* 가 아니라 *타이밍 실패*. 통계상 손절에는 포함하지 말고,
 *    실전 리스크 관리에는 소손실로 반영."
 *
 * 우선순위 SSOT:
 *   1. ENV BE_CLASSIFICATION_DISABLED=true → 기존 동작 (≥+1 WIN / 그 외 LOSS)
 *   2. NaN/Infinity → LOSS 안전 fallback (서킷 보수적)
 *   3. exitRuleTag === 'TARGET_EXIT' / 'EUPHORIA_PARTIAL' → WIN
 *   4. stopLossExitType === 'PROFIT_PROTECTION' AND -0.5 ≤ returnPct ≤ +0.5 → BE
 *   5. exitRuleTag === 'ENTRY_CIRCUIT_BREAKER' AND -0.5 ≤ returnPct ≤ +0.5 → BE
 *   6. returnPct ≥ +1.0 → WIN
 *   7. -0.5 ≤ returnPct ≤ +0.5 → BE (휴리스틱)
 *   8. returnPct < -0.5 → LOSS
 *   9. +0.5 < returnPct < +1.0 → LOSS (보수적 — 표본 미달)
 */

export type ExitOutcome = 'WIN' | 'LOSS' | 'BE';

export const EXIT_OUTCOME_THRESHOLDS = {
  /** +1.0% 이상은 명백한 WIN */
  WIN_PCT_MIN: 1.0,
  /** -0.5% 이하는 명백한 LOSS */
  LOSS_PCT_MAX: -0.5,
  /** BE 영역 하한 */
  BE_PCT_MIN: -0.5,
  /** BE 영역 상한 */
  BE_PCT_MAX: 0.5,
} as const;

const WIN_RULE_TAGS = new Set(['TARGET_EXIT', 'EUPHORIA_PARTIAL']);
const BE_PROTECTION_RULE_TAGS = new Set(['ENTRY_CIRCUIT_BREAKER']);

export function isBreakEvenClassificationDisabled(): boolean {
  return process.env.BE_CLASSIFICATION_DISABLED === 'true';
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isInBeBand(pct: number): boolean {
  return pct >= EXIT_OUTCOME_THRESHOLDS.BE_PCT_MIN && pct <= EXIT_OUTCOME_THRESHOLDS.BE_PCT_MAX;
}

/**
 * 청산 결과 분류. 서킷 카운트·통계 등 모든 호출자가 단일 SSOT 사용.
 *
 * @param returnPct 실현 수익률 (%)
 * @param exitRuleTag ExitRuleTag — 'TARGET_EXIT' / 'HARD_STOP' / ...
 * @param stopLossExitType ServerShadowTrade.stopLossExitType — PROFIT_PROTECTION 식별용
 */
export function classifyExitOutcome(
  returnPct: number,
  exitRuleTag?: string,
  stopLossExitType?: string,
): ExitOutcome {
  // (1) ENV 우회 — 기존 동작
  if (isBreakEvenClassificationDisabled()) {
    if (!isFiniteNumber(returnPct)) return 'LOSS';
    return returnPct >= EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN ? 'WIN' : 'LOSS';
  }

  // (2) NaN/Infinity 안전 fallback → LOSS (서킷 보수적)
  if (!isFiniteNumber(returnPct)) return 'LOSS';

  // (3) 명시 WIN 룰
  if (exitRuleTag && WIN_RULE_TAGS.has(exitRuleTag)) return 'WIN';

  // (4) PROFIT_PROTECTION + BE band → BE (1차 로그 시나리오 핵심)
  if (stopLossExitType === 'PROFIT_PROTECTION' && isInBeBand(returnPct)) return 'BE';

  // (5) ENTRY_CIRCUIT_BREAKER 초기 진입 가드 + BE band → BE
  if (exitRuleTag && BE_PROTECTION_RULE_TAGS.has(exitRuleTag) && isInBeBand(returnPct)) return 'BE';

  // (6) 명백 WIN
  if (returnPct >= EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN) return 'WIN';

  // (7) BE band 휴리스틱 (룰 미명시여도 등락이 본절 영역이면 BE)
  if (isInBeBand(returnPct)) return 'BE';

  // (8) 명백 LOSS
  if (returnPct < EXIT_OUTCOME_THRESHOLDS.LOSS_PCT_MAX) return 'LOSS';

  // (9) +0.5 < returnPct < +1.0 — 보수적 LOSS (표본 미달)
  return 'LOSS';
}

/**
 * fill-level 휴리스틱 분류 (aggregateFillStats 용).
 * fill 에는 exitRuleTag 가 없으므로 pnlPct 만 사용.
 */
export function classifyFillOutcome(pnlPct: number): ExitOutcome {
  if (isBreakEvenClassificationDisabled()) {
    if (!isFiniteNumber(pnlPct)) return 'LOSS';
    return pnlPct > 0 ? 'WIN' : pnlPct < 0 ? 'LOSS' : 'BE';
  }
  if (!isFiniteNumber(pnlPct)) return 'LOSS';
  if (pnlPct >= EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN) return 'WIN';
  if (isInBeBand(pnlPct)) return 'BE';
  return 'LOSS';
}
