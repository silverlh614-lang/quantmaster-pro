/**
 * @responsibility KIS OCO 주문 어댑터 — 손절·익절 레그를 KIS order-cash 요청 형식으로 변환한다.
 */

import { SELL_TR_ID } from '../constants.js';
import type { KisOcoOrderIntent } from './kisOrderTypes.js';
import type { KisOrderRequest } from './kisBuyOrderAdapter.js';

export function buildKisOcoOrderRequest(input: KisOcoOrderIntent): KisOrderRequest {
  return {
    trId: SELL_TR_ID,
    apiPath: '/uapi/domestic-stock/v1/trading/order-cash',
    orderKind: input.leg === 'STOP_LOSS' ? 'OCO_STOP_LOSS' : 'OCO_TAKE_PROFIT',
    body: {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO: input.stockCode.padStart(6, '0'),
      ORD_DVSN: '00',
      ORD_QTY: input.quantity.toString(),
      ORD_UNPR: Math.max(0, Math.floor(input.triggerPrice)).toString(),
      SLL_BUY_DVSN_CD: '01',
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
    },
  };
}
