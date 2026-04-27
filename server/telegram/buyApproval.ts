// @responsibility buyApproval 텔레그램 모듈
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
  escapeHtml,
} from '../alerts/telegramClient.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';
import { formatEnemyCheckSummary, type EnemyCheckResult } from '../clients/enemyCheckClient.js';
import type { RegimeLevel } from '../../src/types/core.js';

/** 자동 승인까지 대기 시간 (ms) — 기본(레짐 미지정 시) 3분 */
const AUTO_APPROVE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * 레짐별 자동 승인 타임아웃 (ms).
 *   R1 TURBO   — 빠른 체결이 생명 (1분)
 *   R2 BULL    — 1.5분
 *   R3 EARLY   — 2분
 *   R4 NEUTRAL — 3분 (기존 고정값)
 *   R5 CAUTION — 신중하게 5분
 *   R6 DEFENSE — 자동 승인 없음(수동만) — 사실상 무제한이지만 R6는 상위 레이어에서 매수가 차단되므로 안전
 */
const TIMEOUT_BY_REGIME: Record<RegimeLevel, number> = {
  R1_TURBO:    60_000,
  R2_BULL:     90_000,
  R3_EARLY:   120_000,
  R4_NEUTRAL: 180_000,
  R5_CAUTION: 300_000,
  R6_DEFENSE:      0,  // 0 = 자동 승인 비활성 (수동 승인만 허용)
};

/** 레짐별 타임아웃 조회. 미전달·미지원 레짐 → 기본 3분. */
export function getAutoApproveTimeoutMs(regime?: string): number {
  if (!regime) return AUTO_APPROVE_TIMEOUT_MS;
  const v = TIMEOUT_BY_REGIME[regime as RegimeLevel];
  return v === undefined ? AUTO_APPROVE_TIMEOUT_MS : v;
}

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
  /** 역검증 참고 데이터 — 자동 감점/차단 없이 표시만 함 */
  enemyCheck?: EnemyCheckResult | null;
  /** 레짐별 가변 타임아웃 결정용. 미전달 시 기본 3분. */
  regime?: string;
  /** 매수 실패 시나리오 사전 체크리스트(Gemini Pre-Mortem). 있으면 메시지에 표시. */
  preMortem?: string | null;
}): Promise<ApprovalAction> {
  const {
    tradeId, stockCode, stockName,
    currentPrice, quantity, stopLoss, targetPrice, mode, gateScore, enemyCheck,
    regime, preMortem,
  } = params;

  const modeEmoji = mode === 'LIVE' ? '🔴' : '⚡';
  const modeLabel = mode === 'LIVE' ? 'LIVE' : 'Shadow';
  const rrrRatio = ((targetPrice - currentPrice) / (currentPrice - stopLoss)).toFixed(1);
  const timeoutMs = getAutoApproveTimeoutMs(regime);
  const autoApproveDisabled = timeoutMs === 0;
  const timeoutSec = Math.round(timeoutMs / 1000);

  // 역검증 섹션 (데이터 있을 때만 표시)
  const enemySummary = enemyCheck ? formatEnemyCheckSummary(enemyCheck) : null;
  const enemySection = enemySummary
    ? `━━━━━━━━━━━━━━━━\n<i>[역검증 참고]\n${escapeHtml(enemySummary)}</i>\n`
    : '';

  // Pre-Mortem 섹션 (진입 전 실패 시나리오 사전 체크리스트)
  const preMortemSection = preMortem
    ? `━━━━━━━━━━━━━━━━\n⚠️ <b>실패 시나리오(Pre-Mortem)</b>\n${escapeHtml(preMortem)}\n`
    : '';

  const timeoutLine = autoApproveDisabled
    ? `<i>🛑 자동 승인 비활성 (레짐 ${escapeHtml(regime ?? '')}) — 수동 승인 필수</i>`
    : `<i>${timeoutSec}초 내 미응답 시 자동 승인${regime ? ` (레짐 ${escapeHtml(regime)})` : ''}</i>`;

  const message =
    `${modeEmoji} <b>[${modeLabel}] ${escapeHtml(stockName)} 매수 신호</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `현재가: ${currentPrice.toLocaleString()}원 × ${quantity}주\n` +
    `손절: ${stopLoss.toLocaleString()}원 | 목표: ${targetPrice.toLocaleString()}원\n` +
    `RRR: ${rrrRatio} | Gate: ${gateScore ?? 'N/A'}\n` +
    `${enemySection}` +
    `${preMortemSection}` +
    `━━━━━━━━━━━━━━━━\n` +
    timeoutLine;

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
    // R6 등 타임아웃 0 → 자동 승인 비활성. 타이머 생성하지 않고 수동 승인만 대기.
    const timer = autoApproveDisabled
      ? (setTimeout(() => { /* no-op */ }, 0) as ReturnType<typeof setTimeout>)
      : setTimeout(async () => {
          const pending = pendingApprovals.get(tradeId);
          if (!pending) return;
          pendingApprovals.delete(tradeId);

          // 자동 승인 시 메시지 업데이트
          await editMessageText(
            msgId,
            message.replace(
              timeoutLine,
              `✅ <b>자동 승인 (${timeoutSec}초 타임아웃)</b>`,
            ),
          );

          console.log(`[BuyApproval] 자동 승인 (타임아웃): ${stockName} — ${timeoutSec}초`);
          resolve('APPROVE');
        }, timeoutMs);

    if (autoApproveDisabled) clearTimeout(timer);

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
    `${actionEmoji} <b>[${escapeHtml(pending.stockName)}] ${actionLabel} 처리됨</b>\n` +
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

/** UI용 대기 승인 목록 — 민감 정보 없이 스냅샷만 반환. */
export function listPendingApprovals(): Array<{
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  createdAt: number;
  ageMs: number;
}> {
  const now = Date.now();
  return Array.from(pendingApprovals.values()).map((p) => ({
    tradeId: p.tradeId,
    stockCode: p.stockCode,
    stockName: p.stockName,
    currentPrice: p.currentPrice,
    quantity: p.quantity,
    stopLoss: p.stopLoss,
    targetPrice: p.targetPrice,
    createdAt: p.createdAt,
    ageMs: now - p.createdAt,
  }));
}

/**
 * UI(관제실)에서 승인/거부 버튼을 눌렀을 때 호출되는 외부 resolver.
 * 텔레그램 callback 과 동일 경로를 거친다 — 타이머 정리 + pending 맵 제거.
 * @returns resolved 여부 (false = 이미 만료/처리됨)
 */
export async function resolvePendingApproval(
  tradeId: string,
  action: ApprovalAction,
  source: 'UI' | 'TELEGRAM' = 'UI',
): Promise<boolean> {
  const pending = pendingApprovals.get(tradeId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingApprovals.delete(tradeId);

  const actionLabel = action === 'APPROVE' ? '✅ 승인' : action === 'REJECT' ? '❌ 거부' : '⏸ 스킵';
  const actionEmoji = action === 'APPROVE' ? '✅' : action === 'REJECT' ? '❌' : '⏸';

  // 텔레그램 원본 메시지 업데이트 — 실패해도 UI 경로는 계속.
  await editMessageText(
    pending.messageId,
    `${actionEmoji} <b>[${escapeHtml(pending.stockName)}] ${actionLabel} (${source}) 처리됨</b>\n` +
    `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주`,
  ).catch(() => { /* 원본 메시지 편집 실패는 치명적이지 않음 */ });

  console.log(`[BuyApproval/${source}] ${actionLabel}: ${pending.stockName} (${pending.stockCode})`);
  pending.resolve(action);
  return true;
}
