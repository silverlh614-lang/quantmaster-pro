/**
 * @responsibility ADR-0653/0654 주문 TR 스킴 정합 가드 — 신/구 매핑 + 매수↔매도 swap 함정 동결 + default-ON.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('ADR-0653/0654 KIS order TR scheme', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('신스킴 매수=...12U / 매도=...11U (swap 함정 동결·env 무관)', () => {
    // ⚠️ 구스킴(매수 ...02U / 매도 ...01U)과 끝자리가 반대. 끝자리 직관 유추 금지.
    expect(KIS_NXT_ORDER_TR_IDS.buyReal).toBe('TTTC0012U');
    expect(KIS_NXT_ORDER_TR_IDS.buyDemo).toBe('VTTC0012U');
    expect(KIS_NXT_ORDER_TR_IDS.sellReal).toBe('TTTC0011U');
    expect(KIS_NXT_ORDER_TR_IDS.sellDemo).toBe('VTTC0011U');
    expect(KIS_NXT_ORDER_TR_IDS.cancelReal).toBe('TTTC0013U');
    expect(KIS_NXT_ORDER_TR_IDS.ccldReal).toBe('TTTC0081R');
  });

  it('구스킴 매핑 보존 (KRX 전용·kill-switch 대상)', () => {
    expect(KIS_LEGACY_ORDER_TR_IDS.buyReal).toBe('TTTC0802U');
    expect(KIS_LEGACY_ORDER_TR_IDS.sellReal).toBe('TTTC0801U');
    expect(KIS_LEGACY_ORDER_TR_IDS.cancelReal).toBe('TTTC0803U');
    expect(KIS_LEGACY_ORDER_TR_IDS.ccldReal).toBe('TTTC8001R');
  });

  it('ADR-0654 default ON → 신 스킴 + 신규 param 주입 (env 미설정)', () => {
    // 테스트 환경은 KIS_ORDER_TR_NXT_SCHEME_ENABLED 미설정 = default ON 이 기대값.
    expect(KIS_ORDER_TR_NXT_SCHEME_ENABLED).toBe(true);
    expect(BUY_TR_ID.endsWith('0012U')).toBe(true);  // demo VTTC0012U
    expect(SELL_TR_ID.endsWith('0011U')).toBe(true);  // demo VTTC0011U
    expect(nxtOrderCashParams('BUY')).toEqual({ EXCG_ID_DVSN_CD: 'KRX', SLL_TYPE: '', CNDT_PRIC: '' });
    expect(nxtOrderCashParams('SELL')).toEqual({ EXCG_ID_DVSN_CD: 'KRX', SLL_TYPE: '01', CNDT_PRIC: '' });
    expect(nxtCancelParams()).toEqual({ EXCG_ID_DVSN_CD: 'KRX' });
  });

  it('default ON 시 매수 주문 body 에 신규 param 주입', () => {
    const req = buildKisBuyOrderRequest({
      stockCode: '005930', quantity: 1, orderType: 'LIMIT', limitPrice: 70000,
    } as Parameters<typeof buildKisBuyOrderRequest>[0]);
    expect(req.body.EXCG_ID_DVSN_CD).toBe('KRX');
    expect(req.body.SLL_TYPE).toBe('');
    expect(req.body.CNDT_PRIC).toBe('');
    expect(req.trId).toBe(BUY_TR_ID);
  });

  it('kill-switch =false → 구 스킴 + 신규 param {} (롤백)', async () => {
    vi.stubEnv('KIS_ORDER_TR_NXT_SCHEME_ENABLED', 'false');
    vi.resetModules();
    const c = await import('../constants.js');
    expect(c.KIS_ORDER_TR_NXT_SCHEME_ENABLED).toBe(false);
    expect(c.BUY_TR_ID.endsWith('0802U')).toBe(true);
    expect(c.SELL_TR_ID.endsWith('0801U')).toBe(true);
    expect(c.nxtOrderCashParams('BUY')).toEqual({});
    expect(c.nxtCancelParams()).toEqual({});
  });
});
