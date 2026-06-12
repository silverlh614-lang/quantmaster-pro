// @responsibility ADR-0475 Gate1 positive source wiring dry-run tests
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPositiveScoreStarvationFallbackReport } from './gate1PositiveScoreStarvation.js';
import { buildPenaltyDeduplicationReport } from './gate1PenaltyDeduplication.js';
import { buildRiskDoubleCountAuditReport } from './gate1RiskDoubleCount.js';
import { buildGate1ScoreCeilingRepairReport } from './gate1ScoreCeilingRepair.js';
import {
  buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore,
  buildGate1PositiveSourceWiringReport,
  decomposeOtherPositive,
  formatGate1PositiveSourceWiringReport,
  resolveBreakoutStructureSource,
  resolveRelativeStrengthSource,
  resolveWatchlistUpstreamScore,
} from './gate1PositiveSourceWiringAdr0475.js';
import {
  createScanCounters,
  formatScanBlockersMessage,
  getLastScanSummary,
  persistScanResults,
} from './scanDiagnostics.js';

function moduleSource(): string {
  return readFileSync(new URL('./gate1PositiveSourceWiringAdr0475.ts', import.meta.url), 'utf8');
}

function scanDiagnosticsSource(): string {
  return readFileSync(new URL('./scanDiagnostics.ts', import.meta.url), 'utf8');
}

function positiveReport() {
  const report = buildPositiveScoreStarvationFallbackReport({
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    minSignalScoreReport: {
      timestamp: '2026-05-09T00:00:00.000Z',
      forDate: '2026-05-09',
      regime: 'R3_EARLY',
      marketSession: 'SELL_ONLY',
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
  if (!report) throw new Error('expected report');
  return report;
}

function buildReport() {
  const positive = positiveReport();
  const repair = buildGate1ScoreCeilingRepairReport({
    positiveStarvationReport: positive,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
  });
  const dedup = buildPenaltyDeduplicationReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    riskMultiplier: 0.26,
  });
  const risk = buildRiskDoubleCountAuditReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
    regimeMultiplier: 0.7,
    fomcMultiplier: 1,
    sectorMultiplier: 1,
    finalRiskMultiplier: 0.38,
    combinedKellyMultiplier: 0.26,
  });
  const report = buildGate1PositiveSourceWiringReport({
    positiveStarvationReport: positive,
    scoreCeilingRepairReport: repair,
    penaltyDeduplicationReport: dedup,
    riskDoubleCountReport: risk,
    timestamp: '2026-05-09T00:00:00.000Z',
    forDate: '2026-05-09',
    regime: 'R3_EARLY',
    marketSession: 'SELL_ONLY',
  });
  if (!report) throw new Error('expected ADR-0475 report');
  return report;
}

