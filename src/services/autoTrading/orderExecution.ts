// @responsibility orderExecution 서비스 모듈
/**
 * orderExecution.ts — KIS 주문 실행 (아이디어 2 + 4 + 6)
 *
 * 아이디어 4: 신호-주문 변환 — convertSignalToOrder
 * 아이디어 2: 체결 확인 루프 — placeAndConfirmOrder
 * 아이디어 6: OCO 자동 등록  — registerOCOAfterFill
 */

import type { EvaluationResult, KISOrderParams, FilledOrder } from '../../types/quant';
import { debugLog } from '../../utils/debug';
import { kisProxy, isReal, BUY_TR, SELL_TR, isServerAutoTradeActive } from './kisProxy';

// ─── 아이디어 4: 신호-주문 변환 ────────────────────────────────────────────────

/**
 * EvaluationResult + 현재가 + 총자산 → KIS 주문 파라미터
 *
 * - STRONG_BUY → 시장가(01), 즉시 체결 우선 (Gate 3 라스트 트리거 개념)
 * - BUY        → 지정가(00), 현재가에 안전 진입
 */
export function convertSignalToOrder(
  signal: EvaluationResult,
  currentPrice: number,
  totalAssets: number,
  stockCode: string
): KISOrderParams {
  const kellyFraction = signal.positionSize / 100;
  const investAmount = totalAssets * kellyFraction;
  const quantity = Math.floor(investAmount / currentPrice);

  const isStrongBuy =
    signal.recommendation === '풀 포지션' || signal.lastTrigger;

  return {
    PDNO: stockCode.padStart(6, '0'),
    ORD_DVSN: isStrongBuy ? '01' : '00',           // 시장가 vs 지정가
    ORD_QTY: quantity.toString(),
    ORD_UNPR: isStrongBuy ? '0' : currentPrice.toString(),
  };
}

/**
 * KIS 현금 매수 주문 실행 (수동 트리거 전용)
 *
 * 서버 자동매매(AUTO_TRADE_ENABLED)가 켜져 있으면 중복 주문 방지를 위해 차단됩니다.
 * @returns KIS 응답 (ORD_NO 등 포함)
 * @throws 서버 자동매매 활성 시 Error
 */
export async function placeKISOrder(
  params: KISOrderParams
): Promise<Record<string, unknown>> {
  if (isServerAutoTradeActive()) {
    throw new Error(
      '[중복 방지] 서버 자동매매(AUTO_TRADE_ENABLED=true)가 활성 상태입니다. ' +
      '클라이언트 실주문은 차단됩니다. 주문은 서버 autoTradeEngine이 단독 실행합니다.'
    );
  }
  const data = await kisProxy({
    path: '/uapi/domestic-stock/v1/trading/order-cash',
    method: 'POST',
    headers: { tr_id: BUY_TR() },
    body: {
      ...params,
      CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',        // 계좌번호 앞 8자리
      ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01', // 상품코드
      SLL_BUY_DVSN_CD: '02',  // 02=매수
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
    } as Record<string, string>,
  });
  debugLog('[KIS 매수 체결]', { code: params.PDNO, qty: params.ORD_QTY, price: params.ORD_UNPR || '시장가' });
  return data;
}

// ─── 아이디어 6: OCO 자동 등록 ─────────────────────────────────────────────────

/**
 * 매수 체결 확인 즉시 호출 — 손절 지정가 매도 + 목표가 지정가 매도를 동시 등록.
 *
 * KIS VTS는 네이티브 OCO 미지원 → 지정가 매도 2건으로 구현.
 * 먼저 체결되는 쪽이 이기면, 남은 주문은 수동 취소 필요 (향후 웹소켓 모니터링으로 자동화 가능).
 */
export async function registerOCOAfterFill(trade: FilledOrder): Promise<{
  stopLossOrder: Record<string, unknown>;
  targetOrder: Record<string, unknown>;
}> {
  const stopLossPct = trade.stopLossPct ?? 0.08;
  const stopLossPrice = Math.floor(trade.executedPrice * (1 - stopLossPct));
  const targetPrice   = Math.ceil(trade.executedPrice * (1 + trade.rrr * stopLossPct));

  const commonBody = {
    CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
    ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
    PDNO: trade.stockCode.padStart(6, '0'),
    SLL_BUY_DVSN_CD: '01',  // 01=매도
    ORD_QTY: trade.quantity.toString(),
    CTAC_TLNO: '',
    MGCO_APTM_ODNO: '',
    ORD_SVR_DVSN_CD: '0',
    ORD_DVSN: '00',          // 지정가
  } as Record<string, string>;

  debugLog(`[OCO 등록] ${trade.stockName} — 손절: ${stopLossPrice.toLocaleString()}원 / 목표: ${targetPrice.toLocaleString()}원`);

  const [stopLossOrder, targetOrder] = await Promise.all([
    kisProxy({
      path: '/uapi/domestic-stock/v1/trading/order-cash',
      method: 'POST',
      headers: { tr_id: SELL_TR() },
      body: { ...commonBody, ORD_UNPR: stopLossPrice.toString() },
    }),
    kisProxy({
      path: '/uapi/domestic-stock/v1/trading/order-cash',
      method: 'POST',
      headers: { tr_id: SELL_TR() },
      body: { ...commonBody, ORD_UNPR: targetPrice.toString() },
    }),
  ]);

  return { stopLossOrder, targetOrder };
}

