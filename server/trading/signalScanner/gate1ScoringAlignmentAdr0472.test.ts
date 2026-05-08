// @responsibility ADR-0472 Gate1 scoring alignment dry-run regression tests
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPositiveScoreStarvationFallbackReport } from './gate1PositiveScoreStarvation.js';
import { buildGate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import { buildPenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import { buildRiskDoubleCountAuditReport } from './gate1RiskDoubleCount.js';
import { buildFinalGate1CalibrationAuditReport } from './gate1FinalCalibration.js';
import {
  buildGate1AlignmentProviderGuard,
  buildGate1ScoringAlignmentReport,
  detectGate1ScoringAlignmentMissingComponents,
  formatGate1ScoringAlignmentReport,
  MINIMUM_SIGNAL_SCORE_COMPONENT_CODES_ADR0472,
} from './gate1ScoringAlignmentAdr0472.js';
import {
  createScanCounters,
  formatScanBlockersMessage,
  getLastScanSummary,
  persistScanResults,
} from './scanDiagnostics.js';

function makeReports(marketSession = 'SELL_ONLY') {
  const positive = buildPositiveScoreStarvationFallbackReport({
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession,
    minSignalScoreReport: {
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession,
      totalCandidates: 45,
      minSignalFailed: 45,
      requiredScoreAvg: 70,
      actualScoreAvg: 21.4,
      actualScoreMin: 17.7,
      actualScoreMax: 21.7,
      avgScoreGap: -48.6,
      topScoreDeficits: [],
      topPenaltyContributors: [
        { code: 'SUPPLY_CONFLUENCE', avgPenalty: -10, affectedCount: 45 },
        { code: 'INVESTOR_FLOW', avgPenalty: -8, affectedCount: 45 },
        { code: 'RISK_PENALTY', avgPenalty: -6.3, affectedCount: 45 },
        { code: 'SOFT_FAIL_PENALTY', avgPenalty: -5, affectedCount: 45 },
      ],
      unknownTreatmentWarnings: 0,
      wouldPassIfUnknownNeutral: 0,
      wouldPassIfProviderPenaltyRemoved: 0,
      wouldPassIfSessionPenaltyRemoved: 0,
      wouldPassIfRiskPenaltyCapped: 0,
      wouldPassIfSoftFailPenaltyRemoved: 0,
      recommendedAction: 'REVIEW_MIN_SIGNAL_THRESHOLD',
    },
  });
  if (!positive) throw new Error('expected positive report');

  const repair = buildGate1ScoreCeilingRepairReport({
    positiveStarvationReport: positive,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession,
  });
  const dedup = buildPenaltyDeduplicationReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession,
    riskMultiplier: 0.26,
  });
  const risk = buildRiskDoubleCountAuditReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession,
    regimeMultiplier: 0.7,
    fomcMultiplier: 1,
    sectorMultiplier: 1,
    finalRiskMultiplier: 0.38,
    combinedKellyMultiplier: 0.26,
  });
  const final = buildFinalGate1CalibrationAuditReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    riskDoubleCountReport: risk,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession,
    providerHealth: 'UNKNOWN',
  });
  const alignment = buildGate1ScoringAlignmentReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    riskDoubleCountReport: risk,
    finalGate1CalibrationReport: final,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession,
    providerHealthStatus: 'UNKNOWN',
    unknownPolicyActive: true,
  });
  if (!alignment) throw new Error('expected alignment report');
  return { positive, repair, dedup, risk, final, alignment };
}

function scenario(name: string) {
  const found = makeReports().alignment.scenarioResults.find((item) => item.scenario === name);
  if (!found) throw new Error(`missing scenario ${name}`);
  return found;
}

