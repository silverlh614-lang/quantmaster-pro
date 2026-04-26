/**
 * @responsibility trancheTakeProfitLimit L3-b LIMIT 분할 익절 + 트레일링 활성화 단위 테스트
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

const { trancheTakeProfitLimit } = await import('../trancheTakeProfitLimit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');

describe('trancheTakeProfitLimit (L3-b LIMIT)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('profitTranches 미설정 → NO_OP', async () => {
    const shadow = makeMockShadow({ profitTranches: undefined });
    const r = await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 130 }));
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('이미 trailingEnabled → NO_OP (트랜치 단계 종료됨)', async () => {
    const shadow = makeMockShadow({
      profitTranches: [{ price: 110, ratio: 0.3, taken: true }],
      trailingEnabled: true,
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 130 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('트랜치 가격 미도달 → NO_OP', async () => {
    const shadow = makeMockShadow({
      profitTranches: [{ price: 130, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 120 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('첫 트랜치 도달 → 30% 매도 + taken=true + LIMIT_TP1', async () => {
    const shadow = makeMockShadow({
      quantity: 100, originalQuantity: 100,
      profitTranches: [
        { price: 110, ratio: 0.3, taken: false },
        { price: 120, ratio: 0.3, taken: false },
      ],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 115 }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 30, 'TAKE_PROFIT');
    expect(shadow.profitTranches![0].taken).toBe(true);
    expect(shadow.profitTranches![1].taken).toBe(false);
    expect(shadow.exitRuleTag).toBe('LIMIT_TRANCHE_TAKE_PROFIT');
  });

  it('모든 트랜치 소화 → trailingEnabled=true + HWM 설정', async () => {
    const shadow = makeMockShadow({
      quantity: 100, originalQuantity: 100,
      profitTranches: [{ price: 110, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 115 }));
    expect(shadow.trailingEnabled).toBe(true);
    expect(shadow.trailingHighWaterMark).toBe(115);
  });

  it('FAILED outcome → taken 플래그 롤백', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({
      quantity: 100, originalQuantity: 100,
      profitTranches: [{ price: 110, ratio: 0.3, taken: false }],
    });
    await trancheTakeProfitLimit(makeMockCtx({ shadow, currentPrice: 115 }));
    expect(shadow.profitTranches![0].taken).toBe(false); // 롤백
  });
});
