import { describe, expect, it } from 'vitest';
import type { DataPromotionAuditInput } from '../../../src/types/dataPromotion.types.js';
import { buildInvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import { buildProgramTradingDataLineReportAdr0490 } from './programTradingDataLineAdr0490.js';
import { buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { recordSupplySnapshotAdr0491 } from './supplySnapshotStoreReplayAdr0491.js';
import { runFreshDataSchedulerAdr0492 } from './freshDataSchedulerAdr0492.js';
import {
  buildPromotionAuditInputForDataLineAdr0494,
  evaluateFreshDataPromotionAuditsAdr0494,
  formatPromotionAuditCompactAdr0494,
  formatPromotionAuditDetailAdr0494,
} from './freshDataPromotionAuditWiringAdr0494.js';

function sectorReport() {
  return buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
    generatedAt: '2026-05-09T00:00:00.000Z',
    sectorMasterRecords: [
      { sectorName: 'Energy', indexCode: 'IDX001', market: 'KR', source: 'KRX', normalized: true, fetchedAt: '2026-05-09T00:00:00.000Z' },
      { sectorName: 'Chemical', indexCode: 'IDX002', market: 'KR', source: 'KRX', normalized: true, fetchedAt: '2026-05-09T00:00:00.000Z' },
    ],
    providerIssue: true,
    marketSignal: false,
  });
}

