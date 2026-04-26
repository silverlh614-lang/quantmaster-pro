/**
 * @responsibility legacyTakeProfit TARGET_EXIT 트랜치 미설정 fallback 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../alerts/channelPipeline.js', () => ({ channelSellSignal: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    syncPositionCache: vi.fn(),
    appendFill: vi.fn((s: any, f: any) => { s.fills = [...(s.fills ?? []), { ...f, id: 'mid' }]; }),
    updateShadow: vi.fn((s: any, p: any) => { Object.assign(s, p); }),
    getRemainingQty: vi.fn((s: any) => s.quantity),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});
vi.mock('../../../fillMonitor.js', () => ({ addSellOrder: vi.fn() }));
vi.mock('../../../tradeEventLog.js', () => ({ appendTradeEvent: vi.fn() }));

const { legacyTakeProfit } = await import('../legacyTakeProfit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT, makeLiveOrderedResult } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
const { addSellOrder } = await import('../../../fillMonitor.js');

describe('legacyTakeProfit (TARGET_EXIT fallback)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('currentPrice < targetPrice → NO_OP', async () => {
    const shadow = makeMockShadow({ targetPrice: 120 });
    const r = await legacyTakeProfit(makeMockCtx({ shadow, currentPrice: 119 }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('currentPrice ≥ targetPrice → 전량 청산 + HIT_TARGET', async () => {
    const shadow = makeMockShadow({ quantity: 100, targetPrice: 120 });
    const r = await legacyTakeProfit(makeMockCtx({ shadow, currentPrice: 120 }));
    expect(r.skipRest).toBe(true);
    expect(shadow.status).toBe('HIT_TARGET');
    expect(shadow.exitRuleTag).toBe('TARGET_EXIT');
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 100, 'TAKE_PROFIT');
  });

  it('LIVE_ORDERED → addSellOrder 호출', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(makeLiveOrderedResult('ORD-TGT-1'));
    const shadow = makeMockShadow({ quantity: 100, targetPrice: 120, mode: 'LIVE' });
    await legacyTakeProfit(makeMockCtx({ shadow, currentPrice: 125 }));
    expect(addSellOrder).toHaveBeenCalledWith(expect.objectContaining({ ordNo: 'ORD-TGT-1' }));
  });

  it('FAILED outcome → CRITICAL 알림', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100, targetPrice: 120 });
    await legacyTakeProfit(makeMockCtx({ shadow, currentPrice: 125 }));
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });

  it('subType=FULL_CLOSE 로 fill 기록', async () => {
    const shadow = makeMockShadow({ quantity: 100, targetPrice: 120 });
    await legacyTakeProfit(makeMockCtx({ shadow, currentPrice: 125 }));
    expect(shadow.fills).toHaveLength(1);
    expect(shadow.fills![0].subType).toBe('FULL_CLOSE');
  });
});
