/**
 * @responsibility r6EmergencyExit R6 블랙스완 30% 1회 청산 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    syncPositionCache: vi.fn(),
    appendFill: vi.fn((shadow: any, fill: any) => {
      shadow.fills = [...(shadow.fills ?? []), { ...fill, id: 'mock-fill-id' }];
    }),
    getRemainingQty: vi.fn((shadow: any) => shadow.quantity),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});
vi.mock('../../../fillMonitor.js', () => ({ addSellOrder: vi.fn() }));
vi.mock('../../../tradeEventLog.js', () => ({ appendTradeEvent: vi.fn() }));

const { r6EmergencyExit } = await import('../r6EmergencyExit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
const { addSellOrder } = await import('../../../fillMonitor.js');

describe('r6EmergencyExit (R6 30% 1회)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('regime != R6 → NO_OP', async () => {
    const shadow = makeMockShadow();
    const r = await r6EmergencyExit(makeMockCtx({ shadow, currentRegime: 'R2_BULL' as any }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('이미 r6EmergencySold=true → 재발동 차단', async () => {
    const shadow = makeMockShadow({ r6EmergencySold: true });
    const r = await r6EmergencyExit(makeMockCtx({ shadow, currentRegime: 'R6_DEFENSE' as any }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('R6 + 미발동 → 30% 청산 + 플래그 set + 알림', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    await r6EmergencyExit(makeMockCtx({ shadow, currentRegime: 'R6_DEFENSE' as any, currentPrice: 95 }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 30, 'STOP_LOSS');
    expect(shadow.r6EmergencySold).toBe(true);
    expect(shadow.exitRuleTag).toBe('R6_EMERGENCY_EXIT');
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
  });

  it('FAILED outcome → r6EmergencySold 플래그 롤백', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100 });
    await r6EmergencyExit(makeMockCtx({ shadow, currentRegime: 'R6_DEFENSE' as any }));
    expect(shadow.r6EmergencySold).toBe(false); // 롤백
    // FAILED 시 priority CRITICAL
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });

  it('LIVE_ORDERED outcome → addSellOrder 호출 + ordNo 보존', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce({ ordNo: 'ORD-R6-1', placed: true, outcome: 'LIVE_ORDERED' });
    const shadow = makeMockShadow({ quantity: 100, mode: 'LIVE' });
    await r6EmergencyExit(makeMockCtx({ shadow, currentRegime: 'R6_DEFENSE' as any }));
    expect(addSellOrder).toHaveBeenCalledWith(expect.objectContaining({ ordNo: 'ORD-R6-1' }));
  });

  it('quantity ≤ 0 → NO_OP', async () => {
    const shadow = makeMockShadow({ quantity: 0 });
    const r = await r6EmergencyExit(makeMockCtx({ shadow, currentRegime: 'R6_DEFENSE' as any }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });
});
