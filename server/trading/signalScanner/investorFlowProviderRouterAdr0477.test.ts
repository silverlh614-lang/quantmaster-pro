// @responsibility ADR-0477 investor-flow provider router wiring tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildInvestorFlowProviderCapabilities,
  buildInvestorFlowProviderRouteResultAdr0477,
  formatInvestorFlowProviderRouterAdr0477,
  normalizeSemanticNetBuySampleAdr0477,
} from './investorFlowProviderRouterAdr0477.js';
import {
  buildGate1DryRunObservationRows,
} from './gate1DryRunObservationLedgerAdr0476.js';
import {
  buildSupplyProviderWarmupReport,
  formatSupplyProviderWarmupCompactLine,
} from '../../supply/investorFlowProviderHealth.js';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const routerSource = () => read('./investorFlowProviderRouterAdr0477.ts');
const scanDiagnosticsSource = () => read('./scanDiagnostics.ts');
const entryFilterSource = () => read('./entryFilterDecomposition.ts');
const penaltyDedupSource = () => read('./gate1PenaltyDeduplication.ts');
const observationLedgerSource = () => read('./gate1DryRunObservationLedgerAdr0476.ts');

function notWiredRoute() {
  return buildInvestorFlowProviderRouteResultAdr0477({
    code: '005930',
    naverCollectorWired: false,
    cacheRaw: null,
    kisTriedForInvestorFlow: true,
    marketProgramStatus: 'ACCEPTED_EMPTY',
    fssSourceAgeTradingDays: 5,
  });
}

