// @responsibility SizingDecider 패턴 시그니처 SSOT — 수치 결정 산출 + 차단 가능 union (ADR-0031)

/**
 * SizingDecider 패턴 — EntryGate 와 달리 차단/통과 boolean 이 아니라 quantity·tier·kelly·stopLossPlan
 * 같은 **수치 결정**을 산출한다. Decider 가 실패 분기를 가질 수 있으므로 ok flag 로 차단 여부를 표현.
 *
 * 원칙:
 *  - decider 자체는 외부 mutation·부수효과(console.log/scanCounters++/외부 mutate) 0건
 *  - 결과는 ok=true 시 산출값 + 옵셔널 logMessages, ok=false 시 logMessage(차단 사유) 반환
 *  - caller (evaluateBuyList) 가 logMessages 출력·continue·다음 단계 진행을 일괄 적용
 *  - 단위 테스트가 외부 mock 0건으로 가능
 */

export interface SizingDeciderFail {
  ok: false;
  /** caller 가 그대로 console.log 로 출력할 한 줄 메시지. */
  logMessage: string;
}

export interface SizingDeciderPassBase {
  ok: true;
  /** 통과 시 caller 가 출력할 정보·경고 메시지 배열 (없으면 빈 배열). */
  logMessages: string[];
}
