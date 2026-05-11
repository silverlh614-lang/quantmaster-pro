import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildFreshDataStatusSectionAdr0498,
  buildFreshDataStatusViewModelFromInputAdr0498,
  formatFreshDataStatusLineAdr0498,
  mapFreshDataSupplyReportToStatusInputsAdr0498,
  mapInvestorFlowRouterToStatusInputAdr0498,
  mapRuntimeFreshDataSummaryToStatusInputsAdr0498,
  mapStatusFromCoverageAdr0498,
  safeBuildFreshDataStatusSectionAdr0498,
} from './freshDataStatusViewModelWiringAdr0498.js';

describe('ADR-0498 FreshDataStatusViewModel wiring', () => {
  it('builds tolerant ADR-0497 view models with diagnostic-only execution impact', () => {
    const minimal = buildFreshDataStatusViewModelFromInputAdr0498({ sourceAdr: 'UNKNOWN', dataLineId: 'minimal' });
    expect(minimal).toMatchObject({
      dataLineId: 'minimal',
      domain: 'UNKNOWN',
      providerHealth: 'UNKNOWN',
      dataConfidence: 'UNKNOWN',
      marketSignal: 'UNKNOWN',
      dataLineStatus: 'OBSERVING',
      executionImpact: 'NONE',
    });

    const providerEmpty = buildFreshDataStatusViewModelFromInputAdr0498({
      sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
      dataLineId: 'NAVER',
      domain: 'INVESTOR_FLOW',
      providerHealth: 'EMPTY',
      marketSignal: 'BULLISH',
    });
    expect(providerEmpty.marketSignal).toBe('UNKNOWN');
    expect(providerEmpty.warnings).toContain('provider issue is diagnostic evidence, not a market signal');

    const providerUp = buildFreshDataStatusViewModelFromInputAdr0498({
      sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
      dataLineId: 'NAVER',
      domain: 'INVESTOR_FLOW',
      providerHealth: 'UP',
      marketSignal: 'BULLISH',
    });
    expect(providerUp.marketSignal).toBe('BULLISH');
  });

  it('maps coverage to display-only confidence and data line status', () => {
    expect(mapStatusFromCoverageAdr0498({ coveragePct: 90 })).toMatchObject({ dataConfidence: 'VERIFIED', dataLineStatus: 'READY_FOR_SHADOW' });
    expect(mapStatusFromCoverageAdr0498({ coveragePct: 50 })).toMatchObject({ dataConfidence: 'PARTIAL', dataLineStatus: 'PARTIAL' });
    expect(mapStatusFromCoverageAdr0498({ coveragePct: 10 })).toMatchObject({ dataConfidence: 'PARTIAL', dataLineStatus: 'OBSERVING' });
    const missing = mapStatusFromCoverageAdr0498({ coveragePct: 0 });
    expect(missing).toMatchObject({ dataConfidence: 'MISSING', dataLineStatus: 'OBSERVING' });
    expect(missing.blockers).toContain('DATA_MISSING');
    expect(mapStatusFromCoverageAdr0498({ coveragePct: undefined })).toMatchObject({ dataConfidence: 'UNKNOWN', dataLineStatus: 'OBSERVING' });
    const stale = mapStatusFromCoverageAdr0498({ providerHealth: 'STALE', coveragePct: 90 });
    expect(stale).toMatchObject({ dataConfidence: 'STALE', dataLineStatus: 'OBSERVING' });
    expect(JSON.stringify(stale)).not.toContain('BEARISH');
    const zeroSample = mapStatusFromCoverageAdr0498({ coveragePct: 0, sampleCount: 0 });
    expect(JSON.stringify(zeroSample)).not.toContain('BEARISH');
    expect(zeroSample.warnings.join(' ')).toContain('not bearish');
  });

  it('formats compact Telegram-safe lines without raw evidence payload fields', () => {
    const vm = buildFreshDataStatusViewModelFromInputAdr0498({
      sourceAdr: 'ADR_0489_INVESTOR_FLOW_SAMPLE',
      dataLineId: 'NAVER',
      domain: 'INVESTOR_FLOW',
      providerHealth: 'UP',
      dataConfidence: 'VERIFIED',
      marketSignal: 'BULLISH',
      dataLineStatus: 'READY_FOR_SHADOW',
      promotionReadiness: 'READY',
      evidence: { rawPayload: 'SECRET_RAW_PROVIDER_PAYLOAD' },
    });
    const line = formatFreshDataStatusLineAdr0498(vm);
    expect(line).toContain('[ADR-0498]');
    expect(line).toContain('NAVER');
    expect(line).toContain('provider=UP');
    expect(line).toContain('confidence=VERIFIED');
    expect(line).toContain('signal=BULLISH');
    expect(line).toContain('status=READY_FOR_SHADOW');
    expect(line).toContain('impact=NONE');
    expect(line).not.toContain('SECRET_RAW_PROVIDER_PAYLOAD');
    expect(line).not.toContain('rawPayload');
    expect(line.length).toBeLessThanOrEqual(280);
  });

  it('builds truncating sections without throwing on partial input lists', () => {
    const section = buildFreshDataStatusSectionAdr0498([
      { sourceAdr: 'UNKNOWN', dataLineId: 'one' },
      { sourceAdr: 'UNKNOWN', dataLineId: 'two', providerHealth: 'UP' },
      { sourceAdr: 'UNKNOWN', dataLineId: '' },
    ], { maxLines: 2 });
    expect(section.executionImpact).toBe('NONE');
    expect(section.viewModels).toHaveLength(3);
    expect(section.lines).toHaveLength(3);
    expect(section.truncated).toBe(true);
    expect(section.lines.at(-1)).toContain('truncated=1 more');
  });

  it('safe wrapper catches malformed top-level input and returns formatter_error', () => {
    const section = safeBuildFreshDataStatusSectionAdr0498(null as unknown as Parameters<typeof safeBuildFreshDataStatusSectionAdr0498>[0]);
    expect(section.executionImpact).toBe('NONE');
    expect(section.lines.join('\n')).toContain('formatter_error');
    expect(section.lines.join('\n')).toContain('impact=NONE');
  });



  it('aligns InvestorFlow selectedProvider=CACHE with FreshDataStatus instead of provider=EMPTY', () => {
    const input = mapInvestorFlowRouterToStatusInputAdr0498({
      selectedProvider: 'CACHE',
      status: 'STALE',
      signal: 'UNKNOWN',
      selectedReason: 'ADR-0491 sanitized snapshot cache selected: CACHE_STALE_HIT',
      providerStatuses: { CACHE: 'CACHE_STALE_HIT' },
      coverage: { available: 1, total: 7 },
      rawPayloadPersistenceAllowed: false,
      liveExecutionAllowed: false,
      executionImpact: 'NONE',
    });
    expect(input).toMatchObject({
      providerDisplay: 'CACHE',
      dataConfidence: 'STALE',
      dataLineStatus: 'OBSERVING',
      marketSignal: 'UNKNOWN',
      promotionReadiness: 'NOT_EVALUATED',
    });
    const section = safeBuildFreshDataStatusSectionAdr0498([input!]);
    expect(section.lines.join('\n')).toContain('provider=CACHE');
    expect(section.lines.join('\n')).not.toContain('provider=EMPTY');
    expect(section.lines.join('\n')).toContain('status=OBSERVING');
    expect(section.lines.join('\n')).toContain('confidence=STALE');
    expect(section.lines.join('\n')).toContain('impact=NONE');
  });

  it('keeps multi-source selected providers visible instead of provider=EMPTY', () => {
    for (const [selectedProvider, providerDisplay] of [
      ['KIS_API', 'KIS'],
      ['KRX_INVESTOR_FLOW', 'KRX'],
      ['FSS_PASSIVE_ACTIVE', 'FSS'],
      ['CACHE', 'CACHE'],
    ] as const) {
      const input = mapInvestorFlowRouterToStatusInputAdr0498({
        selectedProvider,
        status: selectedProvider === 'CACHE' ? 'CACHE_HIT' : 'STALE',
        signal: 'UNKNOWN',
        providerStatuses: { [selectedProvider]: selectedProvider === 'CACHE' ? 'CACHE_HIT' : 'STALE' },
        coverage: { available: 1, total: 8 },
        rawPayloadPersistenceAllowed: false,
        liveExecutionAllowed: false,
        executionImpact: 'NONE',
      });
      const line = safeBuildFreshDataStatusSectionAdr0498([input!]).lines.join('\n');
      expect(line).toContain(`provider=${providerDisplay}`);
      expect(line).not.toContain('provider=EMPTY');
      expect(line).not.toContain('confidence=MISSING');
    }
  });

  it('annotates KRX investor-flow as source of truth with secondary NAVER and derived semantic roles', () => {
    const input = mapInvestorFlowRouterToStatusInputAdr0498({
      selectedProvider: 'KRX_INVESTOR_FLOW',
      status: 'VERIFIED',
      signal: 'BULLISH',
      selectedReason: 'KRX previousTradingDate materialized investor-flow row',
      providerStatuses: { KRX_INVESTOR_FLOW: 'VERIFIED', NAVER_INVESTOR_TREND: 'EMPTY' },
      coverage: { available: 2, total: 8 },
      rawPayloadPersistenceAllowed: false,
      liveExecutionAllowed: false,
      executionImpact: 'NONE',
    });
    expect(input).toMatchObject({ providerDisplay: 'KRX', dataConfidence: 'VERIFIED' });
    expect(input?.warnings?.join(' ')).toContain('sourceOfTruth=KRX');
    expect(input?.warnings?.join(' ')).toContain('NAVER role=SECONDARY');
    expect(input?.warnings?.join(' ')).toContain('SEMANTIC role=DERIVED');
    const section = safeBuildFreshDataStatusSectionAdr0498([input!]);
    expect(section.lines.join('\n')).toContain('INVESTOR_FLOW/investorFlow provider=KRX confidence=VERIFIED');
    expect(section.lines.join('\n')).not.toContain('provider=EMPTY');
  });

  it('keeps selectedProvider=NONE as provider=EMPTY/BLOCKED', () => {
    const input = mapInvestorFlowRouterToStatusInputAdr0498({ selectedProvider: 'NONE', status: 'DATA_UNAVAILABLE', signal: 'UNKNOWN', providerStatuses: { CACHE: 'CACHE_EMPTY' } });
    const section = safeBuildFreshDataStatusSectionAdr0498([input!]);
    expect(section.lines.join('\n')).toContain('provider=EMPTY');
    expect(section.lines.join('\n')).toContain('confidence=MISSING');
    expect(section.lines.join('\n')).toContain('status=BLOCKED');
    expect(section.lines.join('\n')).not.toContain('signal=BEARISH');
  });

  it('keeps registry-ready FreshData placeholders OBSERVING until a router-usable sample is materialized', () => {
    const [placeholder] = mapFreshDataSupplyReportToStatusInputsAdr0498({
      snapshots: [{
        sourceId: 'NAVER_INVESTOR_TREND',
        domain: 'SUPPLY',
        provider: 'NAVER',
        status: 'READY_FOR_SHADOW',
        confidence: 'HIGH',
        coverageRatio: 1,
        isProviderIssue: false,
        sampleMaterialized: false,
        usableForRouter: false,
        usableForShadow: false,
        usableForLive: false,
        readinessKind: 'REGISTRY_READY',
        sourceOfTruth: 'REGISTRY',
      }],
    });
    const [materialized] = mapFreshDataSupplyReportToStatusInputsAdr0498({
      snapshots: [{
        sourceId: 'NAVER_INVESTOR_TREND',
        domain: 'SUPPLY',
        provider: 'NAVER',
        status: 'READY_FOR_SHADOW',
        confidence: 'HIGH',
        coverageRatio: 1,
        isProviderIssue: false,
        sampleMaterialized: true,
        usableForRouter: true,
        usableForShadow: true,
        usableForLive: false,
        readinessKind: 'MATERIALIZED_SAMPLE',
        sourceOfTruth: 'ROUTER_INPUT',
      }],
    });

    expect(placeholder).toMatchObject({ dataLineStatus: 'OBSERVING', dataConfidence: 'MISSING' });
    expect(placeholder?.warnings?.join(' ')).toContain('sampleMaterialized=false');
    expect(materialized).toMatchObject({ dataLineStatus: 'READY_FOR_SHADOW', dataConfidence: 'VERIFIED' });
    expect(materialized?.warnings?.join(' ')).toContain('readinessKind=MATERIALIZED_SAMPLE');
  });

  it('runtime summary prioritizes router selectedProvider over empty investorFlow samples', () => {
    const inputs = mapRuntimeFreshDataSummaryToStatusInputsAdr0498({
      investorFlowProviderRouter: { selectedProvider: 'CACHE', status: 'STALE', signal: 'UNKNOWN', providerStatuses: { CACHE: 'CACHE_STALE_HIT' }, coverage: { available: 1, total: 7 }, liveExecutionAllowed: false, executionImpact: 'NONE' },
      investorFlowSampleAdr0489: { status: 'DATA_UNAVAILABLE', adr0496SupplyCoverage: { coverageAfter: 0, sampleCount: 0 } },
    });
    expect(inputs[0]).toMatchObject({ dataLineId: 'investorFlow', providerDisplay: 'CACHE' });
    const section = safeBuildFreshDataStatusSectionAdr0498(inputs, { maxLines: 1 });
    expect(section.lines[0]).toContain('provider=CACHE');
    expect(section.lines[0]).not.toContain('provider=EMPTY');
  });

  it('contains no forbidden live order, Gate/Kelly mutation, persistence, or provider fetch patterns', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/freshDataStatusViewModelWiringAdr0498.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*(?:kis|orderExecutor|autoTradeEngine|trancheExecutor|buyPipeline|live).*['"]/i);
    expect(source).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|submitOrder|executeTrade/);
    expect(source).not.toMatch(/requiredScore\s*=|GATE_SCORE_THRESHOLD|setRuntimeThresholdDelta|conditionWeight|kelly/i);
    expect(source).not.toMatch(/writeFile|appendFile|mkdir|rename|rmSync|createWriteStream/);
    expect(source).not.toMatch(/\bfetch\b|axios|node-fetch/);
  });

  it('wires command and runtime surfaces to ADR-0498 helpers', () => {
    const freshCommand = fs.readFileSync(path.resolve(process.cwd(), 'server/telegram/commands/system/freshDataStatus.cmd.ts'), 'utf-8');
    const blockersCommand = fs.readFileSync(path.resolve(process.cwd(), 'server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    const runtimeAudit = fs.readFileSync(path.resolve(process.cwd(), 'server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');
    expect(freshCommand).toContain('ADR-0498 Normalized FreshDataStatus');
    expect(freshCommand).toContain('safeBuildFreshDataStatusSectionAdr0498');
    expect(blockersCommand).toContain('safeBuildFreshDataStatusSectionAdr0498');
    expect(runtimeAudit).toContain('freshDataStatusViewModels?: FreshDataStatusViewModelAdr0497[]');
    expect(runtimeAudit).toContain('freshDataStatusCompactLines?: string[]');
    expect(runtimeAudit).toContain('freshDataStatusNormalizedCount?: number');
  });
});
