import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { DataLineStage, DataPromotionAuditInput } from '../../types/dataPromotion.types';
import { createInMemoryPromotionAuditStore, evaluatePromotionReadiness } from './dataPromotionAudit';

const moduleSources = () => [
  'src/data-line/promotion/dataPromotionAudit.ts',
  'src/data-line/promotion/promotionRules.ts',
  'src/data-line/promotion/promotionScore.ts',
  'src/data-line/promotion/promotionAuditStore.ts',
].map((file) => fs.readFileSync(path.resolve(file), 'utf-8')).join('\n');

function baseInput(overrides: Partial<DataPromotionAuditInput> = {}): DataPromotionAuditInput {
  return {
    dataLineId: 'sector-energy-master',
    dataLineName: 'Sector Energy Master',
    sourceType: 'SECTOR_ENERGY',
    currentStage: 'OBSERVE',
    requestedNextStage: 'SHADOW_RAW',
    tradingDaysObserved: 1,
    totalSnapshots: 1,
    missingSnapshotCount: 0,
    staleSnapshotCount: 0,
    staleMisclassificationCount: 0,
    providerFailureCount: 0,
    providerMarketSignalMixedCount: 0,
    shadowWinRate: null,
    shadowAverageReturn: null,
    shadowContributionScore: null,
    liveRegressionPassed: true,
    nullZeroSeparationPassed: true,
    holidayFreshnessPassed: true,
    executionImpactNonePassed: true,
    testCoveragePassed: true,
    latestExecutionImpact: 'NONE',
    providerHealthFieldPresent: true,
    freshnessFieldPresent: true,
    snapshotRecordable: true,
    ...overrides,
  };
}

function stagedInput(currentStage: DataLineStage, requestedNextStage: DataLineStage, overrides: Partial<DataPromotionAuditInput> = {}): DataPromotionAuditInput {
  return baseInput({
    currentStage,
    requestedNextStage,
    tradingDaysObserved: 50,
    totalSnapshots: 100,
    missingSnapshotCount: 0,
    staleSnapshotCount: 0,
    staleMisclassificationCount: 0,
    providerMarketSignalMixedCount: 0,
    shadowContributionScore: 1,
    liveRegressionPassed: true,
    nullZeroSeparationPassed: true,
    holidayFreshnessPassed: true,
    executionImpactNonePassed: true,
    testCoveragePassed: true,
    latestExecutionImpact: 'NONE',
    ...overrides,
  });
}

