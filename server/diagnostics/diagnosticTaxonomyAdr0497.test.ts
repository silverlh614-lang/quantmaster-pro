import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildFreshDataStatusViewModelAdr0497,
  buildGateFailureAttributionEntryAdr0497,
  classifyProviderMarketSeparationAdr0497,
  DIAGNOSTIC_ONLY_POLICY_ADR0497,
  formatFreshDataStatusCompactAdr0497,
  formatGateFailureAttributionCompactAdr0497,
  normalizeDataValueAdr0497,
} from './diagnosticTaxonomyAdr0497.js';

describe('ADR-0497 diagnostic taxonomy SSOT', () => {
  it('freezes the diagnostic-only policy and forbids live effects', () => {
    expect(Object.isFrozen(DIAGNOSTIC_ONLY_POLICY_ADR0497)).toBe(true);
    expect(DIAGNOSTIC_ONLY_POLICY_ADR0497.executionImpact).toBe('NONE');
    expect(DIAGNOSTIC_ONLY_POLICY_ADR0497.liveExecutionAllowed).toBe(false);
    expect(DIAGNOSTIC_ONLY_POLICY_ADR0497.gateMutationAllowed).toBe(false);
    expect(DIAGNOSTIC_ONLY_POLICY_ADR0497.orderPathAllowed).toBe(false);
    expect(DIAGNOSTIC_ONLY_POLICY_ADR0497.autoPromotionAllowed).toBe(false);
    expect(DIAGNOSTIC_ONLY_POLICY_ADR0497.strongBuyUnlockAllowed).toBe(false);
  });

  it('separates provider issues from market signals', () => {
    expect(classifyProviderMarketSeparationAdr0497({ providerHealth: 'UP', requestedMarketSignal: 'BULLISH' })).toMatchObject({
      providerIssue: false,
      marketSignal: 'BULLISH',
      isMarketSignalValid: true,
    });
    expect(classifyProviderMarketSeparationAdr0497({ providerHealth: 'UP', requestedMarketSignal: 'BEARISH' })).toMatchObject({
      providerIssue: false,
      marketSignal: 'BEARISH',
      isMarketSignalValid: true,
    });
    for (const providerHealth of ['DOWN', 'EMPTY', 'STALE'] as const) {
      const result = classifyProviderMarketSeparationAdr0497({
        providerHealth,
        requestedMarketSignal: providerHealth === 'EMPTY' ? 'BULLISH' : 'BEARISH',
      });
      expect(result.providerIssue).toBe(true);
      expect(result.marketSignal).toBe('UNKNOWN');
      expect(result.isMarketSignalValid).toBe(false);
    }
  });

  it('normalizes null, zero, missing, stale, provider-error, and parse-error semantics', () => {
    expect(normalizeDataValueAdr0497({ value: null })).toMatchObject({ valueState: 'NULL', numericValue: null });
    expect(normalizeDataValueAdr0497({ value: undefined })).toMatchObject({ valueState: 'MISSING', numericValue: null });
    expect(normalizeDataValueAdr0497({ fieldPresent: false, value: 7 })).toMatchObject({ valueState: 'MISSING', numericValue: null });
    expect(normalizeDataValueAdr0497({ value: 0 })).toMatchObject({ valueState: 'ZERO', numericValue: 0 });
    expect(normalizeDataValueAdr0497({ value: '0' })).toMatchObject({ valueState: 'ZERO', numericValue: 0 });
    expect(normalizeDataValueAdr0497({ value: '1,200' })).toMatchObject({ valueState: 'VALID_NUMBER', numericValue: 1200 });
    expect(normalizeDataValueAdr0497({ value: 'abc' })).toMatchObject({ valueState: 'PARSE_ERROR', numericValue: null });
    expect(normalizeDataValueAdr0497({ value: 1200, providerError: true })).toMatchObject({ valueState: 'PROVIDER_ERROR', numericValue: null });
    expect(normalizeDataValueAdr0497({ value: -1, stale: true })).toMatchObject({ valueState: 'STALE', numericValue: null });
  });

  it('builds stable fresh data status view models with diagnostic-only provider warnings', () => {
    const defaults = buildFreshDataStatusViewModelAdr0497({ dataLineId: 'NAVER' });
    expect(defaults).toMatchObject({
      domain: 'UNKNOWN',
      providerHealth: 'UNKNOWN',
      dataConfidence: 'UNKNOWN',
      marketSignal: 'UNKNOWN',
      dataLineStatus: 'OBSERVING',
      promotionReadiness: 'NOT_EVALUATED',
      executionImpact: 'NONE',
      blockers: [],
    });
    expect(defaults.warnings).toContain('provider issue is diagnostic evidence, not a market signal');

    const providerEmpty = buildFreshDataStatusViewModelAdr0497({
      dataLineId: 'NAVER',
      domain: 'INVESTOR_FLOW',
      providerHealth: 'EMPTY',
      marketSignal: 'BULLISH',
    });
    expect(providerEmpty.marketSignal).toBe('UNKNOWN');
    expect(providerEmpty.executionImpact).toBe('NONE');
    expect(providerEmpty.warnings).toContain('provider issue is diagnostic evidence, not a market signal');
    expect(formatFreshDataStatusCompactAdr0497(providerEmpty)).toContain('impact=NONE');
  });

  it('builds gate failure attribution entries without persistence or live calls', () => {
    const explicit = buildGateFailureAttributionEntryAdr0497({
      scanId: 'scan-1',
      gateName: 'Gate1',
      failureCause: 'SUPPLY_CONFLUENCE_UNAVAILABLE',
      providerHealth: 'EMPTY',
      dataConfidence: 'MISSING',
      executionImpact: 'DOWNGRADED',
      shadowLearningTag: 'test',
    });
    expect(explicit.timestamp).toEqual(expect.any(String));
    expect(explicit.failureCause).toBe('SUPPLY_CONFLUENCE_UNAVAILABLE');
    expect(explicit.executionImpact).toBe('DOWNGRADED');
    expect(formatGateFailureAttributionCompactAdr0497(explicit)).toBe('GateFailure ADR-0497: Gate1 SUPPLY_CONFLUENCE_UNAVAILABLE provider=EMPTY confidence=MISSING impact=DOWNGRADED');

    expect(() => buildGateFailureAttributionEntryAdr0497()).not.toThrow();
    const minimal = buildGateFailureAttributionEntryAdr0497({ scanId: 'scan-min', gateName: 'Gate2' });
    expect(minimal.failureCause).toBe('UNKNOWN');
    expect(minimal.executionImpact).toBe('NONE');
  });

  it('contains no forbidden live-order, Gate/Kelly mutation, or file-write patterns', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/diagnosticTaxonomyAdr0497.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*(?:kis|orderExecutor|autoTradeEngine|trancheExecutor|buyPipeline|live).*['"]/i);
    expect(source).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|submitOrder|executeTrade/);
    expect(source).not.toMatch(/requiredScore\s*=|GATE_SCORE_THRESHOLD|setRuntimeThresholdDelta|conditionWeight|kelly/i);
    expect(source).not.toMatch(/writeFile|appendFile|mkdir|rename|rmSync|createWriteStream/);
  });
});
