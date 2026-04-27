/**
 * @responsibility euphoriaPartialExit 과열 50% 1회 부분익절 단위 테스트
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
vi.mock('../../../riskManager.js', () => ({ checkEuphoria: vi.fn() }));

const { euphoriaPartialExit } = await import('../euphoriaPartialExit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { checkEuphoria } = await import('../../../riskManager.js');

describe('euphoriaPartialExit (과열 50%)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('status=HIT_TARGET → NO_OP (이미 청산)', async () => {
    const shadow = makeMockShadow({ status: 'HIT_TARGET' });
    await euphoriaPartialExit(makeMockCtx({ shadow }));
    expect(checkEuphoria).not.toHaveBeenCalled();
  });

  it('status=ACTIVE + euphoria 미감지 → NO_OP', async () => {
    (checkEuphoria as any).mockReturnValue({ triggered: false, count: 0, signals: [] });
    const shadow = makeMockShadow({ status: 'ACTIVE' });
    await euphoriaPartialExit(makeMockCtx({ shadow }));
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('euphoria 트리거 → 50% 부분매도 + status EUPHORIA_PARTIAL 전이', async () => {
    (checkEuphoria as any).mockReturnValue({ triggered: true, count: 3, signals: ['volume', 'rsi', 'gap'] });
    const shadow = makeMockShadow({ status: 'ACTIVE', quantity: 100 });
    await euphoriaPartialExit(makeMockCtx({ shadow }));
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 50, 'EUPHORIA');
    expect(shadow.status).toBe('EUPHORIA_PARTIAL');
    expect(shadow.exitRuleTag).toBe('EUPHORIA_PARTIAL');
  });

  it('FAILED outcome → status 롤백 + CRITICAL 알림', async () => {
    (checkEuphoria as any).mockReturnValue({ triggered: true, count: 3, signals: ['x'] });
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ status: 'ACTIVE', quantity: 100 });
    await euphoriaPartialExit(makeMockCtx({ shadow }));
    expect(shadow.status).toBe('ACTIVE'); // 롤백
  });

  it('PARTIALLY_FILLED 상태에서도 발동 가능', async () => {
    (checkEuphoria as any).mockReturnValue({ triggered: true, count: 3, signals: ['x'] });
    const shadow = makeMockShadow({ status: 'PARTIALLY_FILLED', quantity: 100 });
    await euphoriaPartialExit(makeMockCtx({ shadow }));
    expect(placeKisSellOrder).toHaveBeenCalled();
  });
});