describe('ADR-0493 Data Promotion Readiness Audit', () => {
  it('observe_to_shadow_raw_allowed_with_basic_snapshot', () => {
    const result = evaluatePromotionReadiness(baseInput(), { store: null, auditedAt: '2026-05-09T00:00:00.000Z' });

    expect(result.canPromote).toBe(true);
    expect(result.decision).toBe('ALLOW_PROMOTION');
    expect(result.executionImpact).toBe('NONE');
    expect(result.recommendedStage).toBe('SHADOW_RAW');
  });

  it('shadow_raw_to_shadow_score_blocks_insufficient_history', () => {
    const result = evaluatePromotionReadiness(stagedInput('SHADOW_RAW', 'SHADOW_SCORE', { tradingDaysObserved: 4 }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.blockReasons).toContain('INSUFFICIENT_HISTORY');
  });

  it('advisory_to_weighted_requires_20_trading_days', () => {
    const result = evaluatePromotionReadiness(stagedInput('ADVISORY', 'WEIGHTED', { tradingDaysObserved: 19 }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('INSUFFICIENT_HISTORY');
    expect(result.recommendedStage).toBe('ADVISORY');
  });

  it('high_missing_rate_blocks_promotion', () => {
    const result = evaluatePromotionReadiness(stagedInput('SHADOW_SCORE', 'ADVISORY', { totalSnapshots: 10, missingSnapshotCount: 2 }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('HIGH_MISSING_RATE');
  });

  it('stale_misclassification_blocks_promotion', () => {
    const result = evaluatePromotionReadiness(stagedInput('ADVISORY', 'WEIGHTED', { staleMisclassificationCount: 3 }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('STALE_MISCLASSIFICATION');
  });

  it('provider_market_signal_mixed_blocks_promotion', () => {
    const result = evaluatePromotionReadiness(stagedInput('SHADOW_SCORE', 'ADVISORY', { providerMarketSignalMixedCount: 1 }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('PROVIDER_MARKET_SIGNAL_MIXED');
  });

  it('negative_shadow_contribution_blocks_weighted', () => {
    const result = evaluatePromotionReadiness(stagedInput('ADVISORY', 'WEIGHTED', { shadowContributionScore: 0 }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('NEGATIVE_SHADOW_CONTRIBUTION');
  });

  it('execution_impact_not_none_blocks_promotion', () => {
    const result = evaluatePromotionReadiness(stagedInput('OBSERVE', 'SHADOW_RAW', { latestExecutionImpact: 'ORDER' }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('EXECUTION_IMPACT_NOT_NONE');
    expect(result.executionImpact).toBe('NONE');
  });

  it('null_zero_separation_required', () => {
    const result = evaluatePromotionReadiness(stagedInput('SHADOW_RAW', 'SHADOW_SCORE', { nullZeroSeparationPassed: false }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons).toContain('NULL_ZERO_CONTAMINATION');
  });

  it('core_promotion_is_blocked_by_default', () => {
    const result = evaluatePromotionReadiness(stagedInput('GATED', 'CORE'), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.decision).toBe('DENY_PROMOTION');
    expect(result.blockReasons).toContain('CORE_PROMOTION_NOT_ALLOWED');
  });

  it('promotion_audit_has_no_live_effect', () => {
    const store = createInMemoryPromotionAuditStore();
    const result = evaluatePromotionReadiness(stagedInput('SHADOW_SCORE', 'ADVISORY'), { store });
    const forbiddenCallPattern = /\b(placeOrder|submitOrder|executeTrade|liveBuy|liveSell|mutateLiveGate|hardBlock|emitStrongBuy|emitBuy|emitSell)\s*\(/;

    expect(result.executionImpact).toBe('NONE');
    expect(store.list()).toHaveLength(1);
    expect(moduleSources()).not.toMatch(forbiddenCallPattern);
  });

  it('audit_returns_structured_failure_not_throw', () => {
    expect(() => evaluatePromotionReadiness(stagedInput('SHADOW_RAW', 'SHADOW_SCORE', {
      tradingDaysObserved: 0,
      totalSnapshots: 0,
      missingSnapshotCount: 0,
      nullZeroSeparationPassed: false,
    }), { store: null })).not.toThrow();

    const result = evaluatePromotionReadiness(stagedInput('SHADOW_RAW', 'SHADOW_SCORE', {
      tradingDaysObserved: 0,
      totalSnapshots: 0,
      missingSnapshotCount: 0,
      nullZeroSeparationPassed: false,
    }), { store: null });

    expect(result.canPromote).toBe(false);
    expect(result.blockReasons.length).toBeGreaterThan(0);
    expect(result.executionImpact).toBe('NONE');
  });

  it('audit_result_is_persisted_as_minimal_record', () => {
    const store = createInMemoryPromotionAuditStore();
    const result = evaluatePromotionReadiness(stagedInput('ADVISORY', 'WEIGHTED', { tradingDaysObserved: 10 }), { store, auditId: 'audit-fixed' });

    expect(store.list()).toEqual([expect.objectContaining({
      auditId: 'audit-fixed',
      dataLineId: result.dataLineId,
      currentStage: 'ADVISORY',
      requestedNextStage: 'WEIGHTED',
      status: result.status,
      decision: result.decision,
      score: result.score,
      blockReasons: result.blockReasons,
      warnings: result.warnings,
    })]);
  });
});
