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

  it('R6/SELL_ONLY 제거됨 — 모든 entryBlockMode 가 NORMAL 과 동일하게 처리됨', () => {
    const { snapshot, candidate, feature } = fixture();
    const a = buildDecisionContext(snapshot, candidate, feature, 'REGULAR', 'R6_DEFENSE_SELL_ONLY');
    const b = buildDecisionContext(snapshot, candidate, feature, 'AFTERMARKET', 'R6_DEFENSE_SELL_ONLY');
    const c = buildDecisionContext(snapshot, candidate, feature, 'REGULAR', 'NORMAL');

    expect(JSON.stringify(a.gateResult)).toBe(JSON.stringify(b.gateResult));
    expect(JSON.stringify(b.gateResult)).toBe(JSON.stringify(c.gateResult));
    expect(a.policyResult.liveBuyAllowed).toBe(true);
    expect(b.policyResult.liveBuyAllowed).toBe(true);
    expect(c.policyResult.liveBuyAllowed).toBe(true);
    expect(a.policyResult.gateEvaluationAllowed).toBe(true);
    expect(a.policyResult.shadowEvaluationAllowed).toBe(true);
    expect(a.policyResult.counterfactualAllowed).toBe(true);
    // R6/SELL_ONLY 제거됨 → liveBlockReason=NONE, live order permitted
    expect(a.policyResult.liveBlockReason).toBe('NONE');
    expect(a.policyResult.entryBlockMode).toBe('NORMAL');
    expect(b.policyResult.entryBlockMode).toBe('NORMAL');
    expect(a.policyResult.blockReasons).toEqual([]);
    expect(b.policyResult.blockReasons).toEqual([]);
    expect(a.policyResult.legacyPolicyIgnored).toBe(true);
    // legacyPolicyInputs 항상 빈 배열 (R6/SELL_ONLY 완전 제거)
    expect(a.policyResult.legacyPolicyInputs).toEqual([]);
    expect(b.policyResult.legacyPolicyInputs).toEqual([]);
    expect(a.executionResult.executionImpact).toBe('LIVE_ORDER_ALLOWED');
    expect(c.executionResult.executionImpact).toBe('LIVE_ORDER_ALLOWED');
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
        gateEvaluationAllowed: true,
        diagnosticGateEvaluationAllowed: true,
        shadowEvaluationAllowed: true,
        shadowOrderAllowed: true,
        paperFillAllowed: true,
        liveOrderAllowed: true,
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
        confidenceAdjustments: [],
        policyLabels: ['SOURCE_SNAPSHOT_SSOT_CONFIRMED'],
        learningLabels: ['SHADOW_LEARNING_ALWAYS_ON', 'COUNTERFACTUAL_ALWAYS_ON'],
        scorePenalty: 0,
        sizingMultiplier: 1,
        providerIssueIsolated: false,
        marketSignal: false,
        executionPermissionLogTags: ['[SOURCE_SNAPSHOT_SSOT_CONFIRMED]'],
        policyStatus: 'LIVE_ALLOWED',
      },
      telegramSnapshotId: 'third',
      feature: { ...feature, technicalIndicators: { status: 'COMPUTED', source: 'COMPUTED_FROM_KIS_OHLCV' } },
    });
    expect(alerts).toEqual(expect.arrayContaining(['SNAPSHOT_MISMATCH_GATE_POLICY', 'SNAPSHOT_MISMATCH_GATE_TELEGRAM', 'FEATURE_SNAPSHOT_PRESENT_BUT_GATE_MAPPING_DROPPED']));
  });
});
