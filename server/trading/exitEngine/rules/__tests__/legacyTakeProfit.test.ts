/**
 * @responsibility legacyTakeProfit TARGET_EXIT 트랜치 미설정 fallback 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', async () => {
  const actual = await vi.importActual<any>('../../../../clients/kisClient.js');
  return {
    ...actual,
    placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
  };
});
// ADR-0466 — 알림 경로가 sendTelegramAlert → emitTelegramEvent taxonomy router 로 이관.
vi.mock('../../../../alerts/telegramEventRouter.js', () => ({ emitTelegramEvent: vi.fn(() => Promise.resolve(1)) }));
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
// FAILED 분기의 rollbackFullCloseOnFailure 는 실제 appendShadowLog(real-fs
// data/shadow-log.json write)를 호출한다. 병렬 워커 간 torn read/write 로 인한
// 플레이크를 차단하기 위해 helper 를 stub 한다 — 본 테스트는 telegram CRITICAL
// 발송만 검증하므로 rollback 내부 효과 단언 없음(behavior 보존).
vi.mock('../../helpers/rollbackFullClose.js', () => ({
  captureFullCloseSnapshot: vi.fn(() => ({ status: 'ACTIVE', quantity: 100 })),
  rollbackFullCloseOnFailure: vi.fn(),
}));

const { legacyTakeProfit } = await import('../legacyTakeProfit.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT, makeLiveOrderedResult } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { emitTelegramEvent } = await import('../../../../alerts/telegramEventRouter.js');
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
    expect(emitTelegramEvent).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'CRITICAL' }),
    );
  });

  it('subType=FULL_CLOSE 로 fill 기록', async () => {
    const shadow = makeMockShadow({ quantity: 100, targetPrice: 120 });
    await legacyTakeProfit(makeMockCtx({ shadow, currentPrice: 125 }));
    expect(shadow.fills).toHaveLength(1);
    expect(shadow.fills![0].subType).toBe('FULL_CLOSE');
  });
});
