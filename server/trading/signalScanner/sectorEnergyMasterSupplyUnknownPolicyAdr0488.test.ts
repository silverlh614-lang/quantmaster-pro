import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildAdr0488ObservationRows,
  buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
  buildSectorEnergyMasterReportAdr0488,
  buildSupplyUnknownPolicyReportAdr0488,
  classifySupplyUnknownRootCauseAdr0488,
  collectOperatorActionSourcesFromAdr0488,
  formatRuntimePipelineAdr0488EvidenceLine,
  formatSectorEnergySupplyUnknownCompactAdr0488,
  getSectorEnergySupplyUnknownDetailRegistryEntryAdr0488,
  safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';

const modulePath = path.resolve('server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts');
const moduleSrc = () => fs.readFileSync(modulePath, 'utf-8');

function diag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    indexCodeCoverageBefore: 27.5,
    indexCodeCoverageAfterAliasCandidate: 42,
    missingIndexCodeCount: 3,
    aggregateIgnoredCount: 1,
    aliasMissingCount: 2,
    aliasCandidateCount: 4,
    unsafeAliasCandidateCount: 0,
    fallbackUsed: 'STOCK_DAILY',
    dataQuality: 'DEGRADED',
    ...overrides,
  };
}

function penaltyReport(overrides: Record<string, unknown> = {}) {
  return {
    originalPenaltyAvg: 23,
    dedupedPenaltyAvg: 10,
    removedPenaltyAvg: 13,
    originalNetScoreAvg: 21.4,
    dedupedNetScoreAvg: 34.4,
    survivorsAfterDedup: 0,
    unknownPenaltyAvg: 10,
    executionImpact: 'NONE',
    ...overrides,
  } as any;
}

