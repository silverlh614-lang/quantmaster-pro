import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildProgramTradingDataLineReportAdr0490,
  buildProgramTradingObservationRowAdr0490,
  collectOperatorActionSourcesFromProgramTradingAdr0490,
  formatProgramTradingCompactAdr0490,
  formatRuntimePipelineProgramTradingEvidenceLineAdr0490,
  getProgramTradingDetailRegistryEntryAdr0490,
  normalizeProgramTradingSampleAdr0490,
} from './programTradingDataLineAdr0490.js';
import { buildFreshDataSupplyReportAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import { buildInvestorFlowSampleAcquisitionProbeAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import { buildSupplyCoverageSnapshotAdr0484 } from './supplyCoverageRecoveryObservationAdr0484.js';
import { buildSupplyAdvisoryReadinessReportAdr0485 } from './supplyAdvisoryReadinessAdr0485.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';

const modulePath = path.resolve('server/trading/signalScanner/programTradingDataLineAdr0490.ts');
const src = () => fs.readFileSync(modulePath, 'utf-8');
const requiredScoreFiles = [
  path.resolve('server/trading/signalScanner/minimumSignalScoreTrace.ts'),
  path.resolve('server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts'),
];

function raw(overrides = {}) {
  return {
    code: '005930',
    market: 'KOSPI' as const,
    provider: 'KIS' as const,
    scope: 'STOCK' as const,
    sourceDate: '2026-05-08',
    collectedAt: '2026-05-09T00:00:00.000Z',
    rawProgramNetBuy: 1000,
    unit: 'KRW' as const,
    sourceAgeTradingDays: 0,
    ...overrides,
  };
}

function reportWith(overrides = {}) {
  return buildProgramTradingDataLineReportAdr0490({ generatedAt: '2026-05-09T00:00:00.000Z', rawInputs: [raw()], ...overrides });
}

describe('ADR-0490 KRX/KIS Program Trading Data Line', () => {
  it('1. Normalizes KRW programNetBuy sample.', () => { const s = normalizeProgramTradingSampleAdr0490(raw()); expect(s.programNetBuy).toBe(1000); expect(s.unit).toBe('KRW'); expect(s.status).toBe('NORMALIZED'); });
  it('2. Converts THOUSAND_KRW to KRW.', () => { expect(normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: 2, unit: 'THOUSAND_KRW' })).programNetBuy).toBe(2000); });
  it('3. Converts MILLION_KRW to KRW.', () => { expect(normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: 3, unit: 'MILLION_KRW' })).programNetBuy).toBe(3000000); });
  it('4. Preserves SHARES unit and does not mix with KRW.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: 10, unit: 'SHARES' })); expect(s.unit).toBe('SHARES'); expect(s.programNetBuy).toBe(10); });
  it('5. Derives programNetBuy from buy-sell amounts.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: null, rawProgramBuyAmount: '1,500', rawProgramSellAmount: '500' })); expect(s.programNetBuy).toBe(1000); expect(s.coverage.buySellAvailable).toBe(true); });
  it('6. Preserves arbitrage/non-arbitrage fields.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawArbitrageNetBuy: 7, rawNonArbitrageNetBuy: 8 })); expect(s.arbitrageNetBuy).toBe(7); expect(s.nonArbitrageNetBuy).toBe(8); });
  it('7. EMPTY sample returns EMPTY and UNKNOWN.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: null })); expect(s.status).toBe('EMPTY'); expect(s.signal).toBe('UNKNOWN'); });
  it('8. ACCEPTED_EMPTY is not bearish.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: null, providerStatus: 'ACCEPTED_EMPTY' })); expect(s.status).toBe('ACCEPTED_EMPTY'); expect(s.signal).toBe('UNKNOWN'); expect(s.quality.isMarketSignal).toBe(false); });
  it('9. NON_TRADING_DAY is not bearish.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ providerStatus: 'NON_TRADING_DAY' })); expect(s.status).toBe('NON_TRADING_DAY'); expect(s.signal).toBe('UNKNOWN'); });
  it('10. PROVIDER_ERROR is provider issue and not market signal.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ providerStatus: 'PROVIDER_ERROR' })); expect(s.quality.isProviderIssue).toBe(true); expect(s.quality.isMarketSignal).toBe(false); });
  it('11. PROVIDER_MISMATCH is not selected and not bearish.', () => { const r = reportWith({ rawInputs: [raw({ providerStatus: 'PROVIDER_MISMATCH' })] }); expect(r.selectedStockSample).toBeNull(); expect(r.samples[0]?.signal).toBe('UNKNOWN'); });
  it('12. PARSE_ERROR returns UNKNOWN.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: 'abc' })); expect(s.status).toBe('PARSE_ERROR'); expect(s.signal).toBe('UNKNOWN'); });
  it('13. Stale sample returns STALE and lowers confidence.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ sourceAgeTradingDays: 5 })); expect(s.status).toBe('STALE'); expect(s.confidence).toBe('LOW'); });
  it('14. Valid positive normalized sample can produce BULLISH only with HIGH/MEDIUM confidence.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: 1 })); expect(s.signal).toBe('BULLISH'); expect(['HIGH', 'MEDIUM']).toContain(s.confidence); });
  it('15. Valid negative normalized sample can produce BEARISH only with HIGH/MEDIUM confidence.', () => { const s = normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: -1 })); expect(s.signal).toBe('BEARISH'); expect(['HIGH', 'MEDIUM']).toContain(s.confidence); });
  it('16. Near-zero normalized sample returns NEUTRAL.', () => { expect(normalizeProgramTradingSampleAdr0490(raw({ rawProgramNetBuy: 0 })).signal).toBe('NEUTRAL'); });
  it('17. build report selects best stock sample.', () => { const r = reportWith({ rawInputs: [raw({ provider: 'CACHE', rawProgramNetBuy: 1 }), raw({ provider: 'KIS', rawProgramNetBuy: 2 })] }); expect(r.selectedStockSample?.provider).toBe('KIS'); });
  it('18. build report selects best market sample.', () => { const r = reportWith({ rawInputs: [raw({ provider: 'KRX', scope: 'MARKET', market: 'ALL', code: null })] }); expect(r.selectedMarketSample?.provider).toBe('KRX'); });
  it('19. build report handles CACHE fallback.', () => { const r = reportWith({ rawInputs: [raw({ provider: 'CACHE' })] }); expect(r.sampleAcquired).toBe(true); expect(r.selectedStockSample?.provider).toBe('CACHE'); });
  it('20. build report handles INTERNAL_REPLAY as OBSERVE/SHADOW_ONLY only.', () => { const r = reportWith({ stage: 'OBSERVE', rawInputs: [raw({ provider: 'INTERNAL_REPLAY' })] }); expect(r.policyPromotionMode).toBe('OBSERVE'); expect(r.executionImpact).toBe('NONE'); });
  it('21. sampleAcquired=false when all attempts fail.', () => { expect(reportWith({ rawInputs: [raw({ providerStatus: 'PROVIDER_ERROR' })] }).sampleAcquired).toBe(false); });
  it('22. sampleAcquired=true when stock or market sample is usable.', () => { expect(reportWith().sampleAcquired).toBe(true); });
  it('23. ADR-0487 includes ADR-0490 fresh data snapshots.', () => { const r = reportWith(); const f = buildFreshDataSupplyReportAdr0487({ programTradingDataLineAdr0490: r }); expect(f.snapshots.some((s) => s.sourceId === 'PROGRAM_TRADING_SAMPLE' && s.status === 'NORMALIZED')).toBe(true); });
  it('24. ADR-0489 can reference program sample without replacing semantic investor-flow sample.', () => { const p = buildInvestorFlowSampleAcquisitionProbeAdr0489({ selectedProvider: 'NONE', semanticSampleAvailable: false, relatedProgramSampleAvailable: true, relatedProgramSampleProvider: 'KIS' }); expect(p.relatedProgramSampleAvailable).toBe(true); expect(p.signal).toBe('UNKNOWN'); });
  it('25. ADR-0484 consumes program trading coverage metrics.', () => { const s = buildSupplyCoverageSnapshotAdr0484({ programTradingDataLineAdr0490: reportWith() }); expect(s.programTrading?.sampleAvailableCount).toBe(1); });
  it('26. ADR-0485 treats program sample as supporting evidence only.', () => { const e = buildSupplyAdvisoryReadinessReportAdr0485({ snapshotsAdr0484: [buildSupplyCoverageSnapshotAdr0484({ programTradingDataLineAdr0490: reportWith() })], gate1DryRunObservationRowsAdr0476: [] }); expect(e.status).not.toBe('READY'); expect(e.proposedPromotionMode).toBe('NONE'); });
  it('27. ADR-0480 creates/downgrades program trading operator actions.', () => { const q = buildOperatorActionQueueAdr0480({ programTradingDataLineAdr0490: reportWith({ rawInputs: [] }) }); expect(q.allActions.some((a) => a.rootCause === 'PROGRAM_TRADING_SAMPLE_ACQUISITION_NEEDED')).toBe(true); expect(buildOperatorActionQueueAdr0480({ programTradingDataLineAdr0490: reportWith() }).allActions.every((a) => a.rootCause !== 'PROGRAM_TRADING_SAMPLE_ACQUISITION_NEEDED')).toBe(true); });
  it('28. ADR-0476 records sanitized ADR-0490 observation row.', () => { const row = buildProgramTradingObservationRowAdr0490(reportWith()); expect(row.observationType).toBe('PROGRAM_TRADING_DATA_LINE_ADR0490'); expect(JSON.stringify(row)).not.toContain('rawProgram'); });
  it('29. ADR-0478 compact output includes ADR-0490 line.', () => { expect(formatProgramTradingCompactAdr0490(reportWith())).toContain('ADR-0490 ProgramTrading'); });
  it('30. ADR-0479 detail registry exposes ADR-0490 trace.', () => { expect(getProgramTradingDetailRegistryEntryAdr0490(reportWith()).adrTraceHint).toBe('/adr_trace 0490'); });
  it('31. Runtime Pipeline Audit includes ADR-0490 evidence.', () => { expect(formatRuntimePipelineProgramTradingEvidenceLineAdr0490(reportWith())).toContain('ADR-0490 status=NORMALIZED'); });
  it('32. No raw provider payload is persisted.', () => { expect(JSON.stringify(reportWith({ rawInputs: [raw({ rawPayload: { secret: true } } as any)] }))).not.toContain('secret'); });
  it('33. No KIS order modules are imported.', () => { expect(src().split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/kis.*order|order.*kis|sendOrder|buyOrder|sellOrder/i); });
  it('34. No live execution modules are imported.', () => { expect(src().split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor|createLiveOrder|promoteToLive/); });
  it('35. requiredScore remains 70.', () => { expect(requiredScoreFiles.map((f) => fs.readFileSync(f, 'utf-8')).join('\n')).toContain('70'); });
  it('36. Gate thresholds, weights, Kelly remain unchanged.', () => { expect(src()).not.toMatch(/setGateThreshold|GATE_RELAX|kellyMultiplier\s*=|finalKellyMultiplier\s*=/); });
  it('37. UNKNOWN is never converted to bullish.', () => { expect(normalizeProgramTradingSampleAdr0490(raw({ unit: 'UNKNOWN' })).signal).toBe('UNKNOWN'); });
  it('38. Provider issue is never converted to bearish.', () => { expect(normalizeProgramTradingSampleAdr0490(raw({ providerStatus: 'PROVIDER_ERROR', rawProgramNetBuy: -999 })).signal).toBe('UNKNOWN'); });
  it('39. executionImpact is always NONE.', () => { const r = reportWith(); expect(r.executionImpact).toBe('NONE'); expect(r.samples.every((s) => s.executionImpact === 'NONE')).toBe(true); });
  it('40. liveExecutionAllowed is always false.', () => { const r = reportWith(); expect(r.liveExecutionAllowed).toBe(false); expect(r.samples.every((s) => s.liveExecutionAllowed === false)).toBe(true); });
  it('41. policyPromotionMode is OBSERVE or SHADOW_ONLY only.', () => { const r = reportWith({ stage: 'OBSERVE' }); expect(['OBSERVE', 'SHADOW_ONLY']).toContain(r.policyPromotionMode); expect(r.samples.every((s) => ['OBSERVE', 'SHADOW_ONLY'].includes(s.policyPromotionMode))).toBe(true); });
  it('42. operatorApprovalRequired is always true.', () => { const r = reportWith(); expect(r.operatorApprovalRequired).toBe(true); expect(r.samples.every((s) => s.operatorApprovalRequired === true)).toBe(true); });
  it('43. Provider/probe failure is try/catch isolated.', () => { const r = buildProgramTradingDataLineReportAdr0490({ throwForTest: true }); expect(r.overallStatus).toBe('PROVIDER_ERROR'); expect(r.executionImpact).toBe('NONE'); });
  it('ADR-0476 aggregate builder includes ADR-0490 row.', () => { expect(buildGate1DryRunObservationRows({ forDate: '2026-05-09', programTradingDataLineAdr0490: reportWith() }).some((row) => row.source === 'ADR_0490_PROGRAM_TRADING_DATA_LINE')).toBe(true); });
  it('ADR-0480 source collector exposes ADR-0490 sources.', () => { expect(collectOperatorActionSourcesFromProgramTradingAdr0490(reportWith({ rawInputs: [] }))[0]?.adr).toBe('0490'); });
});