describe('ADR-0477 Investor Flow Provider Router Wiring', () => {
  it('NAVER NOT_WIRED, KIS PROVIDER_MISMATCH, and CACHE_EMPTY stay UNKNOWN with executionImpact NONE', () => {
    const route = notWiredRoute();

    expect(route.providerStatuses.NAVER).toBe('NOT_WIRED');
    expect(route.providerStatuses.KIS).toBe('PROVIDER_MISMATCH');
    expect(route.providerStatuses.CACHE).toBe('CACHE_EMPTY');
    expect(route.providerStatuses.MARKET_PROGRAM).toBe('ACCEPTED_EMPTY');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.signal).not.toBe('BEARISH');
    expect(route.coverage.providerMismatch).toBe(1);
    expect(route.coverage.notWired).toBe(1);
    expect(route.coverage.acceptedEmpty).toBe(1);
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(route.operatorApprovalRequired).toBe(true);
  });

  it('provider capability registry does not force KIS into semantic investor_flow', () => {
    const capabilities = buildInvestorFlowProviderCapabilities({ naverCollectorWired: false });
    const kis = capabilities.find((item) => item.provider === 'KIS');
    const naver = capabilities.find((item) => item.provider === 'NAVER');
    const cache = capabilities.find((item) => item.provider === 'CACHE');

    expect(kis?.supportsInvestorFlow).toBe(false);
    expect(kis?.isSemanticNetBuyProvider).toBe(false);
    expect(naver?.supportsInvestorFlow).toBe(false);
    expect(cache?.supportsInvestorFlow).toBe(true);
  });

  it('STALE sources block positive source contribution but do not create bearish signal', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: 100, institutionNetBuy: 100, sourceDate: '2026-05-01' },
      sourceAgeTradingDays: 5,
    });

    expect(route.providerStatuses.NAVER).toBe('STALE');
    expect(route.status).toBe('STALE');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.signal).not.toBe('BEARISH');
  });

  it('verified semantic net-buy can be BULLISH or BEARISH only with verified confidence', () => {
    const positive = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: 100, institutionNetBuy: 50, sourceDate: '2026-05-08' },
      sourceAgeTradingDays: 0,
    });
    const negative = buildInvestorFlowProviderRouteResultAdr0477({
      code: '000660',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: -100, institutionNetBuy: -50, sourceDate: '2026-05-08' },
      sourceAgeTradingDays: 0,
    });
    const staleNegative = buildInvestorFlowProviderRouteResultAdr0477({
      code: '035420',
      naverCollectorWired: true,
      naverRaw: { foreignNetBuy: -100, institutionNetBuy: -50, sourceDate: '2026-05-01' },
      sourceAgeTradingDays: 5,
    });

    expect(positive.signal).toBe('BULLISH');
    expect(positive.selectedProvider).toBe('NAVER');
    expect(positive.liveExecutionAllowed).toBe(false);
    expect(negative.signal).toBe('BEARISH');
    expect(staleNegative.signal).toBe('UNKNOWN');
  });

  it('semantic normalizer excludes ACCEPTED_EMPTY from score and does not persist raw payloads', () => {
    const sample = normalizeSemanticNetBuySampleAdr0477(
      { status: 'ACCEPTED_EMPTY', foreignNetBuy: 0, institutionNetBuy: 0 },
      'KIS',
      { code: '005930' },
    );

    expect(sample.status).toBe('ACCEPTED_EMPTY');
    expect(sample.signal).toBe('UNKNOWN');
    expect(routerSource()).not.toContain('rawPayload');
    expect(routerSource()).not.toContain('JSON.stringify(raw');
  });

  it('ADR-0477 route result is included in ADR-0473 warmup report', () => {
    const route = notWiredRoute();
    const warmup = buildSupplyProviderWarmupReport({
      investorFlowRouter: {
        status: route.status,
        selectedProvider: route.selectedProvider,
        providerTried: route.providerTried,
        signal: route.signal,
        coverage: {
          available: route.coverage.available,
          total: route.coverage.total,
        },
        executionImpact: 'NONE',
        liveExecutionAllowed: false,
      },
    });
    const formatted = formatSupplyProviderWarmupCompactLine(warmup);

    expect(warmup.investorFlowRouter?.status).toBe('DATA_UNAVAILABLE');
    expect(formatted).toContain('ADR-0477 Router');
    expect(formatted).toContain('signal=UNKNOWN');
  });

  it('ADR-0477 fields are available to ADR-0465 SupplyProviderHealthTrace and ADR-0466 unknown treatment', () => {
    const entrySource = entryFilterSource();
    const route = notWiredRoute();

    expect(entrySource).toContain('investorFlowRouterStatus');
    expect(entrySource).toContain('selectedInvestorFlowProvider');
    expect(entrySource).toContain('semanticNetBuySignal');
    expect(route.signal).toBe('UNKNOWN');
    expect(route.diagnostics.join(' ')).toContain('provider issue');
  });

  it('ADR-0469 can keep provider unknown grouped away from verified bearish supply', () => {
    const source = penaltyDedupSource();

    expect(source).toContain('SUPPLY_PROVIDER_UNKNOWN');
    expect(source).toContain('providerIssue');
    expect(source).toContain('marketSignal');
    expect(source).toContain('SUPPLY_UNKNOWN');
  });

  it('ADR-0476 ledger records sanitized ADR-0477 observation row with executionImpact NONE', () => {
    const route = notWiredRoute();
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      investorFlowProviderRouter: route,
      sellOnly: true,
      providerIssue: true,
      marketSignal: false,
    });
    const row = rows.find((item) => item.source === 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER');

    expect(row).toBeDefined();
    expect(row?.observationType).toBe('INVESTOR_FLOW_PROVIDER_ROUTER_ADR0477');
    expect(row?.selectedProvider).toBe('NONE');
    expect(row?.routeSignal).toBe('UNKNOWN');
    expect(row?.providerMismatchCount).toBe(1);
    expect(row?.notWiredCount).toBe(1);
    expect(row?.executionImpact).toBe('NONE');
    expect(row?.liveExecutionAllowed).toBe(false);
    expect(row?.policyPromotionMode).toBe('SHADOW_ONLY');
  });

  it('/scan_blockers formatter includes ADR-0477 compact section without raw Telegram HTML', () => {
    const route = notWiredRoute();
    const formatted = formatInvestorFlowProviderRouterAdr0477(route) ?? '';

    expect(formatted).toContain('Investor Flow Provider Router (ADR-0477)');
    expect(formatted).toContain('수급 악화가 아니라 수급 데이터 라우팅/커버리지 문제입니다.');
    expect(formatted).toContain('UNKNOWN/provider issue는 bearish로 변환되지 않습니다.');
    expect(formatted).not.toContain('<b>');
    expect(scanDiagnosticsSource()).toContain('formatInvestorFlowProviderRouterAdr0477');
    expect(scanDiagnosticsSource()).toContain('[ADR-0477] InvestorFlowProviderRouter build failed');
  });

  it('static guardrails keep live execution, thresholds, Kelly, and external IO unchanged', () => {
    const changedSources = [
      routerSource(),
      scanDiagnosticsSource(),
      observationLedgerSource(),
    ].join('\n');

    expect(changedSources).not.toMatch(/placeKisMarketBuyOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
    expect(changedSources).not.toMatch(/fetch\(|axios/);
    expect(changedSources).not.toMatch(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE/);
    expect(changedSources).not.toMatch(/requiredScore\s*[:=]\s*6[05]/);
    expect(changedSources).not.toContain("liveExecutionAllowed: true");
    expect(changedSources).not.toContain("executionImpact: 'HARD_BLOCK'");
  });

  it('Runtime Pipeline Audit can count ADR-0477 evidence without changing rollout status', () => {
    const route = notWiredRoute();
    const rows = buildGate1DryRunObservationRows({
      forDate: '2026-05-09',
      investorFlowProviderRouter: route,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.source === 'ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER')).toBe(true);
    expect(observationLedgerSource()).toContain('ADR_0477_INVESTOR_FLOW_PROVIDER_ROUTER');
  });

  it('ADR documentation exists and states SHADOW_ONLY promotion guard', () => {
    const doc = read('../../../docs/adr/0477-investor-flow-provider-router-wiring.md');
    const index = read('../../../docs/adr/INDEX.md');

    expect(doc).toContain('Status: Accepted / Shadow-only dry-run');
    expect(doc).toContain('Provider issue remains separated from market signal');
    expect(doc).toContain('UNKNOWN remains UNKNOWN');
    expect(index).toContain('| 0477 | investor-flow-provider-router-wiring.');
    expect(index).toContain('다음 발급 0478');
  });
});
