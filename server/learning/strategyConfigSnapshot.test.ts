import { describe, expect, it } from 'vitest';
import { buildStrategyConfigSnapshot, strategyConfigHash } from './strategyVersioning.js';

describe('ADR-0526 strategy config snapshot', () => {
  it('captures weights, promotion stages, policies and stable hash', () => {
    const snapshot = buildStrategyConfigSnapshot();
    const hash = strategyConfigHash(snapshot);

    expect(snapshot.gate1Weights.watchlistScore).toBeGreaterThan(0);
    expect(snapshot.gate2Weights.SUPPLY_CONFLUENCE).toBeGreaterThan(0);
    expect(snapshot.factorPromotionStages.SUPPLY_CONFLUENCE).toBeDefined();
    expect(snapshot.confidenceRules.aiEstimatedMaxStage).toBe('ADVISORY');
    expect(snapshot.policySettings.providerIssuePolicy).toMatchObject({ marketSignal: false });
    expect(hash).toHaveLength(64);
    expect(strategyConfigHash(JSON.parse(JSON.stringify(snapshot)))).toBe(hash);
  });
});
