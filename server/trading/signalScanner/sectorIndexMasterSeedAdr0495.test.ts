import { describe, expect, it } from 'vitest';
import { evaluateFreshDataPromotionAuditsAdr0494, buildPromotionAuditInputForDataLineAdr0494 } from './freshDataPromotionAuditWiringAdr0494.js';
import { buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488, classifySupplyUnknownRootCauseAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import {
  buildSectorEnergyFallbackSeedAdr0495,
  buildSectorIndexCodeMappingsAdr0495,
  buildSectorIndexMasterSeedAdr0495,
  evaluateSectorIndexMasterCoverageAdr0495,
} from './sectorIndexMasterSeedAdr0495.js';

describe('ADR-0495 Sector Index Master Seed & Mapping Repair', () => {
  it('sector_index_master_seed_has_records', () => {
    expect(buildSectorIndexMasterSeedAdr0495().length).toBeGreaterThanOrEqual(10);
  });

  it('sector_index_mapping_resolves_core_aliases', () => {
    const mappings = buildSectorIndexCodeMappingsAdr0495();
    const canonical = (sectorName: string) => mappings.find((mapping) => mapping.sectorName === sectorName)?.canonicalName;
    expect(canonical('조선주')).toBe('조선');
    expect(canonical('방산주')).toBe('방산');
    expect(canonical('원전')).toBe('원자력');
    expect(canonical('이차전지')).toBe('2차전지');
    expect(canonical('반도체주')).toBe('반도체');
  });

  it('unsafe_alias_is_not_auto_mapped', () => {
    const coverage = evaluateSectorIndexMasterCoverageAdr0495();
    const mappings = buildSectorIndexCodeMappingsAdr0495();
    const unsafe = mappings.find((mapping) => mapping.sectorName === '조방원');
    expect(unsafe?.isSafeAutoAlias).toBe(false);
    expect(unsafe?.mappingType).toBe('UNRESOLVED');
    expect(coverage.unresolvedSectorNames).toContain('조방원');
  });

  it('coverage_after_is_greater_than_zero', () => {
    const coverage = evaluateSectorIndexMasterCoverageAdr0495();
    expect(coverage.coverageAfter).toBeGreaterThan(0);
    expect(coverage.coveragePartial).toBeGreaterThan(0);
  });

  it('no_fake_verified_krx_codes', () => {
    for (const record of buildSectorIndexMasterSeedAdr0495()) {
      if (record.indexCode.startsWith('INTERNAL_PROXY:')) {
        expect(record.provider).toBe('INTERNAL');
        expect(record.confidence).not.toBe('VERIFIED');
      }
    }
  });

  it('fallback_does_not_unlock_leadership', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ generatedAt: '2026-05-09T00:00:00.000Z' });
    expect(report.sectorEnergyMaster.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(report.sectorEnergyMaster.shadowLeadershipAllowed).toBe(true);
    expect(report.sectorEnergyMaster.promotionAllowed).toBe(false);
    expect(report.sectorEnergyMaster.fallbackUsed).toBe('STOCK_DAILY_PROXY');
  });

  it('sector_boost_and_strong_buy_remain_blocked', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488();
    expect(report.sectorEnergyMaster.sectorBoostAllowed).toBe(false);
    expect(report.sectorEnergyMaster.strongBuyAllowed).toBe(false);
  });

  it('execution_impact_none', () => {
    const coverage = evaluateSectorIndexMasterCoverageAdr0495();
    const fallback = buildSectorEnergyFallbackSeedAdr0495();
    expect(coverage.guardrails.executionImpact).toBe('NONE');
    expect(fallback.every((record) => record.executionImpact === 'NONE')).toBe(true);
  });

  it('raw_payload_persistence_forbidden', () => {
    expect(evaluateSectorIndexMasterCoverageAdr0495().guardrails.rawPayloadPersistenceAllowed).toBe(false);
  });

  it('provider_issue_not_bearish', () => {
    const classification = classifySupplyUnknownRootCauseAdr0488({ providerStatus: 'CACHE_EMPTY', providerIssue: true, marketSignal: false });
    expect(classification.providerIssue).toBe(true);
    expect(classification.marketSignal).toBe(false);
  });

  it('adr0488_report_uses_adr0495_seed', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ generatedAt: '2026-05-09T00:00:00.000Z' });
    expect(report.sectorEnergyMaster.adr0495Coverage?.coveragePartial).toBeGreaterThan(0);
    expect(report.sectorEnergyMaster.records.length).toBeGreaterThanOrEqual(10);
    expect(report.sectorEnergyMaster.status).toBe('PARTIAL');
  });

  it('adr0494_audit_remains_blocked_without_history', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ generatedAt: '2026-05-09T00:00:00.000Z' });
    const input = buildPromotionAuditInputForDataLineAdr0494({ sourceType: 'SECTOR_ENERGY', report, tradingDaysObserved: 0 });
    const [audit] = evaluateFreshDataPromotionAuditsAdr0494([input], { store: null });
    expect(audit.result.decision).toBe('KEEP_CURRENT_STAGE');
    expect(audit.result.recommendedStage).toBe(input.currentStage);
  });
});
