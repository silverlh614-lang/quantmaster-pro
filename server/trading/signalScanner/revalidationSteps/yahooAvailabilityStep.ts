// @responsibility 시세(quote) 재검증 가용성 게이트 — reCheckGate=null 시 진입 보류 RevalidationStep

import type { RevalidationStepResult } from './types.js';

export interface YahooAvailabilityStepInput {
  stockName: string;
  reCheckGate: object | null;
}

/**
 * ADR-0031 PR-61 — 라인 734-741 의 재검증 quote 가용성 분기를 byte-equivalent 로 추출.
 *
 * BUG-02 fix: 재검증 quote 실패 시 MTAS 검증 우회 방지 — reCheckGate=null 이면 진입 보류.
 * ⚠️ 이름은 'yahoo' 이나 실제 재검증 quote 출처는 KIS(L1) 다 (ADR-0561/0563 KIS-primary
 *    burn-down 이후). stale 오칭으로, stageLog/라벨은 'quote' 로 정정됨(필드명 rename 은 후속).
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.warn(result.logMessage)
 *   - scanCounters.yahooFails++ (= quote 조회 실패 카운트, legacy 필드명)
 *   - stageLog.gate = 'FAIL(quote_unavailable)'
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
    logMessage: `[AutoTrade] ${input.stockName} 시세(quote) 조회 실패 — 재검증 불가, 진입 보류`,
    failReasons: ['quote_unavailable'],
    stageLogValue: 'FAIL(quote_unavailable)',
  };
}
