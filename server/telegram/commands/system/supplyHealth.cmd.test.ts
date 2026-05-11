// @responsibility /supply_health KIS-first KRX auto-fetch guard regression tests.
import fs from 'fs';
import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync('server/telegram/commands/system/supplyHealth.cmd.ts', 'utf-8');

describe('/supply_health KIS-first KRX fetch guard', () => {
  it('passes a command-local KRX auto-fetch disabled flag into investor-flow routing', () => {
    expect(SOURCE).toContain('function isKrxAutoFetchDisabledForSupplyHealth()');
    expect(SOURCE).toContain("process.env.KIS_FIRST_REBUILD_MODE === 'true' || process.env.KRX_AUTO_FETCH_DISABLED !== 'false'");
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
});

  it('labels KIS_ONLY_REBUILD supply health as legacy diagnostic-only without active alternatives', () => {
    expect(SOURCE).toContain('Current Mode: KIS_ONLY_REBUILD');
    expect(SOURCE).toContain('Active source diagnosis: /kis_health');
    expect(SOURCE).toContain('Legacy Supply Health below is diagnostic-only.');
    expect(SOURCE).toContain('Legacy providers are disabled for current decisions in KIS_ONLY_REBUILD_MODE.');
    expect(SOURCE).not.toContain('KRX/NAVER/FSS/CACHE/SEMANTIC_NETBUY/Yahoo/ADR dry-run');
  });
