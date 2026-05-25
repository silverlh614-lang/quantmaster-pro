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
    // ADR-0527 Phase 2b: 명령은 더미-시각(1970) 재판정 대신 persist 된 통합 정본
    // (candidateExecutionResolutions / executionResolutionAggregate)을 read 한다. 따라서 mock 은
    // producer(persistScanResults)가 영속하는 정본 형태를 직접 제공한다(스캔-시점 asOf, divergence 0).
    // SELL_ONLY: entry-ready 후보가 live 차단되어 shadow 로 흡수된 1건 시나리오.
    mockSummary = {
      sourceSnapshotId: 'scan-exec:test',
      asOf: '2026-05-24T09:00:00.000Z',
      engineMode: 'SELL_ONLY',
      marketSession: 'REGULAR',
      effectiveRegime: 'GREEN',
      candidateExecutionResolutions: [
        {
          sourceSnapshotId: 'scan-exec:test',
          asOf: '2026-05-24T09:00:00.000Z',
          liveOrderAllowed: false,
          liveSellAllowed: false,
          shadowPermissionAllowed: true,
          counterfactualAllowed: true,
          paperFillAllowed: true,
          learningAllowed: true,
          decision: 'BUY',
          convictionLabel: 'BUY',
          strongBuyAsLabelOnly: true,
          liveBlockReason: 'SELL_ONLY_MODE',
          executionImpact: 'NONE',
          sizingMultiplier: 1,
          scorePenalty: 0,
          marketSignal: false,
          providerIssueIsolated: false,
          policyLabels: [],
          learningLabels: [],
          reasonCodes: ['SELL_ONLY_LIVE_BUY_BLOCKED'],
        },
      ],
      executionResolutionAggregate: {
        entryReadyCount: { scope: 'ALL_CANDIDATES', value: 1 },
        liveBuyAllowedCount: { scope: 'LIVE_SAMPLE', value: 0 },
        liveBuyBlockedCount: { scope: 'LIVE_SAMPLE', value: 1 },
        shadowOrderCreated: { scope: 'PAPER_OBSERVATIONAL', value: 1 },
        observeOnlyCount: { scope: 'ALL_CANDIDATES', value: 0 },
        blockedCount: { scope: 'ALL_CANDIDATES', value: 0 },
        providerIssueIsolatedCount: { scope: 'ALL_CANDIDATES', value: 0 },
        blockReasonDistribution: { SELL_ONLY_LIVE_BUY_BLOCKED: 1 },
        topBlockReason: 'SELL_ONLY_LIVE_BUY_BLOCKED',
      },
    };
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
  });

  it('registers command and displays unified execution audit from persisted SSOT without executing orders', async () => {
    const registry = await import('../../commandRegistry.js');
    await import('./scanBlockersExecution.cmd.js');

    const command = registry.commandRegistry.resolve('/scan_blockers_execution');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/execution_audit')).toBe(command);

    const replies: string[] = [];
    await command!.execute({
      args: ['full'],
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
