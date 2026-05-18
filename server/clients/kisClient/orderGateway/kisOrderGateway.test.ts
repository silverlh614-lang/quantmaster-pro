import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelOrder, submitBuyOrder, submitOcoOrder, submitSellOrder } from './kisOrderGateway.js';
import type { KisOrderGatewayDeps } from './kisOrderTypes.js';

function deps(overrides: Partial<KisOrderGatewayDeps> = {}): KisOrderGatewayDeps {
  return {
    kisPost: vi.fn(async () => ({ rt_cd: '0', output: { ODNO: 'ORD-1' } })),
    kisGet: vi.fn(async () => ({ rt_cd: '0', output: { ODNO: 'ORD-1' } })),
    isKisConfigured: () => true,
    isReal: true,
    ...overrides,
  };
}

describe('kisOrderGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips buy submission without KIS config and emits blocked warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const d = deps({ isKisConfigured: () => false });

    await expect(submitBuyOrder({ stockCode: '005930', quantity: 3, orderType: 'MARKET' }, d)).resolves.toEqual({
      kind: 'SKIPPED_KIS_NOT_CONFIGURED',
      executionImpact: 'LIVE_ORDER_BLOCKED',
    });
    expect(d.kisPost).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[P0][P0_KIS_BUY_ORDER_BLOCKED]'), expect.any(Object));
  });

  it('submits buy order through mapped KIS request body', async () => {
    const d = deps();

    await expect(submitBuyOrder({ stockCode: '5930', quantity: 5, orderType: 'MARKET' }, d)).resolves.toEqual({
      kind: 'SUBMITTED',
      ordNo: 'ORD-1',
      raw: { rt_cd: '0', output: { ODNO: 'ORD-1' } },
    });
    expect(d.kisPost).toHaveBeenCalledWith(
      expect.any(String),
      '/uapi/domestic-stock/v1/trading/order-cash',
      expect.objectContaining({
        PDNO: '005930',
        ORD_DVSN: '01',
        ORD_QTY: '5',
        SLL_BUY_DVSN_CD: '02',
      }),
    );
  });

  it('keeps sell retryable errors distinct from fatal failures', async () => {
    const d = deps({
      kisPost: vi.fn(async () => {
        throw { status: 429, message: 'rate limited', retryAfterMs: 1000 };
      }),
    });

    await expect(
      submitSellOrder({ stockCode: '005930', quantity: 1, orderType: 'MARKET', reason: 'STOP_LOSS' }, d),
    ).resolves.toEqual({
      kind: 'FAILED_RETRYABLE',
      reason: 'rate limited',
      retryAfterMs: 1000,
      raw: { status: 429, message: 'rate limited', retryAfterMs: 1000 },
    });
  });

  it('submits synthetic OCO leg as normalized order result', async () => {
    const d = deps({ kisPost: vi.fn(async () => ({ rt_cd: '0', output: { odno: 'OCO-1' } })) });

    await expect(
      submitOcoOrder({ stockCode: '005930', quantity: 2, leg: 'STOP_LOSS', triggerPrice: 69000 }, d),
    ).resolves.toEqual({
      kind: 'SUBMITTED',
      ordNo: 'OCO-1',
      raw: { rt_cd: '0', output: { odno: 'OCO-1' } },
    });
    expect(d.kisPost).toHaveBeenCalledWith(
      expect.any(String),
      '/uapi/domestic-stock/v1/trading/order-cash',
      expect.objectContaining({
        ORD_DVSN: '00',
        ORD_UNPR: '69000',
        SLL_BUY_DVSN_CD: '01',
      }),
    );
  });

  it('normalizes cancel submissions', async () => {
    const d = deps({ kisPost: vi.fn(async () => ({ rt_cd: '0', output: {} })) });

    await expect(cancelOrder({ stockCode: '005930', ordNo: 'ORD-CANCEL', quantity: 3 }, d)).resolves.toEqual({
      kind: 'CANCEL_SUBMITTED',
      ordNo: 'ORD-CANCEL',
      raw: { rt_cd: '0', output: {} },
    });
  });
});
