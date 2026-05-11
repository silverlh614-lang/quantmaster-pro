import { describe, expect, it } from 'vitest';
import {
  buildInvestorSampleDiagnosticsAdr0502,
  formatInvestorSampleDiagnosticsAdr0502,
} from './investorSampleMaterializationAdr0502.js';

describe('ADR-0502 investor sample materialization diagnostics', () => {
  it('marks raw provider rows without investor-flow fields as non-materialized', () => {
    const diag = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'NAVER_INVESTOR_TREND',
      rawFetched: true,
      rawCount: 1,
      normalizedCount: 1,
      materializedCount: 0,
      symbolCoverage: 1,
      dateCoverage: '2026-05-11',
      fieldCoverage: 0,
      inputSourceKind: 'RAW_PROVIDER',
    });

    expect(diag.sampleMaterialized).toBe(false);
    expect(diag.usableForRouter).toBe(false);
    expect(diag.blockedReason).toBe('NO_MATERIALIZED_SAMPLE');
    expect(diag.executionImpact).toBe('NONE');
    expect(diag.liveExecutionAllowed).toBe(false);
  });

  it('marks normalized materialized provider samples as router usable', () => {
    const diag = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'NAVER_INVESTOR_TREND',
      rawFetched: true,
      rawCount: 3,
      normalizedCount: 3,
      materializedCount: 3,
      symbolCoverage: 1,
      dateCoverage: '2026-05-11',
      fieldCoverage: 0.67,
      inputSourceKind: 'RAW_PROVIDER',
      confidenceLevel: 'DEGRADED',
    });

    expect(diag.sampleMaterialized).toBe(true);
    expect(diag.usableForRouter).toBe(true);
    expect(formatInvestorSampleDiagnosticsAdr0502(diag)).toContain('materializedCount=3');
  });

  it('keeps semantic placeholders out of router usability', () => {
    const diag = buildInvestorSampleDiagnosticsAdr0502({
      providerName: 'SEMANTIC_NETBUY',
      rawFetched: false,
      rawCount: 0,
      normalizedCount: 0,
      materializedCount: 0,
      placeholderDetected: true,
      inputSourceKind: 'PLACEHOLDER',
      blockedReason: 'NO_INPUT_SAMPLE',
    });

    expect(diag.sampleMaterialized).toBe(false);
    expect(diag.usableForRouter).toBe(false);
    expect(diag.placeholderDetected).toBe(true);
    expect(diag.blockedReason).toBe('NO_INPUT_SAMPLE');
  });
});
