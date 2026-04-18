/**
 * sell/types.ts — Strategy Pattern 인터페이스
 *
 * 모든 매도 레이어는 SellLayer를 구현하며, SELL_LAYER_REGISTRY의 선언형 배열에
 * 한 줄 추가되는 것만으로 파이프라인에 편입된다. 오케스트레이터 본문은
 * 레이어 추가/제거 시에도 변경되지 않는다 (Open-Closed).
 */

import type { SellContext, SellSignal } from '../../../types/sell';

/**
 * 단일 매도 레이어 계약.
 *
 * priority    — 숫자 작을수록 먼저 실행 (L1=10, L3 익절=20, L3 trailing=25, L2=30, L4=40)
 * shortCircuit — 이 레이어가 반환한 신호 중 "즉시 중단" 조건을 만족하면 true.
 *                orchestrator는 true 반환 시 이후 레이어를 평가하지 않는다.
 *                predicate 형태라 레이어 내부에서 신호 종류에 따라 선택적 중단 가능
 *                (e.g., HARD_STOP은 중단, REVALIDATE_GATE1은 계속 진행).
 */
export interface SellLayer {
  id: string;
  priority: number;
  evaluate(ctx: SellContext): SellSignal[];
  shortCircuit(signals: SellSignal[]): boolean;
}
