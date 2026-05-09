// @responsibility ADR-0481 NAVER Investor Trend Collector wiring tests.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildNaverInvestorTrendCollectorResultAdr0481,
  formatNaverInvestorTrendCompactAdr0481,
  getNaverInvestorTrendDetailRegistryEntryAdr0481,
  safeBuildNaverInvestorTrendCollectorResultAdr0481,
} from './naverInvestorTrendCollectorAdr0481.js';
import { buildInvestorFlowProviderCapabilities, buildInvestorFlowProviderRouteResultAdr0477 } from './investorFlowProviderRouterAdr0477.js';
import { buildSupplyProviderWarmupReport, formatSupplyProviderWarmupCompactLine } from '../../supply/investorFlowProviderHealth.js';
import { buildGate1PositiveSourceWiringReport } from './gate1PositiveSourceWiringAdr0475.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';

function positive() {
  return buildNaverInvestorTrendCollectorResultAdr0481({
    code: '005930',
    rawPoints: [
      { date: '2026-05-04', foreignNetBuy: 1, institutionNetBuy: 2, programNetBuy: 3 },
      { date: '2026-05-08', foreignNetBuy: 10, institutionNetBuy: 20, individualNetBuy: -30, programNetBuy: 5 },
    ],
  });
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

describe('ADR-0481 NAVER Investor Trend Collector Wiring', () => {
  it('collector module existence changes NAVER capability from NOT_WIRED to wired support without semantic promotion', () => {
    const naver = buildInvestorFlowProviderCapabilities().find((item) => item.provider === 'NAVER');
    expect(naver?.supportsInvestorFlow).toBe(true);
    expect(naver?.supportsForeignTrend).toBe(true);
    expect(naver?.isSemanticNetBuyProvider).toBe(false);
    expect(naver?.notes.join(' ')).toContain('SHADOW_ONLY');
  });

  it('empty NAVER result returns DATA_UNAVAILABLE/EMPTY and not BEARISH', () => {
    const noRows = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', rawPoints: [] });
    const empty = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', rawPoints: [{ date: '2026-05-08' }] });
    expect(['DATA_UNAVAILABLE', 'EMPTY']).toContain(noRows.status);
    expect(empty.status).toBe('EMPTY');
    expect(noRows.signal).toBe('UNKNOWN');
    expect(empty.signal).toBe('UNKNOWN');
  });

  it('parse error, provider error, and non-trading day return UNKNOWN', () => {
    expect(buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', parseError: true }).status).toBe('PARSE_ERROR');
    expect(buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', parseError: true }).signal).toBe('UNKNOWN');
    expect(buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', providerError: true }).status).toBe('PROVIDER_ERROR');
    expect(buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', providerError: true }).signal).toBe('UNKNOWN');
    expect(buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', nonTradingDay: true }).status).toBe('NON_TRADING_DAY');
    expect(buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', nonTradingDay: true }).signal).toBe('UNKNOWN');
  });

  it('stale NAVER data returns STALE and signal UNKNOWN', () => {
    const result = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', sourceAgeTradingDays: 4, rawPoints: [{ date: '2026-05-01', foreignNetBuy: 10, institutionNetBuy: 20 }] });
    expect(result.status).toBe('STALE');
    expect(result.signal).toBe('UNKNOWN');
  });

  it('valid positive and negative foreign+institution net-buy produce verified directional signals only with confidence', () => {
    const bullish = positive();
    const bearish = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', rawPoints: [{ date: '2026-05-08', foreignNetBuy: -10, institutionNetBuy: -20 }] });
    expect(bullish.status).toBe('DATA_AVAILABLE');
    expect(bullish.signal).toBe('BULLISH');
    expect(bullish.semanticNetBuyCandidate?.confidence).toBe('HIGH');
    expect(bearish.signal).toBe('BEARISH');
  });

  it('partial and missing data do not force bearish', () => {
    const partial = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', rawPoints: [{ date: '2026-05-08', foreignNetBuy: -10 }] });
    const missing = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930' });
    expect(partial.status).toBe('PARTIAL');
    expect(partial.signal).toBe('UNKNOWN');
    expect(missing.signal).not.toBe('BEARISH');
  });

  it('semanticNetBuyCandidate is produced from normalized NAVER data', () => {
    const result = positive();
    expect(result.semanticNetBuyCandidate).toMatchObject({ foreignNetBuy: 10, institutionNetBuy: 20, programNetBuy: 5, sourceDate: '2026-05-08', status: 'VERIFIED' });
  });

  it('ADR-0477 can select NAVER only in SHADOW_ONLY diagnostics', () => {
    const result = positive();
    const route = buildInvestorFlowProviderRouteResultAdr0477({ code: '005930', naverCollectorResultAdr0481: result, kisTriedForInvestorFlow: true });
    expect(route.selectedProvider).toBe('NAVER');
    expect(route.signal).toBe('BULLISH');
    expect(route.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('ADR-0473 warmup no longer reports NAVER as NOT_WIRED when ADR-0481 is wired', () => {
    const result = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930' });
    const report = buildSupplyProviderWarmupReport({ naverInvestorTrendAdr0481: result });
    const text = formatSupplyProviderWarmupCompactLine(report);
    expect(report.naverStatus).not.toBe('NOT_WIRED');
    expect(text).toContain('ADR-0481 NAVER InvestorTrend');
  });

  it('ADR-0475 dry-run consumes NAVER bullish candidate without live promotion', () => {
    const report = buildGate1PositiveSourceWiringReport({
      positiveStarvationReport: starvationReport(),
      naverInvestorTrendAdr0481: positive(),
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'TEST',
      marketSession: 'CLOSED',
    });
    expect(report?.naverInvestorTrendCandidatesAdr0481?.[0]).toMatchObject({ status: 'VERIFIED', signal: 'BULLISH', executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
  });

  it('ADR-0476 records sanitized ADR-0481 observation row without raw NAVER payload', () => {
    const result = positive();
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', naverInvestorTrendAdr0481: result });
    const row = rows.find((item) => item.observationType === 'NAVER_INVESTOR_TREND_COLLECTOR_ADR0481');
    expect(row).toMatchObject({ symbol: '005930', routeSignal: 'BULLISH', sourceDate: '2026-05-08', availableDays: 2, requestedDays: 5, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY' });
    expect(JSON.stringify(row)).not.toContain('rawPoints');
  });

  it('ADR-0480 downgrades/removes INVESTOR_FLOW_PROVIDER_UNWIRED when NOT_WIRED evidence disappears', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0481', sectionId: 'naver_investor_trend', code: 'NAVER_INVESTOR_TREND_EMPTY', diagnosticKey: 'ADR-0481 NAVER_INVESTOR_TREND', diagnosticValue: 'DATA_UNAVAILABLE', severity: 'DATA_UNAVAILABLE' }] });
    expect(report.dedupedRootCauses).not.toContain('INVESTOR_FLOW_PROVIDER_UNWIRED');
    expect(report.dedupedRootCauses).toContain('NAVER_INVESTOR_TREND_EMPTY_OR_UNAVAILABLE');
    expect(report.topActions[0]?.priority).toBe('P2');
  });

  it('ADR-0478 compact and ADR-0479 detail registry include ADR-0481 summary', () => {
    const result = positive();
    expect(formatNaverInvestorTrendCompactAdr0481(result)).toContain('ADR-0481 NAVER InvestorTrend: DATA_AVAILABLE');
    const entry = getNaverInvestorTrendDetailRegistryEntryAdr0481(result);
    expect(entry.adrTraceHint).toBe('/adr_trace 0481');
    expect(entry.render()).toContain('semanticNetBuyCandidate');
  });

  it('collector failure is try/catch isolated', () => {
    const result = safeBuildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', rawPoints: [{ date: null as never }] });
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('does not import KIS order modules or live execution modules', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/naverInvestorTrendCollectorAdr0481.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKis|Order|liveBuy|executeBuy|Kelly/i);
  });

  it('requiredScore remains 70 and gate thresholds/weights/Kelly remain unchanged by ADR-0481', () => {
    const ledgerSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts'), 'utf-8');
    const collectorSrc = fs.readFileSync(path.resolve('server/trading/signalScanner/naverInvestorTrendCollectorAdr0481.ts'), 'utf-8');
    expect(ledgerSrc).toContain('requiredScore: 70');
    expect(collectorSrc).not.toMatch(/requiredScore\s*=\s*(60|65)|setGateThreshold|GATE_RELAX|kelly/i);
  });

  it('UNKNOWN is never bullish and provider issue is never bearish', () => {
    const unavailable = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930' });
    const providerError = buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', providerError: true });
    expect(unavailable.signal).toBe('UNKNOWN');
    expect(providerError.signal).not.toBe('BEARISH');
  });

  it('ADR-0481 policy invariants are always NONE/false/SHADOW_ONLY/operator approval', () => {
    for (const result of [positive(), buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930' }), buildNaverInvestorTrendCollectorResultAdr0481({ code: '005930', parseError: true })]) {
      expect(result.executionImpact).toBe('NONE');
      expect(result.liveExecutionAllowed).toBe(false);
      expect(result.policyPromotionMode).toBe('SHADOW_ONLY');
      expect(result.operatorApprovalRequired).toBe(true);
    }
  });
});
