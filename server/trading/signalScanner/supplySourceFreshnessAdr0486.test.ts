// @responsibility ADR-0486 supply source freshness dual-clock tests.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSupplySourceFreshnessItemAdr0486,
  buildSupplySourceFreshnessReportAdr0486,
  deriveSupplyRefreshJobStatusAdr0486,
  formatSupplySourceFreshnessCompactAdr0486,
  getSupplySourceFreshnessDetailRegistryEntryAdr0486,
  safeBuildSupplySourceFreshnessReportAdr0486,
} from './supplySourceFreshnessAdr0486.js';
import { buildSupplyProviderWarmupReport, formatSupplyProviderWarmupCompactLine } from '../../supply/investorFlowProviderHealth.js';
import { buildSemanticNetBuyNormalizationReportAdr0485 } from './semanticNetBuyNormalizerAdr0485.js';
import { buildInvestorFlowProviderRouteResultAdr0477 } from './investorFlowProviderRouterAdr0477.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';

const NOW = '2026-05-09T03:00:00.000Z';

function staleInput(overrides = {}) {
  return {
    sourceId: 'FSS_PASSIVE_ACTIVE' as const,
    provider: 'FSS',
    cacheUpdatedAt: NOW,
    sourceDate: '2026-05-01',
    collectedAt: NOW,
    isTradingDay: true,
    sourceStatus: 'OK',
    now: NOW,
    ...overrides,
  };
}

function staleReport() {
  return buildSupplySourceFreshnessReportAdr0486({ generatedAt: NOW, inputs: [
    staleInput(),
    staleInput({ sourceId: 'SHORT_BALANCE', provider: 'FSS_SHORT', sourceDate: '2026-05-01' }),
    staleInput({ sourceId: 'CREDIT_BALANCE', provider: 'FSS_CREDIT', sourceDate: '2026-05-01' }),
  ] });
}

function semanticReportWithFreshness(report = staleReport()) {
  return buildSemanticNetBuyNormalizationReportAdr0485({
    code: '005930',
    generatedAt: NOW,
    supplySourceFreshnessAdr0486: report,
    inputs: [{
      code: '005930',
      provider: 'NAVER',
      sourceDate: '2026-05-08',
      rawForeignNetBuy: 10,
      rawInstitutionNetBuy: 20,
      unit: 'KRW',
    }],
  });
}

