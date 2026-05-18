// @responsibility webhookHandler 텔레그램 모듈
// server/telegram/webhookHandler.ts
// Telegram 양방향 봇 Webhook 라우터 — POST /api/telegram/webhook.
//
// ADR-0017 Stage 2 Phase A+B1+B2+B3 — 모든 명령어는 commands/*/*.cmd.ts 로 분리되어
// commandRegistry 에 자동 등록된다. 본 파일은 callback_query 4-prefix 라우팅 + /help
// + 메타 명령어 6종 + commandRegistry 위임 + 알 수 없는 명령 fallback 만 담당한다.
import { Request, Response } from 'express';
import { sendTelegramAlert, answerCallbackQuery } from '../alerts/telegramClient.js';
import { handleBuyApprovalCallback } from './buyApproval.js';
import { handleOperatorOverrideCallback } from './operatorOverride.js';
import { handleT1AckCallback } from '../alerts/ackTracker.js';
import { type InlineKeyboardMarkup } from './metaCommands.js';
import { dispatchTelegramCommand } from './commandRouter.js';
import { dispatchTelegramCallback } from './callbackRouter.js';
// commands/* barrel side-effect — 모든 .cmd.ts 가 commandRegistry.register 자기 호출.
import './commands/system/index.js';
import './commands/watchlist/index.js';
import './commands/positions/index.js';
import './commands/alert/index.js';
import './commands/learning/index.js';
import './commands/control/index.js';
import './commands/trade/index.js';
import './commands/infra/index.js';
import './commands/shadow/index.js';

export async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  res.sendStatus(200); // Telegram에 즉시 200 응답 (재전송 방지)

  // ── callback_query 처리 (인라인 키보드 버튼 클릭) ──────────────────────────
  const callbackQuery = req.body?.callback_query;
  if (callbackQuery) {
    const cbChatId = String(callbackQuery.message?.chat?.id ?? '');
    const allowedId = process.env.TELEGRAM_CHAT_ID ?? '';
    if (allowedId && cbChatId !== allowedId) return;

    const callbackQueryId = callbackQuery.id;
    const data = callbackQuery.data ?? '';
    const messageId = callbackQuery.message?.message_id as number | undefined;

    // 매수 승인 → T1 ACK → 운용자 오버라이드 순으로 라우팅 (prefix 매칭으로 충돌 없음)
    const buyHandled = await handleBuyApprovalCallback(callbackQueryId, data).catch(() => false);
    if (buyHandled) return;

    const ackHandled = await handleT1AckCallback(callbackQueryId, data).catch((e: unknown) => {
      console.error('[TelegramBot] T1 ACK 처리 실패:', e instanceof Error ? e.message : e);
      return false;
    });
    if (ackHandled) return;

    const overrideHandled = await handleOperatorOverrideCallback(callbackQueryId, data, messageId)
      .catch((e: unknown) => {
        console.error('[TelegramBot] operator override 처리 실패:', e instanceof Error ? e.message : e);
        return false;
      });
    if (overrideHandled) return;

    // 버튼 callback 은 callbackRouter 에서만 처리한다. 텍스트 명령은 아래 commandRouter 로 분리.
    const callbackReply = async (message: string, replyMarkup?: InlineKeyboardMarkup) => {
      const opts = replyMarkup
        ? { replyMarkup: replyMarkup as unknown as Record<string, unknown> }
        : undefined;
      await sendTelegramAlert(message, opts).catch(console.error);
    };
    const callbackHandled = await dispatchTelegramCallback({ data, reply: callbackReply }).catch((e: unknown) => {
      console.error('[TelegramBot] callback router 처리 실패:', e instanceof Error ? e.message : e);
      return false;
    });
    if (callbackHandled) {
      await answerCallbackQuery(callbackQueryId, '실행 완료').catch((e: unknown) => {
        console.error('[TelegramBot] callback ack 실패:', e instanceof Error ? e.message : e);
      });
      return;
    }

    await answerCallbackQuery(callbackQueryId, '알 수 없는 버튼입니다.');
    return;
  }

  // ── 일반 메시지 명령어 처리 ────────────────────────────────────────────────
  const msg = req.body?.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat?.id ?? '');
  const allowedId = process.env.TELEGRAM_CHAT_ID ?? '';
  // 등록된 채팅방만 허용 (타인의 봇 접근 차단)
  if (allowedId && chatId !== allowedId) {
    console.warn(`[TelegramBot] 허가되지 않은 채팅 ID: ${chatId}`);
    return;
  }

  const text: string = msg.text;
  const userId = msg.from?.id ? String(msg.from.id) : undefined;

  const reply = async (message: string, replyMarkup?: InlineKeyboardMarkup) => {
    // sendTelegramAlert 는 replyMarkup 을 Record<string, unknown> 으로 받기 때문에
    // InlineKeyboardMarkup 을 unknown 경유로 전달한다 (구조 동일).
    const opts = replyMarkup
      ? { replyMarkup: replyMarkup as unknown as Record<string, unknown> }
      : undefined;
    await sendTelegramAlert(message, opts).catch(console.error);
  };

  try {
    await dispatchTelegramCommand({
      rawText: text,
      chatId,
      userId,
      reply,
    });
  } catch (e) {
    console.error('[TelegramBot] 명령 처리 실패:', e);
  }
}
