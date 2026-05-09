import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSupplyRecoveryRuntimeMountObservationRowAdr0486,
  buildSupplyRecoveryRuntimeMountReportAdr0486,
  formatRuntimePipelineMountEvidenceLineAdr0486,
  formatSupplyRecoveryRuntimeMountCompactAdr0486,
  getSupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486,
  safeBuildSupplyRecoveryRuntimeMountReportAdr0486,
  type SupplyRecoveryRuntimeMountInputAdr0486,
} from './supplyRecoveryRuntimeMountAdr0486.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';

function mountedInput(patch: Partial<SupplyRecoveryRuntimeMountInputAdr0486> = {}): SupplyRecoveryRuntimeMountInputAdr0486 {
  return {
    generatedAt: '2026-05-09T00:00:00.000Z',
    warmupOutput: [
      'Supply Provider Warmup (ADR-0473)',
      '  NAVER: WIRED',
      '  Semantic NetBuy: NORMALIZER_READY / DATA_UNAVAILABLE',
      '  ADR-0483 SupplyFreshness: FRESH | cacheState=FRESH sourceState=FRESH oldestSourceAgeTradingDays=0 affectedSources=NONE refreshRecommendedSources=NONE',
    ].join('\n'),
    naverInvestorTrendAdr0481: { status: 'WIRED' },
    semanticNetBuyNormalizationAdr0482: { status: 'DATA_UNAVAILABLE', samples: [], selectedSample: null },
    supplySourceFreshnessAdr0483: { status: 'FRESH', rows: [{}], affectedSources: [], oldestSourceAgeTradingDays: 0, refreshStatus: 'NOT_NEEDED' },
    supplyCoverageRecoveryAdr0484: { status: 'STABLE', current: {}, baseline: {}, snapshots: [{}, {}] },
    supplyAdvisoryReadinessAdr0485: { status: 'DEGRADED', readinessScore: 40, evidence: {}, failedReasons: ['COVERAGE_TOO_LOW'] },
    compactOutput: [
      'ADR-0484 SupplyRecovery: STABLE | coverage=6/6 | selectedProvider=NAVER | impact=NONE',
      'ADR-0485 SupplyReadiness: DEGRADED | score=40 | fail=COVERAGE_TOO_LOW | impact=NONE',
      'ADR-0486 RuntimeMount: MOUNTED | legacy=0 | missingEvidence=0 | impact=NONE',
    ],
    detailRegistryEntries: ['0481', '0482', '0483', '0484', '0485', '0486'].map((adr) => ({
      adr,
      adrTraceHint: `/adr_trace ${adr}`,
      commandHint: '/supply_health_detail',
    })),
    runtimePipelineAuditEvidence: 'supplyReadiness: ADR-0485 readinessAuditEvidence=DEGRADED score=40 diagnosticOnly=true executionImpact=NONE | supplyRecoveryMount: ADR-0486 status=MOUNTED legacy=0 missingEvidence=0 diagnosticOnly=true executionImpact=NONE',
    ...patch,
  };
}

function check(input: SupplyRecoveryRuntimeMountInputAdr0486, id: string) {
  return buildSupplyRecoveryRuntimeMountReportAdr0486(input).checks.find((item) => item.id === id);
}

