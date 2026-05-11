// @responsibility ADR-0473 supply provider warmup and semantic net-buy cache policy tests
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPreviousTradingDayCacheFallbackDiagnostic,
  buildSupplyProviderWarmupReport,
  deriveSupplyProviderHealth,
  formatSupplyProviderWarmupCompactLine,
  isSemanticNetBuyProvider,
  makeInvestorFlowProviderHealth,
  summarizeInvestorFlowProviderHealth,
} from '../../supply/investorFlowProviderHealth.js';

const source = () => readFileSync(
  new URL('../../supply/investorFlowProviderHealth.ts', import.meta.url),
  'utf8',
);
const scanBlockersSource = () => readFileSync(
  new URL('../../telegram/commands/system/scanBlockers.cmd.ts', import.meta.url),
  'utf8',
);

describe('ADR-0473 Supply Provider Warmup', () => {
  it('KRX NON_TRADING_DAY is data unavailable but not failed', () => {
    const health = deriveSupplyProviderHealth({ status: 'NON_TRADING_DAY' });

    expect(health.providerIssue).toBe(true);
    expect(health.marketSignal).toBe(false);
    expect(health.supplyMarketSignal).toBe('UNAVAILABLE');
    expect(health.failed).toBe(false);
    expect(health.executionImpact).toBe('NONE');
  });

  it('CACHE_EMPTY is not bearish', () => {
    const health = deriveSupplyProviderHealth({ status: 'CACHE_EMPTY' });

    expect(health.providerIssue).toBe(true);
    expect(health.marketSignal).toBe(false);
    expect(health.supplyMarketSignal).not.toBe('BEARISH');
  });

  it('NAVER NOT_WIRED is providerIssue=true and marketSignal=false', () => {
    const health = deriveSupplyProviderHealth({ status: 'NOT_WIRED' });

    expect(health.providerIssue).toBe(true);
    expect(health.marketSignal).toBe(false);
  });

  it('KIS PROVIDER_MISMATCH is not used as a semantic net-buy provider', () => {
    expect(isSemanticNetBuyProvider('KIS_API')).toBe(false);

    const health = deriveSupplyProviderHealth({ status: 'PROVIDER_MISMATCH' });
    expect(health.providerIssue).toBe(true);
    expect(health.marketSignal).toBe(false);
  });

  it('UNKNOWN supply keeps liveStrongBuyAllowed=false', () => {
    const health = deriveSupplyProviderHealth({ status: 'UNKNOWN' });

    expect(health.liveStrongBuyAllowed).toBe(false);
    expect(health.liveExecutionAllowed).toBe(false);
  });

  it('shadowObservableAllowed remains true', () => {
    expect(deriveSupplyProviderHealth({ status: 'CACHE_EMPTY' }).shadowObservableAllowed).toBe(true);
    expect(deriveSupplyProviderHealth({ status: 'PROVIDER_MISMATCH' }).shadowObservableAllowed).toBe(true);
  });

  it('only VERIFIED bearish semantic sample becomes a market signal', () => {
    const missing = deriveSupplyProviderHealth({
      status: 'DATA_UNAVAILABLE',
      sample: {
        code: '005930',
        source: 'KRX',
        sourceDate: '2026-05-08',
        investorForeignNetBuy: -1,
        investorInstitutionNetBuy: -1,
        confidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: true,
      },
    });
    const bearish = deriveSupplyProviderHealth({
      status: 'VERIFIED',
      sample: {
        code: '005930',
        source: 'KRX',
        sourceDate: '2026-05-08',
        investorForeignNetBuy: -1,
        investorInstitutionNetBuy: -1,
        confidence: 'VERIFIED',
        providerIssue: false,
        marketSignal: true,
      },
    });

    expect(missing.marketSignal).toBe(false);
    expect(missing.supplyMarketSignal).toBe('UNAVAILABLE');
    expect(bearish.marketSignal).toBe(true);
    expect(bearish.supplyMarketSignal).toBe('BEARISH');
    expect(bearish.liveStrongBuyAllowed).toBe(false);
  });

  it('previousTradingDateCandidate is calculated for a weekend source date', () => {
    const diagnostic = buildPreviousTradingDayCacheFallbackDiagnostic({
      code: '005930',
      requestedSourceDate: '2026-05-10',
      cacheHit: false,
    });

    expect(diagnostic.previousTradingDateCandidate).toBe('2026-05-08');
    expect(diagnostic.cacheKeyTried).toContain('005930');
    expect(diagnostic.usableForShadow).toBe(true);
    expect(diagnostic.usableForLiveStrongBuy).toBe(false);
  });

  it('cacheHit=false still has executionImpact=NONE', () => {
    const diagnostic = buildPreviousTradingDayCacheFallbackDiagnostic({
      requestedSourceDate: '2026-05-10',
      cacheHit: false,
    });

    expect(diagnostic.cacheHit).toBe(false);
    expect(diagnostic.executionImpact).toBe('NONE');
  });

  it('compact ADR-0473 report keeps provider issue separate from market signal', () => {
    const health = [
      makeInvestorFlowProviderHealth({
        provider: 'KRX',
        status: 'NON_TRADING_DAY',
        reason: 'KRX non-trading day',
        now: new Date('2026-05-09T03:00:00.000Z'),
        sourceDateKst: '2026-05-08',
        cacheFallback: true,
      }),
      makeInvestorFlowProviderHealth({
        provider: 'NAVER',
        status: 'NOT_WIRED',
        reason: 'semantic net-buy collector not implemented',
        now: new Date('2026-05-09T03:00:00.000Z'),
      }),
      makeInvestorFlowProviderHealth({
        provider: 'CACHE',
        status: 'CACHE_EMPTY',
        reason: 'no usable investor-flow cache',
        now: new Date('2026-05-09T03:00:00.000Z'),
      }),
      makeInvestorFlowProviderHealth({
        provider: 'KIS',
        status: 'PROVIDER_UNAVAILABLE',
        reason: 'KIS diagnostic-only; provider mismatch for semantic net-buy',
        now: new Date('2026-05-09T03:00:00.000Z'),
      }),
    ];
    const report = buildSupplyProviderWarmupReport({
      health,
      now: new Date('2026-05-09T03:00:00.000Z'),
      code: '005930',
      cacheHit: false,
    });
    const text = formatSupplyProviderWarmupCompactLine(report);

    expect(text).toContain('Supply Provider Warmup (ADR-0473)');
    expect(text).toContain('KRX: NON_TRADING_DAY');
    expect(text).toContain('previousTradingDateCandidate=2026-05-08');
    expect(text).toContain('NAVER: NOT_WIRED');
    expect(text).toContain('Semantic NetBuy: DATA_UNAVAILABLE');
    expect(text).toContain('CACHE: CACHE_EMPTY');
    expect(text).toContain('KIS: PROVIDER_MISMATCH');
    expect(text).toContain('providerIssue=true');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('executionImpact=NONE');
    expect(report.shadowObservableAllowed).toBe(true);
  });

  it('aligns top provider health summary with router-aware CACHE_STALE_HIT and avoids legacy contradictions', () => {
    const health = [
      makeInvestorFlowProviderHealth({ provider: 'KRX', status: 'MARKET_CLOSED', reason: 'closed', now: new Date('2026-05-11T00:00:00.000Z') }),
      makeInvestorFlowProviderHealth({ provider: 'NAVER', status: 'NOT_WIRED', reason: 'legacy no sample', now: new Date('2026-05-11T00:00:00.000Z') }),
      makeInvestorFlowProviderHealth({ provider: 'CACHE', status: 'CACHE_EMPTY', reason: 'legacy empty cache', now: new Date('2026-05-11T00:00:00.000Z') }),
      makeInvestorFlowProviderHealth({ provider: 'COMPOSITE', status: 'PROVIDER_UNAVAILABLE', reason: 'legacy unavailable', now: new Date('2026-05-11T00:00:00.000Z'), semanticAvailable: false, dataAvailable: false }),
    ];
    const text = summarizeInvestorFlowProviderHealth(health, {
      status: 'STALE',
      selectedProvider: 'CACHE',
      selectedReason: 'ADR-0491 sanitized snapshot cache selected: CACHE_STALE_HIT',
      providerTried: ['NAVER', 'SEMANTIC_NETBUY', 'CACHE'],
      providerStatuses: { NAVER: 'NON_TRADING_DAY', SEMANTIC_NETBUY: 'DATA_UNAVAILABLE', CACHE: 'CACHE_STALE_HIT' },
      signal: 'UNKNOWN',
      coverage: { available: 1, total: 7 },
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
    });

    expect(text).toContain('- NAVER: NON_TRADING_DAY');
    expect(text).toContain('- Semantic NetBuy: DATA_UNAVAILABLE / NO_INPUT_SAMPLE');
    expect(text).toContain('- CACHE: CACHE_STALE_HIT');
    expect(text).toContain('- selectedProvider: CACHE');
    expect(text).toContain('- supply_confluence: UNKNOWN / STALE_DIAGNOSTIC, not failed');
    expect(text).toContain('- liveStrongBuyAllowed: false');
    expect(text).toContain('- shadowObservableAllowed: true');
    expect(text).not.toContain('- NAVER: NOT_WIRED');
    expect(text).not.toContain('- Semantic NetBuy: NOT_WIRED');
    expect(text).not.toContain('- CACHE: CACHE_EMPTY');
    expect(text).not.toContain('BEARISH');
  });

  it('aligns SupplyHealth warmup display with router CACHE_STALE_HIT selection', () => {
    const report = buildSupplyProviderWarmupReport({
      investorFlowRouter: {
        status: 'STALE',
        selectedProvider: 'CACHE',
        selectedReason: 'ADR-0491 sanitized snapshot cache selected: CACHE_STALE_HIT',
        providerTried: ['NAVER', 'SEMANTIC_NETBUY', 'CACHE', 'KIS', 'KRX', 'FSS'],
        providerStatuses: { NAVER: 'NOT_WIRED', SEMANTIC_NETBUY: 'DATA_UNAVAILABLE', CACHE: 'CACHE_STALE_HIT', KIS: 'PROVIDER_MISMATCH' },
        signal: 'UNKNOWN',
        coverage: { available: 1, total: 7 },
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
      },
    });
    const text = formatSupplyProviderWarmupCompactLine(report);

    expect(report.cacheStatus).toBe('CACHE_STALE_HIT');
    expect(report.naverStatus).toBe('DATA_UNAVAILABLE');
    expect(report.semanticNetBuyCollectorStatus).toBe('WIRED');
    expect(text).toContain('CACHE: CACHE_STALE_HIT');
    expect(text).toContain('selectedProvider: CACHE');
    expect(text).toContain('selectedReason: ADR-0491 sanitized snapshot cache selected: CACHE_STALE_HIT');
    expect(text).toContain('Semantic NetBuy: DATA_UNAVAILABLE / NO_INPUT_SAMPLE');
    expect(text).toContain('NAVER: DATA_UNAVAILABLE');
    expect(text).toContain('supply_confluence: UNKNOWN / STALE_DIAGNOSTIC, not bearish');
    expect(text).toContain('liveStrongBuyAllowed=false');
    expect(text).not.toContain('CACHE: CACHE_EMPTY');
    expect(text).not.toContain('NAVER: NOT_WIRED');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
  });

  it('/scan_blockers appends the ADR-0473 warmup section without raw Telegram HTML', () => {
    const text = scanBlockersSource();

    expect(text).toContain('formatSupplyProviderWarmupCompactLine');
    expect(text).toContain('buildSupplyProviderWarmupReport');
    expect(text).toContain('supplyProviderWarmupSection');
    expect(text).toContain('parts.push(supplyProviderWarmupSection)');
    expect(formatSupplyProviderWarmupCompactLine(buildSupplyProviderWarmupReport()))
      .not.toMatch(/<b>|<i>|<code>/);
  });

  it('raw payload whole persistence is absent', () => {
    expect(source()).not.toContain('rawPayload');
    expect(source()).not.toContain('JSON.stringify(input)');
  });

  it('KIS order function imports remain absent', () => {
    const text = source();

    expect(text).not.toContain('placeKisMarketBuyOrder');
    expect(text).not.toContain('placeKisSellOrder');
    expect(text).not.toContain('placeKisStopLossOrder');
    expect(text).not.toContain('placeKisTakeProfitOrder');
    expect(text).not.toContain('cancelKisOrder');
  });

  it('Gate threshold is not changed by ADR-0473', () => {
    const text = source();

    expect(text).not.toContain('requiredScore = 60');
    expect(text).not.toContain('requiredScore = 65');
    expect(text).not.toContain('setGateThreshold');
    expect(text).not.toContain('GATE_RELAX');
  });
});
