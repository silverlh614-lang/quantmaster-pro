// @responsibility ADR-0477 KIS VERIFIED short-circuit and optional KRX detail isolation tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInvestorFlowProviderRouteResultAdr0477 } from './investorFlowProviderRouterAdr0477.js';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const scanDiagnosticsSource = () => read('./scanDiagnostics.ts');

describe('ADR-0477 KIS VERIFIED short-circuit', () => {
  it('KIS VERIFIED short-circuits optional KRX 400 and stale NAVER fallback', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: {
        code: '005930',
        sourceDate: '2026-05-07',
        foreignNetBuy: -10,
        institutionNetBuy: -20,
        status: 'STALE',
      },
      krxInvestorDiagnosticAdr0505: {
        provider: 'KRX',
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        parserStatus: 'PROVIDER_EMPTY_RESPONSE',
        endpointIssueHint: 'ENDPOINT_PARAMETER_ERROR',
        endpoint: 'MDCSTAT02201',
        bld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
        tradeDate: '20260508',
        routePurpose: 'MARKET_LEVEL',
        selectedBld: 'dbms/MDC/STAT/standard/MDCSTAT02201',
        httpStatus: 400,
        responseKind: 'HTTP_ERROR',
        diagnosticOnly: true,
        useForRouter: false,
        useForGate: false,
        useForLive: false,
        useForShadow: false,
        summary: 'routedStatus=BAD_REQUEST_SESSION_OR_PARAM;providerIssue=false;marketSignal=false;executionImpact=NONE',
      },
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        foreignNetBuy: 100,
        institutionNetBuy: 200,
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.selectedProvider).toBe('KIS_API');
    expect(route.status).toBe('VERIFIED');
    expect(route.selectedReason).toContain('KIS_VERIFIED_SHORTCIRCUIT');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('routedStatus=OPTIONAL_KRX_DETAIL_UNAVAILABLE');
    expect(route.providerReasons.KRX_INVESTOR_FLOW).toContain('useForRouter=false');
    expect(route.providerReasons.NAVER_INVESTOR_TREND).toContain('STALE_WHILE_KIS_VERIFIED');
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
    expect(route.diagnostics.join('\n')).toContain('selectedProvider=KIS_API status=VERIFIED reason=KIS_VERIFIED_SHORTCIRCUIT');
    expect(route.diagnostics.join('\n')).not.toContain('selectedProvider=NAVER_INVESTOR_TREND');
  });

  it('KIS missing plus stale NAVER can still emit SHADOW_ONLY fallback diagnostics', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: true,
      naverRaw: {
        code: '005930',
        sourceDate: '2026-05-07',
        foreignNetBuy: -10,
        institutionNetBuy: -20,
        status: 'STALE',
      },
    });

    expect(route.selectedProvider).toBe('NAVER_INVESTOR_TREND');
    expect(route.status).toBe('STALE');
    expect(route.selectedReason).toContain('STALE SHADOW_ONLY diagnostic');
    expect(route.executionImpact).toBe('NONE');
  });

  it('scan diagnostics logs KIS short-circuit instead of SHADOW_ONLY warning for KIS_API VERIFIED', () => {
    const source = scanDiagnosticsSource();

    expect(source).toContain('selectedProvider=KIS_API');
    expect(source).toContain('reason=KIS_VERIFIED_SHORTCIRCUIT');
    expect(source).toContain('InvestorFlowProviderRouter SHADOW_ONLY emitted');
  });
});
