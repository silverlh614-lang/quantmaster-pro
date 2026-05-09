import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOperatorActionQueueAdr0480, type OperatorActionSource } from './operatorActionRouterAdr0480.js';
import {
  buildSupplyAdvisoryReadinessObservationRowAdr0485,
  buildSupplyAdvisoryReadinessReportAdr0485,
  formatRuntimePipelineReadinessEvidenceLineAdr0485,
  formatSupplyAdvisoryReadinessCompactAdr0485,
  getSupplyAdvisoryReadinessDetailRegistryEntryAdr0485,
  type SupplyAdvisoryReadinessEvidenceAdr0485,
} from './supplyAdvisoryReadinessAdr0485.js';
import type { SupplyCoverageSnapshotAdr0484 } from './supplyCoverageRecoveryObservationAdr0484.js';

function snap(overrides: Partial<SupplyCoverageSnapshotAdr0484> = {}): SupplyCoverageSnapshotAdr0484 {
  const base: SupplyCoverageSnapshotAdr0484 = {
    scanId: 'scan',
    timestamp: '2026-05-09T00:00:00.000Z',
    universeCount: 10,
    candidateCount: 5,
    investorFlow: {
      selectedProvider: 'NAVER',
      selectedProviderNoneCount: 0,
      dataUnavailableCount: 0,
      unknownSignalCount: 1,
      bullishSignalCount: 0,
      bearishSignalCount: 0,
      neutralSignalCount: 1,
      coverageAvailable: 7,
      coverageTotal: 10,
      coverageRatio: 0.7,
    },
    providerHealth: { naverNotWiredCount: 0, naverDataAvailableCount: 1, naverDataUnavailableCount: 0, cacheEmptyCount: 0, kisProviderMismatchCount: 0, providerErrorCount: 0 },
    semanticNetBuy: { sampleAvailableCount: 1, selectedSampleCount: 1, missingSampleCount: 0, parseErrorCount: 0, unitIssueCount: 0 },
    freshness: { staleSourceCount: 0, freshSourceCount: 1, oldestSourceAgeTradingDays: 0, refreshRecommendedCount: 0 },
    operatorActions: { p0Count: 0, p1Count: 0, p2Count: 0, p3Count: 0, investorFlowProviderUnwiredOpen: false, semanticNetBuyMissingOpen: false, supplySourceRefreshRecommendedOpen: false },
    gateDiagnostics: { gate1NearMissCount: 0, dataBlockedNearMissCount: 0, positiveSourceCandidateCount: 0, dryRunObservationRows: 1 },
  };
  return { ...base, ...overrides, investorFlow: { ...base.investorFlow, ...(overrides.investorFlow ?? {}) }, semanticNetBuy: { ...base.semanticNetBuy, ...(overrides.semanticNetBuy ?? {}) }, freshness: { ...base.freshness, ...(overrides.freshness ?? {}) } };
}

function reportWith(evidence: Partial<SupplyAdvisoryReadinessEvidenceAdr0485>) {
  return buildSupplyAdvisoryReadinessReportAdr0485({ evidence: {
    window: 'LAST_3_SCANS', observationRows: 3, coverageRatioAvg: 0.7, coverageRatioTrend: 'FLAT', selectedProviderNoneRate: 0, dataUnavailableRate: 0, semanticSampleAvailabilityRate: 1, staleSourceRate: 0, unknownTreatmentSafe: true, providerIssueBecameBearishCount: 0, unknownBecameBullishCount: 0,
    recoveryStatusCounts: { improving: 1, stable: 2, observing: 0, degraded: 0, insufficientData: 0, unknown: 0 },
    operatorActions: { p0Open: 0, p1Open: 0, p2Open: 0, observing: 0, resolvedCandidate: 0 },
    ...evidence,
  } });
}

function src(value: string): OperatorActionSource { return { adr: '0477', diagnosticKey: value, diagnosticValue: value, severity: 'DATA_UNAVAILABLE' }; }

