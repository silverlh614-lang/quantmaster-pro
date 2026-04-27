/**
 * @responsibility trailingStop L3-c 트레일링 스톱 이익보호 전량청산 단위 테스트
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

const { trailingStop } = await import('../trailingStop.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');

describe('trailingStop (L3-c HWM)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('trailingEnabled=false → NO_OP', async () => {
    const shadow = makeMockShadow({ trailingEnabled: false });
    const r = await trailingStop(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('HWM 미설정 → NO_OP', async () => {
    const shadow = makeMockShadow({ trailingEnabled: true, trailingHighWaterMark: undefined });
    await trailingStop(makeMockCtx({ shadow }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('currentPrice > trailFloor (HWM 의 90%) → NO_OP', async () => {
    const shadow = makeMockShadow({ trailingEnabled: true, trailingHighWaterMark: 130 });
    // trailFloor = 130 * 0.9 = 117. currentPrice 120 > 117
    await trailingStop(makeMockCtx({ shadow, currentPrice: 120 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('currentPrice ≤ trailFloor → 전량 청산 + HIT_TARGET + PROFIT_PROTECTION', async () => {
    const shadow = makeMockShadow({ quantity: 100, trailingEnabled: true, trailingHighWaterMark: 130 });
    // trailFloor = 130 * 0.9 = 117. currentPrice 110 ≤ 117
    const r = await trailingStop(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(r.skipRest).toBe(true);
    expect(shadow.status).toBe('HIT_TARGET');
    expect(shadow.exitRuleTag).toBe('TRAILING_PROTECTIVE_STOP');
    expect(shadow.stopLossExitType).toBe('PROFIT_PROTECTION');
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 100, 'TAKE_PROFIT');
  });

  it('FAILED outcome → CRITICAL 알림 + 상태 롤백', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100, trailingEnabled: true, trailingHighWaterMark: 130 });
    await trailingStop(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: 'CRITICAL' }),
    );
  });

  it('trailPct override (예: 5%) — trailFloor = HWM * 0.95', async () => {
    const shadow = makeMockShadow({
      quantity: 100, trailingEnabled: true,
      trailingHighWaterMark: 130, trailPct: 0.05,
    });
    // trailFloor = 130 * 0.95 = 123.5. currentPrice 124 > 123.5 → NO_OP
    await trailingStop(makeMockCtx({ shadow, currentPrice: 124 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
    // currentPrice 123 ≤ 123.5 → 발동
    await trailingStop(makeMockCtx({ shadow, currentPrice: 123 }));
    expect(placeKisSellOrder).toHaveBeenCalledOnce();
  });
});
