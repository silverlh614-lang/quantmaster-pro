// @responsibility Yahoo 재검증 가용성 게이트 — reCheckGate=null 시 진입 보류 RevalidationStep

import type { RevalidationStepResult } from './types.js';

export interface YahooAvailabilityStepInput {
  stockName: string;
  reCheckGate: object | null;
}

/**
 * ADR-0031 PR-61 — 라인 734-741 의 Yahoo 가용성 분기를 byte-equivalent 로 추출.
 *
 * BUG-02 fix: Yahoo 실패 시 MTAS 검증 우회 방지 — reCheckGate=null 이면 진입 보류.
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.warn(result.logMessage)
 *   - scanCounters.yahooFails++
 *   - stageLog.gate = 'FAIL(yahoo_unavailable)'
 *   - pushTrace()
 */
export function yahooAvailabilityStep(
  input: YahooAvailabilityStepInput,
): RevalidationStepResult {
  if (input.reCheckGate) {
    return { proceed: true };
  }
  return {
    proceed: false,
    logMessage: `[AutoTrade] ${input.stockName} Yahoo 조회 실패 — 재검증 불가, 진입 보류`,
    failReasons: ['yahoo_unavailable'],
    stageLogValue: 'FAIL(yahoo_unavailable)',
  };
}
