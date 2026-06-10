// @responsibility /scan_blockers_gate0 compact Gate0 macro slice command tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSummary: any;

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', async () => {
  const actual = await import('../../../trading/signalScanner/scanDiagnostics/gate0MacroPermissionDecision.js');
  return {
    buildGate0Decision: actual.buildGate0Decision,
    formatGate0Decision: actual.formatGate0Decision,
    getLastScanSummary: () => mockSummary,
  };
});

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
      quoteFails: 0,
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
        liveEntryBlockedReason: 'R3_SANITY_GUARD',
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
    expect(text).toContain('sourceHealth=STALE');
    expect(text).toContain('sourceFreshness=UNKNOWN');
    expect(text).toContain('macroSnapshotAvailable=true');
    expect(text).toContain('macroSignalConfidence=STALE');
    expect(text).toContain('macroSignalReason=MACRO_SNAPSHOT_STALE');
    expect(text).toContain('raw=R3_EARLY');
    expect(text).toContain('effective=R3_EARLY');
    expect(text).toContain('display=SHADOW_ONLY');
    expect(text).toContain('mhs=67');
    expect(text).toContain('liveEntryAllowed=false');
    expect(text).toContain('usableForLiveOrder=false');
    expect(text).toContain('usableForBrokerOrder=false');
    expect(text).toContain('snapshotFreshnessForLive=STALE');
    expect(text).toContain('liveBlockReason=SNAPSHOT_STALE_NOT_LIVE_TRADABLE');
    expect(text).toContain('liveBlockSubReason=SHADOW_ONLY_POLICY');
    expect(text).toContain('paperOrderAllowed=true');
    expect(text).toContain('shadowAllowed=true');
    expect(text).toContain('counterfactualAllowed=true');
    expect(text).toContain('diagnosticAllowed=true');
    expect(text).toContain('macroMarketSignal=false');
    expect(text).toContain('providerIssue=false');
    expect(text).toContain('executionImpact=NONE');
    expect(text).toContain('finalExecutionPolicy=SHADOW_AND_DIAGNOSTIC_ONLY');
    expect(text).toContain('Shadow and counterfactual remain active');
  });
});
