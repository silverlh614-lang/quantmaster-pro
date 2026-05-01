/**
 * @responsibility KIS 실주문 발송 — 시장가/지정가 매수·매도·손절·익절·취소
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 주문 격리.
 * 모든 함수가 isLiveOrderAllowed() 가드 + Shadow 모드에서 실주문 차단.
 * KIS_IS_REAL=true + getTradingMode()='LIVE' 둘 다 충족할 때만 실주문 송신.
 */

import { sendTelegramAlert, escapeHtml } from '../../alerts/telegramClient.js';
import { getTradingMode } from '../../state.js';
import { KIS_IS_REAL, BUY_TR_ID, SELL_TR_ID } from './constants.js';
import { kisPost } from './http.js';

// 실주문 송신 허용 조건 — 실 서버 키 + 런타임 모드 LIVE 가 모두 참이어야 한다.
// killSwitch 가 런타임에서 SHADOW 로 강등하거나 env 에 AUTO_TRADE_MODE=SHADOW 가
// 걸려 있는 경우, KIS_IS_REAL=true 여도 실TR 을 송신하면 안 된다.
function isLiveOrderAllowed(): boolean {
  return KIS_IS_REAL && getTradingMode() === 'LIVE';
}

// ─── 실제 KIS 매도 주문 ─────────────────────────────────────────────────────
/**
 * KIS 현금 시장가 매수 주문 (서버 자동매매 전용).
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisMarketBuyOrder(
  stockCode: string,
  quantity: number,
): Promise<string | null> {
  // Shadow 모드 방어막 — buyPipeline 이 이미 shadowMode 분기를 처리하지만,
  // 런타임 강등(killSwitch)·env 불일치(KIS_IS_REAL=true + AUTO_TRADE_MODE=SHADOW)
  // 상황에서 실TR 이 송신되는 것을 최종 차단한다.
  if (!isLiveOrderAllowed()) {
    console.warn(
      `[AutoTrade BUY Shadow] 🟡 ${stockCode} ${quantity}주 — ` +
      `KIS_IS_REAL=${KIS_IS_REAL} mode=${getTradingMode()} → 실주문 차단`,
    );
    return null;
  }

  const orderData = await kisPost(BUY_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
    CANO:            process.env.KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
    PDNO:            stockCode.padStart(6, '0'),
    ORD_DVSN:        '01',  // 시장가
    ORD_QTY:         quantity.toString(),
    ORD_UNPR:        '0',
    SLL_BUY_DVSN_CD: '02',
    CTAC_TLNO:       '',
    MGCO_APTM_ODNO:  '',
    ORD_SVR_DVSN_CD: '0',
  });
  return (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
}

// ADR-0135: SellOrderOutcome / SellOrderResult 타입 정의는 ./types.ts (도메인 SSOT) 로 이주.
import type { SellOrderResult } from './types.js';

export async function placeKisSellOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA' | 'FOMC_DAY_LIQUIDATION',
): Promise<SellOrderResult> {
  // ADR-0104 — FOMC DAY 자동 청산은 손절(🔴)이 아닌 별도 라벨(📅 FOMC 자동청산)로
  // 표기. 사용자 보고 (4/29): "수익인 종목도 손실 표현됨" 의 오해 차단.
  const emoji =
    reason === 'STOP_LOSS' ? '🔴'
    : reason === 'TAKE_PROFIT' ? '🟢'
    : reason === 'EUPHORIA' ? '🌡️'
    : '📅'; // FOMC_DAY_LIQUIDATION
  const label =
    reason === 'STOP_LOSS' ? '손절'
    : reason === 'TAKE_PROFIT' ? '익절'
    : reason === 'EUPHORIA' ? '과열부분매도'
    : 'FOMC 자동청산'; // FOMC_DAY_LIQUIDATION

  // Shadow 모드: 실주문 없이 로그 + Telegram만
  // KIS_IS_REAL=false(VTS) 또는 런타임 모드가 LIVE 가 아닐 때 모두 차단.
  if (!isLiveOrderAllowed()) {
    console.log(`[AutoTrade SELL Shadow] ${emoji} ${stockName}(${stockCode}) ${label} — ${quantity}주 (Shadow 모드, 실주문 없음, mode=${getTradingMode()})`);
    await sendTelegramAlert(
      `${emoji} <b>[SHADOW ${label}] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `수량: ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
    ).catch(console.error);
    return { ordNo: null, placed: false, outcome: 'SHADOW_ONLY' };
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[AutoTrade] KIS 미설정 — ${stockName} 매도 건너뜀`);
    return { ordNo: null, placed: false, outcome: 'LIVE_FAILED', failureReason: 'KIS_APP_KEY 미설정' };
  }

  try {
    console.log(`[AutoTrade SELL] ${emoji} ${stockName}(${stockCode}) ${label} 매도 주문 — ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '01',   // 시장가 (즉시 체결 우선)
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        '0',
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[AutoTrade SELL] ${emoji} ${stockName} ${label} 완료 — ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `${emoji} <b>[${label}] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `수량: ${quantity}주 | 주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    if (ordNo === null) {
      return { ordNo: null, placed: false, outcome: 'LIVE_FAILED', failureReason: 'ODNO 미발급' };
    }
    return { ordNo, placed: true, outcome: 'LIVE_ORDERED' };
  } catch (err: unknown) {
    console.error(`[AutoTrade SELL] ${stockName} 매도 실패:`, err instanceof Error ? err.message : err);
    // 매도 실패는 치명적 → Telegram 긴급 알림
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${escapeHtml(stockName)} ${label} 매도 실패!</b>\n` +
      `수동으로 즉시 매도하세요!\n` +
      `오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
    ).catch(console.error);
    return {
      ordNo: null,
      placed: false,
      outcome: 'LIVE_FAILED',
      failureReason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── OCO 손절 지정가 매도 (체결 즉시 자동 등록) ─────────────────────────────────
/**
 * 매수 체결 확인 후 호출 — 손절 지정가 매도를 KIS에 즉시 등록.
 * exitEngine 주기적 모니터링과 별개로, 거래소 레벨 안전망 역할.
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisStopLossLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  stopPrice: number,
): Promise<string | null> {
  // Shadow 모드: 실주문 없이 로그 + Telegram만
  if (!isLiveOrderAllowed()) {
    console.log(`[StopLoss OCO] 🛡️ ${stockName}(${stockCode}) 손절 지정가 ${stopPrice.toLocaleString()}원 × ${quantity}주 (Shadow 모드, mode=${getTradingMode()})`);
    await sendTelegramAlert(
      `🛡️ <b>[SHADOW 손절 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
    ).catch(console.error);
    return null;
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[StopLoss OCO] KIS 미설정 — ${stockName} 손절 주문 건너뜀`);
    return null;
  }

  try {
    console.log(`[StopLoss OCO] 🛡️ ${stockName}(${stockCode}) 손절 지정가 등록 — ${stopPrice.toLocaleString()}원 × ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '00',   // 지정가
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        stopPrice.toString(),
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[StopLoss OCO] 🛡️ ${stockName} 손절 등록 완료 — ${stopPrice.toLocaleString()}원 ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `🛡️ <b>[손절 주문 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `손절가: ${stopPrice.toLocaleString()}원 × ${quantity}주\n` +
      `주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    return ordNo;
  } catch (err: unknown) {
    console.error(`[StopLoss OCO] ${stockName} 손절 주문 실패:`, err instanceof Error ? err.message : err);
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${escapeHtml(stockName)} 손절 주문 등록 실패!</b>\n` +
      `수동으로 손절 주문을 등록하세요!\n` +
      `오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
    ).catch(console.error);
    return null;
  }
}

// ─── OCO 익절 지정가 매도 (체결 즉시 자동 등록) ─────────────────────────────────
/**
 * 매수 체결 확인 후 호출 — 익절 지정가 매도를 KIS에 즉시 등록.
 * placeKisStopLossLimitOrder와 쌍으로 등록되어 OCO 완결 루프를 구성.
 *
 * @returns 주문번호(ODNO) 또는 null (Shadow 모드·오류 시)
 */
