import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../learning/regimeLearningBank.js', () => ({
  collectRegimeLearningBank: vi.fn(() => ({ activeRegime: 'R6_DEFENSE', stats: [] })),
  collectRegimeLearningConsistency: vi.fn(() => ({ regimeSumMatchesTotal: true })),
  formatRegimeLearningConsistency: vi.fn(() => 'REGIME_CONSISTENCY regimeSumMatchesTotal=true'),
  formatRegimeLearningSummary: vi.fn(() => 'REGIME_SUMMARY recommendationOnly=true promotionAllowed=false'),
  formatRegimeLearningDetail: vi.fn((regime: string) => `REGIME_DETAIL ${regime} recommendationOnly=true promotionAllowed=false`),
}));

vi.mock('../../../learning/regimeLearningBackfill.js', () => ({
  regimeLearningBackfillDryRun: vi.fn(() => ({ scannedTotal: 0 })),
  regimeLearningBackfillRun: vi.fn(() => ({ scannedTotal: 0, updated: 0 })),
  formatRegimeLearningBackfillDryRun: vi.fn(() => 'REGIME_BACKFILL_DRYRUN executionImpact=NONE brokerOrdersCreated=0'),
  formatRegimeLearningBackfillRun: vi.fn(() => 'REGIME_BACKFILL_RUN executionImpact=NONE brokerOrdersCreated=0 promotionAllowed=false'),
}));

describe('/regime_learning commands', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { commandRegistry } = await import('../../commandRegistry.js');
    commandRegistry.__resetForTests();
  });

  it('registers summary/detail as read-only learning commands', async () => {
    await import('./regimeLearning.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');

    expect(commandRegistry.resolve('/regime_learning')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_learning_detail')?.category).toBe('LRN');
    expect(commandRegistry.resolve('/regime_learning_backfill_dryrun')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_learning_backfill_run')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_learning_consistency')?.category).toBe('LRN');
  });

  it('replies with regime learning summary and detail', async () => {
    const mod = await import('./regimeLearning.cmd.js');
    const reply = vi.fn(async (_msg: string) => {});

    await mod.default.execute({ args: [], reply });
    expect(reply.mock.calls[0][0]).toContain('REGIME_SUMMARY');

    await mod.regimeLearningDetail.execute({ args: ['R6_DEFENSE'], reply });
    expect(reply.mock.calls[1][0]).toContain('REGIME_DETAIL R6_DEFENSE');
    expect(reply.mock.calls[1][0]).toContain('promotionAllowed=false');

    await mod.regimeLearningBackfillDryrun.execute({ args: [], reply });
    expect(reply.mock.calls[2][0]).toContain('REGIME_BACKFILL_DRYRUN');

    await mod.regimeLearningBackfillRunCmd.execute({ args: [], reply });
    expect(reply.mock.calls[3][0]).toContain('REGIME_BACKFILL_RUN');

    await mod.regimeLearningConsistency.execute({ args: [], reply });
    expect(reply.mock.calls[4][0]).toContain('REGIME_CONSISTENCY');
  });
});