// ─── 아이디어 2: 체결 확인 루프 (Fill Confirmation Loop) ───────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** KIS 체결 내역 조회 → 체결/미체결 수량 반환 */
async function checkOrderStatus(orderId: string): Promise<{ filled: number; total: number }> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const data = await kisProxy({
    path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    method: 'GET',
    headers: { tr_id: isReal() ? 'TTTC8001R' : 'VTTC8001R' },
    params: {
      CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT: today,
      INQR_END_DT: today,
      SLL_BUY_DVSN_CD: '00',
      INQR_DVSN: '00',
      PDNO: '',
      CCLD_DVSN: '00',
      ORD_GNO_BRNO: '',
      ODNO: orderId,
      INQR_DVSN_3: '00',
      INQR_DVSN_1: '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    },
  });
  const record = (data.output1 as any[])?.[0];
  if (!record) return { filled: 0, total: 0 };
  return {
    filled: parseInt(record.tot_ccld_qty ?? '0', 10),
    total:  parseInt(record.ord_qty       ?? '0', 10),
  };
}

/** 미체결 주문 취소 */
async function cancelOrder(orderId: string, stockCode: string, originalQty: string): Promise<void> {
  await kisProxy({
    path: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
    method: 'POST',
    headers: { tr_id: isReal() ? 'TTTC0803U' : 'VTTC0803U' },
    body: {
      CANO: import.meta.env.VITE_KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: import.meta.env.VITE_KIS_ACCOUNT_PROD ?? '01',
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: orderId,
      ORD_DVSN: '00',
      RVSE_CNCL_DVSN_CD: '02', // 02=취소
      ORD_QTY: originalQty,
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: 'Y',
      PDNO: stockCode,
    } as Record<string, string>,
  });
  debugLog(`[KIS 주문 취소] ODNO: ${orderId}`);
}

/**
 * 주문 실행 + 체결 확인 폴링 (아이디어 2)
 *
 * 1. 주문 전송 → ODNO 수신
 * 2. 3초 간격으로 체결 수량 폴링 (최대 maxWaitSeconds)
 * 3. 완전 체결 → 'FILLED' + OCO 자동 등록
 * 4. 타임아웃 → 잔량 취소 → 'TIMEOUT'
 */
export async function placeAndConfirmOrder(
  params: KISOrderParams,
  stockName: string,
  rrr: number,
  maxWaitSeconds = 30,
): Promise<'FILLED' | 'PARTIAL' | 'REJECTED' | 'TIMEOUT'> {
  const orderResult = await placeKISOrder(params);
  const orderId = (orderResult as any)?.output?.ODNO as string | undefined;

  if (!orderId) {
    console.error('[체결확인] ODNO 없음 — 주문 거부 또는 오류:', orderResult);
    return 'REJECTED';
  }

  debugLog(`[체결확인] 주문 접수 ODNO: ${orderId} — 폴링 시작 (최대 ${maxWaitSeconds}s)`);

  const polls = Math.floor(maxWaitSeconds / 3);
  let lastFilled = 0;

  for (let i = 0; i < polls; i++) {
    await sleep(3000);
    const { filled, total } = await checkOrderStatus(orderId);
    lastFilled = filled;

    if (total > 0 && filled >= total) {
      debugLog(`[체결확인] 완전 체결 ${filled}/${total}주 — OCO 등록 시작`);
      // 체결 직후 손절/목표가 OCO 등록 (아이디어 6)
      await registerOCOAfterFill({
        stockCode: params.PDNO,
        stockName,
        executedPrice: parseInt(params.ORD_UNPR || '0', 10) || 0,
        quantity: filled,
        rrr,
      }).catch((e) => console.error('[OCO 등록 실패]', e));
      return 'FILLED';
    }
    if (filled > 0) {
      debugLog(`[체결확인] 부분 체결 중 ${filled}/${total}주 ...`);
    }
  }

  // 타임아웃 — 잔량 취소
  if (lastFilled === 0) {
    await cancelOrder(orderId, params.PDNO, params.ORD_QTY).catch(console.error);
    console.warn(`[체결확인] ⏱ 타임아웃 — 주문 취소 완료`);
    return 'TIMEOUT';
  }

  // 부분 체결 상태에서 타임아웃
  console.warn(`[체결확인] ⚠ 부분 체결(${lastFilled}주) 후 타임아웃`);
  return 'PARTIAL';
}
