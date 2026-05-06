// @responsibility ADR-0324 gateContributionAnalyzer 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CounterfactualEntry } from './counterfactualShadow.js';
import {
  analyzeGateContribution,
  analyzeGateContributions,
  DOMINANCE_RATIO,
  isGateContributionAnalyzerDisabled,
  LOSER_RETURN_THRESHOLD_PCT,
  MIN_RESOLVED_SAMPLE,
  WINNER_RETURN_THRESHOLD_PCT,
} from './gateContributionAnalyzer.js';

const ORIGINAL_DISABLED = process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED;

beforeEach(() => {
  delete process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED;
  else process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED = ORIGINAL_DISABLED;
});

let serial = 0;
const entry = (skipReason: string, return30d?: number): CounterfactualEntry => ({
  id: `cf_${serial++}`,
  stockCode: '005930',
  stockName: '삼성전자',
  signalDate: '2026-04-01',
  signalTime: '2026-04-01T09:30:00.000Z',
  priceAtSignal: 70_000,
  gateScore: 6,
  regime: 'R3_EARLY',
  conditionKeys: [],
  skipReason,
  return30d,
});

describe('SSOT 상수 (ADR-0324)', () => {
  it('WINNER_RETURN_THRESHOLD_PCT = 5', () => {
    expect(WINNER_RETURN_THRESHOLD_PCT).toBe(5);
  });
  it('LOSER_RETURN_THRESHOLD_PCT = -5', () => {
    expect(LOSER_RETURN_THRESHOLD_PCT).toBe(-5);
  });
  it('DOMINANCE_RATIO = 1.5', () => {
    expect(DOMINANCE_RATIO).toBe(1.5);
  });
  it('MIN_RESOLVED_SAMPLE = 5', () => {
    expect(MIN_RESOLVED_SAMPLE).toBe(5);
  });
});

describe('isGateContributionAnalyzerDisabled — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → false', () => {
    expect(isGateContributionAnalyzerDisabled()).toBe(false);
  });
  it('"true" → true', () => {
    process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED = 'true';
    expect(isGateContributionAnalyzerDisabled()).toBe(true);
  });
  it('"1" / "TRUE" → false (정확 비교)', () => {
    process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED = '1';
    expect(isGateContributionAnalyzerDisabled()).toBe(false);
    process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED = 'TRUE';
    expect(isGateContributionAnalyzerDisabled()).toBe(false);
  });
});

