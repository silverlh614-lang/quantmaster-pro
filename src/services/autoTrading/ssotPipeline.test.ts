import { describe, expect, it } from 'vitest';
import {
  buildGate1Diag,
  buildPolicyDiag,
  evaluateCommonGate,
  hashCommonGate,
  hashPolicy,
  resolvePolicy,
  type CandidateSnapshot,
  type FeatureSnapshot,
} from './ssotPipeline';

const candidate: CandidateSnapshot = {
  snapshotId: 'scan_20260521_100000_ab123',
  candidateId: 'c1',
  symbol: '005930',
  name: '삼성전자',
  market: 'KOSPI',
  source: 'quant',
  candidateReason: ['MOMENTUM'],
};

const feature: FeatureSnapshot = {
  snapshotId: candidate.snapshotId,
  symbol: candidate.symbol,
  quoteStatus: 'VERIFIED',
  tradableStatus: 'TRADABLE',
  liquidityStatus: 'PASS',
  technicalIndicators: { status: 'NOT_COMPUTED', source: 'NOT_COMPUTED' },
  ohlcvDaily: { status: 'NOT_FETCHED', rows: 0, requiredCandles: 60 },
};

describe('ssot pipeline separation', () => {
  it('same source produces same common gate across removed policy inputs', () => {
    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature });
    const A = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'REGULAR', displaySession: 'REGULAR', entryBlockMode: 'NORMAL' });
    const B = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'REGULAR', displaySession: 'REGULAR', entryBlockMode: 'R6_DEFENSE_SELL_ONLY' });
    const C = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'SELL_ONLY' });
    const D = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'R6_DEFENSE_SELL_ONLY' });

    const gateHash = hashCommonGate(gate);
    expect(gateHash).toBe(hashCommonGate(gate));
    for (const policy of [A, B, C, D]) {
      expect(policy.liveBuyAllowed).toBe(true);
      expect(policy.realOrderAllowed).toBe(true);
      expect(policy.entryBlockMode).toBe('NORMAL');
      expect(policy.blockReasons).toEqual([]);
      expect(policy.legacyPolicyIgnored).toBe(true);
    }
    expect(new Set([hashPolicy(A), hashPolicy(B), hashPolicy(C), hashPolicy(D)]).size).toBe(4);
  });

  it('Gate1Diag stays gate-only and removed policy inputs are ignored by policy', () => {
    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature });
    const policy = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'R6_DEFENSE_SELL_ONLY' });
    const gateDiag = buildGate1Diag(gate, feature);
    const policyDiag = buildPolicyDiag(policy, 'AFTERMARKET', 'AFTERMARKET_SELL_ONLY');

    expect(JSON.stringify(gateDiag)).not.toContain('LIVE_BLOCKED_ONLY');
    expect(gateDiag.technicalStatus).toBe('NOT_COMPUTED');
    expect(gateDiag.dataIssues).toEqual(expect.arrayContaining(['technicalTrendMissing', 'OHLCV_PROVIDER_NOT_CALLED']));
    expect(policyDiag.policyStatus).toBe('LIVE_ALLOWED');
    expect(policyDiag.entryBlockMode).toBe('NORMAL');
    expect(policyDiag.displaySession).toBe('REGULAR');
    expect(policyDiag.blockReasons).toEqual([]);
    expect(policyDiag.legacyPolicyInputs).toEqual(expect.arrayContaining([
      'AFTERMARKET_SELL_ONLY_REMOVED',
      'R6_DEFENSE_SELL_ONLY_REMOVED',
    ]));
  });

  it('blocks only on common gate quality failure', () => {
    const badFeature: FeatureSnapshot = {
      ...feature,
      quoteStatus: 'MISSING',
    };
    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature: badFeature });
    const policy = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'SELL_ONLY' });

    expect(policy.liveBuyAllowed).toBe(false);
    expect(policy.realOrderAllowed).toBe(false);
    expect(policy.entryBlockMode).toBe('NORMAL');
    expect(policy.blockReasons).toEqual(['COMMON_GATE_QUALITY_FAIL']);
    expect(policy.blockReasons.join(',')).not.toMatch(/SELL_ONLY|R6_DEFENSE|AFTERMARKET_BUY_BLOCKED/);
    expect(policy.legacyPolicyInputs).toEqual(expect.arrayContaining([
      'AFTERMARKET_SELL_ONLY_REMOVED',
      'SELL_ONLY_REMOVED',
    ]));
  });

  it('Gate1Diag never reports clean data when technical source is missing', () => {
    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature });
    const gateDiag = buildGate1Diag(gate, feature);

    expect(gateDiag.technicalStatus).not.toBe('COMPUTED');
    expect(gateDiag.dataIssues.length).toBeGreaterThan(0);
    expect(gate.gate2Result).toBe('DATA_INCOMPLETE');
    expect(gate.reasons).toEqual(expect.arrayContaining(['OHLCV_PROVIDER_NOT_CALLED']));
  });

  it('computed technical snapshot yields clean diagnostic view', () => {
    const goodFeature: FeatureSnapshot = {
      ...feature,
      technicalIndicators: {
        status: 'COMPUTED',
        source: 'COMPUTED_FROM_KIS_OHLCV',
        technicalTrend: 'BULLISH',
        rowsComputed: 44,
        requiredCandles: 60,
      },
      ohlcvDaily: {
        status: 'VERIFIED',
        rows: 60,
        requiredCandles: 60,
        apiPath: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
        trId: 'FHKST03010100',
        outputShape: 'output1_output2',
      },
    };

    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature: goodFeature });
    const gateDiag = buildGate1Diag(gate, goodFeature);

    expect(gate.gate2Result).toBe('PASS');
    expect(gate.gate3Result).toBe('PASS');
    expect(gateDiag.technicalStatus).toBe('COMPUTED');
    expect(gateDiag.dataIssues).toEqual([]);
  });
});
