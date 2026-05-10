import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildFreshDataStatusSectionAdr0498,
  buildFreshDataStatusViewModelFromInputAdr0498,
  formatFreshDataStatusLineAdr0498,
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
