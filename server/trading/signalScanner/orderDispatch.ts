/**
 * @responsibility 실 KIS 주문 발송 — operation_id 멱등성·autoTradeEngine 게이트·channelBuySignalEmitted
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 실 주문 발송 단계. 본 모듈은 자동매매 사고
 * 회고(post-mortem) 시 단일 SSOT 가 되는 가장 민감한 경계다.
 *
 * 절대 규칙 #2 준수: KIS API 호출은 `server/clients/kisClient.ts` 경유만 허용.
 * 절대 규칙 #4 준수: AUTO_TRADE_ENABLED=true LIVE 실주문은 autoTradeEngine 단일 통로.
 *
 * 본 모듈 책임:
 *   - createBuyTask 의 onApproved 콜백 빌더 (Phase 3 에서 buyPipeline 위임 분리)
 *   - operation_id 멱등성 키 발급·체크섬
 *   - channelBuySignalEmitted 정확히 1회 송출 보장 (APPROVE 당 1회)
 *   - recordUniverseEntries (Universe A/B/C 가상체결 학습 기록)
 *   - trancheExecutor.scheduleTranches (STRONG_BUY 분할 매수)
 *   - shadows.push(t) / orderableCash 차감 (LIVE/Shadow 분기)
 *
 * 본 모듈이 하지 않는 것:
 *   - 큐 자체 관리 (approvalQueue)
 *   - 종목별 사전 평가 (perSymbolEvaluation)
 *   - 매크로 게이팅 (preflight)
 */

export interface OrderDispatchInput {
  /** Phase 3 에서 EvaluatedSymbol payload 로 교체. */
  payload: unknown;
  shadowMode: boolean;
  isMomentumShadow: boolean;
}

export interface OrderDispatchOutcome {
  /** APPROVE 처리 후 실제 주문 발송 여부. SHADOW 모드는 가상체결 기록만. */
  dispatched: boolean;
  /** 멱등성 키 — 동일 키로 재호출 시 KIS POST 가 중복 발송되지 않아야 한다. */
  operationId: string;
}

/**
 * onApproved 콜백 빌더. approvalQueue 가 createBuyTask 호출 시 본 함수의 반환값을
 * onApproved 로 주입한다. 콜백 내부는 channelBuySignalEmitted / recordUniverseEntries /
 * trancheExecutor 를 정확히 1회 호출하는 SSOT 다.
 */
export function buildOnApprovedCallback(
  _input: OrderDispatchInput,
): (trade: unknown) => Promise<void> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — orderDispatch)',
  );
}

/**
 * 실 KIS 주문 발송 진입점 — 멱등성 키 검증 후 buyPipeline 의 createBuyTask.execute 위임.
 * Phase 3 에서 onApproved 콜백 본체를 본 함수로 통합 가능성 검토.
 */
export async function dispatchOrder(
  _input: OrderDispatchInput,
): Promise<OrderDispatchOutcome> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — orderDispatch)',
  );
}
