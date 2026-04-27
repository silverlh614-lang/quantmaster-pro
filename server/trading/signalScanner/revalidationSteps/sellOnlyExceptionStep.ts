// @responsibility SELL_ONLY 예외 채널의 liveGate/MTAS 추가 검증 RevalidationStep

import type { RevalidationStepResult } from './types.js';

export interface SellOnlyExceptionStepInput {
  stockName: string;
  sellOnlyExc: { allow: boolean; minLiveGate: number; minMtas: number };
  liveGateScore: number;
  mtas: number;
}

/**
 * ADR-0031 PR-61 — 라인 760-773 의 SELL_ONLY 예외 진입 차단 분기를 byte-equivalent 로 추출.
 *
 * Phase 2-③: SELL_ONLY 예외 채널이면 liveGate·MTAS 재검증 (4중 조건의 종목 측면).
 * sellOnlyExc.allow=false 시 통과 (게이트 비활성).
 *
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.log(result.logMessage)
 *   - continue (outer loop)
 */
export function sellOnlyExceptionStep(
  input: SellOnlyExceptionStepInput,
): RevalidationStepResult {
  const { sellOnlyExc, liveGateScore, mtas, stockName } = input;
  if (!sellOnlyExc.allow) {
    return { proceed: true };
  }
  if (liveGateScore < sellOnlyExc.minLiveGate) {
    return {
      proceed: false,
      logMessage: `[AutoTrade/SellOnlyExc] ${stockName} liveGate ${liveGateScore.toFixed(2)} < ${sellOnlyExc.minLiveGate} — 예외 진입 차단`,
      failReasons: [`sellonly_livegate_below(${liveGateScore.toFixed(2)})`],
      stageLogValue: `FAIL(sellonly_livegate:${liveGateScore.toFixed(2)})`,
    };
  }
  if (mtas < sellOnlyExc.minMtas) {
    return {
      proceed: false,
      logMessage: `[AutoTrade/SellOnlyExc] ${stockName} MTAS ${mtas.toFixed(1)} < ${sellOnlyExc.minMtas} — 예외 진입 차단`,
      failReasons: [`sellonly_mtas_below(${mtas.toFixed(1)})`],
      stageLogValue: `FAIL(sellonly_mtas:${mtas.toFixed(1)})`,
    };
  }
  return { proceed: true };
}
