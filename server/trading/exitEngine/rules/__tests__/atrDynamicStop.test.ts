/**
 * @responsibility atrDynamicStop ATR 동적 손절 BEP 보호 + Lock-in 래칫 단위 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../../persistence/shadowTradeRepo.js');
  return { ...actual, appendShadowLog: vi.fn() };
});
vi.mock('../../../entryEngine.js', () => ({ regimeToStopRegime: vi.fn(() => 'NORMAL') }));
vi.mock('../../../../../src/services/quant/dynamicStopEngine.js', () => ({
  evaluateDynamicStop: vi.fn(),
}));

const { atrDynamicStop } = await import('../atrDynamicStop.js');
const { makeMockShadow, makeMockCtx } = await import('./_testHelpers.js');
const { evaluateDynamicStop } = await import('../../../../../src/services/quant/dynamicStopEngine.js');
const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');

describe('atrDynamicStop (BEP / Lock-in 래칫)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('entryATR14 미설정 → NO_OP', async () => {
    const shadow = makeMockShadow({ entryATR14: undefined });
    const r = await atrDynamicStop(makeMockCtx({ shadow }));
    expect(r.skipRest).toBe(false);
    expect(r.hardStopLossUpdate).toBeUndefined();
    expect(evaluateDynamicStop).not.toHaveBeenCalled();
  });

  it('새 손절 ≤ 기존 hardStopLoss → 래칫 (변경 없음)', async () => {
    (evaluateDynamicStop as any).mockReturnValue({
      stopPrice: 85, trailingStopPrice: 85, trailingActive: false,
      profitLockIn: false, bepProtection: false,
    });
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const r = await atrDynamicStop(makeMockCtx({ shadow, hardStopLoss: 90 }));
    expect(r.hardStopLossUpdate).toBeUndefined();
    expect(shadow.hardStopLoss).toBe(90);
  });

  it('수익 Lock-in 갱신 → hardStopLossUpdate 반환 + 텔레그램', async () => {
    (evaluateDynamicStop as any).mockReturnValue({
      stopPrice: 103, trailingStopPrice: 103, trailingActive: false,
      profitLockIn: true, bepProtection: false,
    });
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const r = await atrDynamicStop(makeMockCtx({ shadow, currentPrice: 110, hardStopLoss: 90 }));
    expect(r.hardStopLossUpdate).toBe(103);
    expect(shadow.hardStopLoss).toBe(103);
    expect(shadow.dynamicStopPrice).toBe(103);
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
  });

  it('BEP 보호 갱신 → hardStopLossUpdate + BEP 알림', async () => {
    (evaluateDynamicStop as any).mockReturnValue({
      stopPrice: 100, trailingStopPrice: 100, trailingActive: false,
      profitLockIn: false, bepProtection: true,
    });
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const r = await atrDynamicStop(makeMockCtx({ shadow, currentPrice: 105, hardStopLoss: 90 }));
    expect(r.hardStopLossUpdate).toBe(100);
    expect(sendTelegramAlert).toHaveBeenCalledOnce();
  });

  it('trailingActive=true 면 trailingStopPrice 사용', async () => {
    (evaluateDynamicStop as any).mockReturnValue({
      stopPrice: 95, trailingStopPrice: 105, trailingActive: true,
      profitLockIn: false, bepProtection: false,
    });
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const r = await atrDynamicStop(makeMockCtx({ shadow, hardStopLoss: 90 }));
    expect(r.hardStopLossUpdate).toBe(105); // trailing 우선
  });

  it('skipRest 항상 false (전파 mutation 만)', async () => {
    (evaluateDynamicStop as any).mockReturnValue({
      stopPrice: 105, trailingStopPrice: 105, trailingActive: false,
      profitLockIn: true, bepProtection: false,
    });
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const r = await atrDynamicStop(makeMockCtx({ shadow, hardStopLoss: 90 }));
    expect(r.skipRest).toBe(false);
  });
});
