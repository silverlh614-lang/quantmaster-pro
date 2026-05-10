import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildProviderMarketMigrationEvidenceAdr0499,
  buildProviderMarketMigrationSectionAdr0499,
  classifyDataAvailabilityAdr0499,
  classifyProviderMarketSignalAdr0499,
  formatProviderMarketMigrationEvidenceAdr0499,
  normalizeMarketSignalDirectionAdr0499,
  normalizeProviderHealthStatusAdr0499,
} from './providerMarketSignalMigrationAdr0499.js';

describe('ADR-0499 ProviderHealth vs MarketSignal classifier migration', () => {
  it('normalizes provider health statuses case-insensitively without converting unknowns', () => {
    expect(normalizeProviderHealthStatusAdr0499('OK')).toBe('UP');
    expect(normalizeProviderHealthStatusAdr0499('provider_error')).toBe('DOWN');
    expect(normalizeProviderHealthStatusAdr0499('HTTP_ERROR')).toBe('DOWN');
    expect(normalizeProviderHealthStatusAdr0499('timeout')).toBe('DELAYED');
    expect(normalizeProviderHealthStatusAdr0499('429')).toBe('RATE_LIMITED');
    expect(normalizeProviderHealthStatusAdr0499('no_data')).toBe('EMPTY');
    expect(normalizeProviderHealthStatusAdr0499('cache_stale')).toBe('STALE');
    expect(normalizeProviderHealthStatusAdr0499('invalid_schema')).toBe('PARSE_ERROR');
    expect(normalizeProviderHealthStatusAdr0499('not_a_known_status')).toBe('UNKNOWN');
    expect(normalizeProviderHealthStatusAdr0499(null)).toBe('UNKNOWN');
    expect(normalizeProviderHealthStatusAdr0499(undefined)).toBe('UNKNOWN');
    expect(normalizeProviderHealthStatusAdr0499('  rate limited  ')).toBe('RATE_LIMITED');
    expect(normalizeProviderHealthStatusAdr0499('cache-stale')).toBe('STALE');
  });

  it('normalizes requested market signals but does not decide validity', () => {
    expect(normalizeMarketSignalDirectionAdr0499(1)).toBe('BULLISH');
    expect(normalizeMarketSignalDirectionAdr0499(-1)).toBe('BEARISH');
    expect(normalizeMarketSignalDirectionAdr0499(0)).toBe('NEUTRAL');
    expect(normalizeMarketSignalDirectionAdr0499('NET_BUY')).toBe('BULLISH');
    expect(normalizeMarketSignalDirectionAdr0499('NET_SELL')).toBe('BEARISH');
    expect(normalizeMarketSignalDirectionAdr0499('ZERO')).toBe('NEUTRAL');
    expect(normalizeMarketSignalDirectionAdr0499('MIXED')).toBe('MIXED');
    expect(normalizeMarketSignalDirectionAdr0499('unknownish')).toBe('UNKNOWN');
    expect(normalizeMarketSignalDirectionAdr0499(null)).toBe('UNKNOWN');
  });

  it('uses ADR-0497 as final authority and invalidates signals on provider issues', () => {
    expect(classifyProviderMarketSignalAdr0499({ providerHealthRaw: 'UP', marketSignalRaw: 'NET_BUY' })).toMatchObject({
      providerHealth: 'UP', marketSignal: 'BULLISH', isMarketSignalValid: true, providerIssue: false,
    });
    expect(classifyProviderMarketSignalAdr0499({ providerHealthRaw: 'UP', marketSignalRaw: 'NET_SELL' })).toMatchObject({
      providerHealth: 'UP', marketSignal: 'BEARISH', isMarketSignalValid: true, providerIssue: false,
    });
    expect(classifyProviderMarketSignalAdr0499({ providerHealthRaw: 'EMPTY', marketSignalRaw: 'NET_SELL' })).toMatchObject({
      providerHealth: 'EMPTY', marketSignal: 'UNKNOWN', isMarketSignalValid: false, providerIssue: true,
    });
    expect(classifyProviderMarketSignalAdr0499({ providerHealthRaw: 'DOWN', marketSignalRaw: 'NET_BUY' })).toMatchObject({
      providerHealth: 'DOWN', marketSignal: 'UNKNOWN', isMarketSignalValid: false, providerIssue: true,
    });
    expect(classifyProviderMarketSignalAdr0499({ providerHealthRaw: 'STALE', marketSignalRaw: 'BEARISH' })).toMatchObject({
      providerHealth: 'STALE', marketSignal: 'UNKNOWN', isMarketSignalValid: false, providerIssue: true,
    });
    expect(classifyProviderMarketSignalAdr0499({ providerHealthRaw: 'PARSE_ERROR', marketSignalRaw: 'BULLISH' })).toMatchObject({
      providerHealth: 'PARSE_ERROR', marketSignal: 'UNKNOWN', isMarketSignalValid: false, providerIssue: true,
    });
  });

  it('classifies data availability without turning missing/stale/provider errors bearish', () => {
    expect(classifyDataAvailabilityAdr0499({ sampleCount: 0, requestedSignal: 'NET_SELL' })).toMatchObject({ providerHealth: 'EMPTY', marketSignal: 'UNKNOWN', isMarketSignalValid: false });
    expect(classifyDataAvailabilityAdr0499({ hasRows: false, requestedSignal: 'NET_BUY' })).toMatchObject({ providerHealth: 'EMPTY', marketSignal: 'UNKNOWN', isMarketSignalValid: false });
    expect(classifyDataAvailabilityAdr0499({ stale: true, requestedSignal: 'BEARISH' })).toMatchObject({ providerHealth: 'STALE', marketSignal: 'UNKNOWN', isMarketSignalValid: false });
    expect(classifyDataAvailabilityAdr0499({ providerError: true, requestedSignal: 'BEARISH' })).toMatchObject({ providerHealth: 'DOWN', marketSignal: 'UNKNOWN', isMarketSignalValid: false });
    expect(classifyDataAvailabilityAdr0499({ sampleCount: 5, requestedSignal: 'NET_BUY' })).toMatchObject({ providerHealth: 'UP', marketSignal: 'BULLISH', isMarketSignalValid: true });
    expect(classifyDataAvailabilityAdr0499({ sampleCount: 5, requestedSignal: 'NET_SELL' })).toMatchObject({ providerHealth: 'UP', marketSignal: 'BEARISH', isMarketSignalValid: true });
  });

  it('builds compact evidence with executionImpact NONE and no raw payloads', () => {
    const evidence = buildProviderMarketMigrationEvidenceAdr0499({
      sourceAdr: 'INVESTOR_FLOW',
      dataLineId: 'NAVER',
      providerHealthRaw: 'EMPTY',
      marketSignalRaw: 'BULLISH',
      reason: 'empty response',
    });
    expect(evidence.executionImpact).toBe('NONE');
    expect(evidence.finalMarketSignal).toBe('UNKNOWN');
    expect(evidence.providerIssue).toBe(true);
    expect(evidence.warnings).toContain('provider issue invalidated requested market signal');
    const line = formatProviderMarketMigrationEvidenceAdr0499(evidence);
    expect(line).toContain('[ADR-0499]');
    expect(line).toContain('provider=EMPTY');
    expect(line).toContain('requested=BULLISH');
    expect(line).toContain('final=UNKNOWN');
    expect(line).toContain('impact=NONE');
    expect(line).not.toContain('rawPayload');
    expect(line).not.toContain('SECRET');
    expect(line.length).toBeLessThanOrEqual(280);
  });

  it('builds truncating sections with compact ADR-0499 marker lines', () => {
    const evidences = ['one', 'two', 'three'].map((dataLineId) => buildProviderMarketMigrationEvidenceAdr0499({
      sourceAdr: 'ADR_0499_TEST',
      dataLineId,
      providerHealthRaw: 'UP',
      marketSignalRaw: 'NET_BUY',
    }));
    const section = buildProviderMarketMigrationSectionAdr0499(evidences, { maxLines: 2 });
    expect(section.executionImpact).toBe('NONE');
    expect(section.truncated).toBe(true);
    expect(section.lines).toHaveLength(3);
    expect(section.lines[0]).toContain('[ADR-0499]');
    expect(section.lines.at(-1)).toContain('[ADR-0499] ProviderMarket truncated=1 more');
  });

  it('statically preserves diagnostic-only guardrails and conservative ADR-0498 wiring', () => {
    const moduleSource = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/providerMarketSignalMigrationAdr0499.ts'), 'utf-8');
    const adr0498Source = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/freshDataStatusViewModelWiringAdr0498.ts'), 'utf-8');
    expect(adr0498Source).toContain('classifyProviderMarketSignalAdr0499');
    expect(moduleSource).not.toMatch(/from ['"].*(?:kis|orderExecutor|autoTradeEngine|trancheExecutor|buyPipeline|live).*['"]/i);
    expect(moduleSource).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|submitOrder|executeTrade/);
    expect(moduleSource).not.toMatch(/requiredScore\s*=|GATE_SCORE_THRESHOLD|setRuntimeThresholdDelta|conditionWeight|kelly/i);
    expect(moduleSource).not.toMatch(/writeFile|appendFile|mkdir|rename|rmSync|createWriteStream/);
    expect(moduleSource).not.toMatch(/\bfetch\b|axios|node-fetch/);
  });
});