describe('ADR-0486 Supply Recovery Runtime Mount Verification', () => {
  it('1. NAVER: NOT_WIRED legacy text triggers LEGACY_OUTPUT_DETECTED.', () => {
    const report = buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ warmupOutput: 'NAVER: NOT_WIRED\nSemantic NetBuy: NORMALIZER_READY / DATA_UNAVAILABLE' }));
    expect(report.overallStatus).toBe('LEGACY_OUTPUT_DETECTED');
    expect(report.checks.find((item) => item.id === 'ADR_0481_NAVER_COLLECTOR_MOUNT')?.legacyOutputCode).toBe('NAVER_NOT_WIRED_LEGACY');
  });

  it('2. NAVER: WIRED returns MOUNTED for ADR-0481 check.', () => {
    expect(check(mountedInput({ warmupOutput: 'NAVER: WIRED' }), 'ADR_0481_NAVER_COLLECTOR_MOUNT')?.status).toBe('MOUNTED');
  });

  it('3. NAVER: DATA_UNAVAILABLE is acceptable and not legacy.', () => {
    const c = check(mountedInput({ warmupOutput: 'NAVER: DATA_UNAVAILABLE', naverInvestorTrendAdr0481: { status: 'DATA_UNAVAILABLE' } }), 'ADR_0481_NAVER_COLLECTOR_MOUNT');
    expect(c?.status).toBe('MOUNTED');
    expect(c?.legacyOutputDetected).toBe(false);
  });

  it('4. Semantic NetBuy collector-not-wired legacy text triggers LEGACY_OUTPUT_DETECTED.', () => {
    const c = check(mountedInput({ warmupOutput: 'NAVER: WIRED\nSemantic NetBuy: schema ready / collector not wired' }), 'ADR_0482_SEMANTIC_NETBUY_MOUNT');
    expect(c?.status).toBe('LEGACY_OUTPUT_DETECTED');
    expect(c?.legacyOutputCode).toBe('SEMANTIC_NETBUY_COLLECTOR_NOT_WIRED_LEGACY');
  });

  it('5. Semantic NetBuy NORMALIZER_READY or DATA_UNAVAILABLE is acceptable.', () => {
    expect(check(mountedInput({ warmupOutput: 'Semantic NetBuy: NORMALIZER_READY / DATA_UNAVAILABLE' }), 'ADR_0482_SEMANTIC_NETBUY_MOUNT')?.status).toBe('MOUNTED');
    expect(check(mountedInput({ warmupOutput: 'Semantic NetBuy: DATA_UNAVAILABLE' }), 'ADR_0482_SEMANTIC_NETBUY_MOUNT')?.status).toBe('MOUNTED');
  });

  it('6. Missing ADR-0483 freshness report triggers MISSING_EVIDENCE.', () => {
    const c = check(mountedInput({ warmupOutput: 'NAVER: WIRED\nSemantic NetBuy: NORMALIZER_READY / DATA_UNAVAILABLE', supplySourceFreshnessAdr0483: null }), 'ADR_0483_FRESHNESS_MOUNT');
    expect(c?.status).toBe('MISSING_EVIDENCE');
    expect(c?.legacyOutputCode).toBe('FRESHNESS_REPORT_ABSENT');
  });

  it('7. ADR-0484 baseline=pending is acceptable as PARTIAL/MOUNTED, not failure.', () => {
    const c = check(mountedInput({ compactOutput: 'ADR-0484 SupplyRecovery: OBSERVING | coverage=0/6 | baseline=pending | selectedProvider=NONE', supplyCoverageRecoveryAdr0484: { status: 'OBSERVING', current: {}, baseline: null, snapshots: [{}] } }), 'ADR_0484_RECOVERY_OBSERVATION_MOUNT');
    expect(['PARTIAL', 'MOUNTED']).toContain(c?.status);
  });

  it('8. Missing ADR-0484 recovery line triggers MISSING_EVIDENCE.', () => {
    const c = check(mountedInput({ compactOutput: 'ADR-0485 SupplyReadiness: DEGRADED', supplyCoverageRecoveryAdr0484: null }), 'ADR_0484_RECOVERY_OBSERVATION_MOUNT');
    expect(c?.status).toBe('MISSING_EVIDENCE');
    expect(c?.legacyOutputCode).toBe('RECOVERY_OBSERVATION_ABSENT');
  });

  it('9. ADR-0485 DEGRADED is acceptable if evidence exists.', () => {
    expect(check(mountedInput({ supplyAdvisoryReadinessAdr0485: { status: 'DEGRADED', readinessScore: 40, evidence: {}, failedReasons: ['COVERAGE_TOO_LOW'] } }), 'ADR_0485_READINESS_AUDIT_MOUNT')?.status).toBe('MOUNTED');
  });

  it('10. Runtime Pipeline Audit readinessAuditEvidence=missing triggers MISSING_EVIDENCE.', () => {
    const c = check(mountedInput({ runtimePipelineAuditEvidence: 'ADR-0485 readinessAuditEvidence=missing diagnosticOnly=true executionImpact=NONE' }), 'ADR_0485_READINESS_AUDIT_MOUNT');
    expect(c?.status).toBe('MISSING_EVIDENCE');
    expect(c?.legacyOutputCode).toBe('READINESS_AUDIT_EVIDENCE_MISSING');
  });

  it('11. ADR-0478 compact output mount check detects uncompressed raw blocks.', () => {
    const c = check(mountedInput({ compactOutput: Array.from({ length: 90 }, (_, i) => `Raw ADR-0477 providerStatuses row ${i}`).join('\n') }), 'ADR_0478_COMPACT_OUTPUT_MOUNT');
    expect(c?.status).toBe('PARTIAL');
  });

  it('12. ADR-0479 detail registry check detects missing ADR-0481~0485 entries.', () => {
    const c = check(mountedInput({ detailRegistryEntries: [{ adr: '0486', adrTraceHint: '/adr_trace 0486' }] }), 'ADR_0479_DETAIL_REGISTRY_MOUNT');
    expect(c?.status).toBe('MISSING_EVIDENCE');
  });

  it('13. Overall status MOUNTED when all checks pass.', () => {
    expect(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput()).overallStatus).toBe('MOUNTED');
  });

  it('14. Overall status PARTIAL when some checks are partial but no legacy output.', () => {
    expect(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ supplyCoverageRecoveryAdr0484: { status: 'OBSERVING', current: {}, baseline: null, snapshots: [{}] } })).overallStatus).toBe('PARTIAL');
  });

  it('15. Overall status LEGACY_OUTPUT_DETECTED when legacy output count > 0.', () => {
    expect(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ warmupOutput: 'NAVER: NOT_WIRED' })).overallStatus).toBe('LEGACY_OUTPUT_DETECTED');
  });

  it('16. Report topMountGaps populated.', () => {
    expect(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ warmupOutput: 'NAVER: NOT_WIRED' })).topMountGaps).toContain('NAVER_NOT_WIRED_LEGACY');
  });

  it('17. ADR-0480 creates SUPPLY_RECOVERY_RUNTIME_MOUNT_GAP action when legacy output exists.', () => {
    const q = buildOperatorActionQueueAdr0480({ supplyRecoveryRuntimeMountAdr0486: buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ warmupOutput: 'NAVER: NOT_WIRED' })) });
    expect(q.allActions.some((action) => action.rootCause === 'SUPPLY_RECOVERY_RUNTIME_MOUNT_GAP' && action.priority === 'P1')).toBe(true);
  });

  it('18. ADR-0480 creates SUPPLY_READINESS_EVIDENCE_MISSING when readiness evidence missing.', () => {
    const q = buildOperatorActionQueueAdr0480({ supplyRecoveryRuntimeMountAdr0486: buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ runtimePipelineAuditEvidence: 'ADR-0485 readinessAuditEvidence=missing diagnosticOnly=true executionImpact=NONE' })) });
    expect(q.allActions.some((action) => action.rootCause === 'SUPPLY_READINESS_EVIDENCE_MISSING' && action.priority === 'P1')).toBe(true);
  });

  it('19. ADR-0476 records sanitized ADR-0486 observation row.', () => {
    const report = buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ warmupOutput: 'NAVER: NOT_WIRED' }));
    const row = buildSupplyRecoveryRuntimeMountObservationRowAdr0486(report);
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', supplyRecoveryRuntimeMountAdr0486: report });
    expect(row.observationType).toBe('SUPPLY_RECOVERY_RUNTIME_MOUNT_ADR0486');
    expect(rows[0].source).toBe('ADR_0486_SUPPLY_RECOVERY_RUNTIME_MOUNT');
    expect(JSON.stringify(row)).not.toMatch(/rawPayload|account|orderable_cash|total_assets/i);
  });

  it('20. ADR-0478 compact output includes ADR-0486 line.', () => {
    expect(formatSupplyRecoveryRuntimeMountCompactAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput()))).toContain('ADR-0486 RuntimeMount');
  });

  it('21. ADR-0479 detail registry exposes ADR-0486 trace.', () => {
    const entry = getSupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput()));
    expect(entry.adrTraceHint).toBe('/adr_trace 0486');
    expect(entry.render()).toContain('ADR-0486 Supply Recovery Runtime Mount Verification');
  });

  it('22. Runtime Pipeline Audit includes ADR-0486 diagnostic evidence.', () => {
    expect(formatRuntimePipelineMountEvidenceLineAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput()))).toContain('ADR-0486 status=MOUNTED');
  });

  it('23. No raw provider payload is persisted.', () => {
    const row = buildSupplyRecoveryRuntimeMountObservationRowAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput()));
    expect(Object.keys(row)).not.toContain('rawProviderPayload');
    expect(JSON.stringify(row)).not.toMatch(/foreignNetBuy|institutionNetBuy|rawPoints|payload/i);
  });

  it('24. No KIS order modules are imported.', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.ts'), 'utf-8');
    expect(src.split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/kis.*order|order.*kis|sendOrder|buyOrder|sellOrder/i);
  });

  it('25. No live execution modules are imported.', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.ts'), 'utf-8');
    expect(src.split('\n').filter((line) => line.startsWith('import')).join('\n')).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor|liveExecution|createLiveOrder/i);
  });

  it('26. requiredScore remains 70.', () => {
    expect(buildSupplyRecoveryRuntimeMountObservationRowAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput())).requiredScore).toBe(70);
  });

  it('27. Gate thresholds, weights, Kelly remain unchanged.', () => {
    const src = fs.readFileSync(path.resolve('server/trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.ts'), 'utf-8');
    expect(src).not.toMatch(/setGateThreshold|GATE_RELAX|kellyMultiplier\s*=|finalKellyMultiplier\s*=|kellySizing|kellyFraction/i);
  });

  it('28. UNKNOWN is never converted to bullish.', () => {
    const detail = getSupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput())).render();
    expect(detail).toContain('UNKNOWN remains UNKNOWN');
    expect(detail).not.toMatch(/UNKNOWN.*BULLISH|BULLISH.*UNKNOWN/);
  });

  it('29. Provider issue is never converted to bearish.', () => {
    const detail = getSupplyRecoveryRuntimeMountDetailRegistryEntryAdr0486(buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput())).render();
    expect(detail).toContain('provider issue is not bearish');
    expect(detail).not.toMatch(/providerIssue.*BEARISH|BEARISH.*providerIssue/);
  });

  it('30. executionImpact is always NONE.', () => {
    const report = buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput({ warmupOutput: 'NAVER: NOT_WIRED' }));
    expect(report.executionImpact).toBe('NONE');
    expect(report.checks.every((item) => item.executionImpact === 'NONE')).toBe(true);
  });

  it('31. liveExecutionAllowed is always false.', () => {
    const report = buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput());
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.checks.every((item) => item.liveExecutionAllowed === false)).toBe(true);
  });

  it('32. policyPromotionMode is always SHADOW_ONLY.', () => {
    const report = buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput());
    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(report.checks.every((item) => item.policyPromotionMode === 'SHADOW_ONLY')).toBe(true);
  });

  it('33. operatorApprovalRequired is always true.', () => {
    const report = buildSupplyRecoveryRuntimeMountReportAdr0486(mountedInput());
    expect(report.operatorApprovalRequired).toBe(true);
    expect(report.checks.every((item) => item.operatorApprovalRequired === true)).toBe(true);
  });

  it('34. Mount verification failure is try/catch isolated.', () => {
    const report = safeBuildSupplyRecoveryRuntimeMountReportAdr0486({ throwForTest: true });
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.diagnostics.join(' ')).toContain('failure isolated');
  });
});
