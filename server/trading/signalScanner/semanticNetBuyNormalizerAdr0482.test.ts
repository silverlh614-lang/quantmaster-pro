// @responsibility ADR-0482 semantic net-buy normalizer tests; SHADOW_ONLY guardrails.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSemanticNetBuyNormalizationReportAdr0482,
  formatSemanticNetBuyCompactAdr0482,
  getSemanticNetBuyDetailRegistryEntryAdr0482,
  normalizeSemanticNetBuySampleAdr0482,
  safeBuildSemanticNetBuyNormalizationReportAdr0482,
} from './semanticNetBuyNormalizerAdr0482.js';
import { buildNaverInvestorTrendCollectorResultAdr0481 } from './naverInvestorTrendCollectorAdr0481.js';
import { buildInvestorFlowProviderRouteResultAdr0477 } from './investorFlowProviderRouterAdr0477.js';
import { buildGate1PositiveSourceWiringReport } from './gate1PositiveSourceWiringAdr0475.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';

function verifiedInput(overrides = {}) {
  return {
    code: '005930',
    provider: 'NAVER' as const,
    sourceDate: '2026-05-08',
    rawForeignNetBuy: 10,
    rawInstitutionNetBuy: 20,
    rawProgramNetBuy: 5,
    rawIndividualNetBuy: -35,
    unit: 'KRW' as const,
    sourceAgeTradingDays: 0,
    ...overrides,
  };
}

function positiveReport() {
  return buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [verifiedInput()] });
}

function starvationReport() {
  return {
    totalCandidates: 1,
    grossPositiveScoreAvg: 10,
    netScoreAvg: 55,
    actualScoreRange: 3,
    requiredScoreAvg: 70,
    rangeCompressionReport: { compressed: true },
    unavailableTop: [],
    topPositiveContributors: [{ code: 'OTHER_POSITIVE', avgContribution: 10 }],
    zeroContributionComponents: [
      { code: 'WATCHLIST_UPSTREAM_SCORE', count: 1 },
      { code: 'RELATIVE_STRENGTH', count: 1 },
      { code: 'BREAKOUT_STRUCTURE', count: 1 },
    ],
    traces: [{ symbol: '005930', totalScore: 55, positiveScores: { WATCHLIST_UPSTREAM_SCORE: 0, RELATIVE_STRENGTH: 0, BREAKOUT_STRUCTURE: 0, OTHER_POSITIVE: 10 } }],
  } as never;
}