describe('ADR-0494 Fresh Data Promotion Audit Wiring', () => {
  it('promotion_wiring_calls_adr0493_audit', () => {
    let called = 0;
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'SECTOR_ENERGY', report: sectorReport() });
    const audits = evaluateFreshDataPromotionAuditsAdr0494([input], {
      store: null,
      evaluator: (auditInput: DataPromotionAuditInput) => {
        called += 1;
        return {
          auditId: 'test-audit',
          dataLineId: auditInput.dataLineId,
          auditedAt: '2026-05-09T00:00:00.000Z',
          currentStage: auditInput.currentStage,
          requestedNextStage: auditInput.requestedNextStage,
          status: 'PASS',
          decision: 'ALLOW_PROMOTION',
          score: 100,
          requiredScore: 40,
          passedChecks: [],
          warnings: [],
          blockReasons: [],
          canPromote: true,
          recommendedStage: auditInput.requestedNextStage,
          executionImpact: 'NONE',
        };
      },
    });
    expect(called).toBe(1);
    expect(audits[0].result.dataLineId).toBe('sectorEnergy');
  });

  it('sector_energy_audit_input_mapping', () => {
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'SECTOR_ENERGY', report: sectorReport() });
    expect(input.sourceType).toBe('SECTOR_ENERGY');
    expect(input.dataLineId).toBe('sectorEnergy');
    expect(input.currentStage).toBe('SHADOW_SCORE');
    expect(input.requestedNextStage).toBe('ADVISORY');
    expect(input.totalSnapshots).toBe(2);
    expect(input.providerFailureCount).toBe(0);
    expect(input.providerMarketSignalMixedCount).toBe(0);
    expect(input.latestExecutionImpact).toBe('NONE');
  });

  it('investor_flow_audit_input_mapping', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489({
      generatedAt: '2026-05-09T00:00:00.000Z',
      samples: [{ symbol: '005930', provider: 'NAVER', foreignNetBuy: 10, institutionNetBuy: null, programNetBuy: null }],
    });
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'INVESTOR_FLOW', report });
    expect(input.sourceType).toBe('INVESTOR_FLOW');
    expect(input.totalSnapshots).toBe(1);
    expect(input.missingSnapshotCount).toBe(0);
    expect(input.providerFailureCount).toBe(0);
    expect(input.currentStage).toBe('OBSERVE');
    expect(input.requestedNextStage).toBe('SHADOW_RAW');
  });

  it('program_trading_audit_input_mapping', () => {
    const report = buildProgramTradingDataLineReportAdr0490({
      generatedAt: '2026-05-09T00:00:00.000Z',
      rows: [{ symbol: '005930', provider: 'KRX', programNetBuy: 100 }],
    });
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'PROGRAM_TRADING', report });
    expect(input.sourceType).toBe('PROGRAM_TRADING');
    expect(input.totalSnapshots).toBe(1);
    expect(input.missingSnapshotCount).toBe(0);
    expect(input.providerFailureCount).toBe(0);
  });

  it('can_promote_does_not_mutate_stage', () => {
    const dataLine = { stage: 'OBSERVE' as const };
    const input = buildPromotionAuditInputForDataLineAdr0494({
      sourceType: 'INVESTOR_FLOW',
      report: buildInvestorFlowSampleAcquisitionReportAdr0489({ samples: [{ foreignNetBuy: 1 }] }),
      currentStage: dataLine.stage,
      requestedNextStage: 'SHADOW_RAW',
    });
    const [audit] = evaluateFreshDataPromotionAuditsAdr0494([input], { store: null });
    expect(audit.result.canPromote).toBe(false);
    expect(audit.result.decision).toBe('KEEP_CURRENT_STAGE');
    expect(audit.result.recommendedStage).toBe('OBSERVE');
    expect(dataLine.stage).toBe('OBSERVE');
  });

  it('promotion_wiring_has_no_live_effect', () => {
    const source = buildPromotionAuditInputForDataLineAdr0494.toString() + evaluateFreshDataPromotionAuditsAdr0494.toString();
    expect(source).not.toMatch(/createLiveOrder|placeOrder|executeOrder|setLiveGate|mutateGate|hardBlock/i);
    const audit = evaluateFreshDataPromotionAuditsAdr0494([
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'PROGRAM_TRADING', report: buildProgramTradingDataLineReportAdr0490({ rows: [{ programNetBuy: 1 }] }) }),
    ], { store: null })[0];
    expect(audit.executionImpact).toBe('NONE');
  });

  it('promotion_wiring_execution_impact_none', () => {
    const snapshot = recordSupplySnapshotAdr0491({ filePath: `/tmp/qmp-adr0494-${Date.now()}.json`, scanId: 'scan-1', maxSnapshots: 3 });
    const scheduler = runFreshDataSchedulerAdr0492({
      now: '2026-05-09T00:00:00.000Z',
      filePath: `/tmp/qmp-adr0494-scheduler-${Date.now()}.json`,
      providerInputs: [{ providerId: 'NAVER', health: 'UP', sampleCount: 1 }],
    });
    const inputs = [
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'SUPPLY_SNAPSHOT', report: snapshot }),
      buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'FRESH_DATA_SCHEDULER', report: scheduler }),
    ];
    const audits = evaluateFreshDataPromotionAuditsAdr0494(inputs, { store: null });
    expect(audits.every((audit) => audit.executionImpact === 'NONE' && audit.result.executionImpact === 'NONE')).toBe(true);
  });

  it('blocked_lines_include_block_reasons', () => {
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'INVESTOR_FLOW', report: buildInvestorFlowSampleAcquisitionReportAdr0489() });
    const [audit] = evaluateFreshDataPromotionAuditsAdr0494([input], { store: null });
    expect(audit.result.canPromote).toBe(false);
    expect(audit.result.blockReasons.length).toBeGreaterThan(0);
  });

  it('core_promotion_still_blocked', () => {
    const input = buildPromotionAuditInputForDataLineAdr0494({
      sourceType: 'SECTOR_ENERGY',
      report: sectorReport(),
      currentStage: 'GATED',
      requestedNextStage: 'CORE',
      tradingDaysObserved: 100,
      liveRegressionPassed: true,
      nullZeroSeparationPassed: true,
      holidayFreshnessPassed: true,
      testCoveragePassed: true,
      shadowContributionScore: 10,
    });
    const [audit] = evaluateFreshDataPromotionAuditsAdr0494([input], { store: null });
    expect(audit.result.canPromote).toBe(false);
    expect(audit.result.blockReasons).toContain('CORE_PROMOTION_NOT_ALLOWED');
    expect(audit.result.recommendedStage).toBe('GATED');
  });

  it('diagnostic_format_contains_stage_score_blocks', () => {
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'INVESTOR_FLOW', report: buildInvestorFlowSampleAcquisitionReportAdr0489() });
    const [audit] = evaluateFreshDataPromotionAuditsAdr0494([input], { store: null });
    const compact = formatPromotionAuditCompactAdr0494(audit);
    const detail = formatPromotionAuditDetailAdr0494(audit);
    expect(compact).toContain('stage=');
    expect(compact).toContain('score=');
    expect(compact).toContain('blocks=');
    expect(detail).toContain('currentStage=');
    expect(detail).toContain('score=');
    expect(detail).toContain('blockReasons=');
  });
});