describe('ADR-0485 Supply Advisory Promotion Readiness Audit', () => {
  it('1. Missing inputs return INSUFFICIENT_DATA safely.', () => { expect(buildSupplyAdvisoryReadinessReportAdr0485().status).toBe('INSUFFICIENT_DATA'); });
  it('2. observationRows below threshold returns OBSERVING if safety is clean.', () => { expect(reportWith({ observationRows: 2 }).status).toBe('OBSERVING'); });
  it('3. Sufficient observations + high coverage returns positive readiness score.', () => { expect(reportWith({}).readinessScore).toBeGreaterThan(80); });
  it('4. coverageRatioAvg below threshold fails readiness.', () => { const r = reportWith({ coverageRatioAvg: 0.3 }); expect(r.failedReasons).toContain('COVERAGE_TOO_LOW'); });
  it('5. selectedProviderNoneRate above threshold fails readiness.', () => { const r = reportWith({ selectedProviderNoneRate: 0.8 }); expect(r.failedReasons).toContain('SELECTED_PROVIDER_NONE'); });
  it('6. dataUnavailableRate above threshold fails readiness.', () => { const r = reportWith({ dataUnavailableRate: 0.9 }); expect(r.failedReasons).toContain('DATA_UNAVAILABLE_HIGH'); });
  it('7. semanticSampleAvailabilityRate below threshold fails readiness.', () => { const r = reportWith({ semanticSampleAvailabilityRate: 0 }); expect(r.failedReasons).toContain('SEMANTIC_SAMPLE_MISSING'); });
  it('8. staleSourceRate above threshold fails readiness.', () => { const r = reportWith({ staleSourceRate: 1 }); expect(r.failedReasons).toContain('SOURCE_STALE'); });
  it('9. unknownBecameBullishCount > 0 prevents READY.', () => { const r = reportWith({ unknownTreatmentSafe: false, unknownBecameBullishCount: 1 }); expect(r.status).not.toBe('READY'); });
  it('10. providerIssueBecameBearishCount > 0 sets DEGRADED or prevents READY.', () => { const r = reportWith({ unknownTreatmentSafe: false, providerIssueBecameBearishCount: 1 }); expect(['DEGRADED', 'NOT_READY']).toContain(r.status); });
  it('11. p1Open > 0 prevents READY.', () => { const r = reportWith({ operatorActions: { p0Open: 0, p1Open: 1, p2Open: 0, observing: 0, resolvedCandidate: 0 } }); expect(r.status).not.toBe('READY'); });
  it('12. READY requires unknownTreatmentSafe=true.', () => { expect(reportWith({ unknownTreatmentSafe: false }).status).not.toBe('READY'); });
  it('13. READY sets proposedPromotionMode=ADVISORY_READY.', () => { expect(reportWith({}).proposedPromotionMode).toBe('ADVISORY_READY'); });
  it('14. READY does not change policyPromotionMode from SHADOW_ONLY.', () => { expect(reportWith({}).policyPromotionMode).toBe('SHADOW_ONLY'); });
  it('15. READY recommendedNextStep is PREPARE_ADVISORY_DRY_RUN_ADR.', () => { expect(reportWith({}).recommendedNextStep).toBe('PREPARE_ADVISORY_DRY_RUN_ADR'); });
  it('16. NOT_READY proposedPromotionMode=NONE.', () => { expect(reportWith({ coverageRatioAvg: 0.3 }).proposedPromotionMode).toBe('NONE'); });
  it('17. OBSERVING proposedPromotionMode=NONE.', () => { expect(reportWith({ observationRows: 2 }).proposedPromotionMode).toBe('NONE'); });
  it('18. readinessScore is capped 0~100.', () => { const r = reportWith({ coverageRatioAvg: 5, semanticSampleAvailabilityRate: 5 }); expect(r.readinessScore).toBeLessThanOrEqual(100); });
  it('19. readinessScore max is capped if unknown safety fails.', () => { expect(reportWith({ unknownTreatmentSafe: false }).readinessScore).toBeLessThanOrEqual(50); });
  it('20. passedReasons and failedReasons are populated.', () => { const r = reportWith({ coverageRatioAvg: 0.3 }); expect(r.passedReasons.length).toBeGreaterThan(0); expect(r.failedReasons.length).toBeGreaterThan(0); });
  it('21. ADR-0480 creates PREPARE_SUPPLY_ADVISORY_DRY_RUN_ADR action only when READY.', () => { const q = buildOperatorActionQueueAdr0480({ supplyAdvisoryReadinessAdr0485: reportWith({}) }); expect(q.allActions.some(a => a.rootCause === 'PREPARE_SUPPLY_ADVISORY_DRY_RUN_ADR')).toBe(true); });
  it('22. ADR-0480 keeps remediation actions open when NOT_READY/DEGRADED.', () => { const q = buildOperatorActionQueueAdr0480({ sources: [src('selectedProvider=NONE')], supplyAdvisoryReadinessAdr0485: reportWith({ coverageRatioAvg: 0.1 }) }); expect(q.allActions.find(a => a.rootCause === 'INVESTOR_FLOW_PROVIDER_UNWIRED')?.status).toBe('OPEN'); });
  it('23. ADR-0478 compact output includes ADR-0485 line.', () => { expect(formatSupplyAdvisoryReadinessCompactAdr0485(reportWith({}))).toContain('ADR-0485 SupplyReadiness'); });
  it('24. ADR-0479 detail registry exposes ADR-0485 trace.', () => { expect(getSupplyAdvisoryReadinessDetailRegistryEntryAdr0485(reportWith({})).adrTraceHint).toBe('/adr_trace 0485'); });
  it('25. ADR-0476 records sanitized readiness observation row.', () => { const row = buildSupplyAdvisoryReadinessObservationRowAdr0485(reportWith({})); expect(row.observationType).toBe('SUPPLY_ADVISORY_READINESS_ADR0485'); expect(JSON.stringify(row)).not.toContain('rawPayload'); });
  it('26. Runtime Pipeline Audit treats ADR-0485 as diagnostic readiness evidence only.', () => { expect(formatRuntimePipelineReadinessEvidenceLineAdr0485(reportWith({}))).toContain('rolloutInstalled=false'); });
  it('27. No raw provider payload is persisted.', () => { expect(buildSupplyAdvisoryReadinessObservationRowAdr0485(reportWith({}))).not.toHaveProperty('rawProviderPayload'); });
  it('28. No KIS order modules are imported.', () => { expect(fs.readFileSync(path.resolve('server/trading/signalScanner/supplyAdvisoryReadinessAdr0485.ts'), 'utf-8').split('\n').filter(line => line.startsWith('import')).join('\n')).not.toMatch(/kis|orderDispatch/i); });
  it('29. No live execution modules are imported.', () => { expect(fs.readFileSync(path.resolve('server/trading/signalScanner/supplyAdvisoryReadinessAdr0485.ts'), 'utf-8').split('\n').filter(line => line.startsWith('import')).join('\n')).not.toMatch(/liveExecution|createLiveOrder/i); });
  it('30. requiredScore remains 70.', () => { expect(buildSupplyAdvisoryReadinessObservationRowAdr0485(reportWith({})).requiredScore).toBe(70); });
  it('31. Gate thresholds, weights, Kelly remain unchanged.', () => { expect(fs.readFileSync(path.resolve('server/trading/signalScanner/supplyAdvisoryReadinessAdr0485.ts'), 'utf-8').split('\n').filter(line => line.startsWith('import')).join('\n')).not.toMatch(/setGateThreshold|GATE_RELAX|kelly/i); });
  it('32. UNKNOWN is never converted to bullish.', () => { expect(reportWith({ unknownTreatmentSafe: false, unknownBecameBullishCount: 1 }).diagnostics.join(' ')).toContain('UNKNOWN remains UNKNOWN'); });
  it('33. Provider issue is never converted to bearish.', () => { expect(reportWith({ providerIssueBecameBearishCount: 1, unknownTreatmentSafe: false }).diagnostics.join(' ')).toContain('provider issues remain separated'); });
  it('34. executionImpact is always NONE.', () => { expect(reportWith({}).executionImpact).toBe('NONE'); });
  it('35. liveExecutionAllowed is always false.', () => { expect(reportWith({}).liveExecutionAllowed).toBe(false); });
  it('36. policyPromotionMode is always SHADOW_ONLY.', () => { expect(reportWith({}).policyPromotionMode).toBe('SHADOW_ONLY'); });
  it('37. operatorApprovalRequired is always true.', () => { expect(reportWith({}).operatorApprovalRequired).toBe(true); });
  it('38. Readiness audit failure is try/catch isolated.', () => { const r = buildSupplyAdvisoryReadinessReportAdr0485({ evidence: undefined, snapshotsAdr0484: [snap()] }); expect(r.executionImpact).toBe('NONE'); });
});
