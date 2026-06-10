// @responsibility 시세(quote) 재검증 가용성 게이트 — reCheckGate=null 시 진입 보류 RevalidationStep

import type { RevalidationStepResult } from './types.js';

export interface QuoteAvailabilityStepInput {
  stockName: string;
  reCheckGate: object | null;
}

/**
 * ADR-0031 PR-61 — 라인 734-741 의 재검증 quote 가용성 분기를 byte-equivalent 로 추출.
 *
 * BUG-02 fix: 재검증 quote 실패 시 MTAS 검증 우회 방지 — reCheckGate=null 이면 진입 보류.
 * 구 yahooAvailabilityStep — 실제 재검증 quote 출처는 KIS(L1)라(ADR-0561/0563 burn-down)
 * stale 오칭을 quote 로 정정. 레거시 trace 의 'FAIL(yahoo*' 는 파서 dual-parse 로 호환.
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.warn(result.logMessage)
 *   - scanCounters.quoteFails++
 *   - stageLog.gate = 'FAIL(quote_unavailable)'
 *   - pushTrace()
 */
export function quoteAvailabilityStep(
  input: QuoteAvailabilityStepInput,
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
