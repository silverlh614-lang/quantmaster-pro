// @responsibility RevalidationStep mutating pipeline 시그니처 SSOT (ADR-0031)

/**
 * RevalidationStep 패턴 — EntryGate 와 달리 staging 컨텍스트를 점진적으로
 * 검증·mutate 하는 단계. 본 PoC 에서는 동기 step 만 다루지만 후속 PR 에서
 * async union 으로 확장 가능하다.
 *
 * 원칙:
 *  - step 자체는 외부 mutation·부수효과(console.log/scanCounters++/pushTrace) 0건
 *  - fail 시 diagnostic(메시지 / failReasons / stageLog 값) 만 반환
 *  - caller (evaluateBuyList) 가 stock.entryFailCount, watchlistMutated,
 *    scanCounters[counter]++, stageLog 갱신, pushTrace, counterfactual 기록을 일괄 적용
 *  - 이로써 step 단위 테스트가 외부 mock 0건으로 가능
 */

export interface RevalidationStepFail {
  proceed: false;
  /** caller 가 그대로 console.log 로 출력할 한 줄 메시지. */
  logMessage: string;
  /** counterfactual skipReason 합성용 사유 배열. */
  failReasons: string[];
  /** stageLog.gate 에 기록될 값 (예: "FAIL(reason1,reason2)"). */
  stageLogValue: string;
}

export interface RevalidationStepPass {
  proceed: true;
}

export type RevalidationStepResult = RevalidationStepPass | RevalidationStepFail;
