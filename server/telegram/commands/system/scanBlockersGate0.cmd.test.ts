// @responsibility /scan_blockers_gate0 compact Gate0 macro slice command tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSummary: any;

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

describe('/scan_blockers_gate0 command', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSummary = {
      time: '2026-05-24T09:00:00.000Z',
      snapshotId: 'scan-eval:gate0',
      candidates: 11,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 0,
      rrrMisses: 0,
      entries: 0,
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        macroRegimeRaw: 'R3_EARLY',
        macroRegimeEffective: 'R3_EARLY',
        displayRegime: 'SHADOW_ONLY',
        riskOverride: 'SHADOW_ONLY',
        engineMode: 'SHADOW_ONLY',
        sourceHealth: 'FRESH',
        regimeSnapshotId: 'regime:test',
        regimeSnapshotAsOf: '2026-05-24T08:59:00.000Z',
        regimeSnapshotTtlSec: 300,
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NORMAL',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        mhs: 67,
        kospi20dReturn: 2.4,
        watchlistEmpty: false,
        sellOnlyMode: false,
        liveEntryAllowed: true,
        shadowBuyAllowed: true,
        shadowSellAllowed: true,
        shadowLearningAllowed: true,
        counterfactualAllowed: true,
        diagnosticAllowed: true,
        brokerRouteAlive: true,
        brokerOrderAllowed: true,
        brokerLiveOrderAllowed: false,
        paperOrderAllowed: true,
        shadowAllowed: true,
      },
    };
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers aliases and replies with Gate0 macro permission diagnostics only', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersGate0.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_gate0');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate0_macro')).toBe(command);
    expect(registry.commandRegistry.resolve('/blockers_gate0')).toBe(command);

    const replies: string[] = [];
    await command!.execute({ args: [], reply: async message => { replies.push(message); } });
    const text = replies.join('\n');

    expect(text).toContain('[scan_blockers_gate0] Gate0 Macro / Permission Guard');
    expect(text).toContain('Gate0 Macro / Permission Guard');
    expect(text).toContain('sourceSnapshotId=scan-eval:gate0');
    expect(text).toContain('regimeSnapshotId=regime:test');
    expect(text).toContain('regime: raw=R3_EARLY effective=R3_EARLY display=SHADOW_ONLY riskOverride=SHADOW_ONLY');
    expect(text).toContain('mhs=67');
    expect(text).toContain('permissions: liveEntryAllowed=true brokerRouteAlive=true brokerLiveOrderAllowed=false');
    expect(text).toContain('macroMarketSignal=false');
    expect(text).toContain('providerIssue=false');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('no scan execution');
    expect(text).toContain('no broker order');
  });
});
