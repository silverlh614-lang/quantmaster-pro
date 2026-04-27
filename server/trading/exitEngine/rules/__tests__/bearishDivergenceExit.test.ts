/**
 * @responsibility bearishDivergenceExit 하락 다이버전스 30% 1회 부분익절 단위 테스트
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
    getRemainingQty: vi.fn((s: any) => s.quantity),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});
vi.mock('../../../fillMonitor.js', () => ({ addSellOrder: vi.fn() }));
vi.mock('../../../tradeEventLog.js', () => ({ appendTradeEvent: vi.fn() }));
vi.mock('../../helpers/priceHistory.js', () => ({ fetchPriceAndRsiHistory: vi.fn() }));
vi.mock('../../helpers/rsiSeries.js', () => ({ detectBearishDivergence: vi.fn() }));

const { bearishDivergenceExit } = await import('../bearishDivergenceExit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { fetchPriceAndRsiHistory } = await import('../../helpers/priceHistory.js');
const { detectBearishDivergence } = await import('../../helpers/rsiSeries.js');

describe('bearishDivergenceExit (다이버전스 30%)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('이미 divergencePartialSold=true → NO_OP', async () => {
    const shadow = makeMockShadow({ divergencePartialSold: true });
    await bearishDivergenceExit(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(fetchPriceAndRsiHistory).not.toHaveBeenCalled();
  });

  it('수익 영역 아님 (currentPrice ≤ entry) → NO_OP', async () => {
    const shadow = makeMockShadow();
    await bearishDivergenceExit(makeMockCtx({ shadow, currentPrice: 100 }));
    expect(fetchPriceAndRsiHistory).not.toHaveBeenCalled();
  });

  it('히스토리 fetch 실패 → NO_OP', async () => {
    (fetchPriceAndRsiHistory as any).mockResolvedValue(null);
    const shadow = makeMockShadow();
    await bearishDivergenceExit(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(detectBearishDivergence).not.toHaveBeenCalled();
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('다이버전스 미감지 → NO_OP', async () => {
    (fetchPriceAndRsiHistory as any).mockResolvedValue({ prices: [1, 2], rsi: [60, 70] });
    (detectBearishDivergence as any).mockReturnValue(false);
    const shadow = makeMockShadow();
    await bearishDivergenceExit(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('다이버전스 감지 → 30% 익절 + 플래그 set', async () => {
    (fetchPriceAndRsiHistory as any).mockResolvedValue({ prices: [1, 2], rsi: [60, 70] });
    (detectBearishDivergence as any).mockReturnValue(true);
    const shadow = makeMockShadow({ quantity: 100 });
    await bearishDivergenceExit(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 30, 'TAKE_PROFIT');
    expect(shadow.divergencePartialSold).toBe(true);
    expect(shadow.exitRuleTag).toBe('DIVERGENCE_PARTIAL');
  });

  it('FAILED outcome → divergencePartialSold 롤백', async () => {
    (fetchPriceAndRsiHistory as any).mockResolvedValue({ prices: [], rsi: [] });
    (detectBearishDivergence as any).mockReturnValue(true);
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100 });
    await bearishDivergenceExit(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(shadow.divergencePartialSold).toBe(false);
  });
});
