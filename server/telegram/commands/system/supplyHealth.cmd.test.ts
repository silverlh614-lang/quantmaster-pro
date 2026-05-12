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
    expect(SOURCE).toContain('supply_confluence and SectorEnergy remain final gates');
  });

  it('keeps accepted-empty market program as non-provider issue observation', () => {
    expect(SOURCE).toContain("'status: ACCEPTED_EMPTY'");
    expect(SOURCE).toContain("'scoring=excluded'");
    expect(SOURCE).toContain("'providerIssue=false'");
    expect(SOURCE).toContain("'marketSignal=false'");
    expect(SOURCE).toContain("'action=observe'");
  });
});
