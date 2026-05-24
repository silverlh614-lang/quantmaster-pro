import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSummary: any;

vi.mock('../../commandRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../../commandRegistry.js')>('../../commandRegistry.js');
  return actual;
});

vi.mock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
  getLastScanSummary: () => mockSummary,
}));

describe('/scan_blockers_execution command', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockSummary = {
      sourceSnapshotId: 'scan-exec:test',
      asOf: '2026-05-24T09:00:00.000Z',
      engineMode: 'SELL_ONLY',
      marketSession: 'REGULAR',
      effectiveRegime: 'GREEN',
      entryFilterDecomposition: {
        candidateTraces: [
          {
            symbol: '204320',
            gate1Passed: true,
            gate2Status: 'GATE2_PASS_STRONG',
            currentPrice: 10_000,
            high20d: 9_900,
            volume: 2_000_000,
            avgVolume20d: 1_000_000,
            rsi14: 58,
            macdHistogram: 0.2,
            priceFreshness: 'VERIFIED',
            entryPriceAgeSec: 20,
            stopLoss: 9_300,
            targetPrice: 11_500,
            falseBreakoutRisk: 'LOW',
          },
        ],
      },
    };
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers command and displays FinalDecision audit without executing orders', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersExecution.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_execution');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/execution_audit')).toBe(command);

    const replies: string[] = [];
    await command!.execute({
      args: [],
      reply: async message => {
        replies.push(message);
      },
    });

    const text = replies.join('\n');
    expect(text).toContain('[scan_blockers_execution] Final Decision / Execution Permission');
    expect(text).toContain('sourceSnapshotId=scan-exec:test');
    expect(text).toContain('entryReady: 1');
    expect(text).toContain('liveBuyAllowed: 0');
    expect(text).toContain('liveBuyBlocked: 1');
    expect(text).toContain('shadowBuyAllowed: 1');
    expect(text).toContain('SELL_ONLY_LIVE_BUY_BLOCKED');
    expect(text).toContain('providerIssueConvertedToMarketSignal: 0');
    expect(text).toContain('shadowLearning: ON');
    expect(text).toContain('counterfactualRecorded: 1');
    expect(text).toContain('gate3LivePermissionLeakDetected: 0');
    expect(text).toContain('diagnosticOnlyBrokerOrderLeakDetected: 0');
    expect(text).toContain('read-only diagnostic; no provider fetch, no broker order, no live promotion');
  });
});
