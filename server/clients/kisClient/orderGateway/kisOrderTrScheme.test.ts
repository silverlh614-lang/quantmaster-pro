/**
 * @responsibility ADR-0653 주문 TR 스킴 정합 가드 — 신/구 매핑 + 매수↔매도 swap 함정 동결.
 */
import { describe, it, expect } from 'vitest';
import {
  KIS_NXT_ORDER_TR_IDS,
  KIS_LEGACY_ORDER_TR_IDS,
  KIS_ORDER_TR_NXT_SCHEME_ENABLED,
  BUY_TR_ID,
  SELL_TR_ID,
  nxtOrderCashParams,
  nxtCancelParams,
} from '../constants.js';
import { buildKisBuyOrderRequest } from './kisBuyOrderAdapter.js';

describe('ADR-0653 KIS order TR scheme', () => {
  it('신스킴 매수=...12U / 매도=...11U (swap 함정 동결)', () => {
    // ⚠️ 구스킴(매수 ...02U / 매도 ...01U)과 끝자리가 반대. 끝자리 직관 유추 금지.
    expect(KIS_NXT_ORDER_TR_IDS.buyReal).toBe('TTTC0012U');
    expect(KIS_NXT_ORDER_TR_IDS.buyDemo).toBe('VTTC0012U');
    expect(KIS_NXT_ORDER_TR_IDS.sellReal).toBe('TTTC0011U');
    expect(KIS_NXT_ORDER_TR_IDS.sellDemo).toBe('VTTC0011U');
    expect(KIS_NXT_ORDER_TR_IDS.cancelReal).toBe('TTTC0013U');
    expect(KIS_NXT_ORDER_TR_IDS.ccldReal).toBe('TTTC0081R');
  });

  it('구스킴 매핑 보존 (KRX 전용)', () => {
    expect(KIS_LEGACY_ORDER_TR_IDS.buyReal).toBe('TTTC0802U');
    expect(KIS_LEGACY_ORDER_TR_IDS.sellReal).toBe('TTTC0801U');
    expect(KIS_LEGACY_ORDER_TR_IDS.cancelReal).toBe('TTTC0803U');
    expect(KIS_LEGACY_ORDER_TR_IDS.ccldReal).toBe('TTTC8001R');
  });

  it('flag default OFF → 구 스킴 + 신규 param {} (byte-equivalent)', () => {
    // 테스트 환경은 KIS_ORDER_TR_NXT_SCHEME_ENABLED 미설정 = OFF 가 기대값.
    expect(KIS_ORDER_TR_NXT_SCHEME_ENABLED).toBe(false);
    expect(BUY_TR_ID.endsWith('0802U')).toBe(true);
    expect(SELL_TR_ID.endsWith('0801U')).toBe(true);
    expect(nxtOrderCashParams('BUY')).toEqual({});
    expect(nxtOrderCashParams('SELL')).toEqual({});
    expect(nxtCancelParams()).toEqual({});
  });

  it('OFF 시 매수 주문 body 에 신규 param 미주입 (byte-equivalent)', () => {
    const req = buildKisBuyOrderRequest({
      stockCode: '005930', quantity: 1, orderType: 'LIMIT', limitPrice: 70000,
    } as Parameters<typeof buildKisBuyOrderRequest>[0]);
    expect(req.body.EXCG_ID_DVSN_CD).toBeUndefined();
    expect(req.body.SLL_TYPE).toBeUndefined();
    expect(req.body.CNDT_PRIC).toBeUndefined();
    expect(req.trId).toBe(BUY_TR_ID);
  });
});
