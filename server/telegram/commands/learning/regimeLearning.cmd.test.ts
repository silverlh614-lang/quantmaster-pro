import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../learning/regimeLearningBank.js', () => ({
  collectRegimeLearningBank: vi.fn(() => ({ activeRegime: 'R6_DEFENSE', stats: [] })),
  collectRegimeLearningConsistency: vi.fn(() => ({ regimeSumMatchesTotal: true })),
  collectRegimeResolvedStatus: vi.fn(() => ({ rows: [] })),
  formatRegimeConditionAttribution: vi.fn(() => 'REGIME_CONDITION_ATTRIBUTION recommendationOnly=true promotionAllowed=false'),
  formatRegimeAttributionRecalc: vi.fn((_summary: unknown, title: string) => `${title} noWeightUpdate=true recommendationOnly=true executionImpact=NONE`),
  formatRegimeLearningConsistency: vi.fn(() => 'REGIME_CONSISTENCY regimeSumMatchesTotal=true'),
  formatRegimeLearningSummary: vi.fn(() => 'REGIME_SUMMARY recommendationOnly=true promotionAllowed=false'),
  formatRegimeLearningDetail: vi.fn((regime: string) => `REGIME_DETAIL ${regime} recommendationOnly=true promotionAllowed=false`),
  formatRegimeLearningQuality: vi.fn(() => 'REGIME_QUALITY resolvedSampleSize=3 promotionAllowed=false recommendationOnly=true'),
  formatRegimeResolvedStatus: vi.fn(() => 'REGIME_RESOLVED_STATUS R3_EXPANSION resolvedSampleSize=3 pendingCounterfactualCount=453 executionImpact=NONE'),
  regimeAttributionRecalcDryRun: vi.fn(() => ({ regimesNeedingRecalc: ['R3_EXPANSION'] })),
  regimeAttributionRecalcRun: vi.fn(() => ({ recalculatedRegimes: ['R3_EXPANSION'], noWeightUpdate: true })),
}));

vi.mock('../../../learning/regimeLearningBackfill.js', () => ({
  regimeLearningBackfillDryRun: vi.fn(() => ({ scannedTotal: 0 })),
  regimeLearningBackfillRun: vi.fn(() => ({ scannedTotal: 0, updated: 0 })),
  regimeUnknownAnalysis: vi.fn(() => ({ unknownTotal: 0 })),
  regimeUnknownRepairDryRun: vi.fn(() => ({ scannedUnknown: 0 })),
  regimeUnknownRepairRun: vi.fn(() => ({ scannedUnknown: 0 })),
  formatRegimeLearningBackfillDryRun: vi.fn(() => 'REGIME_BACKFILL_DRYRUN executionImpact=NONE brokerOrdersCreated=0'),
  formatRegimeLearningBackfillRun: vi.fn(() => 'REGIME_BACKFILL_RUN executionImpact=NONE brokerOrdersCreated=0 promotionAllowed=false'),
  formatRegimeUnknownAnalysis: vi.fn(() => 'REGIME_UNKNOWN_ANALYSIS executionImpact=NONE'),
  formatRegimeUnknownRepair: vi.fn((_s, mode: string) => `REGIME_UNKNOWN_REPAIR_${mode} brokerOrdersCreated=0`),
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
    expect(commandRegistry.resolve('/regime_learning_quality')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_unknown_analysis')?.category).toBe('LRN');
    expect(commandRegistry.resolve('/regime_unknown_repair_dryrun')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_unknown_repair_run')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_condition_attribution')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_resolved_status')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_attribution_recalc_dryrun')?.riskLevel).toBe(0);
    expect(commandRegistry.resolve('/regime_attribution_recalc_run')?.riskLevel).toBe(0);
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

    await mod.regimeLearningQuality.execute({ args: [], reply });
    expect(reply.mock.calls[5][0]).toContain('REGIME_QUALITY');

    await mod.regimeUnknownAnalysisCmd.execute({ args: [], reply });
    expect(reply.mock.calls[6][0]).toContain('REGIME_UNKNOWN_ANALYSIS');

    await mod.regimeUnknownRepairDryrunCmd.execute({ args: [], reply });
    expect(reply.mock.calls[7][0]).toContain('REGIME_UNKNOWN_REPAIR_dryrun');

    await mod.regimeUnknownRepairRunCmd.execute({ args: [], reply });
    expect(reply.mock.calls[8][0]).toContain('REGIME_UNKNOWN_REPAIR_run');

    await mod.regimeConditionAttribution.execute({ args: ['R3_EXPANSION'], reply });
    expect(reply.mock.calls[9][0]).toContain('REGIME_CONDITION_ATTRIBUTION');

    await mod.regimeResolvedStatus.execute({ args: [], reply });
    expect(reply.mock.calls[10][0]).toContain('REGIME_RESOLVED_STATUS');

    await mod.regimeAttributionRecalcDryrun.execute({ args: [], reply });
    expect(reply.mock.calls[11][0]).toContain('regime_attribution_recalc_dryrun');

    await mod.regimeAttributionRecalcRunCmd.execute({ args: [], reply });
    expect(reply.mock.calls[12][0]).toContain('regime_attribution_recalc_run');
    expect(reply.mock.calls[12][0]).toContain('noWeightUpdate=true');
  });
});
