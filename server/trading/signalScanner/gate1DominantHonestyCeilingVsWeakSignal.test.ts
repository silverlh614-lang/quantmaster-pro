/**
 * @responsibility Gate1 forensic dominant 정직화 회귀 — 실현 net 미달 시 구조적 ceiling vs 약한 양(+)신호 구분.
 *
 * ADR-0505 computeDominantFailureReason: 실현 net(positiveScoreTotal+penaltyTotal) < required 이고
 * 누락 소스 0 일 때, 달성가능 ceiling(컴포넌트 maxScore 합)>=required 면 POSITIVE_SIGNAL_BELOW_THRESHOLD
 * (진짜 약한 신호, ceiling repair 무효), ceiling<required 일 때만 SCORE_CEILING_BELOW_THRESHOLD.
 * 점수/threshold 무변경 — 진단 라벨 정직화 only.
 */
import { describe, it, expect } from 'vitest';
import { buildGate1MinimumSignalForensicAuditAdr0505 } from './gate1MinimumSignalForensicAuditAdr0505.js';
import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
} from './minimumSignalScoreTrace.js';

function component(
  code: SignalScoreComponentCode,
  overrides: Partial<SignalScoreComponentTrace> = {},
): SignalScoreComponentTrace {
  return {
    code,
    rawValue: undefined,
    normalizedScore: 0,
    weight: 1,
    weightedScore: 0,
    maxScore: 10,
    contributionPct: 0,
    confidence: 'VERIFIED',
    providerIssue: false,
    marketSignal: false,
    penaltyApplied: false,
    message: '',
    ...overrides,
  };
}

function trace(overrides: Partial<MinimumSignalScoreTrace> = {}): MinimumSignalScoreTrace {
  return {
    symbol: '005930',
    name: '삼성전자',
    requiredScore: 70,
    actualScore: 33,
    scoreGap: -37,
    passed: false,
    components: [],
    positiveScoreTotal: 33,
    penaltyTotal: 0,
    unknownPenaltyTotal: 0,
    providerIssuePenaltyTotal: 0,
    sessionPenaltyTotal: 0,
    sectorPenaltyTotal: 0,
    riskPenaltyTotal: 0,
    softFailPenaltyTotal: 0,
    topMissingContributors: [],
    topPenaltyContributors: [],
    wouldPassIfUnknownNeutral: false,
    wouldPassIfProviderPenaltyRemoved: false,
    wouldPassIfSessionPenaltyRemoved: false,
    wouldPassIfRiskPenaltyCapped: false,
    wouldPassIfSectorPenaltyRemoved: false,
    wouldPassIfSoftFailPenaltyRemoved: false,
    ...overrides,
  };
}

describe('Gate1 dominant 정직화 — ceiling vs 약한 신호', () => {
  it('달성가능 ceiling >= required 이면 POSITIVE_SIGNAL_BELOW_THRESHOLD (ceiling 라벨 오표시 금지)', () => {
    // 실현 net=33 < required=70, 누락 소스 0, 달성가능 ceiling=116 >= 70 → ceiling 문제 아님.
    const audit = buildGate1MinimumSignalForensicAuditAdr0505({
      trace: trace({
        components: [
          component('PRICE_MOMENTUM', { weightedScore: 20, maxScore: 60 }),
          component('TECHNICAL_TREND', { weightedScore: 13, maxScore: 56 }),
        ],
      }),
    });
    expect(audit.missingPositiveSources).toHaveLength(0);
    expect(audit.dominantFailureReason).toBe('POSITIVE_SIGNAL_BELOW_THRESHOLD');
    expect(audit.dominantFailureReason).not.toBe('SCORE_CEILING_BELOW_THRESHOLD');
  });

  it('달성가능 ceiling < required 이면 SCORE_CEILING_BELOW_THRESHOLD 유지 (진짜 구조적)', () => {
    const audit = buildGate1MinimumSignalForensicAuditAdr0505({
      trace: trace({
        components: [
          component('PRICE_MOMENTUM', { weightedScore: 20, maxScore: 30 }),
          component('TECHNICAL_TREND', { weightedScore: 13, maxScore: 25 }),
        ],
      }),
    });
    expect(audit.missingPositiveSources).toHaveLength(0);
    expect(audit.dominantFailureReason).toBe('SCORE_CEILING_BELOW_THRESHOLD');
  });
});
