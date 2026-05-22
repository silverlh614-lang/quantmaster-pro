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
};

describe('ssot pipeline separation', () => {
  it('same source produces same common gate across policy cases', () => {
    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature });
    const A = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'REGULAR', displaySession: 'REGULAR', entryBlockMode: 'NORMAL' });
    const B = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'REGULAR', displaySession: 'REGULAR', entryBlockMode: 'R6_DEFENSE_SELL_ONLY' });
    const C = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'SELL_ONLY' });
    const D = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'R6_DEFENSE_SELL_ONLY' });

    const gateHash = hashCommonGate(gate);
    expect(gateHash).toBe(hashCommonGate(gate));
    expect(new Set([hashPolicy(A), hashPolicy(B), hashPolicy(C), hashPolicy(D)]).size).toBe(4);
  });

  it('Gate1Diag stays gate-only and legacy R6/SELL_ONLY is ignored by policy rollback', () => {
    const gate = evaluateCommonGate({ snapshotId: candidate.snapshotId, candidate, feature });
    const policy = resolvePolicy({ snapshotId: candidate.snapshotId, commonGateResult: gate, marketSession: 'AFTERMARKET', displaySession: 'AFTERMARKET_SELL_ONLY', entryBlockMode: 'R6_DEFENSE_SELL_ONLY' });
    const gateDiag = buildGate1Diag(gate, feature);
    const policyDiag = buildPolicyDiag(policy, 'AFTERMARKET', 'AFTERMARKET_SELL_ONLY');

    expect(JSON.stringify(gateDiag)).not.toContain('LIVE_BLOCKED_ONLY');
    expect(policyDiag.policyStatus).toBe('LIVE_ALLOWED');
    expect(policyDiag.entryBlockMode).toBe('NORMAL');
    expect(policyDiag.blockReasons).toEqual([]);
    expect(policyDiag.legacyIgnoredReasons).toEqual(expect.arrayContaining([
      'AFTERMARKET_BUY_BLOCK_IGNORED_BY_ROLLBACK',
      'AFTERMARKET_SELL_ONLY_IGNORED_BY_ROLLBACK',
      'R6_DEFENSE_SELL_ONLY_IGNORED_BY_ROLLBACK',
    ]));
  });
});