describe('analyzeGateContribution — 단일 패턴 분류', () => {
  it('빈 entries → 모두 0, INSUFFICIENT_SAMPLE', () => {
    const r = analyzeGateContribution([], 'GATE_UNDER');
    expect(r.blockedWinners).toBe(0);
    expect(r.blockedLosers).toBe(0);
    expect(r.blockedNeutral).toBe(0);
    expect(r.blockedUnresolved).toBe(0);
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('패턴 미매칭 → 모두 0', () => {
    const entries = [entry('SKIP', 10), entry('SECTOR_FULL', -10)];
    const r = analyzeGateContribution(entries, 'NONEXISTENT');
    expect(r.blockedWinners).toBe(0);
    expect(r.blockedLosers).toBe(0);
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('return30d > 5 → blockedWinners (알파 손실)', () => {
    const entries = Array.from({ length: 6 }, () => entry('GATE_UNDER', 10));
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedWinners).toBe(6);
    expect(r.blockedLosers).toBe(0);
    expect(r.verdict).toBe('NEGATIVE');
  });

  it('return30d < -5 → blockedLosers (게이트 차단 정당)', () => {
    const entries = Array.from({ length: 6 }, () => entry('GATE_UNDER', -10));
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedLosers).toBe(6);
    expect(r.blockedWinners).toBe(0);
    expect(r.verdict).toBe('POSITIVE');
  });

  it('return30d 횡보 (-5~+5) → blockedNeutral', () => {
    const entries = Array.from({ length: 6 }, () => entry('GATE_UNDER', 2));
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedNeutral).toBe(6);
    expect(r.verdict).toBe('NEUTRAL');
  });

  it('return30d 부재 → blockedUnresolved (30거래일 미경과)', () => {
    const entries = [entry('GATE_UNDER'), entry('GATE_UNDER')];
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedUnresolved).toBe(2);
    expect(r.resolvedSample).toBe(0);
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('return30d NaN/Infinity → blockedUnresolved (안전 fallback)', () => {
    const entries = [entry('GATE_UNDER', NaN), entry('GATE_UNDER', Infinity)];
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedUnresolved).toBe(2);
  });

  it('boundary +5% 정확 → blockedNeutral (초과 비교, > 만)', () => {
    const entries = Array.from({ length: 6 }, () => entry('GATE_UNDER', 5));
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedNeutral).toBe(6);
  });

  it('boundary -5% 정확 → blockedNeutral (초과 비교, < 만)', () => {
    const entries = Array.from({ length: 6 }, () => entry('GATE_UNDER', -5));
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedNeutral).toBe(6);
  });

  it('losers > winners × 1.5 → POSITIVE', () => {
    // 4 winners + 7 losers (7 > 4×1.5=6) → POSITIVE
    const entries = [
      ...Array.from({ length: 4 }, () => entry('SECTOR_FULL', 10)),
      ...Array.from({ length: 7 }, () => entry('SECTOR_FULL', -10)),
    ];
    const r = analyzeGateContribution(entries, 'SECTOR_FULL');
    expect(r.blockedWinners).toBe(4);
    expect(r.blockedLosers).toBe(7);
    expect(r.verdict).toBe('POSITIVE');
  });

  it('winners > losers × 1.5 → NEGATIVE (게이트 알파 손실)', () => {
    // 7 winners + 4 losers (7 > 4×1.5=6) → NEGATIVE
    const entries = [
      ...Array.from({ length: 7 }, () => entry('SECTOR_FULL', 10)),
      ...Array.from({ length: 4 }, () => entry('SECTOR_FULL', -10)),
    ];
    const r = analyzeGateContribution(entries, 'SECTOR_FULL');
    expect(r.verdict).toBe('NEGATIVE');
  });

  it('균형 (winners ≈ losers) → NEUTRAL', () => {
    const entries = [
      ...Array.from({ length: 5 }, () => entry('SECTOR_FULL', 10)),
      ...Array.from({ length: 5 }, () => entry('SECTOR_FULL', -10)),
    ];
    const r = analyzeGateContribution(entries, 'SECTOR_FULL');
    expect(r.verdict).toBe('NEUTRAL');
  });

  it('표본 4건 < 5 → INSUFFICIENT_SAMPLE (강한 우세에도)', () => {
    const entries = [
      ...Array.from({ length: 4 }, () => entry('GATE_UNDER', -10)),
    ];
    const r = analyzeGateContribution(entries, 'GATE_UNDER');
    expect(r.blockedLosers).toBe(4);
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('substring 매칭 — "GATE" 패턴이 "GATE_UNDER" / "GATE_FAIL" 둘 다 매칭', () => {
    const entries = [
      entry('GATE_UNDER', 10),
      entry('GATE_FAIL', -10),
      entry('SECTOR_FULL', 10),
    ];
    const r = analyzeGateContribution(entries, 'GATE');
    // 2 매칭 (GATE_UNDER + GATE_FAIL), SECTOR_FULL 제외
    expect(r.blockedWinners + r.blockedLosers + r.blockedNeutral).toBe(2);
  });
});

describe('analyzeGateContributions — 다중 패턴 일괄', () => {
  it('빈 patterns → 빈 배열', () => {
    const r = analyzeGateContributions([entry('GATE_UNDER', 10)], []);
    expect(r).toEqual([]);
  });

  it('ENV DISABLED → 빈 배열', () => {
    process.env.GATE_CONTRIBUTION_ANALYZER_DISABLED = 'true';
    const r = analyzeGateContributions([entry('GATE_UNDER', 10)], ['GATE_UNDER']);
    expect(r).toEqual([]);
  });

  it('다중 패턴 — 각 패턴 별도 분석', () => {
    const entries = [
      entry('GATE_UNDER', 10),
      entry('GATE_UNDER', -10),
      entry('SECTOR_FULL', 10),
    ];
    const r = analyzeGateContributions(entries, ['GATE_UNDER', 'SECTOR_FULL', 'NONE']);
    expect(r).toHaveLength(3);
    expect(r[0].skipReasonPattern).toBe('GATE_UNDER');
    expect(r[1].skipReasonPattern).toBe('SECTOR_FULL');
    expect(r[2].skipReasonPattern).toBe('NONE');
  });

  it('순서 보존', () => {
    const r = analyzeGateContributions([], ['A', 'B', 'C']);
    expect(r.map(x => x.skipReasonPattern)).toEqual(['A', 'B', 'C']);
  });
});
