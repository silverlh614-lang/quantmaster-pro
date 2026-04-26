// @responsibility operatorOverride 텔레그램 모듈
/**
 * operatorOverride.ts — Telegram 인라인 버튼(빈 스캔 Decision Broker) 콜백 처리
 *
 * callback_data 포맷: "op_override:<ACTION>:<nonce>"
 *   ACTION ∈ { EXPAND_UNIVERSE, RELAX_THRESHOLD, HOLD }
 *
 * webhookHandler.ts에서 buyApproval 다음 순서로 라우팅된다 — prefix 매칭으로 충돌 없음.
 * 실제 액션 실행은 overrideExecutor에 위임. 이 모듈은 어댑터 역할만 한다.
 */

import {
  answerCallbackQuery,
  editMessageText,
} from '../alerts/telegramClient.js';
import { executeOverride } from '../orchestrator/overrideExecutor.js';
import type { OverrideAction } from '../persistence/overrideLedger.js';

const PREFIX = 'op_override:';

/**
 * Telegram callback_query 핸들러. buyApproval과 동일한 리턴 convention을 따른다.
 * @returns true = 이 모듈이 처리함, false = 다른 핸들러로 위임
 */
export async function handleOperatorOverrideCallback(
  callbackQueryId: string,
  data: string,
  messageId: number | undefined,
): Promise<boolean> {
  if (!data.startsWith(PREFIX)) return false;

  const [, actionRaw] = data.split(':');
  const validActions: OverrideAction[] = ['EXPAND_UNIVERSE', 'RELAX_THRESHOLD', 'HOLD'];
  if (!validActions.includes(actionRaw as OverrideAction)) {
    await answerCallbackQuery(callbackQueryId, '알 수 없는 오버라이드 액션입니다.');
    return true;
  }
  const action = actionRaw as OverrideAction;

  const result = await executeOverride({
    action,
    context: 'telegram_empty_scan_broker',
    source: 'telegram:callback',
  });

  // 인라인 키보드를 비워(버튼 제거) 결과만 남긴다 — 중복 탭 방지
  if (messageId !== undefined) {
    await editMessageText(
      messageId,
      `${result.summary}\n\n<i>action=${action} · status=${result.status}</i>`,
    ).catch((e: unknown) => {
      console.error('[OperatorOverride] editMessageText 실패:', e instanceof Error ? e.message : e);
    });
  }

  // answerCallbackQuery — 토스트는 짧게
  const toast =
    result.status === 'APPLIED' ? '✅ 적용'
    : result.status === 'REJECTED' ? '🛑 거부'
    : '⏸ 관망';
  await answerCallbackQuery(callbackQueryId, toast);

  console.log(
    `[OperatorOverride] ${action} → ${result.status} (${result.summary})`,
  );
  return true;
}
