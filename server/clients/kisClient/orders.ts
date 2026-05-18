/**
 * @responsibility Backward-compatible KIS order facade over orderGateway.
 *
 * Public exports are preserved for existing trading modules, but raw KIS
 * request/response parsing now lives in orderGateway adapters/normalizers.
 */

import { sendTelegramAlert, escapeHtml } from '../../alerts/telegramClient.js';
import { getTradingMode } from '../../state.js';
import { KIS_IS_REAL } from './constants.js';
import {
  cancelOrder,
  submitBuyOrder,
  submitOcoOrder,
  submitSellOrder,
} from './orderGateway/kisOrderGateway.js';
import type { SellOrderResult } from './types.js';
import type { OrderGatewayResult } from './orderGateway/kisOrderTypes.js';

type SellReason = 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA' | 'FOMC_DAY_LIQUIDATION';

function isLiveOrderAllowed(): boolean {
  return KIS_IS_REAL && getTradingMode() === 'LIVE';
}

function reasonDisplay(reason: SellReason): { emoji: string; label: string } {
  const emoji =
    reason === 'STOP_LOSS' ? '🔴'
    : reason === 'TAKE_PROFIT' ? '🟢'
    : reason === 'EUPHORIA' ? '🌡️'
    : '📅';
  const label =
    reason === 'STOP_LOSS' ? '손절'
    : reason === 'TAKE_PROFIT' ? '익절'
    : reason === 'EUPHORIA' ? '과열부분매도'
    : 'FOMC 자동청산';
  return { emoji, label };
}

function gatewayFailureReason(result: OrderGatewayResult): string {
  switch (result.kind) {
    case 'SUBMITTED':
    case 'CANCEL_SUBMITTED':
      return 'SUBMITTED';
    case 'SKIPPED_KIS_NOT_CONFIGURED':
      return 'KIS_NOT_CONFIGURED';
    case 'REJECTED':
    case 'FAILED_RETRYABLE':
    case 'FAILED_FATAL':
    case 'CANCEL_FAILED':
      return result.reason;
  }
}

function sellResultFromGateway(result: OrderGatewayResult): SellOrderResult {
  if (result.kind === 'SUBMITTED') {
    return { ordNo: result.ordNo, placed: true, outcome: 'LIVE_ORDERED' };
  }
  return {
    ordNo: null,
    placed: false,
    outcome: 'LIVE_FAILED',
    failureReason: gatewayFailureReason(result),
  };
}

async function sendLiveSellFailureAlert(stockName: string, label: string, result: OrderGatewayResult): Promise<void> {
  await sendTelegramAlert(
    `🚨 <b>[긴급] ${escapeHtml(stockName)} ${escapeHtml(label)} 매도 실패!</b>\n` +
    `수동으로 즉시 매도하세요.\n` +
    `오류: ${escapeHtml(gatewayFailureReason(result))}`,
    { priority: 'CRITICAL' },
  ).catch(console.error);
}

export async function placeKisMarketBuyOrder(
  stockCode: string,
  quantity: number,
): Promise<string | null> {
  if (!isLiveOrderAllowed()) {
    console.log(
      `[AutoTrade BUY Shadow] ${stockCode} ${quantity}주 ` +
      `KIS_IS_REAL=${KIS_IS_REAL} mode=${getTradingMode()} 실주문 차단`,
    );
    return null;
  }

  const result = await submitBuyOrder({
    stockCode,
    quantity,
    orderType: 'MARKET',
  });
  return result.kind === 'SUBMITTED' ? result.ordNo : null;
}

