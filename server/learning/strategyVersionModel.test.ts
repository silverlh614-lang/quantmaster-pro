import { describe, expect, it } from 'vitest';
import { strategyVersionFixture } from './strategyVersioningFixtures.js';

describe('ADR-0526 strategy version model', () => {
  it('packages approved governance changes into a ready-for-shadow version artifact', () => {
    const version = strategyVersionFixture();

    expect(version.versionId).toBe('strategy-v2026-06-01-001');
    expect(version.status).toBe('READY_FOR_SHADOW');
    expect(version.createdBy).toBe('GOVERNANCE');
    expect(version.validation.passed).toBe(true);
    expect(version.rollbackPlan.rollbackPlanId).toBe('rollback-strategy-v2026-06-01-001');
    expect(version.rolloutPolicy.autoPromoteAllowed).toBe(false);
    expect(version.executionImpact).toBe('NONE');
  });
});
