// @responsibility 전량 청산 주문 실패 시 shadow 상태 스냅샷 롤백 헬퍼
/**
 * exitEngine/helpers/rollbackFullClose.ts — BUG #7 fix (ADR-0028).
 *
 * 기존 HARD_STOP / CASCADE_FINAL / TRAILING_PROTECTIVE / TARGET_EXIT / MA60_DEATH
 * 경로는 `updateShadow({status:'HIT_STOP'|'HIT_TARGET', quantity:0, …})` 를 주문
 * 접수 전에 실행해, 주문 접수 실패 시 "shadow DB = CLOSED, KIS 잔고 = OPEN" 의
 * 괴리가 발생했다 (naked position). 아래 두 함수로:
 *   1) updateShadow 전에 직전 상태 스냅샷을 캡처
 *   2) reserveSell.kind==='FAILED' 이면 상태를 되돌려 다음 스캔 사이클에서 규칙을 재평가
 */

import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import { appendShadowLog, updateShadow } from '../../../persistence/shadowTradeRepo.js';

export interface FullCloseSnapshot {
  status: ServerShadowTrade['status'];
  quantity: number;
  exitPrice?: number;
  exitTime?: string;
  exitRuleTag?: ServerShadowTrade['exitRuleTag'];
  stopLossExitType?: ServerShadowTrade['stopLossExitType'];
  ma60DeathForced?: boolean;
}

export function captureFullCloseSnapshot(shadow: ServerShadowTrade): FullCloseSnapshot {
  return {
    status: shadow.status,
    quantity: shadow.quantity,
    exitPrice: shadow.exitPrice,
    exitTime: shadow.exitTime,
    exitRuleTag: shadow.exitRuleTag,
    stopLossExitType: shadow.stopLossExitType,
    ma60DeathForced: shadow.ma60DeathForced,
  };
}

/**
 * 전량 청산 주문 실패 시 shadow 상태를 스냅샷 시점으로 되돌린다. 상태가 ACTIVE 등으로
 * 복원되면 다음 scan tick 에서 동일 exit 규칙이 재평가되어 자동 재시도가 된다.
 *
 * 본 함수는 "주문 실패 = 상태 변경 없음" 원칙을 exit 레이어에 강제한다.
 * CRITICAL 텔레그램 경보는 각 호출부가 기존 메시지 체계를 유지하고 본 함수는
 * 결과 로그 + ShadowLog audit 만 담당한다.
 */
export function rollbackFullCloseOnFailure(
  shadow: ServerShadowTrade,
  snap: FullCloseSnapshot,
  ruleName: string,
  failureReason: string,
): void {
  updateShadow(shadow, {
    status: snap.status,
    quantity: snap.quantity,
    exitPrice: snap.exitPrice,
    exitTime: snap.exitTime,
    exitRuleTag: snap.exitRuleTag,
    stopLossExitType: snap.stopLossExitType,
    ma60DeathForced: snap.ma60DeathForced,
  });
  appendShadowLog({
    event: 'FULL_CLOSE_ROLLBACK',
    code: shadow.stockCode,
    rule: ruleName,
    reason: failureReason,
    restoredStatus: snap.status,
    restoredQty: snap.quantity,
  });
  console.error(
    `[AutoTrade] 🚨 ${shadow.stockName} ${ruleName} 주문 실패 → shadow 상태 롤백 ` +
    `(status=${snap.status}, qty=${snap.quantity}) · 다음 스캔에서 자동 재시도`,
  );
}
