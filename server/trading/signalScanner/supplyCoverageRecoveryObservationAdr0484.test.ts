import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSupplyCoverageRecoveryObservationReportAdr0484,
  buildSupplyCoverageRecoveryObservationRowAdr0484,
  buildSupplyCoverageSnapshotAdr0484,
  formatSupplyCoverageRecoveryCompactAdr0484,
  getSupplyCoverageRecoveryDetailRegistryEntryAdr0484,
  saveSupplyCoverageRecoverySnapshotAdr0484,
  type SupplyCoverageSnapshotAdr0484,
} from './supplyCoverageRecoveryObservationAdr0484.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import { summarizeGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';

const moduleSrc = () => readFileSync(new URL('./supplyCoverageRecoveryObservationAdr0484.ts', import.meta.url), 'utf8');
const scanBlockersSrc = () => readFileSync(new URL('../../telegram/commands/system/scanBlockers.cmd.ts', import.meta.url), 'utf8');

function router(overrides = {}) {
  return {
    code: '005930', route: 'investor_flow', selectedProvider: 'NAVER', providerTried: ['NAVER'],
    providerStatuses: { NAVER: 'VERIFIED' }, semanticNetBuy: null, status: 'VERIFIED', signal: 'BULLISH',
    coverage: { available: 3, total: 5, missing: 2, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 0 },
    freshness: { cacheState: 'FRESH', sourceState: 'FRESH', sourceAgeTradingDays: 1, oldestSourceAgeTradingDays: 1, lastSourceDate: '2026-05-08' },
    executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: [],
    ...overrides,
  } as any;
}
function semantic(overrides = {}) { return { generatedAt: '2026-05-09T00:00:00.000Z', code: '005930', samples: [{ code: '005930', provider: 'NAVER', sourceDate: '2026-05-08', collectedAt: '2026-05-09T00:00:00.000Z', foreignNetBuy: 1, institutionNetBuy: 1, programNetBuy: 0, individualNetBuy: null, totalSmartMoneyNetBuy: 2, unit: 'KRW', status: 'VERIFIED', signal: 'BULLISH', confidence: 'HIGH', freshness: { sourceState: 'FRESH', sourceAgeTradingDays: 1, lastSourceDate: '2026-05-08' }, coverage: { foreignAvailable: true, institutionAvailable: true, programAvailable: true, individualAvailable: false, availableFields: 3, totalFields: 4 }, quality: { parseOk: true, unitNormalized: true, hasMinimumFields: true, isProviderIssue: false, isMarketSignal: true }, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: [] }], selectedSample: null, providerRanking: ['NAVER'], status: 'VERIFIED', signal: 'BULLISH', confidence: 'HIGH', executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: [], ...overrides } as any; }
function freshness(overrides = {}) { return { status: 'FRESH', rows: [{ source: 'NAVER', cacheState: 'FRESH', sourceState: 'FRESH', cacheAgeMinutes: 10, sourceAgeTradingDays: 1, sourceDate: '2026-05-08', refreshStatus: 'NOT_NEEDED', providerIssue: false }], affectedSources: [], oldestSourceAgeTradingDays: 1, refreshStatus: 'NOT_NEEDED', diagnostics: [], executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, ...overrides } as any; }
function snapshot(overrides: Partial<SupplyCoverageSnapshotAdr0484> = {}): SupplyCoverageSnapshotAdr0484 { return buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router(), semanticNetBuyNormalizationAdr0482: semantic({ selectedSample: semantic().samples[0] }), supplySourceFreshnessAdr0483: freshness(), ...overrides as any }); }

