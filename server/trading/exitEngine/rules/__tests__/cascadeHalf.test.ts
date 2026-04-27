/**
 * @responsibility cascadeHalf -15% 50% 반매도 1회 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    syncPositionCache: vi.fn(),
    appendFill: vi.fn((s: any, f: any) => { s.fills = [...(s.fills ?? []), { ...f, id: 'mid' }]; }),
    getRemainingQty: vi.fn((s: any) => s.quantity),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});
vi.mock('../../../fillMonitor.js', () => ({ addSellOrder: vi.fn() }));
vi.mock('../../../tradeEventLog.js', () => ({ appendTradeEvent: vi.fn() }));

const { cascadeHalf } = await import('../cascadeHalf.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');

describe('cascadeHalf (-15% 50%)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returnPct > -15 → NO_OP', async () => {
    const shadow = makeMockShadow();
    const r = await cascadeHalf(makeMockCtx({ shadow, currentPrice: 88 })); // -12%
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('cascadeStep ≥ 2 (이미 발동) → 재트리거 차단', async () => {
    const shadow = makeMockShadow({ cascadeStep: 2 });
    const r = await cascadeHalf(makeMockCtx({ shadow, currentPrice: 80 })); // -20%
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('-15% + cascadeStep 0 → 50% 반매도 + cascadeStep=2 + halfSoldAt 기록', async () => {
    const shadow = makeMockShadow({ quantity: 100, cascadeStep: 0 });
    const r = await cascadeHalf(makeMockCtx({ shadow, currentPrice: 85 }));
    expect(r.skipRest).toBe(true);
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'STOP_LOSS');
    expect(shadow.cascadeStep).toBe(2);
    expect(shadow.halfSoldAt).toBeTruthy();
    expect(shadow.exitRuleTag).toBe('CASCADE_HALF_SELL');
  });

  it('FAILED outcome → cascadeStep + halfSoldAt 롤백', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100, cascadeStep: 1, halfSoldAt: undefined });
    await cascadeHalf(makeMockCtx({ shadow, currentPrice: 85 }));
    expect(shadow.cascadeStep).toBe(1); // 이전 값으로 롤백
    expect(shadow.halfSoldAt).toBeUndefined();
  });

  it('cascadeStep 1 (이전 -7% 발동) → -15% 진입 시 발동 OK', async () => {
    const shadow = makeMockShadow({ quantity: 100, cascadeStep: 1 });
    await cascadeHalf(makeMockCtx({ shadow, currentPrice: 85 }));
    expect(shadow.cascadeStep).toBe(2);
    expect(placeKisSellOrder).toHaveBeenCalled();
  });
});
