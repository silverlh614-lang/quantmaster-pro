// @responsibility Verify retired regime liquidation cannot send orders, mutate positions, or create delayed exit intents in any trade mode.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { r6EmergencyExit } from '../r6EmergencyExit.js';
import { makeMockShadow, makeMockCtx } from './_testHelpers.js';

const effects = vi.hoisted(() => ({ reserve: vi.fn(), fill: vi.fn(), event: vi.fn(), pending: vi.fn() }));
vi.mock('../../helpers/reserveSell.js', () => ({ placeReservedSellOrder: effects.reserve }));
vi.mock('../../../../persistence/shadowTradeRepo.js', () => ({ appendFill: effects.fill }));
vi.mock('../../../../alerts/telegramEventRouter.js', () => ({ emitTelegramEvent: effects.event }));
vi.mock('../../../../persistence/pendingEmergencyExitQueueRepo.js', () => ({ appendPendingEmergencyExit: effects.pending }));
beforeEach(() => vi.clearAllMocks());

describe('retired R6 liquidation hook', () => {
  it.each(['LIVE', 'SHADOW', undefined] as const)('is inert for mode %s even when an old caller supplies R6', async (mode) => {
    const trade = makeMockShadow({ mode, quantity: 100 });
    const before = structuredClone(trade);
    const result = await r6EmergencyExit(makeMockCtx({ shadow: trade, currentRegime: 'R6_DEFENSE', currentPrice: 80 }));
    expect(result).toEqual({ skipRest: false });
    expect(trade).toEqual(before);
    for (const dependency of Object.values(effects)) expect(dependency).not.toHaveBeenCalled();
  });
});
