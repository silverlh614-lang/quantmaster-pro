// @responsibility ADR-0485 semantic net-buy normalizer tests; SHADOW_ONLY guardrails.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSemanticNetBuyNormalizationReportAdr0485,
  formatSemanticNetBuyCompactAdr0485,
  getSemanticNetBuyDetailRegistryEntryAdr0485,
  normalizeSemanticNetBuySampleAdr0485,
  safeBuildSemanticNetBuyNormalizationReportAdr0485,
} from './semanticNetBuyNormalizerAdr0485.js';
import { buildNaverInvestorTrendCollectorResultAdr0484 } from './naverInvestorTrendCollectorAdr0484.js';
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
  return buildSemanticNetBuyNormalizationReportAdr0485({ code: '005930', inputs: [verifiedInput()] });
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

describe('ADR-0485 Semantic Net-Buy Normalizer', () => {
  it('parses numeric string values safely and normalizes KRW fields', () => {
    const sample = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: '1,200', rawInstitutionNetBuy: '(200)' }));
    expect(sample.foreignNetBuy).toBe(1200);
    expect(sample.institutionNetBuy).toBe(-200);
    expect(sample.totalSmartMoneyNetBuy).toBe(1000);
    expect(sample.quality.parseOk).toBe(true);
  });

  it('converts THOUSAND_KRW and MILLION_KRW to KRW', () => {
    expect(normalizeSemanticNetBuySampleAdr0485(verifiedInput({ unit: 'THOUSAND_KRW', rawForeignNetBuy: 2, rawInstitutionNetBuy: 3 })).foreignNetBuy).toBe(2000);
    expect(normalizeSemanticNetBuySampleAdr0485(verifiedInput({ unit: 'MILLION_KRW', rawForeignNetBuy: 2, rawInstitutionNetBuy: 3 })).institutionNetBuy).toBe(3_000_000);
  });

  it('preserves SHARES unit and marks UNKNOWN unit as low confidence without mixing KRW', () => {
    const shares = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ unit: 'SHARES' }));
    const unknown = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ unit: 'UNKNOWN' }));
    expect(shares.unit).toBe('SHARES');
    expect(shares.quality.unitNormalized).toBe(true);
    expect(unknown.unit).toBe('UNKNOWN');
    expect(unknown.quality.unitNormalized).toBe(false);
    expect(unknown.confidence).toBe('LOW');
  });

  it('EMPTY input returns EMPTY and UNKNOWN', () => {
    const sample = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: null, rawInstitutionNetBuy: null, rawProgramNetBuy: null, rawIndividualNetBuy: null }));
    expect(sample.status).toBe('EMPTY');
    expect(sample.signal).toBe('UNKNOWN');
  });

  it('PROVIDER_ERROR, PROVIDER_MISMATCH, and PARSE_ERROR return UNKNOWN without bearish market signal', () => {
    const providerError = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ status: 'PROVIDER_ERROR' }));
    const mismatch = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ provider: 'KIS', status: undefined }));
    const parseError = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: 'not-a-number' }));
    expect(providerError.signal).toBe('UNKNOWN');
    expect(providerError.quality.isProviderIssue).toBe(true);
    expect(mismatch.status).toBe('PROVIDER_MISMATCH');
    expect(mismatch.quality.isMarketSignal).toBe(false);
    expect(parseError.status).toBe('PARSE_ERROR');
    expect(parseError.signal).toBe('UNKNOWN');
  });

  it('PARTIAL foreign-only sample returns PARTIAL and never bearish', () => {
    const sample = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: -10, rawInstitutionNetBuy: null }));
    expect(sample.status).toBe('PARTIAL');
    expect(['MEDIUM', 'LOW']).toContain(sample.confidence);
    expect(sample.signal).not.toBe('BEARISH');
  });

  it('verified positive, negative, and near-zero samples derive BULLISH, BEARISH, and NEUTRAL safely', () => {
    expect(normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: 10, rawInstitutionNetBuy: 20 })).signal).toBe('BULLISH');
    const bearish = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: -10, rawInstitutionNetBuy: -20 }));
    expect(bearish.status).toBe('VERIFIED');
    expect(['HIGH', 'MEDIUM']).toContain(bearish.confidence);
    expect(bearish.signal).toBe('BEARISH');
    expect(normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: 10, rawInstitutionNetBuy: -10 })).signal).toBe('NEUTRAL');
  });

  it('stale and missing/provider issue data never become bullish or bearish incorrectly', () => {
    const stale = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ sourceAgeTradingDays: 4 }));
    const missing = normalizeSemanticNetBuySampleAdr0485(verifiedInput({ rawForeignNetBuy: null, rawInstitutionNetBuy: null }));
    expect(stale.status).toBe('STALE');
    expect(stale.confidence).toBe('LOW');
    expect(stale.signal).toBe('UNKNOWN');
    expect(missing.signal).not.toBe('BEARISH');
    expect(normalizeSemanticNetBuySampleAdr0485(verifiedInput({ status: 'DATA_UNAVAILABLE' })).signal).not.toBe('BULLISH');
  });

  it('build report ranks NAVER verified above CACHE stale and rejects provider mismatch', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0485({ code: '005930', inputs: [
      verifiedInput({ provider: 'CACHE', sourceAgeTradingDays: 5 }),
      verifiedInput({ provider: 'NAVER', rawForeignNetBuy: 1, rawInstitutionNetBuy: 1 }),
      verifiedInput({ provider: 'KIS', status: 'PROVIDER_MISMATCH' }),
    ] });
    expect(report.selectedSample?.provider).toBe('NAVER');
    expect(report.samples.find((sample) => sample.provider === 'KIS')?.status).toBe('PROVIDER_MISMATCH');
  });

  it('selectedSample is null when all samples are empty or provider errors', () => {
    const report = buildSemanticNetBuyNormalizationReportAdr0485({ code: '005930', inputs: [
      verifiedInput({ rawForeignNetBuy: null, rawInstitutionNetBuy: null }),
      verifiedInput({ status: 'PROVIDER_ERROR' }),
    ] });
    expect(report.selectedSample).toBeNull();
    expect(report.signal).toBe('UNKNOWN');
  });

  it('ADR-0484 NAVER collector uses ADR-0485 normalizer', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/naverInvestorTrendCollectorAdr0484.ts'), 'utf-8');
    const result = buildNaverInvestorTrendCollectorResultAdr0484({ code: '005930', rawPoints: [{ date: '2026-05-08', foreignNetBuy: 1, institutionNetBuy: 2 }] });
    expect(src).toContain('normalizeSemanticNetBuySampleAdr0485');
    expect(result.semanticNetBuyCandidate?.status).toBe('VERIFIED');
  });

  it('ADR-0477 consumes ADR-0485 selected sample', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', semanticNetBuyNormalizationAdr0485: positiveReport() });
    expect(route.selectedProvider).toBe('NAVER');
    expect(route.semanticNetBuy?.source).toBe('NAVER');
    expect(route.signal).toBe('BULLISH');
    expect(route.policyPromotionMode).toBe('SHADOW_ONLY');
  });

  it('ADR-0475 exposes BULLISH selected sample only as SHADOW_ONLY positive source', () => {
    const report = buildGate1PositiveSourceWiringReport({
      positiveStarvationReport: starvationReport(),
      semanticNetBuyNormalizationAdr0485: positiveReport(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'TEST',
      marketSession: 'CLOSED',
    });
    expect(report?.semanticNetBuyCandidatesAdr0485?.[0]).toMatchObject({ status: 'VERIFIED', signal: 'BULLISH', executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
  });

  it('ADR-0476 records sanitized ADR-0485 observation row without raw provider payload', () => {
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', semanticNetBuyNormalizationAdr0485: positiveReport() });
    const row = rows.find((item) => item.observationType === 'SEMANTIC_NETBUY_NORMALIZER_ADR0485');
    expect(row).toMatchObject({ symbol: '005930', provider: 'NAVER', routeSignal: 'BULLISH', confidence: 'HIGH', unit: 'KRW', executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
    expect(JSON.stringify(row)).not.toContain('rawForeignNetBuy');
  });

  it('ADR-0480 downgrades/removes SEMANTIC_NETBUY_MISSING when normalizer exists', () => {
    const unavailable = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0485', sectionId: 'semantic_net_buy_normalizer', code: 'ADR-0485', diagnosticKey: 'ADR-0485 SEMANTIC_NETBUY_NORMALIZER', diagnosticValue: 'selected=NONE DATA_UNAVAILABLE', severity: 'DATA_UNAVAILABLE' }] });
    const parse = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0485', sectionId: 'semantic_net_buy_normalizer', code: 'ADR-0485', diagnosticKey: 'ADR-0485 SEMANTIC_NETBUY_NORMALIZER', diagnosticValue: 'PARSE_ERROR unitNormalized=false', severity: 'ERROR' }] });
    expect(unavailable.dedupedRootCauses).not.toContain('SEMANTIC_NETBUY_MISSING');
    expect(unavailable.dedupedRootCauses).toContain('SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE');
    expect(parse.dedupedRootCauses).toContain('SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE');
  });

  it('ADR-0478 compact output and ADR-0479 detail registry expose ADR-0485 trace', () => {
    const report = positiveReport();
    expect(formatSemanticNetBuyCompactAdr0485(report)).toContain('ADR-0485 SemanticNetBuy: VERIFIED');
    const entry = getSemanticNetBuyDetailRegistryEntryAdr0485(report);
    expect(entry.adrTraceHint).toBe('/adr_trace 0485');
    expect(entry.render()).toContain('selectedSample');
  });

  it('normalizer failure is try/catch isolated where integrated', () => {
    const report = safeBuildSemanticNetBuyNormalizationReportAdr0485({ code: '005930', inputs: [{ code: '005930', provider: 'NAVER', sourceDate: '2026-05-08', rawForeignNetBuy: Symbol('bad') as never }] });
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('does not import KIS order modules or live execution modules', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/semanticNetBuyNormalizerAdr0485.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKisMarketBuyOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder|liveBuy|executeBuy|trancheExecutor|autoTradeEngine/i);
  });

  it('requiredScore, Gate thresholds, weights, and Kelly remain unchanged', () => {
    const ledgerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts'), 'utf-8');
    const normalizerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/semanticNetBuyNormalizerAdr0485.ts'), 'utf-8');
    expect(ledgerSrc).toContain('requiredScore: 70');
    expect(normalizerSrc).not.toMatch(/requiredScore\s*=\s*(60|65)|setGateThreshold|GATE_RELAX|kelly/i);
  });

  it('policy invariants are always NONE/false/SHADOW_ONLY/operator approval', () => {
    const report = positiveReport();
    for (const sample of [report.selectedSample, normalizeSemanticNetBuySampleAdr0485(verifiedInput({ status: 'PROVIDER_ERROR' }))].filter(Boolean)) {
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
