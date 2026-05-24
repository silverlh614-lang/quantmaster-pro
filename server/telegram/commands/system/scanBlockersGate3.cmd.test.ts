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
            'Gate3: WAIT | issue=RRR_BELOW_2_0 | priceFresh=VERIFIED | rrr=1.6 | falseBreakout=LOW | executionImpact=NONE | marketSignal=false': 1,
          },
          timingReadiness: { WAIT: 1, READY: 1 },
          lastTriggerStatus: { THRESHOLD_NOT_MET: 1, FIRED: 1 },
          priceFreshness: { VERIFIED: 2 },
          executionImpact: { NONE: 2 },
          lastTriggerPassCount: 1,
          lastTriggerWaitCount: 1,
          entryPriceStaleCount: 0,
          rrrFailCount: 1,
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
    expect(text).toContain('[scan_blockers_gate3] Gate3 Entry Timing / LastTrigger / Price Guard');
    expect(text).toContain('Gate3 Timing Readiness');
    expect(text).toContain('gate3Pass: 1');
    expect(text).toContain('lastTriggerPass: 1');
    expect(text).toContain('lastTriggerWait: 1');
    expect(text).toContain('rrrFail: 1');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('no scan execution');
  }, 15000);
});