export async function placeKisSellOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  reason: SellReason,
): Promise<SellOrderResult> {
  const { emoji, label } = reasonDisplay(reason);

  if (!isLiveOrderAllowed()) {
    console.log(
      `[AutoTrade SELL Shadow] ${emoji} ${stockName}(${stockCode}) ${label} — ${quantity}주 ` +
      `(Shadow 모드, 실주문 없음, mode=${getTradingMode()})`,
    );
    await sendTelegramAlert(
      `${emoji} <b>[SHADOW ${escapeHtml(label)}] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `수량: ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실제 계좌 주문 아님`,
    ).catch(console.error);
    return { ordNo: null, placed: false, outcome: 'SHADOW_ONLY' };
  }

  console.log(`[AutoTrade SELL] ${emoji} ${stockName}(${stockCode}) ${label} 매도 주문 — ${quantity}주`);
  const result = await submitSellOrder({
    stockCode,
    stockName,
    quantity,
    orderType: 'MARKET',
    reason,
  });

  if (result.kind !== 'SUBMITTED') {
    await sendLiveSellFailureAlert(stockName, label, result);
    return sellResultFromGateway(result);
  }

  console.log(`[AutoTrade SELL] ${emoji} ${stockName} ${label} 완료 — ODNO: ${result.ordNo}`);
  await sendTelegramAlert(
    `${emoji} <b>[${escapeHtml(label)}] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
    `수량: ${quantity}주 | 주문번호: ${escapeHtml(result.ordNo)}`,
  ).catch(console.error);

  return sellResultFromGateway(result);
}

export async function placeKisStopLossLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  stopPrice: number,
): Promise<string | null> {
  if (!isLiveOrderAllowed()) {
    console.log(
      `[StopLoss OCO] ${stockName}(${stockCode}) 손절 지정가 ${stopPrice.toLocaleString()}원 × ${quantity}주 ` +
      `(Shadow 모드, mode=${getTradingMode()})`,
    );
    await sendTelegramAlert(
      `🛑 <b>[SHADOW 손절 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실제 계좌 주문 아님`,
    ).catch(console.error);
    return null;
  }

  const result = await submitOcoOrder({
    stockCode,
    stockName,
    quantity,
    leg: 'STOP_LOSS',
    triggerPrice: stopPrice,
  });

  if (result.kind !== 'SUBMITTED') {
    await sendLiveSellFailureAlert(stockName, '손절 주문 등록', result);
    return null;
  }

  await sendTelegramAlert(
    `🛑 <b>[손절 주문 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
    `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주\n` +
    `주문번호: ${escapeHtml(result.ordNo)}`,
  ).catch(console.error);
  return result.ordNo;
}

export async function placeKisTakeProfitLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  targetPrice: number,
): Promise<string | null> {
  if (!isLiveOrderAllowed()) {
    console.log(
      `[TakeProfit OCO] ${stockName}(${stockCode}) 익절 지정가 ${targetPrice.toLocaleString()}원 × ${quantity}주 ` +
      `(Shadow 모드, mode=${getTradingMode()})`,
    );
    await sendTelegramAlert(
      `🎯 <b>[SHADOW 익절 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `익절가: ${targetPrice.toLocaleString()}원 × ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실제 계좌 주문 아님`,
    ).catch(console.error);
    return null;
  }

  const result = await submitOcoOrder({
    stockCode,
    stockName,
    quantity,
    leg: 'TAKE_PROFIT',
    triggerPrice: targetPrice,
  });

  if (result.kind !== 'SUBMITTED') {
    await sendLiveSellFailureAlert(stockName, '익절 주문 등록', result);
    return null;
  }

  await sendTelegramAlert(
    `🎯 <b>[익절 주문 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
    `익절가: ${targetPrice.toLocaleString()}원 × ${quantity}주\n` +
    `주문번호: ${escapeHtml(result.ordNo)}`,
  ).catch(console.error);
  return result.ordNo;
}

export async function cancelKisOrder(
  stockCode: string,
  ordNo: string,
  quantity: number,
): Promise<boolean> {
  if (!isLiveOrderAllowed()) return false;
  const result = await cancelOrder({
    stockCode,
    ordNo,
    quantity,
  });
  if (result.kind === 'CANCEL_SUBMITTED') {
    console.log(`[KIS] 주문 취소 접수: ${stockCode} ODNO=${ordNo}`);
    return true;
  }
  console.error(`[KIS] 주문 취소 실패 ODNO=${ordNo}: ${gatewayFailureReason(result)}`);
  return false;
}