function finalCalibration(overrides: Record<string, unknown> = {}) {
  return {
    currentRequiredScore: 70,
    bestRepairedNetAvg: 56.7,
    unknownDiagnosticNetAvg: 69.7,
    providerRecoveryGuard: {
      providerHealth: 'DEGRADED',
      unknownPolicyActive: true,
      shouldAutoDisableUnknownPolicy: false,
      warningIfOverridePersists: true,
      message: 'provider issue diagnostic only',
    },
    unknownPolicyScenarios: [
      {
        scenario: 'CURRENT_RETAIN_10',
        pointPenaltyAvg: 10,
        netScoreAvg: 56.7,
        gate1Survivors: 0,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
      {
        scenario: 'UNKNOWN_DIAGNOSTIC_ONLY',
        pointPenaltyAvg: 0,
        netScoreAvg: 69.7,
        gate1Survivors: 4,
        executionImpact: 'NONE',
        survivorExamples: [{ symbol: '005930', beforeScore: 56.7, afterScore: 69.7, requiredScore: 70, reason: ['SUPPLY_UNKNOWN_DIAGNOSTIC_ONLY'] }],
      },
      {
        scenario: 'UNKNOWN_TO_CONFIDENCE_DOWNGRADE',
        pointPenaltyAvg: 0,
        netScoreAvg: 67.1,
        gate1Survivors: 2,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
      {
        scenario: 'UNKNOWN_TO_SIZING_ONLY',
        pointPenaltyAvg: 0,
        netScoreAvg: 68.3,
        gate1Survivors: 3,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
      {
        scenario: 'BEARISH_ONLY_SUPPLY_PENALTY',
        pointPenaltyAvg: 10,
        netScoreAvg: 56.7,
        gate1Survivors: 0,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
    ],
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    ...overrides,
  } as any;
}

describe('ADR-0488 SectorEnergy master + supply UNKNOWN policy', () => {
  it('returns DATA_UNAVAILABLE with executionImpact NONE when sector master source is missing', () => {
    const report = buildSectorEnergyMasterReportAdr0488({ generatedAt: '2026-05-09T00:00:00.000Z' });
    expect(report.status).toBe('DATA_UNAVAILABLE');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('returns partial/degraded sector evidence with sanitized metadata only', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag(),
      sectorMasterRecords: [
        { sectorName: '반도체', indexCode: 'G1010', market: 'KOSPI', source: 'KRX', rawPayload: { secret: true } },
        { sectorName: '제약', indexCode: null, source: 'CACHE', payload: { secret: true } },
      ],
    });
    expect(['PARTIAL', 'DEGRADED']).toContain(report.status);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(report.records[0]).toMatchObject({ sectorName: '반도체', indexCode: 'G1010', normalized: true });
  });

  it('ignores aggregate rows for leadership mapping', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorMasterRecords: [
        { sectorName: '코스피', indexCode: 'KOSPI', source: 'KRX' },
        { sectorName: '반도체', indexCode: 'G1010', source: 'KRX' },
      ],
    });
    expect(report.records.find((row) => row.sectorName === '코스피')?.coverageMetadata.aggregateIgnored).toBe(true);
    expect(report.mappingDiagnostics.sectorToIndexCode).not.toHaveProperty('코스피');
  });

  it('does not unlock leadership confidence for unsafe alias candidates', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({ unsafeAliasCandidateCount: 2, indexCodeCoverageAfterAliasCandidate: 90, fallbackUsed: 'NONE' }),
    });
    expect(report.leadershipConfidence).toBe('BLOCKED');
    expect(report.sectorBoostAllowed).toBe(false);
  });

  it('keeps STOCK_DAILY fallback from unlocking SectorEnergy boost or STRONG_BUY', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({ indexCodeCoverageAfterAliasCandidate: 95, missingIndexCodeCount: 0, fallbackUsed: 'STOCK_DAILY' }),
    });
    expect(report.fallbackUsed).toBe('STOCK_DAILY');
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
  });

  it('computes indexCode coverage percentage', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorMasterRecords: [
        { sectorName: 'A', indexCode: 'A1' },
        { sectorName: 'B', indexCode: null },
      ],
    });
    expect(report.coveragePct).toBe(50);
  });

  it('counts missing indexCode values', () => {
    const report = buildSectorEnergyMasterReportAdr0488({ sectorMasterRecords: [{ sectorName: 'A' }, { sectorName: 'B' }] });
    expect(report.mappingDiagnostics.missingIndexCodeCount).toBe(2);
  });

  it('checks sectorName to indexCode symmetry and reports unresolved names', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorMasterRecords: [{ sectorName: 'A', indexCode: 'A1' }, { sectorName: 'B' }],
    });
    expect(report.mappingDiagnostics.symmetryPassed).toBe(false);
    expect(report.mappingDiagnostics.unresolvedSectorNames).toContain('B');
  });

  it('classifies provider-side UNKNOWN as provider issue and not market signal', () => {
    const classification = classifySupplyUnknownRootCauseAdr0488({ providerIssue: true, marketSignal: false, providerStatus: 'UNKNOWN' });
    expect(classification.providerIssue).toBe(true);
    expect(classification.marketSignal).toBe(false);
    expect(classification.rootCause).toBe('SUPPLY_PROVIDER_UNKNOWN');
  });

  it('collapses duplicate SUPPLY_UNKNOWN penalties into one root cause group for dry-run', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({
      providerIssue: true,
      marketSignal: false,
      providerStatus: 'DATA_UNAVAILABLE',
      penaltyDeduplicationAdr0469: penaltyReport(),
      finalGate1CalibrationAdr0471: finalCalibration(),
    });
    expect(report.classification.duplicatePenaltyGroupCollapsed).toBe(true);
    expect(report.dedupedPenaltyAvg).toBe(10);
    expect(report.removedPenaltyAvg).toBe(13);
  });

  it('keeps requiredScore at 70 and live execution false', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, finalGate1CalibrationAdr0471: finalCalibration() });
    expect(report.requiredScore).toBe(70);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
  });

  it('marks dry-run survivors as shadow/counterfactual only', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, finalGate1CalibrationAdr0471: finalCalibration() });
    const unknown = report.dryRunVariants.find((row) => row.variant === 'UNKNOWN_DIAGNOSTIC_ONLY');
    expect(unknown?.survivors).toBe(4);
    expect(unknown?.shadowOnly).toBe(true);
    expect(unknown?.operatorApprovalRequired).toBe(true);
  });

  it('disables UNKNOWN diagnostic relaxation when provider becomes VERIFIED', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, providerStatus: 'VERIFIED', finalGate1CalibrationAdr0471: finalCalibration() });
    expect(report.status).toBe('VERIFIED_DISABLED');
    expect(report.unknownPolicyActive).toBe(false);
    expect(report.providerVerifiedOverrideWarning).toBe(true);
  });

  it('emits requested audit averages and survivor counts', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({
      providerIssue: true,
      marketSignal: false,
      penaltyDeduplicationAdr0469: penaltyReport(),
      finalGate1CalibrationAdr0471: finalCalibration(),
    });
    expect(report.originalPenaltyAvg).toBe(23);
    expect(report.dedupedPenaltyAvg).toBe(10);
    expect(report.diagnosticPolicyNetAvg).toBe(69.7);
    expect(report.survivorsUnknownDiagnosticOnly).toBe(4);
  });

  it('builds a combined report with compact ADR-0488 evidence', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag(),
      providerIssue: true,
      marketSignal: false,
      finalGate1CalibrationAdr0471: finalCalibration(),
      penaltyDeduplicationAdr0469: penaltyReport(),
    });
    const compact = formatSectorEnergySupplyUnknownCompactAdr0488(report);
    expect(compact).toContain('ADR-0488 SectorEnergyMaster');
    expect(compact).toContain('ADR-0488 SupplyUnknownPolicy');
  });

  it('adds ADR-0488 observation rows to ADR-0476 ledger builder', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      generatedAt: '2026-05-09T00:00:00.000Z',
      sectorEnergyDiagnosticAdr0474: diag(),
      providerIssue: true,
      marketSignal: false,
      finalGate1CalibrationAdr0471: finalCalibration(),
    });
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', sectorEnergySupplyUnknownAdr0488: report });
    expect(rows.some((row) => row.source === 'ADR_0488_SECTOR_ENERGY_MASTER_SUPPLY_LINE')).toBe(true);
    expect(rows.some((row) => row.source === 'ADR_0488_SUPPLY_UNKNOWN_POLICY_STABILIZATION')).toBe(true);
  });

  it('builds sanitized standalone ADR-0488 observation rows', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    const rows = buildAdr0488ObservationRows(report);
    expect(JSON.stringify(rows)).not.toContain('rawPayload');
    expect(rows.every((row) => row.executionImpact === 'NONE' && row.liveExecutionAllowed === false)).toBe(true);
  });

  it('creates operator action evidence for sector repair and supply UNKNOWN observe', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    const queue = buildOperatorActionQueueAdr0480({ sectorEnergySupplyUnknownAdr0488: report });
    expect(queue.dedupedRootCauses).toContain('REPAIR_SECTOR_INDEX_MASTER');
    expect(queue.dedupedRootCauses).toContain('IMPROVE_INDEX_CODE_COVERAGE');
    expect(queue.dedupedRootCauses).toContain('SUPPLY_UNKNOWN_POLICY_OBSERVE');
    expect(queue.dedupedRootCauses).toContain('COLLECT_SUPPLY_SAMPLE_BEFORE_PROMOTION');
  });

  it('collects ADR-0488 operator action source codes', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    const codes = collectOperatorActionSourcesFromAdr0488(report).map((source) => source.code);
    expect(codes).toContain('REPAIR_SECTOR_INDEX_MASTER');
    expect(codes).toContain('SUPPLY_UNKNOWN_POLICY_OBSERVE');
  });

  it('exposes ADR-0488 detail registry trace', () => {
    const entry = getSectorEnergySupplyUnknownDetailRegistryEntryAdr0488(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488());
    expect(entry.adrTraceHint).toBe('/adr_trace 0488');
    expect(entry.commandHint).toBe('/fresh_data_status');
  });

  it('emits Runtime Pipeline Audit ADR-0488 evidence', () => {
    const line = formatRuntimePipelineAdr0488EvidenceLine(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false }));
    expect(line).toContain('ADR-0488');
    expect(line).toContain('diagnosticOnly=true');
    expect(line).toContain('executionImpact=NONE');
  });

  it('keeps policy promotion SHADOW_ONLY with operator approval', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(report.operatorApprovalRequired).toBe(true);
  });

  it('try/catch isolates ADR-0488 builder failures', () => {
    const report = safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ throwForTest: true });
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.diagnostics.join(' ')).toContain('isolated');
  });

  it('wires ADR-0488 through ScanSummary source and scan blockers command', () => {
    const scanDiagnostics = fs.readFileSync(path.resolve('server/trading/signalScanner/scanDiagnostics.ts'), 'utf-8');
    const scanBlockers = fs.readFileSync(path.resolve('server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    expect(scanDiagnostics).toContain('sectorEnergySupplyUnknownAdr0488');
    expect(scanBlockers).toContain('formatSectorEnergySupplyUnknownCompactAdr0488');
  });

  it('wires ADR-0488 through Runtime Pipeline Audit and /fresh_data_status', () => {
    const runtimeAudit = fs.readFileSync(path.resolve('server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');
    const freshDataStatus = fs.readFileSync(path.resolve('server/telegram/commands/system/freshDataStatus.cmd.ts'), 'utf-8');
    expect(runtimeAudit).toContain('formatRuntimePipelineAdr0488EvidenceLine');
    expect(freshDataStatus).toContain('formatSectorEnergySupplyUnknownDetailAdr0488');
  });

  it('does not import KIS order or live execution modules', () => {
    const src = moduleSrc();
    expect(src).not.toMatch(/kisOrder|orderExecutor|trancheExecutor|autoTradeEngine|createLiveOrder/i);
  });

  it('does not allow raw payload persistence', () => {
    const src = moduleSrc();
    expect(src).not.toContain('rawPayloadPersistenceAllowed: true');
    expect(src).not.toContain('rawPayload:');
  });

  it('does not mutate requiredScore or Gate/Kelly policy', () => {
    const src = moduleSrc();
    expect(src).not.toMatch(/setRequiredScore|requiredScoreOverride|currentRequiredScore\s*=/);
    expect(src).not.toMatch(/setGateThreshold|kellyMultiplier|setKelly|GATE_RELAX/i);
  });

  it('never enables SectorEnergy boost or STRONG_BUY', () => {
    const src = moduleSrc();
    expect(src).not.toContain('sectorBoostAllowed: true');
    expect(src).not.toContain('strongBuyAllowed: true');
  });

  it('keeps UNKNOWN as UNKNOWN and provider issue separate from bearish signal', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, providerStatus: 'UNKNOWN' });
    expect(report.classification.rootCause).toBe('SUPPLY_PROVIDER_UNKNOWN');
    expect(report.marketSignal).toBe(false);
    expect(report.diagnostics.join(' ')).toContain('not classified as market signal');
  });
});