export async function placeKisTakeProfitLimitOrder(
  stockCode: string,
  stockName: string,
  quantity: number,
  targetPrice: number,
): Promise<string | null> {
  if (!isLiveOrderAllowed()) {
    console.log(`[TakeProfit OCO] 🎯 ${stockName}(${stockCode}) 익절 지정가 ${targetPrice.toLocaleString()}원 × ${quantity}주 (Shadow 모드, mode=${getTradingMode()})`);
    await sendTelegramAlert(
      `🎯 <b>[SHADOW 익절 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `익절가: ${targetPrice.toLocaleString()}원 × ${quantity}주 | 실주문 없음\n` +
      `⚠️ SHADOW 모드 — 실계좌 잔고 아님`
    ).catch(console.error);
    return null;
  }

  if (!process.env.KIS_APP_KEY) {
    console.warn(`[TakeProfit OCO] KIS 미설정 — ${stockName} 익절 주문 건너뜀`);
    return null;
  }

  try {
    console.log(`[TakeProfit OCO] 🎯 ${stockName}(${stockCode}) 익절 지정가 등록 — ${targetPrice.toLocaleString()}원 × ${quantity}주`);

    const orderData = await kisPost(SELL_TR_ID, '/uapi/domestic-stock/v1/trading/order-cash', {
      CANO:            process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD:    process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO:            stockCode.padStart(6, '0'),
      ORD_DVSN:        '00',   // 지정가
      ORD_QTY:         quantity.toString(),
      ORD_UNPR:        targetPrice.toString(),
      SLL_BUY_DVSN_CD: '01',  // 01 = 매도
      CTAC_TLNO:       '',
      MGCO_APTM_ODNO:  '',
      ORD_SVR_DVSN_CD: '0',
    });

    const ordNo = (orderData as { output?: { ODNO?: string } } | null)?.output?.ODNO ?? null;
    console.log(`[TakeProfit OCO] 🎯 ${stockName} 익절 등록 완료 — ${targetPrice.toLocaleString()}원 ODNO: ${ordNo}`);

    await sendTelegramAlert(
      `🎯 <b>[익절 주문 등록] ${escapeHtml(stockName)} (${escapeHtml(stockCode)})</b>\n` +
      `익절가: ${targetPrice.toLocaleString()}원 × ${quantity}주\n` +
      `주문번호: ${ordNo ?? 'N/A'}`
    ).catch(console.error);

    return ordNo;
  } catch (err: unknown) {
    console.error(`[TakeProfit OCO] ${stockName} 익절 주문 실패:`, err instanceof Error ? err.message : err);
    await sendTelegramAlert(
      `🚨 <b>[긴급] ${escapeHtml(stockName)} 익절 주문 등록 실패!</b>\n` +
      `수동으로 익절 주문을 등록하세요!\n` +
      `오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
    ).catch(console.error);
    return null;
  }
}

// ─── KIS 주문 취소 (OCO one-cancels-other용) ────────────────────────────────
/**
 * 기존 미체결 주문을 취소한다. OCO에서 한 쪽 체결 시 다른 쪽 자동 취소에 사용.
 *
 * @returns true = 취소 성공 또는 이미 체결됨, false = 취소 실패
 */
export async function cancelKisOrder(
  stockCode: string,
  ordNo: string,
  quantity: number,
): Promise<boolean> {
  if (!KIS_IS_REAL || !process.env.KIS_APP_KEY) return false;

  try {
    const cancelTrId = KIS_IS_REAL ? 'TTTC0803U' : 'VTTC0803U';
    await kisPost(cancelTrId, '/uapi/domestic-stock/v1/trading/order-rvsecncl', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: ordNo,
      ORD_DVSN: '00',
      RVSE_CNCL_DVSN_CD: '02',  // 02 = 취소
      ORD_QTY: quantity.toString(),
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: 'Y',
      PDNO: stockCode.padStart(6, '0'),
    });
    console.log(`[KIS] 주문 취소 완료: ${stockCode} ODNO=${ordNo}`);
    return true;
  } catch (err) {
    console.error(`[KIS] 주문 취소 실패 ODNO=${ordNo}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