describe('ADR-0472 Gate1 scoring alignment', () => {
  it('minimumSignalScoreTrace component set missing WATCHLIST_UPSTREAM_SCORE is recorded', () => {
    expect(detectGate1ScoringAlignmentMissingComponents()).toContain('WATCHLIST_UPSTREAM_SCORE');
  });

  it('minimumSignalScoreTrace component set missing BREAKOUT_STRUCTURE is recorded', () => {
    expect(detectGate1ScoringAlignmentMissingComponents()).toContain('BREAKOUT_STRUCTURE');
  });

  it('WATCHLIST_PRIORITY and WATCHLIST_UPSTREAM_SCORE are not treated as the same component', () => {
    const report = makeReports().alignment;
    const priority = report.componentMeanings.find((item) => item.code === 'WATCHLIST_PRIORITY');
    const upstream = report.componentMeanings.find((item) => item.code === 'WATCHLIST_UPSTREAM_SCORE');

    expect(priority?.meaning).not.toEqual(upstream?.meaning);
    expect(report.minimumSignalComponents).toContain('WATCHLIST_PRIORITY');
    expect(report.missingComponents).toContain('WATCHLIST_UPSTREAM_SCORE');
  });

  it('ADD_WATCHLIST_UPSTREAM_SCORE dry-run does not change live score', () => {
    const current = scenario('CURRENT');
    const watchlist = scenario('ADD_WATCHLIST_UPSTREAM_SCORE');

    expect(watchlist.netScoreAvg).toBeGreaterThan(current.netScoreAvg);
    expect(watchlist.liveExecutionAllowed).toBe(false);
    expect(watchlist.executionImpact).toBe('NONE');
  });

  it('ADD_BREAKOUT_STRUCTURE dry-run does not change live score', () => {
    const current = scenario('CURRENT');
    const breakout = scenario('ADD_BREAKOUT_STRUCTURE');

    expect(breakout.netScoreAvg).toBeGreaterThan(current.netScoreAvg);
    expect(breakout.liveExecutionAllowed).toBe(false);
    expect(breakout.executionImpact).toBe('NONE');
  });

  it('ALIGN_ALL_POSITIVE_COMPONENTS increases positiveScoreAvg', () => {
    const current = scenario('CURRENT');
    const aligned = scenario('ALIGN_ALL_POSITIVE_COMPONENTS');

    expect(aligned.positiveScoreAvg).toBeGreaterThan(current.positiveScoreAvg);
  });

  it('penalty dedup dry-run can be combined with component alignment', () => {
    const aligned = scenario('ALIGN_ALL_POSITIVE_COMPONENTS');
    const combined = scenario('ALIGN_PLUS_PENALTY_DEDUP');

    expect(combined.penaltyAvg).toBeLessThan(aligned.penaltyAvg);
    expect(combined.netScoreAvg).toBeGreaterThan(aligned.netScoreAvg);
  });

  it('risk split dry-run can be combined with component alignment', () => {
    const aligned = scenario('ALIGN_ALL_POSITIVE_COMPONENTS');
    const combined = scenario('ALIGN_PLUS_RISK_SPLIT');

    expect(combined.penaltyAvg).toBeLessThan(aligned.penaltyAvg);
    expect(combined.netScoreAvg).toBeGreaterThan(aligned.netScoreAvg);
  });

  it('providerHealth VERIFIED auto-disables unknownPolicyActive', () => {
    const guard = buildGate1AlignmentProviderGuard({
      providerHealthStatus: 'VERIFIED',
      unknownPolicyActive: true,
    });

    expect(guard.unknownPolicyActive).toBe(false);
    expect(guard.providerVerifiedOverrideWarning).toBe(true);
  });

  it('providerHealth UNKNOWN can keep unknownPolicyActive for dry-run', () => {
    const guard = buildGate1AlignmentProviderGuard({
      providerHealthStatus: 'UNKNOWN',
      unknownPolicyActive: true,
    });

    expect(guard.unknownPolicyActive).toBe(true);
    expect(guard.providerVerifiedOverrideWarning).toBe(false);
  });

  it('executionImpact is always NONE', () => {
    const report = makeReports().alignment;

    expect(report.executionImpact).toBe('NONE');
    expect(report.scenarioResults.every((item) => item.executionImpact === 'NONE')).toBe(true);
    expect(report.matrixRows.every((item) => item.executionImpact === 'NONE')).toBe(true);
  });

  it('liveExecutionAllowed is false', () => {
    const report = makeReports().alignment;

    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.scenarioResults.every((item) => item.liveExecutionAllowed === false)).toBe(true);
  });

  it('policyPromotionMode is SHADOW_ONLY', () => {
    const report = makeReports().alignment;

    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(report.scenarioResults.every((item) => item.policyPromotionMode === 'SHADOW_ONLY')).toBe(true);
  });

  it('requiredScore 70 is unchanged', () => {
    const report = makeReports().alignment;

    expect(report.requiredScore).toBe(70);
    expect(report.scenarioResults.every((item) => item.requiredScore === 70)).toBe(true);
  });

  it('Gate threshold is not directly changed', () => {
    expect(MINIMUM_SIGNAL_SCORE_COMPONENT_CODES_ADR0472).toContain('WATCHLIST_PRIORITY');
    expect(scenario('CURRENT').requiredScore).toBe(70);
  });

  it('KIS order function imports remain absent from the ADR-0472 module', () => {
    const source = readFileSync(new URL('./gate1ScoringAlignmentAdr0472.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('placeKisMarketBuyOrder');
    expect(source).not.toContain('placeKisSellOrder');
    expect(source).not.toContain('placeKisStopLossOrder');
    expect(source).not.toContain('placeKisTakeProfitOrder');
    expect(source).not.toContain('cancelKisOrder');
  });

  it('SectorEnergy DEGRADED/BLOCKED is not force-promoted to OK', () => {
    const source = readFileSync(new URL('./gate1ScoringAlignmentAdr0472.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/SECTOR_ENERGY.*OK/);
    expect(source).not.toContain('sectorEnergyQuality = \'OK\'');
  });

  it('SELL_ONLY remains execution eligibility and does not change alignment signal score', () => {
    const sellOnly = makeReports('SELL_ONLY').alignment;
    const buyAllowed = makeReports('BUY_ALLOWED').alignment;

    expect(sellOnly.scenarioResults[0].netScoreAvg).toBe(buyAllowed.scenarioResults[0].netScoreAvg);
  });

  it('raw payload whole persistence is absent from ADR-0472 module', () => {
    const source = readFileSync(new URL('./gate1ScoringAlignmentAdr0472.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('rawPayload');
    expect(source).not.toContain('JSON.stringify(input)');
  });

  it('ADR-0469/0470/0472 document files exist with required dry-run language', () => {
    const root = process.cwd();
    const docs = [
      'docs/adr/0469-gate1-penalty-deduplication-dry-run.md',
      'docs/adr/0470-gate1-risk-double-count-dry-run.md',
      'docs/adr/0472-gate1-scoring-alignment-and-dry-run-policy-promotion.md',
    ];

    for (const doc of docs) {
      const fullPath = join(root, doc);
      expect(existsSync(fullPath)).toBe(true);
      expect(readFileSync(fullPath, 'utf8')).toContain('Dry-run');
    }
  });

  it('/scan_blockers includes ADR-0472 without removing existing ADR sections', async () => {
    const counters = createScanCounters();
    await persistScanResults(counters, {
      buyListLength: 45,
      intradayBuyListLength: 0,
      swingListLength: 45,
      catalystListLength: 0,
      momentumListLength: 0,
      candidateSnapshots: Array.from({ length: 45 }, (_, index) => ({
        symbol: `${index}`.padStart(6, '0'),
        name: `candidate-${index}`,
        stageReached: 'WATCHLIST',
        gateScore: 21.4,
        minSignalRequiredScore: 70,
        gate1Passed: false,
        supplyConfluenceState: 'UNKNOWN',
        minSignalScorePassed: false,
      })),
      macroGateState: {
        emergencyStop: false,
        autoTradeEnabled: true,
        regime: 'R3_EARLY',
        kellyMultiplierFromRegime: 0.7,
        fomcPhase: 'NONE',
        fomcKellyMultiplier: 1,
        finalKellyMultiplier: 0.26,
        vixGatingActive: false,
        bearDefenseMode: false,
        mhsBelow30: false,
        watchlistEmpty: false,
        sellOnlyMode: true,
      },
    });

    const message = formatScanBlockersMessage(getLastScanSummary());
    expect(message).toContain('Positive Score Starvation Audit (ADR-0467)');
    expect(message).toContain('Penalty Deduplication Audit (ADR-0469)');
    expect(message).toContain('Risk Penalty Double-Count Audit (ADR-0470)');
    expect(message).toContain('Final Gate1 Calibration (ADR-0471)');
    expect(message).toContain('Gate1 Scoring Alignment (ADR-0472)');
    expect(message).toContain('policyPromotionMode: SHADOW_ONLY');
    expect(message).toContain('liveExecutionAllowed: false');
  });

  it('compact formatter exposes the required ADR-0472 operational line', () => {
    const section = formatGate1ScoringAlignmentReport(makeReports().alignment);

    expect(section).toContain('Gate1 Scoring Alignment (ADR-0472)');
    expect(section).toContain('componentSetAligned: false');
    expect(section).toContain('WATCHLIST_UPSTREAM_SCORE');
    expect(section).toContain('BREAKOUT_STRUCTURE');
    expect(section).toContain('nextAction: OBSERVE_3D_THEN_OPERATOR_APPROVAL');
  });
});
