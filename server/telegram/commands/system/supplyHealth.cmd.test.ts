// @responsibility /supply_health KIS-first output policy regression tests.
import fs from 'fs';
import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync('server/telegram/commands/system/supplyHealth.cmd.ts', 'utf-8');

describe('/supply_health KIS-first diagnostics', () => {
  it('passes a command-local KRX auto-fetch disabled flag into investor-flow routing', () => {
    expect(SOURCE).toContain('function isKrxAutoFetchDisabledForSupplyHealth()');
    expect(SOURCE).toContain("process.env.KIS_FIRST_REBUILD_MODE === 'true' || process.env.KRX_AUTO_FETCH_DISABLED === 'true'");
    expect(SOURCE).toContain('fetchInvestorFlowWithPolicy(stock.code, now, { krxAutoFetchDisabled: isKrxAutoFetchDisabledForSupplyHealth() })');
  });

  it('guards the KRX short-selling live probe with DISABLED_BY_KIS_FIRST_MODE diagnostics', () => {
    const guardIndex = SOURCE.indexOf('if (isKrxAutoFetchDisabledForSupplyHealth())');
    const fetchIndex = SOURCE.indexOf('await fetchKrxShortSelling()');
    expect(guardIndex).toBeGreaterThan(0);
    expect(fetchIndex).toBeGreaterThan(guardIndex);
    expect(SOURCE).toContain("'status: DISABLED_BY_KIS_FIRST_MODE'");
    expect(SOURCE).toContain("'providerIssue=false'");
    expect(SOURCE).toContain("'marketSignal=false'");
    expect(SOURCE).toContain("'executionImpact=NONE'");
  });

  it('labels KIS verified investor-flow samples without active KRX/NAVER/CACHE fallback wording', () => {
    expect(SOURCE).toContain('fallback: disabled because KIS verified sample is available');
    expect(SOURCE).toContain('legacyProviders: KRX/NAVER/CACHE diagnostic-only');
    expect(SOURCE).toContain('KRX role=MANUAL_VALIDATION_ONLY');
  });

  it('details zero-suspect reason and materialization action instead of only a count', () => {
    expect(SOURCE).toContain('interface ZeroSuspectDetail');
    expect(SOURCE).toContain("reason: 'REAL_ZERO_FIELD' | 'FALLBACK_ZERO' | 'UNKNOWN'");
    expect(SOURCE).toContain("if (sample.provider === 'KIS_API' && hasRequiredNetBuyFields && hasOptionalIndividualField) return 'REAL_ZERO_FIELD'");
    expect(SOURCE).toContain("reason === 'FALLBACK_ZERO' ? 'block materialization'");
    expect(SOURCE).toContain('zeroSuspect:');
  });

  it('separates pack-local StrongBuy wording from final gate wording', () => {
    expect(SOURCE).toContain('packLocalStrongBuyAllowed=');
    expect(SOURCE).toContain('finalStrongBuyAllowed=controlledByFinalGate');
    expect(SOURCE).toContain('finalGateNote=enemyWarnings=1 does not block STRONG_BUY alone; final decision is controlled by FinalGate.');
  });


  it('renders the eight supply health sections in a fixed independent order', () => {
    expect(SOURCE).toContain(`await diagnoseInvestorFlow(targets, now, nowMs),
      diagnoseLoadedKisOfficialSupplyPack(kis),
      await diagnoseStockProgram(targets),
      await diagnoseMarketProgram(macro, nowMs),
      diagnoseFss(macro, nowMs, kis.pack),
      await diagnoseShort(macro, nowMs, kis.pack),
      diagnoseForeignerRatio(targets, nowMs, kis.pack),
      diagnoseMargin(macro, nowMs, kis.pack),`);
    expect(SOURCE).toContain("if (index !== channels.length - 1) lines.push('');");
  });

  it('keeps market-program routing out of the KIS official pack note', () => {
    const packIndex = SOURCE.indexOf("title: 'KIS Official Supply Pack'");
    const noteIndex = SOURCE.indexOf('finalGateNote=enemyWarnings=1 does not block STRONG_BUY alone; final decision is controlled by FinalGate.');
    const packSnippet = SOURCE.slice(packIndex, noteIndex + 120);
    expect(packIndex).toBeGreaterThan(0);
    expect(noteIndex).toBeGreaterThan(packIndex);
    expect(packSnippet).not.toContain('route: KIS>KRX | fb=CACHE | diag=KIS | scoring=allowed_when_non_empty');
  });

  it('shows stock-program partial coverage as an amber lamp instead of OFF', () => {
    expect(SOURCE).toContain('function stockProgramLamp(success: number, total: number, zeroSuspicious: boolean)');
    expect(SOURCE).toContain("if (success >= 8) return { marker: 'DEGRADED', status: 'PARTIAL', lamp: 'AMBER' }");
    expect(SOURCE).toContain('`status: ${lamp.status}`');
    expect(SOURCE).toContain('`lamp: ${lamp.lamp}`');
    expect(SOURCE).toContain("'scoring=allowed_when_non_empty'");
    expect(SOURCE).toContain("'providerIssue=false'");
    expect(SOURCE).toContain("'executionImpact=NONE'");
  });

  it('routes accepted-empty market program through Patch-004 SSOT (no hardcoded ACCEPTED_EMPTY observation text)', () => {
    // Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004: hardcoded renderAcceptedEmptyMarketProgram replaced
    // by routeProgramMarketEmpty(...) SSOT + formatProgramMarketRouted(...) builder.
    expect(SOURCE).toContain('programMarketRouterPatch004');
    expect(SOURCE).toContain('routeProgramMarketEmpty');
    expect(SOURCE).toContain('formatProgramMarketRouted');
    expect(SOURCE).toContain('renderRoutedMarketProgram');
    expect(SOURCE).toContain('deriveCacheFallbackFromMacroState');
    // legacy hardcoded function removed
    expect(SOURCE).not.toContain('renderAcceptedEmptyMarketProgram');
  });
  it('formats KIS-first providerTried with KIS_API first and cache disabled when verified', () => {
    expect(SOURCE).toContain('function formatKisFirstInvestorFlowProviderTriedLines(');
    expect(SOURCE).toContain('KIS_API:OK endpoint=KIS_INVESTOR_TRADE_BY_STOCK_DAILY confidence=VERIFIED materialized=${success}/${total}');
    expect(SOURCE).toContain('KRX:DISABLED_BY_KIS_FIRST_MODE diagnosticOnly=true');
    expect(SOURCE).toContain('NAVER:DIAGNOSTIC_ONLY');
    expect(SOURCE).toContain('CACHE:FALLBACK_DISABLED_KIS_VERIFIED');
    expect(SOURCE).toContain('!router || router.selectedProvider === \'KIS_API\'');
  });

  it('documents BEARISH supply_confluence as actual KIS flow, not provider failure', () => {
    expect(SOURCE).toContain('function formatSupplyConfluenceLines(');
    expect(SOURCE).toContain('supply_confluence:');
    expect(SOURCE).toContain('signal=${router.signal}');
    expect(SOURCE).toContain('dataStatus=${dataStatus}');
    expect(SOURCE).toContain('providerIssue=${providerIssue}');
    expect(SOURCE).toContain('interpretation=actual KIS verified flow is bearish, not provider failure');
    expect(SOURCE).toContain('BEARISH는 데이터 장애가 아니라 KIS 실데이터 기반 약세 수급 신호입니다.');
    expect(SOURCE).toContain('일반 BUY는 최종 Gate 정책에 따르며, STRONG_BUY는 별도 제한될 수 있습니다.');
  });

  it('pins program lamp semantics for stock partial plus routed market program (Patch-004)', () => {
    // Stock-program lamp semantics preserved
    expect(SOURCE).toContain("if (success >= 8) return { marker: 'DEGRADED', status: 'PARTIAL', lamp: 'AMBER' }");
    expect(SOURCE).toContain('판정: PARTIAL — KIS stock program usable for non-empty symbols');
    expect(SOURCE).toContain('providerIssue=false');
    // Market-program ACCEPTED_EMPTY now routed via Patch-004 SSOT (router decides routedStatus + marker)
    expect(SOURCE).toContain('routeProgramMarketEmpty');
    expect(SOURCE).toContain('markerForRoutedStatus');
    // No bearish conversion (preserved through Patch-004 literal types: marketSignal=false)
    expect(SOURCE).not.toContain('renderAcceptedEmptyMarketProgram');
  });

});
