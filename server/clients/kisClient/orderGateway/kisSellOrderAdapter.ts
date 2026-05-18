import { SELL_TR_ID } from '../constants.js';
import type { KisOrderKind, KisSellOrderIntent } from './kisOrderTypes.js';
import type { KisOrderRequest } from './kisBuyOrderAdapter.js';

export function buildKisSellOrderRequest(input: KisSellOrderIntent): KisOrderRequest {
  const isMarket = input.orderType === 'MARKET';
  const orderKind: KisOrderKind = isMarket ? 'SELL_MARKET' : 'SELL_LIMIT';
  return {
    trId: SELL_TR_ID,
    apiPath: '/uapi/domestic-stock/v1/trading/order-cash',
    orderKind,
    body: {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      PDNO: input.stockCode.padStart(6, '0'),
      ORD_DVSN: isMarket ? '01' : '00',
      ORD_QTY: input.quantity.toString(),
      ORD_UNPR: isMarket ? '0' : Math.max(0, Math.floor(input.limitPrice ?? 0)).toString(),
      SLL_BUY_DVSN_CD: '01',
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
    },
  };
}

export function buildKisCancelOrderRequest(input: {
  stockCode: string;
  ordNo: string;
  quantity: number;
  isReal: boolean;
}): KisOrderRequest {
  return {
    trId: input.isReal ? 'TTTC0803U' : 'VTTC0803U',
    apiPath: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
    orderKind: 'CANCEL',
    body: {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      KRX_FWDG_ORD_ORGNO: '',
      ORGN_ODNO: input.ordNo,
      ORD_DVSN: '00',
      RVSE_CNCL_DVSN_CD: '02',
      ORD_QTY: input.quantity.toString(),
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: 'Y',
      PDNO: input.stockCode.padStart(6, '0'),
    },
  };
}
