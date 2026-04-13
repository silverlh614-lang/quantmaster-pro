/**
 * buyApproval.ts — 매수 신호 인라인 키보드 승인/거부/스킵 처리
 *
 * 매수 신호 발생 시 텔레그램 인라인 버튼을 표시하고,
 * 일정 시간(AUTO_APPROVE_TIMEOUT) 내 응답 없으면 자동 승인 처리.
 *
 * 버튼 구성:
 *   [✅ 승인]  [❌ 거부]  [⏸ 스킵]
 */

import {
  sendTelegramAlert,
  answerCallbackQuery,
  editMessageText,
} from '../alerts/telegramClient.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

/** 자동 승인까지 대기 시간 (ms) — 기본 3분 */
const AUTO_APPROVE_TIMEOUT_MS = 3 * 60 * 1000;

export type ApprovalAction = 'APPROVE' | 'REJECT' | 'SKIP';

interface PendingApproval {
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  messageId: number;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (action: ApprovalAction) => void;
}

/** 대기 중인 승인 요청 (tradeId → PendingApproval) */
const pendingApprovals = new Map<string, PendingApproval>();

/**
 * 매수 신호 알림을 인라인 키보드와 함께 전송하고, 사용자 응답을 기다린다.
 * timeout 내 응답 없으면 자동 승인.
 *
 * @returns 'APPROVE' | 'REJECT' | 'SKIP'
 */
export async function requestBuyApproval(params: {
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  mode: 'LIVE' | 'SHADOW';
  gateScore?: number;
}): Promise<ApprovalAction> {
  const {
    tradeId, stockCode, stockName,
    currentPrice, quantity, stopLoss, targetPrice, mode, gateScore,
  } = params;

  const modeEmoji = mode === 'LIVE' ? '🔴' : '⚡';
  const modeLabel = mode === 'LIVE' ? 'LIVE' : 'Shadow';
  const rrrRatio = ((targetPrice - currentPrice) / (currentPrice - stopLoss)).toFixed(1);
  const timeoutSec = Math.round(AUTO_APPROVE_TIMEOUT_MS / 1000);

  const message =
    `${modeEmoji} <b>[${modeLabel}] ${stockName} 매수 신호</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `현재가: ${currentPrice.toLocaleString()}원 × ${quantity}주\n` +
    `손절: ${stopLoss.toLocaleString()}원 | 목표: ${targetPrice.toLocaleString()}원\n` +
    `RRR: ${rrrRatio} | Gate: ${gateScore ?? 'N/A'}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>${timeoutSec}초 내 미응답 시 자동 승인</i>`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ 승인', callback_data: `buy_approve:${tradeId}` },
      { text: '❌ 거부', callback_data: `buy_reject:${tradeId}` },
      { text: '⏸ 스킵', callback_data: `buy_skip:${tradeId}` },
    ]],
  };

  const msgId = await sendTelegramAlert(message, {
    priority: 'HIGH',
    dedupeKey: `buy_approval:${stockCode}`,
    replyMarkup,
  });

  if (!msgId) {
    // 메시지 전송 실패 시 자동 승인
    console.warn(`[BuyApproval] 메시지 전송 실패 — 자동 승인: ${stockName}`);
    return 'APPROVE';
  }

  return new Promise<ApprovalAction>((resolve) => {
    const timer = setTimeout(async () => {
      const pending = pendingApprovals.get(tradeId);
      if (!pending) return;
      pendingApprovals.delete(tradeId);

      // 자동 승인 시 메시지 업데이트
      await editMessageText(
        msgId,
        message.replace(
          `<i>${timeoutSec}초 내 미응답 시 자동 승인</i>`,
          `✅ <b>자동 승인 (${timeoutSec}초 타임아웃)</b>`,
        ),
      );

      console.log(`[BuyApproval] 자동 승인 (타임아웃): ${stockName}`);
      resolve('APPROVE');
    }, AUTO_APPROVE_TIMEOUT_MS);

    pendingApprovals.set(tradeId, {
      tradeId,
      stockCode,
      stockName,
      currentPrice,
      quantity,
      stopLoss,
      targetPrice,
      messageId: msgId,
      createdAt: Date.now(),
      timer,
      resolve,
    });
  });
}

/**
 * Telegram callbackQuery 처리 — 인라인 키보드 버튼 클릭 시 호출.
 * webhookHandler.ts에서 callback_query를 감지하여 이 함수로 라우팅.
 *
 * @returns true if handled, false if not a buy approval callback
 */
export async function handleBuyApprovalCallback(
  callbackQueryId: string,
  data: string,
): Promise<boolean> {
  if (!data.startsWith('buy_approve:') && !data.startsWith('buy_reject:') && !data.startsWith('buy_skip:')) {
    return false;
  }

  const [actionStr, tradeId] = data.split(':');
  const actionMap: Record<string, ApprovalAction> = {
    buy_approve: 'APPROVE',
    buy_reject: 'REJECT',
    buy_skip: 'SKIP',
  };
  const action = actionMap[actionStr];
  if (!action || !tradeId) {
    await answerCallbackQuery(callbackQueryId, '잘못된 요청입니다.');
    return true;
  }

  const pending = pendingApprovals.get(tradeId);
  if (!pending) {
    await answerCallbackQuery(callbackQueryId, '이미 처리된 요청입니다.');
    return true;
  }

  // 타이머 정리 및 맵에서 제거
  clearTimeout(pending.timer);
  pendingApprovals.delete(tradeId);

  const actionLabel = action === 'APPROVE' ? '✅ 승인' : action === 'REJECT' ? '❌ 거부' : '⏸ 스킵';
  const actionEmoji = action === 'APPROVE' ? '✅' : action === 'REJECT' ? '❌' : '⏸';

  // 메시지 업데이트 (버튼 제거 + 결과 표시)
  await editMessageText(
    pending.messageId,
    `${actionEmoji} <b>[${pending.stockName}] ${actionLabel} 처리됨</b>\n` +
    `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주`,
  );

  await answerCallbackQuery(callbackQueryId, `${actionLabel} 완료`);
  console.log(`[BuyApproval] ${actionLabel}: ${pending.stockName} (${pending.stockCode})`);

  pending.resolve(action);
  return true;
}

/** 대기 중인 승인 요청 수 */
export function getPendingApprovalCount(): number {
  return pendingApprovals.size;
}

/** 특정 종목의 대기 중인 승인 있는지 확인 */
export function hasPendingApproval(stockCode: string): boolean {
  for (const [, p] of pendingApprovals) {
    if (p.stockCode === stockCode) return true;
  }
  return false;
}
