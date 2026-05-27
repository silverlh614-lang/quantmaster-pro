/**
 * @responsibility KIS 매수 주문 어댑터 — 매수 의도를 KIS order-cash 요청 형식으로 변환한다.
 */

import { BUY_TR_ID } from '../constants.js';
import type { KisBuyOrderIntent, KisOrderKind } from './kisOrderTypes.js';

export interface KisOrderRequest {
  trId: string;
  apiPath: string;
  body: Record<string, string>;
  orderKind: KisOrderKind;
}

export function buildKisBuyOrderRequest(input: KisBuyOrderIntent): KisOrderRequest {
  const isMarket = input.orderType === 'MARKET';
  return {
    trId: BUY_TR_ID,
    apiPath: '/uapi/domestic-stock/v1/trading/order-cash',
    orderKind: isMarket ? 'BUY_MARKET' : 'BUY_LIMIT',
    body: {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO: input.stockCode.padStart(6, '0'),
      ORD_DVSN: isMarket ? '01' : '00',
      ORD_QTY: input.quantity.toString(),
      ORD_UNPR: isMarket ? '0' : Math.max(0, Math.floor(input.limitPrice ?? 0)).toString(),
      SLL_BUY_DVSN_CD: '02',
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
    },
  };
}