describe('ADR-0486 Supply Source Freshness Dual Clock', () => {
  it('cache fresh + source stale keeps separate clocks', () => {
    const item = buildSupplySourceFreshnessItemAdr0486(staleInput());
    expect(item.cacheState).toBe('FRESH');
    expect(item.sourceState).toBe('STALE');
    expect(item.cacheAgeMinutes).toBe(0);
    expect(item.sourceAgeTradingDays).toBeGreaterThanOrEqual(4);
    expect(item.severity).toBe('STALE');
    expect(item.isMarketSignal).toBe(false);
  });

  it('cache fresh does not imply source fresh', () => {
    const item = buildSupplySourceFreshnessItemAdr0486(staleInput());
    expect(item.cacheState).toBe('FRESH');
    expect(item.sourceState).not.toBe('FRESH');
    expect(item.diagnostics.join(' ')).toContain('cache fresh, source stale');
  });

  it('source age thresholds produce FRESH, DEGRADED severity, and STALE', () => {
    const fresh = buildSupplySourceFreshnessItemAdr0486(staleInput({ sourceDate: '2026-05-08' }));
    const degraded = buildSupplySourceFreshnessItemAdr0486(staleInput({ sourceDate: '2026-05-06' }));
    const stale = buildSupplySourceFreshnessItemAdr0486(staleInput({ sourceDate: '2026-05-01' }));
    expect(fresh.sourceAgeTradingDays).toBeLessThanOrEqual(1);
    expect(fresh.sourceState).toBe('FRESH');
    expect(degraded.sourceAgeTradingDays).toBeGreaterThanOrEqual(2);
    expect(degraded.severity).toBe('DEGRADED');
    expect(stale.sourceAgeTradingDays).toBeGreaterThanOrEqual(4);
    expect(stale.sourceState).toBe('STALE');
  });

  it('null sourceDate returns MISSING or DATA_UNAVAILABLE', () => {
    expect(buildSupplySourceFreshnessItemAdr0486(staleInput({ sourceDate: null })).sourceState).toBe('MISSING');
    expect(buildSupplySourceFreshnessItemAdr0486(staleInput({ sourceDate: null, sourceStatus: 'DATA_UNAVAILABLE' })).sourceState).toBe('DATA_UNAVAILABLE');
  });

  it('NON_TRADING_DAY, PROVIDER_ERROR, and stale source are provider issues not market signals', () => {
    const nonTrading = buildSupplySourceFreshnessItemAdr0486(staleInput({ isTradingDay: false, sourceStatus: 'NON_TRADING_DAY' }));
    const providerError = buildSupplySourceFreshnessItemAdr0486(staleInput({ sourceStatus: 'PROVIDER_ERROR' }));
    const stale = buildSupplySourceFreshnessItemAdr0486(staleInput());
    expect(nonTrading.sourceState).toBe('NON_TRADING_DAY');
    expect(nonTrading.isMarketSignal).toBe(false);
    expect(providerError.sourceState).toBe('PROVIDER_ERROR');
    expect(providerError.isProviderIssue).toBe(true);
    expect(stale.isMarketSignal).toBe(false);
  });

  it('build report calculates oldest age, affected sources, and refresh recommendations', () => {
    const report = staleReport();
    expect(report.oldestSourceAgeTradingDays).toBeGreaterThanOrEqual(4);
    expect(report.affectedSources).toEqual(expect.arrayContaining(['FSS_PASSIVE_ACTIVE', 'SHORT_BALANCE', 'CREDIT_BALANCE']));
    expect(report.refreshRecommendedSources).toEqual(expect.arrayContaining(['FSS_PASSIVE_ACTIVE']));
    expect(report.overallSeverity).toBe('STALE');
    expect(report.executionImpact).toBe('NONE');
  });

  it('refresh status rules handle fresh, stale, non-trading, and dry-run', () => {
    expect(deriveSupplyRefreshJobStatusAdr0486({ sourceState: 'FRESH', severity: 'OK' })).toBe('NOT_REQUIRED');
    expect(deriveSupplyRefreshJobStatusAdr0486({ sourceState: 'STALE', severity: 'STALE' })).toBe('RECOMMENDED');
    expect(deriveSupplyRefreshJobStatusAdr0486({ sourceState: 'NON_TRADING_DAY', severity: 'INFO' })).toBe('SKIPPED_NON_TRADING_DAY');
    expect(deriveSupplyRefreshJobStatusAdr0486({ sourceState: 'STALE', severity: 'STALE', dryRunRefresh: true })).toBe('DRY_RUN');
  });

  it('ADR-0473 warmup includes ADR-0486 freshness summary', () => {
    const report = buildSupplyProviderWarmupReport({ supplySourceFreshnessAdr0486: staleReport() });
    const text = formatSupplyProviderWarmupCompactLine(report);
    expect(text).toContain('ADR-0486 SupplyFreshness: STALE');
    expect(text).toContain('impact=NONE');
  });

  it('ADR-0477 degrades confidence when selected sample source is stale', () => {
    const freshness = buildSupplySourceFreshnessReportAdr0486({ generatedAt: NOW, inputs: [staleInput({ sourceId: 'NAVER_INVESTOR_TREND', provider: 'NAVER', sourceDate: '2026-05-01' })] });
    const semantic = buildSemanticNetBuyNormalizationReportAdr0485({ code: '005930', generatedAt: NOW, inputs: [{ code: '005930', provider: 'NAVER', sourceDate: '2026-05-08', rawForeignNetBuy: 10, rawInstitutionNetBuy: 20, unit: 'KRW' }] });
    const route = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', semanticNetBuyNormalizationAdr0485: semantic, supplySourceFreshnessAdr0486: freshness });
    expect(route.status).toBe('STALE');
    expect(route.semanticNetBuy?.confidence).toBe('LOW');
    expect(route.signal).toBe('UNKNOWN');
  });

  it('ADR-0485 attaches sourceAgeTradingDays from ADR-0486 freshness', () => {
    const report = semanticReportWithFreshness(buildSupplySourceFreshnessReportAdr0486({ generatedAt: NOW, inputs: [staleInput({ sourceId: 'NAVER_INVESTOR_TREND', provider: 'NAVER', sourceDate: '2026-05-01' })] }));
    expect(report.samples[0]?.freshness.sourceAgeTradingDays).toBeGreaterThanOrEqual(4);
    expect(report.samples[0]?.status).toBe('STALE');
  });

  it('ADR-0476 records sanitized freshness observation row', () => {
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', supplySourceFreshnessAdr0486: staleReport() });
    const row = rows.find((item) => item.observationType === 'SUPPLY_SOURCE_FRESHNESS_ADR0486');
    expect(row).toMatchObject({ routeStatus: 'STALE', marketSignal: false, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
    expect(row?.affectedSources).toContain('FSS_PASSIVE_ACTIVE');
    expect(JSON.stringify(row)).not.toContain('rawPayload');
  });

  it('ADR-0480 creates stale refresh and cache/source mismatch actions while fresh evidence stays quiet', () => {
    const refresh = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0486', sectionId: 'supply_source_freshness', code: 'ADR-0486', diagnosticKey: 'ADR-0486 SupplyFreshness', diagnosticValue: 'STALE refresh recommended', severity: 'DEGRADED' }] });
    const mismatch = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0486', sectionId: 'supply_source_freshness', code: 'ADR-0486', diagnosticKey: 'ADR-0486 SupplyFreshness', diagnosticValue: 'cacheState=FRESH sourceState=STALE', severity: 'DEGRADED' }] });
    const fresh = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0486', sectionId: 'supply_source_freshness', code: 'ADR-0486', diagnosticKey: 'ADR-0486 SupplyFreshness', diagnosticValue: 'OK oldest=1d', severity: 'INFO' }] });
    expect(refresh.dedupedRootCauses).toContain('SUPPLY_SOURCE_REFRESH_RECOMMENDED');
    expect(mismatch.dedupedRootCauses).toContain('CACHE_SOURCE_FRESHNESS_MISMATCH');
    expect(fresh.dedupedRootCauses).not.toContain('FSS_SOURCE_STALE');
  });

  it('ADR-0478 compact output and ADR-0479 detail registry expose ADR-0486 trace', () => {
    const report = staleReport();
    expect(formatSupplySourceFreshnessCompactAdr0486(report)).toContain('ADR-0486 SupplyFreshness: STALE');
    const entry = getSupplySourceFreshnessDetailRegistryEntryAdr0486(report);
    expect(entry.adrTraceHint).toBe('/adr_trace 0486');
    expect(entry.render()).toContain('cache=FRESH');
  });

  it('does not import KIS order modules or live execution modules', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/supplySourceFreshnessAdr0486.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKisMarketBuyOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder|liveBuy|executeBuy|trancheExecutor|autoTradeEngine/i);
  });

  it('requiredScore, Gate thresholds, weights, Kelly, UNKNOWN/bearish invariants remain unchanged', () => {
    const ledgerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts'), 'utf-8');
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/supplySourceFreshnessAdr0486.ts'), 'utf-8');
    expect(ledgerSrc).toContain('requiredScore: 70');
    expect(src).not.toMatch(/requiredScore\s*=\s*(60|65)|setGateThreshold|GATE_RELAX|kelly/i);
    expect(staleReport().items.every((item) => item.isMarketSignal === false)).toBe(true);
  });

  it('policy invariants are always NONE/false/SHADOW_ONLY/operator approval and failures are isolated', () => {
    const report = staleReport();
    const failed = safeBuildSupplySourceFreshnessReportAdr0486({ inputs: [{ ...staleInput(), sourceDate: Symbol('bad') as never }] });
    for (const output of [report, failed]) {
      expect(output.executionImpact).toBe('NONE');
      expect(output.liveExecutionAllowed).toBe(false);
      expect(output.policyPromotionMode).toBe('SHADOW_ONLY');
      expect(output.operatorApprovalRequired).toBe(true);
    }
    for (const item of report.items) {
      expect(item.executionImpact).toBe('NONE');
      expect(item.liveExecutionAllowed).toBe(false);
      expect(item.policyPromotionMode).toBe('SHADOW_ONLY');
      expect(item.operatorApprovalRequired).toBe(true);
    }
  });
});
