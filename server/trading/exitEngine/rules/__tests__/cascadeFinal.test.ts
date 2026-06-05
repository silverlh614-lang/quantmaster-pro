/**
 * @responsibility cascadeFinal -25% 전량 / -30% 블랙리스트 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../clients/kisClient.js', async () => {
  const actual = await vi.importActual<any>('../../../../clients/kisClient.js');
  return {
    ...actual,
    placeKisSellOrder: vi.fn(() => Promise.resolve({ ordNo: null, placed: false, outcome: 'SHADOW_ONLY' })),
  };
});
// ADR-0466 — 알림 경로가 sendTelegramAlert → emitTelegramEvent taxonomy router 로
// 이관. 테스트는 router 를 mock 해 "알림 발송 + severity" intent 를 검증한다.
vi.mock('../../../../alerts/telegramEventRouter.js', () => ({ emitTelegramEvent: vi.fn(() => Promise.resolve(1)) }));
vi.mock('../../../../alerts/channelPipeline.js', () => ({ channelSellSignal: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../alerts/stopLossTransparencyReport.js', () => ({ sendStopLossTransparencyReport: vi.fn(() => Promise.resolve()) }));
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
vi.mock('../../../../persistence/blacklistRepo.js', () => ({ addToBlacklist: vi.fn() }));
// FAILED 분기 rollbackFullCloseOnFailure 의 real-fs appendShadowLog 플레이크 차단.
vi.mock('../../helpers/rollbackFullClose.js', () => ({
  captureFullCloseSnapshot: vi.fn(() => ({ status: 'ACTIVE', quantity: 100 })),
  rollbackFullCloseOnFailure: vi.fn(),
}));

const { cascadeFinal } = await import('../cascadeFinal.js');
const { makeMockShadow, makeMockCtx, LIVE_FAILED_RESULT } = await import('./_testHelpers.js');
const { placeKisSellOrder } = await import('../../../../clients/kisClient.js');
const { addToBlacklist } = await import('../../../../persistence/blacklistRepo.js');
const { emitTelegramEvent } = await import('../../../../alerts/telegramEventRouter.js');

describe('cascadeFinal (-25% 전량 / -30% 블랙리스트)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returnPct > -25 → NO_OP', async () => {
    const shadow = makeMockShadow();
    const r = await cascadeFinal(makeMockCtx({ shadow, currentPrice: 80 })); // -20%
    expect(r.skipRest).toBe(false);
    expect(placeKisSellOrder).not.toHaveBeenCalled();
  });

  it('-25% boundary (≤ -25) → 전량 청산 (블랙리스트는 미발동)', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    const r = await cascadeFinal(makeMockCtx({ shadow, currentPrice: 75 }));
    expect(r.skipRest).toBe(true);
    expect(placeKisSellOrder).toHaveBeenCalledWith('005930', '삼성전자', 100, 'STOP_LOSS');
    expect(shadow.status).toBe('HIT_STOP');
    expect(addToBlacklist).not.toHaveBeenCalled();
  });

  it('-30% boundary 진입 → 전량 청산 + 블랙리스트 등록 + 추가 알림', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    await cascadeFinal(makeMockCtx({ shadow, currentPrice: 70 })); // -30%
    expect(addToBlacklist).toHaveBeenCalledWith('005930', '삼성전자', expect.any(String));
    // -30% SHADOW 성공 → 블랙리스트 SELL_FILLED emit 1회 (FAILED 분기 미진입)
    expect(emitTelegramEvent).toHaveBeenCalledTimes(1);
  });

  it('FAILED outcome → 블랙리스트 등록 차단', async () => {
    (placeKisSellOrder as any).mockResolvedValueOnce(LIVE_FAILED_RESULT);
    const shadow = makeMockShadow({ quantity: 100 });
    await cascadeFinal(makeMockCtx({ shadow, currentPrice: 70 }));
    expect(addToBlacklist).not.toHaveBeenCalled();
    expect(emitTelegramEvent).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'CRITICAL' }),
    );
  });

  it('exitRuleTag = CASCADE_FINAL', async () => {
    const shadow = makeMockShadow({ quantity: 100 });
    await cascadeFinal(makeMockCtx({ shadow, currentPrice: 70 }));
    expect(shadow.exitRuleTag).toBe('CASCADE_FINAL');
  });
});
