// @responsibility Verify saved stops and price-based BEP/lock-in protection no longer depend on regime policy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../../alerts/telegramEventRouter.js', () => ({ emitTelegramEvent: vi.fn(async () => 1) }));
vi.mock('../../../../persistence/shadowTradeRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../../persistence/shadowTradeRepo.js')>()),
  appendShadowLog: vi.fn(),
}));
import { atrDynamicStop } from '../atrDynamicStop.js';
import { makeMockShadow, makeMockCtx } from './_testHelpers.js';
import { emitTelegramEvent } from '../../../../alerts/telegramEventRouter.js';

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('BEP_GLIDE_DISABLED', undefined); });
afterEach(() => vi.unstubAllEnvs());

describe('ATR profit protection without regime multipliers', () => {
  it('keeps the saved stop when entry ATR is unavailable', async () => {
    const shadow = makeMockShadow({ entryATR14: undefined });
    const result = await atrDynamicStop(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(result).toEqual({ skipRest: false });
    expect(emitTelegramEvent).not.toHaveBeenCalled();
  });

  it.each(['R1_TURBO', 'R4_NEUTRAL', 'R6_DEFENSE', undefined])('does not tighten a saved stop for regime %s', async (regime) => {
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const result = await atrDynamicStop({ ...makeMockCtx({ shadow, currentPrice: 101 }), currentRegime: regime as never });
    expect(result.hardStopLossUpdate).toBeUndefined();
    expect(shadow.hardStopLoss).toBe(90);
    expect(shadow.stopLossExitType).toBeUndefined();
    expect(emitTelegramEvent).not.toHaveBeenCalled();
  });

  it('preserves the existing +5% ATR-buffered BEP protection', async () => {
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const result = await atrDynamicStop(makeMockCtx({ shadow, currentPrice: 105 }));
    expect(result).toEqual({ skipRest: false, hardStopLossUpdate: 98 });
    expect(shadow.hardStopLoss).toBe(98);
    expect(shadow.stopLossExitType).toBe('PROFIT_PROTECTION');
    expect(emitTelegramEvent).toHaveBeenCalledOnce();
  });

  it('preserves the existing +10% profit lock at +3%', async () => {
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 90 });
    const result = await atrDynamicStop(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(result).toEqual({ skipRest: false, hardStopLossUpdate: 103 });
    expect(shadow.hardStopLoss).toBe(103);
    expect(shadow.dynamicStopPrice).toBe(103);
    expect(shadow.stopLossExitType).toBe('PROFIT_PROTECTION');
    expect(emitTelegramEvent).toHaveBeenCalledOnce();
  });

  it('never lowers an already higher saved protection level', async () => {
    const shadow = makeMockShadow({ entryATR14: 5, hardStopLoss: 105 });
    const result = await atrDynamicStop(makeMockCtx({ shadow, currentPrice: 110 }));
    expect(result).toEqual({ skipRest: false });
    expect(shadow.hardStopLoss).toBe(105);
    expect(emitTelegramEvent).not.toHaveBeenCalled();
  });
});
