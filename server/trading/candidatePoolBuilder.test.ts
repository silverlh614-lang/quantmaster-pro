import { describe, expect, it, vi } from 'vitest';
import { buildCandidatePool, formatCandidatePoolSection } from './candidatePoolBuilder.js';
import type { CandidatePoolInputCandidate } from './candidatePoolBuilder.js';

function makeCandidate(index: number, patch: Partial<CandidatePoolInputCandidate> = {}): CandidatePoolInputCandidate {
  const symbol = `${index}`.padStart(6, '0');
  return {
    symbol,
    name: `Candidate ${index}`,
    market: 'KRX',
    sector: index % 2 === 0 ? 'SEMICONDUCTOR' : 'AUTOMOTIVE',
    sourceTags: ['WATCHLIST'],
    price: 10_000 + index,
    volume: 100_000 + index * 1000,
    turnover: 1_000_000_000 + index * 1_000_000,
    relativeStrengthScore: 8 + (index % 5),
    breakoutScore: 5 + (index % 3),
    return5d: 2 + index / 10,
    return20d: 5 + index / 5,
    volumeRatio: 1.5,
    supplyScore: 4,
    sectorLeadershipScore: 3,
    ...patch,
  };
}

describe('CandidatePoolBuilder', () => {
  it('builds a broad ranked candidate pool with at least 30 valid snapshots', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:normal',
      existingWatchlist: Array.from({ length: 35 }, (_, i) => makeCandidate(i + 1)),
      liveOrderAllowed: false,
      emitLogs: false,
    });

    expect(result.validCount).toBe(35);
    expect(result.rankedCandidates).toBe(35);
    expect(result.gateEvaluated).toBe(35);
    expect(result.shadowEligible).toBe(35);
    expect(result.counterfactualRecorded).toBe(35);
    expect(result.candidateSnapshots[0].rank).toBe(1);
    expect(result.diagnostics.logTags).toContain('[CANDIDATE_POOL_BUILT]');
    expect(result.diagnostics.logTags).toContain('[LIVE_PERMISSION_SEPARATED_FROM_CANDIDATE_EVALUATION]');
  });

  it('keeps candidates during SELL_ONLY, R6, Kelly zero, and provider issue states', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:p0-states',
      existingWatchlist: [makeCandidate(1, { providerIssue: true })],
      runtimeLabels: {
        sellOnly: true,
        r6Defense: true,
        kellyZero: true,
        providerIssue: true,
        staleData: true,
      },
      liveOrderAllowed: false,
      emitLogs: false,
    });

    const candidate = result.candidateSnapshots[0];
    expect(result.validCount).toBe(1);
    expect(candidate.evaluationEligible).toBe(true);
    expect(candidate.shadowEligible).toBe(true);
    expect(candidate.counterfactualEligible).toBe(true);
    expect(candidate.liveOrderEligible).toBe(false);
    expect(candidate.learningLabels).toEqual(expect.arrayContaining([
      'SELL_ONLY_EVALUATION_CONTINUED',
      'R6_PENALTY_ONLY',
      'KELLY_ADVISORY_ONLY',
      'PROVIDER_ISSUE_ISOLATED',
    ]));
    expect(candidate.missingFeatures).toContain('PROVIDER_ISSUE_ISOLATED');
    expect(candidate.diagnosticReason).toContain('PROVIDER_ISSUE_MARKET_SIGNAL_FALSE');
  });

  it('scores missing RS and breakout features instead of removing the candidate', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:missing-features',
      existingWatchlist: [
        makeCandidate(1, {
          relativeStrengthScore: null,
          rsRankPct: null,
          breakoutScore: null,
        }),
      ],
      emitLogs: false,
    });

    const candidate = result.candidateSnapshots[0];
    expect(result.validCount).toBe(1);
    expect(candidate.missingFeatures).toEqual(expect.arrayContaining([
      'RS_SCORE_MISSING',
      'BREAKOUT_SCORE_MISSING',
    ]));
    expect(candidate.featureScores.relativeStrengthScore).toBe(0);
    expect(candidate.featureScores.breakoutScore).toBe(0);
    expect(candidate.penalties.missingFeaturePenalty).toBeGreaterThan(0);
  });

  it('uses fallback candidates when watchlist import and Gate entry candidates are zero', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:fallback',
      existingWatchlist: [],
      fallbackBroadUniverse: [makeCandidate(1), makeCandidate(2)],
      zeroSurvivorSignals: {
        gateEntryCandidates: 0,
        watchlistImported: 0,
        rsScoreUsable: 0,
        breakoutScoreUsable: 0,
      },
      emitLogs: false,
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.validCount).toBe(2);
    expect(result.diagnostics.fallbackTriggerReasons).toEqual(expect.arrayContaining([
      'VALID_COUNT_ZERO',
      'HYDRATED_COUNT_ZERO',
      'GATE_ENTRY_CANDIDATES_ZERO',
      'WATCHLIST_IMPORTED_ZERO',
      'RS_AND_BREAKOUT_UNUSABLE',
    ]));
    expect(result.diagnostics.logTags).toContain('[CANDIDATE_FALLBACK_USED]');
    expect(result.diagnostics.logTags).toContain('[ZERO_SURVIVOR_PREVENTED]');
    expect(result.candidateSnapshots.every((candidate) => candidate.learningLabels.includes('FALLBACK_CANDIDATE'))).toBe(true);
  });

  it('merges duplicate symbols and preserves source tags', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:duplicate',
      existingWatchlist: [makeCandidate(1, { symbol: '005930', sourceTags: ['WATCHLIST'] })],
      sectorLeaders: [makeCandidate(2, { symbol: '005930', sourceTags: ['SECTOR_LEADER'], sectorLeadershipScore: 8 })],
      volumeSpikeCandidates: [makeCandidate(3, { symbol: '005930', sourceTags: ['VOLUME_SPIKE'], volumeRatio: 4 })],
      emitLogs: false,
    });

    expect(result.validCount).toBe(1);
    expect(result.diagnostics.duplicateMergedCount).toBe(2);
    expect(result.diagnostics.logTags).toContain('[CANDIDATE_SOURCE_TAGS_MERGED]');
    expect(result.candidateSnapshots[0].sourceTags).toEqual(expect.arrayContaining([
      'WATCHLIST',
      'SECTOR_LEADER',
      'VOLUME_SPIKE',
    ]));
  });

  it('records counterfactual diagnostics for every retained candidate', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:counterfactual',
      existingWatchlist: [makeCandidate(1), makeCandidate(2, { breakoutScore: null })],
      liveOrderAllowed: false,
      emitLogs: false,
    });

    expect(result.counterfactualRecorded).toBe(result.validCount);
    expect(result.diagnostics.counterfactualRecords).toHaveLength(result.validCount);
    expect(result.diagnostics.counterfactualRecords[0]).toMatchObject({
      sourceSnapshotId: 'snapshot:counterfactual',
      outcomePending: true,
      gateResult: {
        diagnosticPass: true,
        shadowPass: true,
        livePass: false,
        liveOrderAllowed: false,
      },
    });
    expect(result.diagnostics.logTags).toContain('[COUNTERFACTUAL_CANDIDATE_RECORDED]');
  });

  it('formats scan_blockers candidate pool diagnostics', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:format',
      existingWatchlist: [makeCandidate(1, { breakoutScore: null })],
      emitLogs: false,
    });
    const text = formatCandidatePoolSection(result);

    expect(text).toContain('[Candidate Pool Runtime]');
    expect(text).toContain('Candidate evaluation active');
    expect(text).toContain('Live order permission separated');
    expect(text).toContain('Counterfactual recording ON');
    expect(text).toContain('Missing features scored as confidence penalty');
  });

  it('separates actual missing, promotion gap, and condition-zero coverage evidence', () => {
    const result = buildCandidatePool({
      sourceSnapshotId: 'snapshot:coverage',
      existingWatchlist: Array.from({ length: 43 }, (_, i) => makeCandidate(i + 1, {
        relativeStrengthScore: null,
        breakoutScore: null,
        supplyScore: null,
        sectorLeadershipScore: null,
      })),
      emitLogs: false,
      featureCoverage: {
        totalCandidates: 43,
        rs: {
          rawComputed: 34,
          traceAvailable: 39,
          gateApplied: 34,
          scoreUsable: 11,
          selectedBasisForActualMissing: 'traceAvailableFromForensic',
          selectedBasisForPromotionGap: 'scoreUsableFromForensic',
        },
        breakout: {
          mapped: 39,
          traceAvailableRuntime: 39,
          traceAvailableAlignment: 43,
          runtimeScoreComputed: 20,
          scoreMappedToGateRuntime: 39,
          scoreMappedToGateAlignment: 43,
          zeroByCondition: 23,
          selectedBasisForActualMissing: 'alignment.traceAvailable',
          selectedBasisForPromotionGap: 'alignment.scoreMappedToGate',
        },
        supply: {
          injected: 43,
          verified: 43,
          symbolMatched: 39,
          semanticAvailable: 27,
          gateEligibleRows: 27,
          shadowOnlyRows: 16,
        },
        sectorLeadership: {
          officialIndexCoverage: 0,
          verifiedIndexCodeCoverage: 0,
          internalGroupedSnapshotCoverage: 100,
          internalGroupedValidSectorCount: 12,
          internalGroupedExpectedSectorCount: 12,
          internalProxyCoverage: 100,
          stockDailyFallbackCoverage: 0,
          selectedSourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
          leadershipConfidence: 'SHADOW_ONLY',
          promotionAllowed: false,
          sectorBoostAllowed: false,
          strongBuyAllowed: false,
          shadowLeadershipAllowed: true,
          counterfactualAllowed: true,
        },
        volumeEnergy: {
          rawVolumeFieldAvailable: true,
          rawVolumeFieldKeys: ['acml_vol'],
          volumeEnergyPromoted: false,
        },
      },
    });

    const text = formatCandidatePoolSection(result);

    expect(text).toContain('rsRawInputMissing=4/43');
    expect(text).toContain('breakoutRawTraceMissing=0/43');
    expect(text).toContain('supplyInjectedMissing=0/43');
    expect(text).toContain('supplySemanticMissing=16/43');
    expect(text).toContain('volumeEnergyRawMissing=false(rawVolumeExists:acml_vol)');
    expect(text).not.toContain('rsRawInputMissing=43/43');
    expect(text).not.toContain('breakoutRawTraceMissing=43/43');
    expect(text).not.toContain('supplySemanticMissing=43/43');
    expect(text).toContain('RS rawComputed=34/43 traceAvailable=39/43 gateApplied=34/43 scoreUsable=11/43');
    expect(text).toContain('BREAKOUT mapped=39/43 traceAvailableRuntime=39/43 traceAvailableAlignment=43/43');
    expect(text).toContain('zeroByCondition=23/43');
    expect(text).toContain('SECTOR_LEADERSHIP sourceOfTruth=SectorEnergyCanonicalResolver');
    expect(text).toContain('officialSectorCount=11');
    expect(text).toContain('promotionCoverage=0.0%');
    expect(text).toContain('promotionAllowed=false');
    expect(text).toContain('sectorBoostAllowed=false');
    expect(text).toContain('strongBuyAllowed=false');
    expect(text).toContain('selectedSourceTier=NONE');
    expect(text).toContain('dataQuality=MISSING');
    expect(text).toContain('reason=SECTOR_ENERGY_CANONICAL_STATE_MISSING');
    expect(text).toContain('diagnostic.oldOfficialIndexCoverage=0.0%');
    expect(text).toContain('diagnostic.internalGroupedSnapshotCoverage=100.0%');
    expect(text).toContain('diagnostic.internalGroupedValidSectorCount=12/12');
    expect(text).toContain('diagnostic.kisBasketDerivedStatus=DIAGNOSTIC_ONLY');
    expect(text).toContain('RS_SCORE_NOT_PROMOTED=32/43(basis=scoreUsableFromForensic)');
    expect(text).toContain('BREAKOUT_SCORE_NOT_PROMOTED=0/43(basis=alignment.scoreMappedToGate)');
  });

  it('emits Railway verification tags once per build', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      buildCandidatePool({
        sourceSnapshotId: 'snapshot:logs',
        existingWatchlist: [makeCandidate(1)],
      });
      const output = info.mock.calls.map((call) => String(call[0])).join('\n');
      expect(output).toContain('[CANDIDATE_POOL_BUILT]');
      expect(output).toContain('[CANDIDATE_MINIMAL_VALIDITY_FILTER_APPLIED]');
      expect(output).toContain('[CANDIDATE_SNAPSHOT_CREATED]');
      expect(output).toContain('[CANDIDATE_FEATURE_MISSING_SCORED]');
      expect(output).toContain('[CANDIDATE_RANKING_COMPLETED]');
      expect(output).toContain('[GATE_EVALUATION_CONTINUED_FOR_CANDIDATES]');
      expect(output).toContain('[WATCHLIST_COUNTERFACTUAL_RECORDED]');
      expect(output).toContain('[COUNTERFACTUAL_CANDIDATE_RECORDED]');
      expect(output).toContain('[LIVE_PERMISSION_SEPARATED_FROM_CANDIDATE_EVALUATION]');
    } finally {
      info.mockRestore();
    }
  });
});
