/**
 * @responsibility 최종 승인된 주문 내역 로깅 및 사후 처리
 * (실제 KIS 실주문 발송은 approvalQueue 플러시 중 task.execute 내부에서 병렬/순차 완료됨)
 */
import type { LiveBuyTask } from '../buyPipeline.js';

export async function dispatchApprovedBuy(approvedTasks: LiveBuyTask[], context: any): Promise<void> {
  if (approvedTasks.length > 0) {
    console.log(`[AutoTrade] 승인 큐 플러시 및 KIS 실주문 발송 완료: 총 ${approvedTasks.length}건`);
  }
}