describe('ADR-0475 Gate1 Positive Source Wiring', () => {
  it('stage2Score maps to WATCHLIST_UPSTREAM_SCORE via STAGE2_SCORE', () => {
    const trace = resolveWatchlistUpstreamScore({ symbol: '005930', stage2Score: 80 });
    expect(trace.source).toBe('STAGE2_SCORE');
    expect(trace.importedScore).toBe(12);
  });

  it('watchlistScore maps to WATCHLIST_SCORE source', () => {
    const trace = resolveWatchlistUpstreamScore({ symbol: '005930', watchlistScore: 60 });
    expect(trace.source).toBe('WATCHLIST_SCORE');
    expect(trace.importedScore).toBe(9);
  });

  it('watchlistRank maps to WATCHLIST_RANK source', () => {
    const trace = resolveWatchlistUpstreamScore({ symbol: '005930', watchlistRank: 3, totalCandidates: 20 });
    expect(trace.source).toBe('WATCHLIST_RANK');
    expect(trace.importedScore).toBeGreaterThan(0);
  });

  it('watchlistReason maps to WATCHLIST_REASON_PROXY source', () => {
    const trace = resolveWatchlistUpstreamScore({ symbol: '005930', watchlistReason: ['momentum breakout'] });
    expect(trace.source).toBe('WATCHLIST_REASON_PROXY');
    expect(trace.status).toBe('PROXY');
  });

  it('missing watchlist source records zeroReason', () => {
    const trace = resolveWatchlistUpstreamScore({ symbol: '005930' });
    expect(trace.importedScore).toBe(0);
    expect(trace.zeroReason).toContain('WATCHLIST_SCORE_MISSING');
  });

  it('price history computes RELATIVE_STRENGTH from PRICE_HISTORY', () => {
    const trace = resolveRelativeStrengthSource({
      symbol: '005930',
      stockReturn20d: 12,
      stockReturn60d: 18,
      benchmarkReturn20d: 1,
      benchmarkReturn60d: 5,
    });
    expect(trace.source).toBe('PRICE_HISTORY');
    expect(trace.normalizedRSScore).toBeGreaterThan(10);
  });

  it('sector return fallback computes SECTOR_RELATIVE_RETURN', () => {
    const trace = resolveRelativeStrengthSource({
      symbol: '005930',
      stockReturn20d: 8,
      sectorReturn20d: 2,
    });
    expect(trace.source).toBe('SECTOR_RELATIVE_RETURN');
    expect(trace.status).toBe('DEGRADED');
  });

  it('proxy-only relative strength is PROXY', () => {
    const trace = resolveRelativeStrengthSource({
      symbol: '005930',
      watchlistReason: ['주도주 강세'],
    });
    expect(trace.source).toBe('WATCHLIST_PROXY');
    expect(trace.status).toBe('PROXY');
  });

  it('OHLCV computes BREAKOUT_STRUCTURE from OHLCV', () => {
    const trace = resolveBreakoutStructureSource({
      symbol: '005930',
      currentPrice: 100,
      high20: 101,
      high60: 98,
      volumeRatio: 1.4,
      aboveMA20: true,
      aboveMA60: true,
      vcpDetected: true,
    });
    expect(trace.source).toBe('OHLCV');
    expect(trace.normalizedBreakoutScore).toBeGreaterThan(5);
  });

  it('watchlist breakout reason computes BREAKOUT_STRUCTURE proxy', () => {
    const trace = resolveBreakoutStructureSource({
      symbol: '005930',
      watchlistReason: ['VCP breakout'],
    });
    expect(trace.source).toBe('WATCHLIST_REASON_PROXY');
    expect(trace.normalizedBreakoutScore).toBe(5);
  });

  it('unavailable breakout source records zero score', () => {
    const trace = resolveBreakoutStructureSource({ symbol: '005930' });
    expect(trace.normalizedBreakoutScore).toBe(0);
    expect(trace.zeroReason).toContain('UNAVAILABLE');
  });

  it('OTHER_POSITIVE decomposition reduces remainingOtherPositive', () => {
    const trace = decomposeOtherPositive({ symbol: '005930', otherPositiveRaw: 50 });
    expect(trace.remainingOtherPositive).toBeLessThan(trace.otherPositiveRaw);
    expect(trace.decompositionCoveragePct).toBeGreaterThan(70);
  });

  it('unresolved OTHER_POSITIVE above 30 percent creates warning', () => {
    const trace = decomposeOtherPositive({ symbol: '005930', otherPositiveRaw: 50, watchlistPriorityScore: 0 });
    expect(trace.warningIfRemainingTooHigh).toBe(true);
  });

  it('WIRE_ALL_POSITIVE_SOURCES increases positiveScoreAvg', () => {
    const report = buildReport();
    const current = report.dryRunScenarios.find((item) => item.scenario === 'CURRENT');
    const wired = report.dryRunScenarios.find((item) => item.scenario === 'WIRE_ALL_POSITIVE_SOURCES');
    expect(wired?.positiveScoreAvg).toBeGreaterThan(current?.positiveScoreAvg ?? 0);
  });

  it('scoreRange expands beyond 4.0', () => {
    const report = buildReport();
    expect(report.beforeScoreRange).toBe(4);
    expect(report.afterDryRunScoreRange).toBeGreaterThan(4);
  });

  it('dry-run invariants stay NONE, false, SHADOW_ONLY, and requiredScore 70', () => {
    const report = buildReport();
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(report.dryRunScenarios.every((item) => item.executionImpact === 'NONE')).toBe(true);
    expect(report.dryRunScenarios.every((item) => item.liveExecutionAllowed === false)).toBe(true);
    expect(report.dryRunScenarios.every((item) => item.policyPromotionMode === 'SHADOW_ONLY')).toBe(true);
    expect(report.dryRunScenarios.every((item) => item.requiredScore === 70)).toBe(true);
  });

  it('EntryDecisionLedger includes positiveSourceWiringSummary', () => {
    const summary = buildEntryDecisionLedgerPositiveSourceWiringSummaryFromScore({
      watchlistUpstreamScore: 5,
      relativeStrengthScore: 7,
      breakoutStructureScore: 4,
      beforeScoreRange: 4,
      afterScoreRange: 9,
      otherPositiveRaw: 50,
      remainingOtherPositive: 5,
    });
    expect(summary.tags).toContain('CASE_GATE1_POSITIVE_SOURCE_WIRING_DRY_RUN');
    expect(summary.tags).toContain('CASE_SCORE_RANGE_EXPANDED');
    expect(summary.executionImpact).toBe('NONE');
  });

  it('/scan_blockers outputs ADR-0475 section without raw Telegram HTML tags', async () => {
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
    const adr0475Start = message.indexOf('Gate1 Positive Source Wiring (ADR-0475)');
    const adr0475End = message.indexOf('\n\n', adr0475Start);
    const adr0475Section = message.slice(adr0475Start, adr0475End === -1 ? undefined : adr0475End);
    expect(message).toContain('Gate1 Positive Source Wiring (ADR-0475)');
    expect(message).toContain('liveExecutionAllowed: false');
    expect(adr0475Section).not.toMatch(/<b>|<i>|<code>/);
  });

  it('static guards: no live order, external API, threshold, raw payload, or override path', () => {
    const source = moduleSource();
    expect(source).not.toContain('placeKisMarketBuyOrder');
    expect(source).not.toContain('placeKisSellOrder');
    expect(source).not.toContain('placeKisStopLossOrder');
    expect(source).not.toContain('placeKisTakeProfitOrder');
    expect(source).not.toContain('cancelKisOrder');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('axios');
    expect(source).not.toContain('setGateThreshold');
    expect(source).not.toContain('GATE_RELAX');
    expect(source).not.toContain('STRONG_BUY_OVERRIDE');
    expect(source).not.toContain('requiredScore = 60');
    expect(source).not.toContain('requiredScore = 65');
    expect(source).not.toContain('liveExecutionAllowed: true');
    expect(source).not.toContain("executionImpact: 'HARD_BLOCK'");
    expect(source).not.toContain('rawPayload');
    expect(source).not.toContain('JSON.stringify(input)');
    expect(source).not.toContain('promoteToOk');
    expect(source).not.toContain('forceOk');
  });

  it('scanDiagnostics wires ADR-0475 report without changing Gate threshold', () => {
    const source = scanDiagnosticsSource();
    expect(source).toContain('buildGate1PositiveSourceWiringReport');
    expect(source).toContain('formatGate1PositiveSourceWiringReport');
    expect(source).toContain('[ADR-0475]');
    expect(source).not.toContain('setGateThreshold');
  });

  it('ADR-0475 document exists and ADR index has advanced beyond 0475', () => {
    const root = process.cwd();
    const doc = join(root, 'docs/adr/0475-gate1-positive-source-wiring.md');
    const index = readFileSync(join(root, 'docs/adr/INDEX.md'), 'utf8');
    expect(existsSync(doc)).toBe(true);
    expect(readFileSync(doc, 'utf8')).toContain('Dry-run');
    expect(index).toMatch(/다음 ADR 번호: `0[5-9]\d{2}`/);
  });
});
