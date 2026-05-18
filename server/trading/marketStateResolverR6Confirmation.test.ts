import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveMarketState R6 confirmation wait display', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('../persistence/macroStateRepo.js');
    vi.doUnmock('./regimeBridge.js');
  });

  it('maps close/next-day confirmation blocking to R6_CONFIRMATION_WAIT display state', async () => {
    const now = new Date('2026-05-18T07:00:00.000Z');
    const macro = {
      updatedAt: now.toISOString(),
      mhs: 70,
      regime: 'GREEN',
      biasScore: -23.9,
    };

    vi.doMock('../persistence/macroStateRepo.js', () => ({
      loadMacroState: () => macro,
    }));
    vi.doMock('./regimeBridge.js', () => ({
      getRegimeDiagnostics: () => ({
        rawRegime: 'R4_NEUTRAL',
        effectiveRegime: 'R6_DEFENSE',
        r6RecoveryStatus: 'R6_DEFENSE',
        transitionReason: 'RAW_REGIME_RECONFIRMED',
        recoveryEvidence: {},
        sourceFreshness: 'FRESH',
        r6TriggerBreakdown: {
          activeR6Triggers: [],
          staleR6Triggers: [],
          triggerFreshness: 'FRESH',
          staleCarryForward: false,
          staleBlockedRecovery: false,
        },
        activeR6Triggers: [],
        previousR6Triggers: ['KOSPI_INTRADAY_LOW_SHOCK', 'KOSPI_CLOSE_SHOCK'],
        r6ShockLatch: true,
        recoveryBlockedReason: 'WAITING_FOR_CLOSE_OR_NEXT_TRADING_DAY_CONFIRMATION',
        transitionState: {
          r6StateMachineState: 'R6_DEFENSE',
          r6ShockLatch: true,
          r6ShockLatchReason: 'KOSPI_INTRADAY_LOW_SHOCK',
          latchReleaseEligibleAt: '2026-05-18T08:18:00.000Z',
          latchExpiresAt: '2026-05-18T23:18:00.000Z',
          latchDecayPercent: 0,
          previousR6Triggers: ['KOSPI_INTRADAY_LOW_SHOCK', 'KOSPI_CLOSE_SHOCK'],
          r6TriggerBreakdown: {
            activeR6Triggers: [],
            staleR6Triggers: [],
            triggerFreshness: 'FRESH',
            staleCarryForward: false,
            staleBlockedRecovery: false,
          },
        },
      }),
    }));
    vi.doMock('../observability/operationalWarn.js', () => ({
      defaultWarnTtlSec: () => 60,
      emitOperationalWarn: vi.fn(),
    }));

    const { resolveMarketState } = await import('./marketStateResolver.js');
    const snapshot = resolveMarketState(now);

    expect(snapshot.effectiveRegime).toBe('R6_CONFIRMATION_WAIT');
    expect(snapshot.displayTitle).toBe('R6_CONFIRMATION_WAIT');
    expect(snapshot.liveNewBuyAllowed).toBe(false);
    expect(snapshot.liveSellAllowed).toBe(true);
    expect(snapshot.positionManagementAllowed).toBe(true);
    expect(snapshot.shadowScanAllowed).toBe(true);
    expect(snapshot.shadowPaperFillAllowed).toBe(true);
    expect(snapshot.r6Latch?.activeTriggers).toEqual([]);
    expect(snapshot.r6Latch?.previousTriggers).toEqual(['KOSPI_INTRADAY_LOW_SHOCK', 'KOSPI_CLOSE_SHOCK']);
    expect(snapshot.macroState.executionImpact).toBe('NONE');
  });
});
