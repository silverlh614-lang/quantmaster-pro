import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildFreshDataDomainSummaryAdr0487,
  buildFreshDataSnapshotAdr0487,
  buildFreshDataSourceRegistryAdr0487,
  buildFreshDataSupplyObservationRowAdr0487,
  buildFreshDataSupplyReportAdr0487,
  formatFreshDataSupplyCompactAdr0487,
  formatFreshDataSupplyDetailAdr0487,
  formatRuntimePipelineFreshDataEvidenceLineAdr0487,
  getFreshDataSupplyDetailRegistryEntryAdr0487,
  safeBuildFreshDataSupplyReportAdr0487,
} from './freshDataSupplyLayerAdr0487.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';

const moduleSrc = () => fs.readFileSync(path.resolve('server/trading/signalScanner/freshDataSupplyLayerAdr0487.ts'), 'utf-8');
const scanBlockersSrc = () => fs.readFileSync(path.resolve('server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
const runtimeAuditSrc = () => fs.readFileSync(path.resolve('server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');

function partialInput() {
  return {
    generatedAt: '2026-05-09T00:00:00.000Z',
    sectorEnergyDiagnosticAdr0474: { indexCodeCoverage: 0.5, missingIndexCodeCount: 3, aliasMissingCount: 2, fallbackUsed: 'STOCK_DAILY' },
    naverInvestorTrendAdr0481: { status: 'DATA_AVAILABLE', availableDays: 2, requestedDays: 5 },
    semanticNetBuyNormalizationAdr0482: { status: 'DATA_UNAVAILABLE', selectedSample: null },
    supplySourceFreshnessAdr0483: { status: 'STALE', rows: [{ sourceId: 'FSS_PASSIVE_ACTIVE', sourceState: 'STALE', cacheState: 'FRESH', sourceAgeTradingDays: 3 }] },
    investorFlowProviderRouterAdr0477: { status: 'DATA_UNAVAILABLE', selectedProvider: 'NONE', providerStatuses: {} },
  };
}

function readyInput() {
  return {
    generatedAt: '2026-05-09T00:00:00.000Z',
    sectorEnergyDiagnosticAdr0474: { indexCodeCoverage: 0.95, missingIndexCodeCount: 0, aliasMissingCount: 0, fallbackUsed: 'NONE' },
    naverInvestorTrendAdr0481: { status: 'DATA_AVAILABLE', availableDays: 5, requestedDays: 5 },
    semanticNetBuyNormalizationAdr0482: { status: 'NORMALIZED', selectedSample: { provider: 'NAVER' } },
    supplySourceFreshnessAdr0483: {
      status: 'FRESH',
      rows: [
        { sourceId: 'FSS_PASSIVE_ACTIVE', sourceState: 'FRESH', cacheState: 'FRESH', sourceAgeTradingDays: 0 },
        { sourceId: 'SHORT_BALANCE', sourceState: 'FRESH', cacheState: 'FRESH', sourceAgeTradingDays: 0 },
        { sourceId: 'CREDIT_BALANCE', sourceState: 'FRESH', cacheState: 'FRESH', sourceAgeTradingDays: 0 },
      ],
    },
    investorFlowProviderRouterAdr0477: { status: 'OK', selectedProvider: 'NAVER', providerStatuses: { KIS_PROGRAM_TRADING: 'OK', MARKET_PROGRAM_TRADING: 'OK' } },
  };
}

describe('ADR-0487 Fresh Data Supply Layer Foundation', () => {
  it('1. Registry includes sector energy data sources.', () => {
    const ids = buildFreshDataSourceRegistryAdr0487().map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['KRX_SECTOR_INDEX_MASTER', 'SECTOR_INDEX_CODE_MAPPING', 'SECTOR_ENERGY_STOCK_DAILY_FALLBACK']));
  });

  it('2. Registry includes supply data sources.', () => {
    const ids = buildFreshDataSourceRegistryAdr0487().map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['NAVER_INVESTOR_TREND', 'SEMANTIC_NETBUY', 'KRX_INVESTOR_FLOW', 'SUPPLY_SNAPSHOT_CACHE', 'FSS_PASSIVE_ACTIVE', 'SHORT_BALANCE', 'CREDIT_BALANCE']));
  });

  it('3. Registry entries all have liveExecutionAllowed=false.', () => {
    expect(buildFreshDataSourceRegistryAdr0487().every((item) => item.liveExecutionAllowed === false)).toBe(true);
  });

  it('4. Registry entries all disallow raw payload persistence.', () => {
    expect(buildFreshDataSourceRegistryAdr0487().every((item) => item.rawPayloadPersistenceAllowed === false)).toBe(true);
  });

  it('5. Snapshot separates cacheState and sourceState.', () => {
    const snapshot = buildFreshDataSnapshotAdr0487({ cacheState: 'FRESH', sourceState: 'STALE', coverageRatio: 0.5 });
    expect(snapshot.cacheState).toBe('FRESH');
    expect(snapshot.sourceState).toBe('STALE');
  });

  it('6. Snapshot marks stale source as STALE, not bearish.', () => {
    const snapshot = buildFreshDataSnapshotAdr0487({ sourceState: 'STALE', coverageRatio: 0.5 });
    expect(snapshot.status).toBe('STALE');
    expect(snapshot.isMarketSignal).toBe(false);
  });

  it('7. Snapshot marks provider error as provider issue, not market signal.', () => {
    const snapshot = buildFreshDataSnapshotAdr0487({ sourceState: 'PROVIDER_ERROR' });
    expect(snapshot.isProviderIssue).toBe(true);
    expect(snapshot.isMarketSignal).toBe(false);
  });


  it('KRX disabled by KIS-first mode is not a provider issue and is excluded from router/live/gate use', () => {
    const prev = process.env.KIS_FIRST_REBUILD_MODE;
    process.env.KIS_FIRST_REBUILD_MODE = 'true';
    try {
      const report = buildFreshDataSupplyReportAdr0487({
        ...partialInput(),
        investorFlowProviderRouterAdr0477: {
          status: 'DISABLED_BY_KIS_FIRST_MODE',
          selectedProvider: 'NONE',
          providerStatuses: { KRX_INVESTOR_FLOW: 'DISABLED_BY_KIS_FIRST_MODE', KRX: 'DISABLED_BY_KIS_FIRST_MODE' },
        },
      });
      const krxFlow = report.snapshots.find((item) => item.sourceId === 'KRX_INVESTOR_FLOW');
      const krxSector = report.snapshots.find((item) => item.sourceId === 'KRX_SECTOR_INDEX_MASTER');

      expect(krxFlow?.status).toBe('DISABLED_BY_KIS_FIRST_MODE');
      expect(krxFlow?.isProviderIssue).toBe(false);
      expect(krxFlow?.isMarketSignal).toBe(false);
      expect(krxFlow?.usableForRouter).toBe(false);
      expect(krxFlow?.usableForLive).toBe(false);
      expect(krxFlow?.executionImpact).toBe('NONE');
      expect(krxFlow?.diagnostics.join(' ')).toContain('selectedProvider=NONE');
      expect(krxFlow?.diagnostics.join(' ')).toContain('KIS-first mode; KRX retained for manual diagnostics only');

      expect(krxSector?.status).toBe('DISABLED_BY_KIS_FIRST_MODE');
      expect(krxSector?.isProviderIssue).toBe(false);
      expect(krxSector?.isMarketSignal).toBe(false);
      expect(krxSector?.diagnostics.join(' ')).toContain('KIS-first mode; KRX retained for manual diagnostics only');
    } finally {
      if (prev === undefined) delete process.env.KIS_FIRST_REBUILD_MODE;
      else process.env.KIS_FIRST_REBUILD_MODE = prev;
    }
  });

  it('8. Snapshot marks normalized fresh source as NORMALIZED or READY_FOR_SHADOW.', () => {
    const snapshot = buildFreshDataSnapshotAdr0487({ stage: 'SHADOW_ONLY', sourceState: 'FRESH', normalized: true, coverageRatio: 1 });
    expect(['NORMALIZED', 'READY_FOR_SHADOW']).toContain(snapshot.status);
  });

  it('8a. READY_FOR_SHADOW requires a materialized router-usable sample', () => {
    const placeholder = buildFreshDataSnapshotAdr0487({
      stage: 'SHADOW_ONLY',
      sourceState: 'FRESH',
      normalized: true,
      coverageRatio: 1,
      sampleMaterialized: false,
      usableForRouter: false,
      readinessKind: 'REGISTRY_READY',
      sourceOfTruth: 'REGISTRY',
    });
    const materialized = buildFreshDataSnapshotAdr0487({
      stage: 'SHADOW_ONLY',
      sourceState: 'FRESH',
      normalized: true,
      coverageRatio: 1,
      sampleMaterialized: true,
      usableForRouter: true,
      readinessKind: 'MATERIALIZED_SAMPLE',
      sourceOfTruth: 'ROUTER_INPUT',
    });

    expect(placeholder.status).toBe('NORMALIZED');
    expect(placeholder.status).not.toBe('READY_FOR_SHADOW');
    expect(placeholder.sampleMaterialized).toBe(false);
    expect(placeholder.usableForRouter).toBe(false);
    expect(materialized.status).toBe('READY_FOR_SHADOW');
    expect(materialized.sampleMaterialized).toBe(true);
  });

  it('9. Missing input does not throw.', () => {
    expect(() => buildFreshDataSupplyReportAdr0487()).not.toThrow();
  });

  it('10. Domain summary calculates source counts.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    const summary = buildFreshDataDomainSummaryAdr0487(report.snapshots, 'SECTOR_ENERGY');
    expect(summary.sourcesTotal).toBe(4);
  });

  it('11. Domain summary calculates average coverage.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    const summary = buildFreshDataDomainSummaryAdr0487(report.snapshots, 'SECTOR_ENERGY');
    expect(summary.averageCoverageRatio).toBeGreaterThan(0);
  });

  it('12. Domain summary lists top gaps.', () => {
    expect(buildFreshDataSupplyReportAdr0487(partialInput()).topGaps.length).toBeGreaterThan(0);
  });

  it('13. Full report includes sectorEnergy domain summary.', () => {
    expect(buildFreshDataSupplyReportAdr0487(partialInput()).domainSummaries.some((item) => item.domain === 'SECTOR_ENERGY')).toBe(true);
  });

  it('14. Full report includes supply domain summary.', () => {
    expect(buildFreshDataSupplyReportAdr0487(partialInput()).domainSummaries.some((item) => item.domain === 'SUPPLY')).toBe(true);
  });

  it('15. SectorEnergy ADR-0474 diagnostics produce sector snapshots.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    expect(report.snapshots.filter((item) => item.domain === 'SECTOR_ENERGY').length).toBe(4);
  });

  it('16. Supply ADR-0481/0482/0483 diagnostics produce supply snapshots.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    expect(report.snapshots.map((item) => item.sourceId)).toEqual(expect.arrayContaining(['NAVER_INVESTOR_TREND', 'SEMANTIC_NETBUY', 'FSS_PASSIVE_ACTIVE']));
  });

  it('17. Overall status OBSERVING when data exists but insufficient coverage.', () => {
    const report = buildFreshDataSupplyReportAdr0487({ ...partialInput(), sectorEnergyDiagnosticAdr0474: { indexCodeCoverage: 0.1 }, naverInvestorTrendAdr0481: { status: 'DATA_AVAILABLE', availableDays: 1, requestedDays: 10 } });
    expect(['OBSERVING', 'STALE']).toContain(report.overallStatus);
  });

  it('18. Overall status PARTIAL when some sources are available.', () => {
    expect(['PARTIAL', 'STALE']).toContain(buildFreshDataSupplyReportAdr0487(partialInput()).overallStatus);
  });

  it('19. Overall status DATA_UNAVAILABLE when key sources missing.', () => {
    expect(buildFreshDataSupplyReportAdr0487({ generatedAt: '2026-05-09T00:00:00.000Z' }).overallStatus).toBe('DATA_UNAVAILABLE');
  });

  it('20. Overall status READY_FOR_SHADOW only when key sources meet freshness/coverage requirements.', () => {
    expect(buildFreshDataSupplyReportAdr0487(readyInput()).overallStatus).toBe('READY_FOR_SHADOW');
  });

  it('21. ADR-0476 records sanitized ADR-0487 observation row.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    const row = buildFreshDataSupplyObservationRowAdr0487(report);
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', freshDataSupplyAdr0487: report });
    expect(row.observationType).toBe('FRESH_DATA_SUPPLY_LAYER_ADR0487');
    expect(rows.some((item) => item.observationType === 'FRESH_DATA_SUPPLY_LAYER_ADR0487')).toBe(true);
    expect(JSON.stringify(row)).not.toMatch(/rawPayload|providerPayload/i);
  });

  it('22. ADR-0480 creates operator actions for top gaps.', () => {
    const q = buildOperatorActionQueueAdr0480({ freshDataSupplyAdr0487: buildFreshDataSupplyReportAdr0487(partialInput()) });
    expect(q.allActions.some((item) => item.rootCause === 'NAVER_SAMPLE_ACQUISITION_NEEDED' || item.rootCause === 'SECTOR_INDEX_MASTER_REPAIR_NEEDED')).toBe(true);
  });

  it('23. ADR-0478 compact output includes ADR-0487 line.', () => {
    expect(formatFreshDataSupplyCompactAdr0487(buildFreshDataSupplyReportAdr0487(partialInput()))).toContain('ADR-0487 FreshData');
    expect(scanBlockersSrc()).toContain('formatFreshDataSupplyCompactAdr0487');
  });

  it('24. ADR-0479 detail registry exposes ADR-0487 trace.', () => {
    const entry = getFreshDataSupplyDetailRegistryEntryAdr0487(buildFreshDataSupplyReportAdr0487(partialInput()));
    expect(entry.adrTraceHint).toBe('/adr_trace 0487');
    expect(entry.commandHint).toBe('/fresh_data_status');
  });

  it('25. Runtime Pipeline Audit includes ADR-0487 diagnostic evidence.', () => {
    expect(formatRuntimePipelineFreshDataEvidenceLineAdr0487(buildFreshDataSupplyReportAdr0487(partialInput()))).toContain('ADR-0487 status=');
    expect(runtimeAuditSrc()).toContain('freshDataSupply');
  });

  it('26. No raw provider payload is persisted.', () => {
    const row = buildFreshDataSupplyObservationRowAdr0487(buildFreshDataSupplyReportAdr0487(partialInput()));
    expect(JSON.stringify(row)).not.toMatch(/rawPayload|providerPayload|html/i);
  });

  it('27. No KIS order modules are imported.', () => {
    expect(moduleSrc().split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/kis.*order|order.*kis|orderExecutor|createLiveOrder/i);
  });

  it('28. No live execution modules are imported.', () => {
    expect(moduleSrc().split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/liveExecution|autoTradeEngine|trancheExecutor/i);
  });

  it('29. requiredScore remains 70.', () => {
    expect(buildFreshDataSupplyObservationRowAdr0487(buildFreshDataSupplyReportAdr0487(partialInput())).requiredScore).toBe(70);
  });

  it('30. Gate thresholds, weights, Kelly remain unchanged.', () => {
    expect(moduleSrc().split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/setGateThreshold|GATE_RELAX|kelly|gateWeight|STRONG_BUY_OVERRIDE/i);
  });

  it('31. UNKNOWN is never converted to bullish.', () => {
    expect(formatFreshDataSupplyDetailAdr0487(buildFreshDataSupplyReportAdr0487()).toUpperCase()).not.toContain('BULLISH');
  });

  it('32. Provider issue is never converted to bearish.', () => {
    expect(formatFreshDataSupplyDetailAdr0487(buildFreshDataSupplyReportAdr0487(partialInput())).toUpperCase()).not.toMatch(/SIGNAL=BEARISH|MARKETSIGNAL=TRUE/);
  });

  it('33. executionImpact is always NONE.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    expect(report.executionImpact).toBe('NONE');
    expect(report.snapshots.every((item) => item.executionImpact === 'NONE')).toBe(true);
  });

  it('34. liveExecutionAllowed is always false.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.snapshots.every((item) => item.liveExecutionAllowed === false)).toBe(true);
  });

  it('35. policyPromotionMode is OBSERVE or SHADOW_ONLY only.', () => {
    expect(['OBSERVE', 'SHADOW_ONLY']).toContain(buildFreshDataSupplyReportAdr0487(partialInput()).policyPromotionMode);
  });

  it('36. operatorApprovalRequired is always true.', () => {
    const report = buildFreshDataSupplyReportAdr0487(partialInput());
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.snapshots.every((item) => item.operatorApprovalRequired === true)).toBe(true);
  });

  it('37. Data supply failure is try/catch isolated.', () => {
    const report = safeBuildFreshDataSupplyReportAdr0487({ throwForTest: true });
    expect(report.overallStatus).toBe('UNKNOWN');
    expect(report.executionImpact).toBe('NONE');
  });

  it('38. SemanticNetBuy stale input sample remains normalized shadow evidence, not NO_INPUT_SAMPLE', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      semanticNetBuyNormalizationAdr0482: {
        status: 'STALE',
        selectedSample: null,
        samples: [{ provider: 'CACHE', sourceDate: '2026-05-04', status: 'STALE', confidence: 'LOW' }],
      },
    });
    const semantic = report.snapshots.find((item) => item.sourceId === 'SEMANTIC_NETBUY');

    expect(semantic?.status).toBe('STALE');
    expect(semantic?.normalized).toBe(true);
    expect(semantic?.confidence).toBe('LOW');
    expect(semantic?.liveExecutionAllowed).toBe(false);
  });

  it('38a. NAVER registry-ready without a fetched sample remains non-materialized and not READY_FOR_SHADOW', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      naverInvestorTrendAdr0481: { status: 'DATA_AVAILABLE', availableDays: 5, requestedDays: 5 },
    });
    const naver = report.snapshots.find((item) => item.sourceId === 'NAVER_INVESTOR_TREND');

    expect(naver?.sampleMaterialized).toBe(false);
    expect(naver?.usableForRouter).toBe(false);
    expect(naver?.readinessKind).toBe('REGISTRY_READY');
    expect(naver?.status).not.toBe('READY_FOR_SHADOW');
  });

  it('38b. NAVER materialization diagnostics flow into FreshData snapshot diagnostics', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      naverInvestorTrendAdr0481: {
        status: 'DATA_AVAILABLE',
        semanticNetBuyCandidate: { sourceDate: '2026-05-11' },
        materializationDiagnostics: {
          sampleMaterialized: true,
          usableForRouter: true,
          rawCount: 2,
          normalizedCount: 2,
          materializedCount: 2,
          symbolCoverage: 100,
          blockedReason: 'NONE',
          placeholderDetected: false,
          inputSourceKind: 'RAW_PROVIDER',
        },
      },
    });
    const naver = report.snapshots.find((item) => item.sourceId === 'NAVER_INVESTOR_TREND');

    expect(naver?.sampleMaterialized).toBe(true);
    expect(naver?.usableForRouter).toBe(true);
    expect(naver?.diagnostics.join(' ')).toContain('materializedCount=2');
    expect(naver?.diagnostics.join(' ')).toContain('inputSourceKind=RAW_PROVIDER');
  });

  it('39. FSS Passive/Active stale diagnostics expose lastUpdated, staleDays, and live=false', () => {
    const detail = formatFreshDataSupplyDetailAdr0487(buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      supplySourceFreshnessAdr0483: {
        status: 'STALE',
        rows: [{ source: 'FSS', sourceId: 'FSS_PASSIVE_ACTIVE', sourceState: 'STALE', cacheState: 'FRESH', sourceAgeTradingDays: 7, sourceDate: '2026-04-29' }],
      },
    }));

    expect(detail).toContain('FSS_PASSIVE_ACTIVE');
    expect(detail).toContain('status=STALE');
    expect(detail).toContain('lastUpdated=2026-04-29');
    expect(detail).toContain('staleDays=7');
    expect(detail).toContain('usableForLive=false');
    expect(detail).toContain('normalized=false');
  });

  it('40. mounts router KRX and sanitized cache fallback sources into FreshData supply snapshots', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      investorFlowProviderRouterAdr0477: {
        selectedProvider: 'CACHE',
        status: 'CACHE_HIT',
        selectedReason: 'ADR-0491 sanitized snapshot cache selected',
        providerStatuses: {
          KRX_INVESTOR_FLOW: 'NON_TRADING_DAY',
          CACHE: 'CACHE_HIT',
        },
        coverage: { available: 1, total: 8 },
        coverageAfter: 1,
        diagnosticUsableCount: 1,
        materializationDiagnostics: {
          CACHE: {
            sampleMaterialized: true,
            usableForRouter: true,
            rawCount: 1,
            normalizedCount: 1,
            materializedCount: 1,
            blockedReason: 'NONE',
            placeholderDetected: false,
            inputSourceKind: 'CACHE_FALLBACK',
          },
        },
      },
    });

    const ids = report.snapshots.map((item) => item.sourceId);
    const cache = report.snapshots.find((item) => item.sourceId === 'SUPPLY_SNAPSHOT_CACHE');
    const krx = report.snapshots.find((item) => item.sourceId === 'KRX_INVESTOR_FLOW');

    expect(ids).toEqual(expect.arrayContaining(['KRX_INVESTOR_FLOW', 'SUPPLY_SNAPSHOT_CACHE']));
    expect(cache?.provider).toBe('CACHE');
    expect(cache?.sampleMaterialized).toBe(true);
    expect(cache?.usableForRouter).toBe(true);
    expect(cache?.status).toBe('READY_FOR_SHADOW');
    expect(cache?.diagnostics.join(' ')).toContain('routerStatus=CACHE_HIT');
    expect(cache?.diagnostics.join(' ')).toContain('diagnosticUsableCount=1');
    expect(krx?.diagnostics.join(' ')).toContain('routerProvider=KRX_INVESTOR_FLOW');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
  });

  it('41. materializes KIS Official Supply Pack sources into FreshData domains', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      kisOfficialSupplyPack: {
        officialSource: true,
        provider: 'KIS_API',
        fetchedAt: '2026-05-11T00:00:00.000Z',
        price: { currentPrice: 70000, prevClose: 69000, tradingDate: '2026-05-08', confidence: 'VERIFIED' },
        marketSupply: { foreignNetBuy: 1, institutionNetBuy: 2, individualNetBuy: -3, confidence: 'VERIFIED' },
        stockProgram: { programNetBuyAmount: 100, confidence: 'VERIFIED' },
        marketProgram: { programNetBuyAmount: 200, programArbitrageNetBuy: 50, confidence: 'VERIFIED' },
        loanTransaction: { loanBalanceQty: 10, trend: 'FLAT', confidence: 'VERIFIED' },
        creditBalance: { creditBalanceQty: 20, trend: 'FLAT', confidence: 'VERIFIED' },
      },
    });

    const byId = (id: string) => report.snapshots.find((item) => item.sourceId === id);
    expect(report.registrations.map((item) => item.id)).toEqual(expect.arrayContaining([
      'KIS_PRICE',
      'KIS_DAILY_CHART',
      'KIS_MARKET_SUPPLY',
      'KIS_PROGRAM_TRADING_STOCK',
      'KIS_PROGRAM_TRADING_MARKET',
      'KIS_SHORT_BALANCE',
      'KIS_LOAN_BALANCE',
      'KIS_CREDIT_BALANCE',
    ]));
    expect(byId('KIS_PRICE')?.status).toBe('FETCH_OK');
    expect(byId('KIS_MARKET_SUPPLY')?.status).toBe('FETCH_OK');
    expect(byId('KIS_PROGRAM_TRADING_MARKET')?.sampleMaterialized).toBe(true);
    expect(byId('KIS_LOAN_BALANCE')?.diagnostics.join(' ')).toContain('signal=NEUTRAL');
    expect(byId('KIS_CREDIT_BALANCE')?.diagnostics.join(' ')).toContain('signal=NEUTRAL');
    expect(byId('KIS_SHORT_BALANCE')?.isProviderIssue).toBe(true);
    expect(byId('KIS_SHORT_BALANCE')?.isMarketSignal).toBe(false);
    expect(report.domainSummaries.some((item) => item.domain === 'PRICE_VOLUME' && item.status === 'FETCH_OK')).toBe(true);
  });

  it('42. registers KIS sector basket as a shadow-only bridge without boost unlock', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      kisSectorBasketAdr0503: { basketRows: 12, coverageRatio: 1 },
    });
    const basket = report.snapshots.find((item) => item.sourceId === 'KIS_SECTOR_BASKET');

    expect(basket?.provider).toBe('KIS');
    expect(basket?.status).toBe('FETCH_OK');
    expect(basket?.confidence).toBe('MEDIUM');
    expect(basket?.diagnostics.join(' ')).toContain('leadershipConfidence=READY_FOR_SHADOW');
    expect(basket?.diagnostics.join(' ')).toContain('sectorBoostAllowed=false');
    expect(basket?.diagnostics.join(' ')).toContain('strongBuyAllowed=false');
  });

  it('43. materializes SEMANTIC_NETBUY from KIS ADR-0496 samples without cache fallback override', () => {
    const report = buildFreshDataSupplyReportAdr0487({
      generatedAt: '2026-05-11T00:00:00.000Z',
      supplyCoverageReportAdr0496: {
        status: 'PARTIAL',
        sampleCount: 1,
        normalizedSampleCount: 1,
        semanticNetBuyCount: 1,
        materializedSampleCount: 1,
        semanticPlaceholderCount: 0,
        routerUsableSampleCount: 0,
        diagnosticUsableSampleCount: 1,
        registryReadyCount: 0,
        coverageBefore: 0,
        coverageAfter: 0.5,
        nullCount: 0,
        zeroCount: 0,
        missingCount: 0,
        staleCount: 0,
        providerErrorCount: 0,
        providerIssueCount: 0,
        marketSignalCount: 0,
        normalized: true,
        confidence: 'PARTIAL',
        topGaps: [],
        recommendedNextActions: [],
        liveExecutionAllowed: false,
        executionImpact: 'NONE',
      },
      investorFlowProviderRouterAdr0477: {
        selectedProvider: 'KIS_API',
        providerStatuses: { CACHE: 'CACHE_STALE_HIT', KIS_API: 'PARTIAL' },
      },
    });

    const semantic = report.snapshots.find((item) => item.sourceId === 'SEMANTIC_NETBUY');
    expect(semantic?.status).toBe('READY_FOR_SHADOW');
    expect(semantic?.coverageRatio).toBeGreaterThan(0);
    expect(semantic?.diagnostics.join(' ')).toContain('inputSources=KIS_API');
    expect(semantic?.executionImpact).toBe('NONE');
  });
});