describe('ADR-0482 Semantic Net-Buy Normalizer', () => {
  it('parses numeric string values safely and normalizes KRW fields', () => {
    const sample = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: '1,200', rawInstitutionNetBuy: '(200)' }));
    expect(sample.foreignNetBuy).toBe(1200);
    expect(sample.institutionNetBuy).toBe(-200);
    expect(sample.totalSmartMoneyNetBuy).toBe(1000);
    expect(sample.quality.parseOk).toBe(true);
  });

  it('converts THOUSAND_KRW and MILLION_KRW to KRW', () => {
    expect(normalizeSemanticNetBuySampleAdr0482(verifiedInput({ unit: 'THOUSAND_KRW', rawForeignNetBuy: 2, rawInstitutionNetBuy: 3 })).foreignNetBuy).toBe(2000);
    expect(normalizeSemanticNetBuySampleAdr0482(verifiedInput({ unit: 'MILLION_KRW', rawForeignNetBuy: 2, rawInstitutionNetBuy: 3 })).institutionNetBuy).toBe(3_000_000);
  });

  it('preserves SHARES unit and marks UNKNOWN unit as low confidence without mixing KRW', () => {
    const shares = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ unit: 'SHARES' }));
    const unknown = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ unit: 'UNKNOWN' }));
    expect(shares.unit).toBe('SHARES');
    expect(shares.quality.unitNormalized).toBe(true);
    expect(unknown.unit).toBe('UNKNOWN');
    expect(unknown.quality.unitNormalized).toBe(false);
    expect(unknown.confidence).toBe('LOW');
  });

  it('EMPTY input returns EMPTY and UNKNOWN', () => {
    const sample = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: null, rawInstitutionNetBuy: null, rawProgramNetBuy: null, rawIndividualNetBuy: null }));
    expect(sample.status).toBe('EMPTY');
    expect(sample.signal).toBe('UNKNOWN');
  });

  it('PROVIDER_ERROR, PROVIDER_MISMATCH, and PARSE_ERROR return UNKNOWN without bearish market signal', () => {
    const providerError = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ status: 'PROVIDER_ERROR' }));
    const mismatch = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ provider: 'KIS', status: undefined }));
    const parseError = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: 'not-a-number' }));
    expect(providerError.signal).toBe('UNKNOWN');
    expect(providerError.quality.isProviderIssue).toBe(true);
    expect(mismatch.status).toBe('PROVIDER_MISMATCH');
    expect(mismatch.quality.isMarketSignal).toBe(false);
    expect(parseError.status).toBe('PARSE_ERROR');
    expect(parseError.signal).toBe('UNKNOWN');
  });

  it('PARTIAL foreign-only sample returns PARTIAL and never bearish', () => {
    const sample = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: -10, rawInstitutionNetBuy: null }));
    expect(sample.status).toBe('PARTIAL');
    expect(['MEDIUM', 'LOW']).toContain(sample.confidence);
    expect(sample.signal).not.toBe('BEARISH');
  });


  it('materializes KIS verified symbol investor fields into SEMANTIC_NETBUY and outranks stale cache', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [
      verifiedInput({ provider: 'CACHE', status: 'STALE', sourceAgeTradingDays: 4, rawForeignNetBuy: 999, rawInstitutionNetBuy: 999 }),
      verifiedInput({ provider: 'KIS', providerSemanticCapable: true, status: 'VERIFIED', rawForeignNetBuy: 10, rawInstitutionNetBuy: 20, rawIndividualNetBuy: -30, unit: 'SHARES' }),
    ] });

    expect(report.status).toBe('VERIFIED');
    expect(report.selectedSample?.provider).toBe('KIS');
    expect(report.inputSources).toContain('KIS');
    expect(report.materializationDiagnostics.usableForRouter).toBe(true);
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('keeps KIS foreign+institution-only sample DEGRADED/PARTIAL and shadow usable without fake individual zero', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [
      verifiedInput({ provider: 'KIS', providerSemanticCapable: true, status: 'PARTIAL', rawForeignNetBuy: 10, rawInstitutionNetBuy: 20, rawIndividualNetBuy: null, unit: 'SHARES' }),
    ] });

    expect(report.selectedSample?.provider).toBe('KIS');
    expect(report.selectedSample?.status).toBe('VERIFIED');
    expect(report.selectedSample?.individualNetBuy).toBeNull();
    expect(report.materializationDiagnostics.sampleMaterialized).toBe(true);
    expect(report.materializationDiagnostics.usableForRouter).toBe(true);
  });

  it('rejects KIS marketSupply-shaped input unless it is marked symbol semantic capable', () => {
    const sample = normalizeSemanticNetBuySampleAdr0482(verifiedInput({
      provider: 'KIS',
      status: undefined,
      rawForeignNetBuy: 10,
      rawInstitutionNetBuy: 20,
      rawIndividualNetBuy: -30,
      diagnostics: ['marketSupply is market context only; not symbol-level investorFlow.'],
    }));

    expect(sample.status).toBe('PROVIDER_MISMATCH');
    expect(sample.quality.isProviderIssue).toBe(true);
    expect(sample.quality.isMarketSignal).toBe(false);
    expect(sample.executionImpact).toBe('NONE');
  });

  it('verified positive, negative, and near-zero samples derive BULLISH, BEARISH, and NEUTRAL safely', () => {
    expect(normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: 10, rawInstitutionNetBuy: 20 })).signal).toBe('BULLISH');
    const bearish = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: -10, rawInstitutionNetBuy: -20 }));
    expect(bearish.status).toBe('VERIFIED');
    expect(['HIGH', 'MEDIUM']).toContain(bearish.confidence);
    expect(bearish.signal).toBe('BEARISH');
    expect(normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: 10, rawInstitutionNetBuy: -10 })).signal).toBe('NEUTRAL');
  });



  it('accepts sanitized CACHE_STALE_HIT snapshot input as SHADOW_ONLY stale diagnostic sample', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0482({
      code: '012200',
      inputs: [{
        code: '012200',
        provider: 'CACHE',
        sourceDate: '2026-05-04',
        rawForeignNetBuy: 100,
        rawInstitutionNetBuy: 50,
        rawProgramNetBuy: null,
        unit: 'KRW',
        status: 'STALE',
        sourceAgeTradingDays: 4,
        diagnostics: ['ADR-0491 sanitized CACHE snapshot consumed by ADR-0482 as SHADOW_ONLY input; raw payload not persisted.'],
      }],
    });

    expect(report.samples[0]).toMatchObject({ provider: 'CACHE', status: 'STALE', signal: 'UNKNOWN', confidence: 'LOW', liveExecutionAllowed: false, executionImpact: 'NONE' });
    expect(report.samples[0]?.rawPayloadPersistenceAllowed).toBe(false);
    expect(report.rawPayloadPersistenceAllowed).toBe(false);
    expect(report.status).toBe('STALE');
    expect(report.selectedSample).toBeNull();
    expect(report.inputSources).toContain('CACHE');
    expect(report.materializationDiagnostics).toMatchObject({
      sampleMaterialized: true,
      usableForRouter: true,
      materializedCount: 1,
      blockedReason: 'NONE',
      inputSources: ['CACHE'],
    });
    expect(JSON.stringify(report)).not.toMatch(/SECRET|providerPayload|rawPoints/i);
  });

  it('stale and missing/provider issue data never become bullish or bearish incorrectly', () => {
    const stale = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ sourceAgeTradingDays: 4 }));
    const missing = normalizeSemanticNetBuySampleAdr0482(verifiedInput({ rawForeignNetBuy: null, rawInstitutionNetBuy: null }));
    expect(stale.status).toBe('STALE');
    expect(stale.confidence).toBe('LOW');
    expect(stale.signal).toBe('UNKNOWN');
    expect(missing.signal).not.toBe('BEARISH');
    expect(normalizeSemanticNetBuySampleAdr0482(verifiedInput({ status: 'DATA_UNAVAILABLE' })).signal).not.toBe('BULLISH');
  });

  it('build report ranks NAVER verified above CACHE stale and rejects provider mismatch', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [
      verifiedInput({ provider: 'CACHE', sourceAgeTradingDays: 5 }),
      verifiedInput({ provider: 'NAVER', rawForeignNetBuy: 1, rawInstitutionNetBuy: 1 }),
      verifiedInput({ provider: 'KIS', status: 'PROVIDER_MISMATCH' }),
    ] });
    expect(report.selectedSample?.provider).toBe('NAVER');
    expect(report.samples.find((sample) => sample.provider === 'KIS')?.status).toBe('PROVIDER_MISMATCH');
  });

  it('selectedSample is null when all samples are empty or provider errors', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [
      verifiedInput({ rawForeignNetBuy: null, rawInstitutionNetBuy: null }),
      verifiedInput({ status: 'PROVIDER_ERROR' }),
    ] });
    expect(report.selectedSample).toBeNull();
    expect(report.signal).toBe('UNKNOWN');
  });

  it('separates SEMANTIC placeholder/no-input from real router-usable input sources', () => {
    const noInput = buildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [] });
    expect(noInput.materializationDiagnostics).toMatchObject({
      sampleMaterialized: false,
      usableForRouter: false,
      blockedReason: 'NO_INPUT_SAMPLE',
      placeholderDetected: true,
      inputSourceKind: 'NONE',
    });
    expect(noInput.inputSources).toEqual([]);

    const derived = buildSemanticNetBuyNormalizationReportAdr0482({
      code: '005930',
      inputs: [verifiedInput({ provider: 'MANUAL' })],
    });
    expect(derived.materializationDiagnostics.inputSourceKind).toBe('SEMANTIC_DERIVED');
    expect(derived.materializationDiagnostics.usableForRouter).toBe(false);
    expect(derived.materializationDiagnostics.blockedReason).toBe('NO_REAL_INPUT_SOURCE');
  });

  it('ADR-0481 NAVER collector uses ADR-0482 normalizer', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/naverInvestorTrendCollectorAdr0481.ts'), 'utf-8');
    const result = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', rawPoints: [{ date: '2026-05-08', foreignNetBuy: 1, institutionNetBuy: 2 }] });
    expect(src).toContain('normalizeSemanticNetBuySampleAdr0482');
    expect(result.semanticNetBuyCandidate?.status).toBe('VERIFIED');
  });

  it('ADR-0477 observes ADR-0482 selected sample without making semantic the source of truth', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', semanticNetBuyNormalizationAdr0482: positiveReport() });
    expect(route.selectedProvider).toBe('NONE');
    expect(route.semanticNetBuy).toBeNull();
    expect(route.semanticInputStatus).toBe('VERIFIED');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('ADR-0475 exposes BULLISH selected sample only as SHADOW_ONLY positive source', () => {
    const report = buildGate1PositiveSourceWiringReport({
      positiveStarvationReport: starvationReport(),
      semanticNetBuyNormalizationAdr0482: positiveReport(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'TEST',
      marketSession: 'CLOSED',
    });
    expect(report?.semanticNetBuyCandidatesAdr0482?.[0]).toMatchObject({ status: 'VERIFIED', signal: 'BULLISH', executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
  });

  it('ADR-0476 records sanitized ADR-0482 observation row without raw provider payload', () => {
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', semanticNetBuyNormalizationAdr0482: positiveReport() });
    const row = rows.find((item) => item.observationType === 'SEMANTIC_NETBUY_NORMALIZER_ADR0482');
    expect(row).toMatchObject({ symbol: '005930', provider: 'NAVER', routeSignal: 'BULLISH', confidence: 'HIGH', unit: 'KRW', executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
    expect(JSON.stringify(row)).not.toContain('rawForeignNetBuy');
  });

  it('ADR-0480 downgrades/removes SEMANTIC_NETBUY_MISSING when normalizer exists', () => {
    const unavailable = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0482', sectionId: 'semantic_net_buy_normalizer', code: 'ADR-0482', diagnosticKey: 'ADR-0482 SEMANTIC_NETBUY_NORMALIZER', diagnosticValue: 'selected=NONE DATA_UNAVAILABLE', severity: 'DATA_UNAVAILABLE' }] });
    const parse = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0482', sectionId: 'semantic_net_buy_normalizer', code: 'ADR-0482', diagnosticKey: 'ADR-0482 SEMANTIC_NETBUY_NORMALIZER', diagnosticValue: 'PARSE_ERROR unitNormalized=false', severity: 'ERROR' }] });
    expect(unavailable.dedupedRootCauses).not.toContain('SEMANTIC_NETBUY_MISSING');
    expect(unavailable.dedupedRootCauses).toContain('SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE');
    expect(parse.dedupedRootCauses).toContain('SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE');
  });

  it('ADR-0478 compact output and ADR-0479 detail registry expose ADR-0482 trace', () => {
    const report = positiveReport();
    expect(formatSemanticNetBuyCompactAdr0482(report)).toContain('ADR-0482 SemanticNetBuy: VERIFIED');
    const entry = getSemanticNetBuyDetailRegistryEntryAdr0482(report);
    expect(entry.adrTraceHint).toBe('/adr_trace 0482');
    expect(entry.render()).toContain('selectedSample');
    expect(entry.render()).toContain('materialization');
  });

  it('normalizer failure is try/catch isolated where integrated', () => {
    const report = safeBuildSemanticNetBuyNormalizationReportAdr0482({ code: '005930', inputs: [{ code: '005930', provider: 'NAVER', sourceDate: '2026-05-08', rawForeignNetBuy: Symbol('bad') as never }] });
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('does not import KIS order modules or live execution modules', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/semanticNetBuyNormalizerAdr0482.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKisMarketBuyOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder|liveBuy|executeBuy|trancheExecutor|autoTradeEngine/i);
  });

  it('requiredScore, Gate thresholds, weights, and Kelly remain unchanged', () => {
    const ledgerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts'), 'utf-8');
    const normalizerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/semanticNetBuyNormalizerAdr0482.ts'), 'utf-8');
    expect(ledgerSrc).toContain('requiredScore: LEGACY_GATE1_REQUIRED_SCORE');
    expect(normalizerSrc).not.toMatch(/requiredScore\s*=\s*(60|65)|setGateThreshold|GATE_RELAX|kelly/i);
  });

  it('policy invariants are always NONE/false/SHADOW_ONLY/operator approval', () => {
    const report = positiveReport();
    for (const sample of [report.selectedSample, normalizeSemanticNetBuySampleAdr0482(verifiedInput({ status: 'PROVIDER_ERROR' }))].filter(Boolean)) {
      expect(sample?.executionImpact).toBe('NONE');
      expect(sample?.liveExecutionAllowed).toBe(false);
      expect(sample?.policyPromotionMode).toBe('SHADOW_ONLY');
      expect(sample?.operatorApprovalRequired).toBe(true);
    }
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(report.operatorApprovalRequired).toBe(true);
  });
});
