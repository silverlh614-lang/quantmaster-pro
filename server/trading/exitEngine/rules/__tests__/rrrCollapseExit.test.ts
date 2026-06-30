/**
 * @responsibility rrrCollapseExit RRR 붕괴 50% 자동 익절 1회 단위 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const { rrrCollapseExit } = await import('../rrrCollapseExit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { channelSellSignal } = await import('../../../../alerts/channelPipeline.js');

describe('rrrCollapseExit (잔여 RRR<1.0 → 50%)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rrrCollapsePartialSold=true → NO_OP', async () => {
    const shadow = makeMockShadow({ rrrCollapsePartialSold: true, targetPrice: 120, hardStopLoss: 90 });
    await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 115, hardStopLoss: 90 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('currentPrice ≤ entry → NO_OP (수익 영역에서만 동작)', async () => {
    const shadow = makeMockShadow({ targetPrice: 120 });
    await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 95 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('remainingRisk ≤ 0 (현재가 ≤ hardStopLoss) → NO_OP (수치 안전)', async () => {
    const shadow = makeMockShadow({ targetPrice: 120 });
    // currentPrice 95, hardStopLoss 95 → remainingRisk = 0
    await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 95, hardStopLoss: 95 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('liveRRR ≥ 1.0 → NO_OP', async () => {
    // currentPrice 105, target 120, hardStop 99 → reward 15 / risk 6 = 2.5 RRR
    const shadow = makeMockShadow({ targetPrice: 120 });
    await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 105, hardStopLoss: 99 }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('liveRRR < 1.0 → 50% 익절 + 플래그 set + channelSellSignal', async () => {
    // currentPrice 118, target 120, hardStop 110 → reward 2 / risk 8 = 0.25 RRR
    const shadow = makeMockShadow({ targetPrice: 120, quantity: 100 });
    await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 118, hardStopLoss: 110 }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'TAKE_PROFIT');
    expect(shadow.rrrCollapsePartialSold).toBe(true);
    expect(shadow.exitRuleTag).toBe('RRR_COLLAPSE_PARTIAL');
    expect(channelSellSignal).toHaveBeenCalledWith(expect.objectContaining({ reason: 'RRR_COLLAPSE' }));
  });

  it('FAILED outcome → rrrCollapsePartialSold 플래그 롤백', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ targetPrice: 120, quantity: 100 });
    await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 118, hardStopLoss: 110 }));
    expect(shadow.rrrCollapsePartialSold).toBe(false);
    expect(channelSellSignal).not.toHaveBeenCalled(); // recorded=false
  });

  // ─── ADR-0660 최소 수익률 가드 ──────────────────────────────────────────────
  describe('ADR-0660 최소 수익률 가드', () => {
    const ENV_KEY = 'RRR_COLLAPSE_MIN_PROFIT_PCT';
    const original = process.env[ENV_KEY];
    afterEach(() => {
      if (original === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = original;
    });

    it('liveRRR<1.0 이지만 returnPct<기본임계(3%) → NO_OP (본전 조기청산 보류)', async () => {
      delete process.env[ENV_KEY]; // 기본 3% 적용
      // entry 100, currentPrice 101 (+1%), target 102, hardStop 95
      //   reward 1 / risk 6 = 0.17 RRR (<1.0) 이지만 returnPct +1% < 3% → 보류
      const shadow = makeMockShadow({ targetPrice: 102, quantity: 100 });
      await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 101, hardStopLoss: 95 }));
      expect(placeKisSellOrder).not.toHaveBeenCalled();
      expect(shadow.rrrCollapsePartialSold).toBeFalsy();
    });

    it('returnPct ≥ 기본임계(3%) + liveRRR<1.0 → 정상 발동', async () => {
      delete process.env[ENV_KEY];
      // entry 100, currentPrice 104 (+4% ≥ 3%), target 105, hardStop 98
      //   reward 1 / risk 6 = 0.17 RRR (<1.0)
      const shadow = makeMockShadow({ targetPrice: 105, quantity: 100 });
      await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 104, hardStopLoss: 98 }));
      expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'TAKE_PROFIT');
      expect(shadow.rrrCollapsePartialSold).toBe(true);
    });

    it('RRR_COLLAPSE_MIN_PROFIT_PCT=0 → 구 동작 복귀 (returnPct +1% 에서도 발동)', async () => {
      process.env[ENV_KEY] = '0';
      const shadow = makeMockShadow({ targetPrice: 102, quantity: 100 });
      await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 101, hardStopLoss: 95 }));
      expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'TAKE_PROFIT');
      expect(shadow.rrrCollapsePartialSold).toBe(true);
    });

    it('ENV 음수·NaN → 기본값(3%)로 안전 폴백 (returnPct +1% 보류)', async () => {
      process.env[ENV_KEY] = 'abc';
      const shadow = makeMockShadow({ targetPrice: 102, quantity: 100 });
      await rrrCollapseExit(makeMockCtx({ shadow, currentPrice: 101, hardStopLoss: 95 }));
      expect(placeKisSellOrder).not.toHaveBeenCalled();
    });
  });
});
