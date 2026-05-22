import { describe, it, expect } from 'vitest';
import { buildUnifiedMarketSnapshot, classifyTechnicalTrendMissing } from './ssotSnapshot.js';
import { buildDecisionContext, detectSnapshotMismatch, evaluateCommonGate } from './ssotDecisionPipeline.js';

const asOf = new Date('2026-05-21T01:00:00.000Z');

function fixture() {
  const snapshot = buildUnifiedMarketSnapshot({
    asOf,
    marketSession: 'REGULAR',
    candidates: [{ snapshotId: 'x', candidateId: 'c1', symbol: '005930', name: '삼성전자', market: 'KRX', source: 'watchlist', importedAt: asOf.toISOString(), watchlistSource: 'default', candidateReason: 'seed', rawCandidateData: {} }],
    featuresBySymbol: {
      '005930': {
        snapshotId: 'x', symbol: '005930', quote: { price: 70000 }, ohlcvDaily: null,
        technicalIndicators: { status: 'NOT_COMPUTED', source: 'NOT_COMPUTED' },
        supplyContext: {}, sectorContext: {}, financialContext: {}, macroContext: {}, riskContext: {}, dataConfidenceMap: {}, featureSourceMap: {},
      },
    },
    providerHealth: { quote: 'VERIFIED', ohlcv: 'NOT_FETCHED' },
  });
  const candidate = snapshot.candidates[0];
  const feature = snapshot.featuresBySymbol['005930'];
  return { snapshot, candidate, feature };
}

describe('SSOT snapshot pipeline', () => {
  it('uses one snapshotId across candidates/features and decision layers', () => {
    const { snapshot, candidate, feature } = fixture();
    const decision = buildDecisionContext(snapshot, candidate, feature, 'REGULAR', 'NORMAL');
    expect(candidate.snapshotId).toBe(snapshot.snapshotId);
    expect(feature.snapshotId).toBe(snapshot.snapshotId);
    expect(decision.gateResult.snapshotId).toBe(snapshot.snapshotId);
    expect(decision.policyResult.snapshotId).toBe(snapshot.snapshotId);
    expect(decision.executionResult.snapshotId).toBe(snapshot.snapshotId);
  });

  it('ignores removed R6/SELL_ONLY execution blocks while keeping gate and execution stable', () => {
    const { snapshot, candidate, feature } = fixture();
    const a = buildDecisionContext(snapshot, candidate, feature, 'REGULAR', 'R6_DEFENSE_SELL_ONLY');
    const b = buildDecisionContext(snapshot, candidate, feature, 'AFTERMARKET', 'R6_DEFENSE_SELL_ONLY');
    const c = buildDecisionContext(snapshot, candidate, feature, 'REGULAR', 'NORMAL');

    expect(JSON.stringify(a.gateResult)).toBe(JSON.stringify(b.gateResult));
    expect(JSON.stringify(b.gateResult)).toBe(JSON.stringify(c.gateResult));
    expect(a.policyResult.liveBuyAllowed).toBe(true);
    expect(b.policyResult.liveBuyAllowed).toBe(true);
    expect(c.policyResult.liveBuyAllowed).toBe(true);
    expect(a.policyResult.entryBlockMode).toBe('NORMAL');
    expect(b.policyResult.entryBlockMode).toBe('NORMAL');
    expect(a.policyResult.blockReasons).toEqual([]);
    expect(b.policyResult.blockReasons).toEqual([]);
    expect(a.policyResult.legacyPolicyIgnored).toBe(true);
    expect(a.policyResult.legacyPolicyInputs).toContain('R6_DEFENSE_SELL_ONLY_REMOVED');
    expect(b.policyResult.legacyPolicyInputs).toEqual(expect.arrayContaining([
      'R6_DEFENSE_SELL_ONLY_REMOVED',
    ]));
    expect(JSON.stringify(a.executionResult)).toBe(JSON.stringify(c.executionResult));
    expect(a.learningResult.shadowLearning).toBe(true);
    expect(c.learningResult.shadowLearning).toBe(true);
  });

  it('classifies technicalTrendMissing from feature snapshot state', () => {
    const { feature } = fixture();
    expect(classifyTechnicalTrendMissing(feature)).toBe('KIS_QUOTE_VERIFIED_BUT_OHLCV_NOT_FETCHED');
  });

  it('detects snapshot mismatch forensic alerts', () => {
    const { snapshot, candidate, feature } = fixture();
    const gate = evaluateCommonGate({ snapshotId: snapshot.snapshotId, candidate, feature: { ...feature, technicalIndicators: { status: 'COMPUTED', source: 'COMPUTED_FROM_KIS_OHLCV' } } });
    const alerts = detectSnapshotMismatch({
      gateResult: { ...gate, technicalTrendMissing: true },
      policyResult: {
        snapshotId: 'other',
        marketSession: 'REGULAR',
        liveBuyAllowed: true,
        realOrderAllowed: true,
        gatePolicyLiveAllowed: true,
        macroLiveAllowed: true,
        engineMode: 'LIVE',
        brokerOrderAllowed: true,
        operatorOrderAllowed: true,
        actualLiveOrderAllowed: true,
        liveBlockReason: 'NONE',
        shadowAllowed: true,
        shadowLearningAllowed: true,
        shadowSignalAllowed: true,
        diagnosticAllowed: true,
        counterfactualAllowed: true,
        entryBlockMode: 'NORMAL',
        blockReasons: [],
        legacyPolicyInputs: [],
        legacyPolicyIgnored: true,
        legacyIgnoredReasons: [],
        policyStatus: 'LIVE_ALLOWED',
      },
      telegramSnapshotId: 'third',
      feature: { ...feature, technicalIndicators: { status: 'COMPUTED', source: 'COMPUTED_FROM_KIS_OHLCV' } },
    });
    expect(alerts).toEqual(expect.arrayContaining(['SNAPSHOT_MISMATCH_GATE_POLICY', 'SNAPSHOT_MISMATCH_GATE_TELEGRAM', 'FEATURE_COMPUTED_BUT_GATE_MAPPING_DROPPED']));
  });
});