describe('ADR-0484 Supply Coverage Recovery Observation', () => {
  it('1. Builds current snapshot from ADR-0477/0481/0482/0483 inputs', () => {
    const s = snapshot();
    expect(s.investorFlow.selectedProvider).toBe('NAVER'); expect(s.providerHealth.naverDataAvailableCount).toBe(1); expect(s.semanticNetBuy.sampleAvailableCount).toBe(1); expect(s.freshness.freshSourceCount).toBe(1);
  });
  it('2. Missing inputs produce UNKNOWN/null safely, not throw', () => { expect(() => buildSupplyCoverageSnapshotAdr0484({})).not.toThrow(); expect(buildSupplyCoverageSnapshotAdr0484({}).investorFlow.selectedProvider).toBeNull(); });
  it('3. Calculates coverageRatio correctly', () => { expect(snapshot().investorFlow.coverageRatio).toBe(0.6); });
  it('4. Calculates selectedProviderNoneCount', () => { expect(buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ selectedProvider: 'NONE' }) }).investorFlow.selectedProviderNoneCount).toBe(1); });
  it('5. Calculates DATA_UNAVAILABLE count', () => { expect(buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ status: 'DATA_UNAVAILABLE' }) }).investorFlow.dataUnavailableCount).toBe(1); });
  it('6. Calculates NAVER NOT_WIRED count', () => { expect(buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ providerStatuses: { NAVER: 'NOT_WIRED' }, coverage: { available: 0, total: 5, missing: 5, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 1 } }) }).providerHealth.naverNotWiredCount).toBe(1); });
  it('7. Calculates semantic sample availability', () => { expect(snapshot().semanticNetBuy.sampleAvailableCount).toBe(1); });
  it('8. Calculates stale source count and oldestSourceAgeTradingDays', () => { const s = buildSupplyCoverageSnapshotAdr0484({ supplySourceFreshnessAdr0483: freshness({ oldestSourceAgeTradingDays: 5, rows: [{ source: 'FSS', cacheState: 'FRESH', sourceState: 'STALE', cacheAgeMinutes: 1, sourceAgeTradingDays: 5, sourceDate: '2026-05-01', refreshStatus: 'RECOMMENDED', providerIssue: false }] }) }); expect(s.freshness.staleSourceCount).toBe(1); expect(s.freshness.oldestSourceAgeTradingDays).toBe(5); });
  it('9. Calculates operator P1/P2 counts', () => { const q = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0477', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }, { adr: '0483', diagnosticKey: 'SUPPLY_SOURCE_REFRESH_RECOMMENDED', diagnosticValue: 'REFRESH_RECOMMENDED', severity: 'DEGRADED' }] }); const s = buildSupplyCoverageSnapshotAdr0484({ operatorActionQueueAdr0480: q }); expect(s.operatorActions.p1Count).toBe(1); expect(s.operatorActions.p2Count).toBe(1); });
  it('10. Calculates Gate1 near-miss and observation row counts', () => { const s = buildSupplyCoverageSnapshotAdr0484({ scanSummary: { time: 't', candidates: 1, trackB: 0, swing: 0, catalyst: 0, momentum: 0, yahooFails: 0, gateMisses: 0, rrrMisses: 0, entries: 0, gateScoreCandidateBuckets: { counts: { DATA_BLOCKED_NEAR_MISS: 2 } as any, dataBlockedNearMissTopUnavailable: [], probingTopConditions: [], totalNearMissLike: 2 } }, gate1DryRunObservationLedgerAdr0476: summarizeGate1DryRunObservationRows([]) }); expect(s.gateDiagnostics.gate1NearMissCount).toBe(2); expect(s.gateDiagnostics.dryRunObservationRows).toBe(0); });
  it('11. Baseline=null returns INSUFFICIENT_DATA or OBSERVING', () => { expect(['INSUFFICIENT_DATA', 'OBSERVING']).toContain(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot(), priorSnapshots: [] }).status); });
  it('12-14. Positive coverage / reduced NOT_WIRED / reduced DATA_UNAVAILABLE contributes to IMPROVING', () => { const b = buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ selectedProvider: 'NONE', status: 'DATA_UNAVAILABLE', providerStatuses: { NAVER: 'NOT_WIRED' }, coverage: { available: 0, total: 5, missing: 5, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 1 } }) }); expect(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot(), baselineSnapshot: b }).status).toBe('IMPROVING'); });
  it('15-16. Increased stale source and selectedProvider=NONE contributes to DEGRADED', () => { const c = buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ selectedProvider: 'NONE', coverage: { available: 0, total: 5, missing: 5, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 0 } }), supplySourceFreshnessAdr0483: freshness({ rows: [{ source: 'FSS', cacheState: 'FRESH', sourceState: 'STALE', cacheAgeMinutes: 1, sourceAgeTradingDays: 5, sourceDate: '2026-05-01', refreshStatus: 'RECOMMENDED', providerIssue: false }] }) }); expect(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: c, baselineSnapshot: snapshot() }).status).toBe('DEGRADED'); });
  it('17. Stable metrics return STABLE', () => { const s = snapshot(); expect(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: s, baselineSnapshot: s }).status).toBe('STABLE'); });
  it('18. Report topImprovedMetrics are populated', () => { const b = buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ coverage: { available: 0, total: 5, missing: 5, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 1 } }) }); expect(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot(), baselineSnapshot: b }).topImprovedMetrics.length).toBeGreaterThan(0); });
  it('19. Report topRemainingBlockers are populated', () => { expect(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: buildSupplyCoverageSnapshotAdr0484({}) }).topRemainingBlockers).toContain('selectedProvider=NONE'); });
  it('20. ADR-0476 records sanitized ADR-0484 observation row', () => { const row = buildSupplyCoverageRecoveryObservationRowAdr0484(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot() })); expect(row?.observationType).toBe('SUPPLY_COVERAGE_RECOVERY_ADR0484'); expect(JSON.stringify(row)).not.toContain('raw'); });
  it('21. ADR-0480 downgrades related actions to OBSERVING only when status=IMPROVING and evidence supports it', () => { const q = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0477', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }], supplyCoverageRecoveryAdr0484: { status: 'IMPROVING', topRemainingBlockers: [] } }); expect(q.allActions[0].status).toBe('OBSERVING'); });
  it('22. ADR-0480 does not mark actions RESOLVED on first improving scan', () => { const q = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0477', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }], supplyCoverageRecoveryAdr0484: { status: 'IMPROVING', topRemainingBlockers: [] } }); expect(q.allActions[0].status).not.toBe('RESOLVED'); });
  it('23. ADR-0478 compact output includes ADR-0484 line', () => { expect(formatSupplyCoverageRecoveryCompactAdr0484(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot() }))).toContain('ADR-0484 SupplyRecovery'); expect(scanBlockersSrc()).toContain('formatSupplyCoverageRecoveryCompactAdr0484'); });
  it('24. ADR-0479 detail registry exposes ADR-0484 trace', () => { expect(getSupplyCoverageRecoveryDetailRegistryEntryAdr0484(buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot() })).adrTraceHint).toBe('/adr_trace 0484'); });
  it('25. No raw provider payload is persisted', () => { expect(moduleSrc()).not.toContain('rawProvider'); expect(saveSupplyCoverageRecoverySnapshotAdr0484).toBeTypeOf('function'); });
  it('26-27. No KIS order or live execution modules are imported', () => { const src = moduleSrc(); expect(src).not.toMatch(/orderExecutor|trancheExecutor|autoTradeEngine|kis.*Order/i); });
  it('28. requiredScore remains 70', () => { expect(moduleSrc()).toContain('requiredScore: 70'); });
  it('29. Gate thresholds, weights, Kelly remain unchanged', () => { expect(moduleSrc()).not.toMatch(/kelly|gateThreshold|thresholds|weights/i); });
  it('30. UNKNOWN is never converted to bullish', () => { expect(buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ signal: 'UNKNOWN' }) }).investorFlow.bullishSignalCount).toBe(0); });
  it('31. Provider issue is never converted to bearish', () => { expect(buildSupplyCoverageSnapshotAdr0484({ investorFlowProviderRouterAdr0477: router({ status: 'PROVIDER_ERROR', signal: 'UNKNOWN' }) }).investorFlow.bearishSignalCount).toBe(0); });
  it('32-35. Guardrails are literal', () => { const r = buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: snapshot() }); expect(r.executionImpact).toBe('NONE'); expect(r.liveExecutionAllowed).toBe(false); expect(r.policyPromotionMode).toBe('SHADOW_ONLY'); expect(r.operatorApprovalRequired).toBe(true); });
  it('36. Observation failure is try/catch isolated', () => { const r = buildSupplyCoverageRecoveryObservationReportAdr0484({ currentSnapshot: null, priorSnapshots: [{ bad: BigInt(1) } as any], persist: true, persistenceFile: '/root/nope/blocked.json' }); expect(['UNKNOWN', 'OBSERVING', 'INSUFFICIENT_DATA']).toContain(r.status); });
});
