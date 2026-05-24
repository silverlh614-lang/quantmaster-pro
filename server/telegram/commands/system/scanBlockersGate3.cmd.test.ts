import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSummary: any;

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

describe('/scan_blockers_gate3 command', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSummary = {
      gateLayerAudit: {
        gate1PassCount: 3,
        gate2PassCount: 2,
        gate3PassCount: 1,
        strongBuySuppressedByDataUnavailableCount: 0,
        topGate1BlockReasons: [],
        topGate2BlockReasons: [],
        topGate3BlockReasons: [],
        gate3Consolidated: {
          samples: 2,
          health: { TIMING_NOT_CONFIRMED: 1, OK: 1 },
          primaryIssue: { RRR_BELOW_2_0: 1, none: 1 },
          compactText: {
            'Gate3: WAIT | issue=RRR_FAIL | priceFresh=VERIFIED | rrr=1.20 FAIL | rrrSource=FALLBACK_PERCENT | price=NOT_CONFIRMED | volume=WEAK 0.80x | falseBreakout=LOW | executionImpact=NONE | marketSignal=false': 1,
          },
          timingReadiness: { WAIT: 1, READY: 1 },
          lastTriggerStatus: { THRESHOLD_NOT_MET: 1, FIRED: 1 },
          priceFreshness: { VERIFIED: 2 },
          executionImpact: { NONE: 2 },
          priceConfirmationStatus: { BREAKOUT_CONFIRMED: 1, NOT_CONFIRMED: 1 },
          volumeConfirmationStatus: { CONFIRMED: 1, WEAK: 1 },
          lastTriggerPassCount: 1,
          lastTriggerFiredCount: 1,
          lastTriggerWaitCount: 1,
          lastTriggerThresholdNotMetCount: 1,
          lastTriggerDataUnavailableCount: 0,
          entryPriceStaleCount: 0,
          priceBreakoutConfirmedCount: 1,
          priceNearBreakoutCount: 0,
          pricePullbackEntryCount: 0,
          priceNotConfirmedCount: 1,
          priceOverextendedCount: 0,
          volumeConfirmedCount: 1,
          volumePartialCount: 0,
          volumeDryUpCount: 0,
          volumeWeakCount: 1,
          volumeSpikeRiskCount: 0,
          rrrPassCount: 1,
          rrrWatchCount: 0,
          rrrFailCount: 1,
          rrrMissingCount: 0,
          rrrFallbackUsedCount: 1,
          falseBreakoutHighCount: 0,
          executionReadyCount: 1,
        },
      },
    };
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers aliases and replies with Gate3 timing readiness only', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersGate3.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_gate3');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate3_timing')).toBe(command);
    expect(registry.commandRegistry.resolve('/blockers_gate3')).toBe(command);

    const replies: string[] = [];
    await command!.execute({
      args: [],
      reply: async (message) => {
        replies.push(message);
      },
    });

    const text = replies.join('\n');
    expect(text).toContain('[scan_blockers_gate3] Gate3 Entry Timing / LastTrigger / Price & Volume Guard');
    expect(text).toContain('Gate3 Timing Readiness');
    expect(text).toContain('gate3Pass: 1');
    expect(text).toContain('lastTriggerPass: 1');
    expect(text).toContain('lastTriggerWait: 1');
    expect(text).toContain('lastTriggerThresholdNotMet: 1');
    expect(text).toContain('priceBreakoutConfirmed: 1');
    expect(text).toContain('volumeWeak: 1');
    expect(text).toContain('rrrPass: 1');
    expect(text).toContain('rrrFail: 1');
    expect(text).toContain('rrrMissing: 0');
    expect(text).toContain('rrrSource=FALLBACK_PERCENT');
    expect(text).toContain('price=NOT_CONFIRMED');
    expect(text).toContain('volume=WEAK 0.80x');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('no scan execution');
  }, 15000);
});
