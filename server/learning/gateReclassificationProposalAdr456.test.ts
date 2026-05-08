// @responsibility ADR-456 Gate Reclassification Proposal Generator 회귀 테스트
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  NearMissOutcomeAnalyticsReport,
  NearMissOutcomeConditionAnalytics,
  NearMissOutcomeConditionKind,
  NearMissOutcomeStrictnessVerdict,
} from './nearMissOutcomeAnalytics.js';
import {
  buildGateReclassificationProposalReport,
  confidenceFromSamples,
  formatGateReclassificationProposalReport,
  isGateReclassificationProposalDisabled,
} from './gateReclassificationProposal.js';

function conditionRow(args: {
  kind: NearMissOutcomeConditionKind;
  condition: string;
  verdict: NearMissOutcomeStrictnessVerdict;
  observed: number;
  avgReturnPct: number;
  winRate: number;
}): NearMissOutcomeConditionAnalytics {
  const stats = {
    observed: args.observed,
    avgReturnPct: args.avgReturnPct,
    winRate: args.winRate,
    positiveCount: Math.round(args.observed * args.winRate),
  };
  return {
    kind: args.kind,
    condition: args.condition,
    totalEntries: args.observed,
    horizonStats: {
      3: stats,
      5: stats,
      10: stats,
    },
    verdict: args.verdict,
    verdictHorizonDays: 5,
  };
}

function analytics(rows: NearMissOutcomeConditionAnalytics[]): NearMissOutcomeAnalyticsReport {
  return {
    totalEntries: rows.reduce((sum, row) => sum + row.totalEntries, 0),
    observedEntries: rows.reduce((sum, row) => sum + row.horizonStats[row.verdictHorizonDays].observed, 0),
    bucketAnalytics: [],
    conditionAnalytics: {
      unavailableConditions: rows.filter((row) => row.kind === 'unavailableConditions'),
      thresholdNotMetConditions: rows.filter((row) => row.kind === 'thresholdNotMetConditions'),
      providerDegradedConditions: rows.filter((row) => row.kind === 'providerDegradedConditions'),
    },
    policy: {
      minObservedSamples: 3,
      overStrictAvgReturnPct: 2,
      overStrictWinRate: 0.55,
      goodDefenseAvgReturnPct: -2,
      goodDefenseWinRate: 0.45,
      maxRankedConditionsPerKind: 5,
      preferredHorizonDays: 10,
    },
    executionImpact: 'NONE',
    diagnosticOnly: true,
  };
}

afterEach(() => {
  delete process.env.GATE_RECLASSIFICATION_PROPOSAL_DISABLED;
});

describe('ADR-456 Gate Reclassification Proposal Generator', () => {
  it('OVER_STRICT unavailableConditions 는 SOFT_PENALTY 제안을 생성한다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'unavailableConditions', condition: 'supply_confluence', verdict: 'OVER_STRICT_CANDIDATE', observed: 18, avgReturnPct: 3.1, winRate: 0.61 }),
    ]));

    expect(report.proposals[0]).toMatchObject({
      condition: 'supply_confluence',
      source: 'unavailableConditions',
      verdict: 'OVER_STRICT',
      proposedClass: 'SOFT_PENALTY',
      confidence: 'MEDIUM',
      executionImpact: 'NONE',
      requiresHumanApproval: true,
    });
    expect(report.topPriority).toHaveLength(1);
  });

  it('OVER_STRICT volume/entry/vcp 계열 thresholdNotMetConditions 는 WAIT_TRIGGER 제안을 생성한다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'volume_breakout', verdict: 'OVER_STRICT_CANDIDATE', observed: 22, avgReturnPct: 2.4, winRate: 0.58 }),
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'entry_price_not_reached', verdict: 'OVER_STRICT_CANDIDATE', observed: 30, avgReturnPct: 2.6, winRate: 0.6 }),
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'vcp_incomplete', verdict: 'OVER_STRICT_CANDIDATE', observed: 31, avgReturnPct: 2.7, winRate: 0.61 }),
    ]));

    expect(report.proposals.map((proposal) => proposal.proposedClass)).toEqual([
      'WAIT_TRIGGER',
      'WAIT_TRIGGER',
      'WAIT_TRIGGER',
    ]);
  });

  it('GOOD_DEFENSE 는 HARD_BLOCK 유지 제안을 생성한다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'volume_surge', verdict: 'GOOD_DEFENSE', observed: 21, avgReturnPct: -2.8, winRate: 0.48 }),
    ]));

    expect(report.proposals[0]).toMatchObject({
      verdict: 'GOOD_DEFENSE',
      proposedClass: 'HARD_BLOCK',
      lossRate: 0.52,
    });
  });

  it('MIXED 는 SCORE_ONLY 제안으로 남긴다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'rsi_zone', verdict: 'MIXED_OR_NEUTRAL', observed: 12, avgReturnPct: 0.4, winRate: 0.5 }),
    ]));

    expect(report.proposals[0]).toMatchObject({ verdict: 'MIXED', proposedClass: 'SCORE_ONLY' });
  });

  it('INSUFFICIENT_SAMPLE 과 LOW confidence 는 holdList 로 보낸다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'late_session', verdict: 'INSUFFICIENT_DATA', observed: 2, avgReturnPct: 6, winRate: 1 }),
    ]));

    expect(report.proposals[0]).toMatchObject({ verdict: 'INSUFFICIENT_SAMPLE', confidence: 'LOW' });
    expect(report.holdList).toHaveLength(1);
    expect(report.topPriority).toHaveLength(0);
  });

  it('confidence 산정은 sample 수 30/10/미만10 기준을 따른다', () => {
    expect(confidenceFromSamples(30)).toBe('HIGH');
    expect(confidenceFromSamples(10)).toBe('MEDIUM');
    expect(confidenceFromSamples(9)).toBe('LOW');
  });

  it('모든 제안은 executionImpact NONE 및 human approval required literal 을 강제한다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'providerDegradedConditions', condition: 'sector_energy', verdict: 'OVER_STRICT_CANDIDATE', observed: 30, avgReturnPct: 3.2, winRate: 0.7 }),
      conditionRow({ kind: 'thresholdNotMetConditions', condition: 'macd_zone', verdict: 'MIXED_OR_NEUTRAL', observed: 10, avgReturnPct: 0.1, winRate: 0.5 }),
    ]));

    expect(report.proposals).toHaveLength(2);
    for (const proposal of report.proposals) {
      expect(proposal.executionImpact).toBe('NONE');
      expect(proposal.requiresHumanApproval).toBe(true);
    }
  });

  it('formatter 는 approval REQUIRED 를 출력하고 no sample 은 null 을 반환한다', () => {
    const report = buildGateReclassificationProposalReport(analytics([
      conditionRow({ kind: 'unavailableConditions', condition: 'supply_confluence', verdict: 'OVER_STRICT_CANDIDATE', observed: 18, avgReturnPct: 3.1, winRate: 0.61 }),
    ]));

    const formatted = formatGateReclassificationProposalReport(report);
    expect(formatted).toContain('Gate Reclassification Proposals (ADR-456)');
    expect(formatted).toContain('approval: REQUIRED');
    expect(formatted).toContain('Operator note');
    expect(formatGateReclassificationProposalReport(buildGateReclassificationProposalReport(analytics([])))).toBeNull();
  });

  it('ENV rollback 은 정확히 true 일 때만 report 연결을 skip 할 수 있다', () => {
    process.env.GATE_RECLASSIFICATION_PROPOSAL_DISABLED = 'true';
    expect(isGateReclassificationProposalDisabled()).toBe(true);

    process.env.GATE_RECLASSIFICATION_PROPOSAL_DISABLED = 'TRUE';
    expect(isGateReclassificationProposalDisabled()).toBe(false);

    process.env.GATE_RECLASSIFICATION_PROPOSAL_DISABLED = '1';
    expect(isGateReclassificationProposalDisabled()).toBe(false);

    const commandSource = fs.readFileSync(path.resolve('server/telegram/commands/system/learningStatus.cmd.ts'), 'utf-8');
    expect(commandSource).toContain('!isGateReclassificationProposalDisabled()');
    expect(commandSource).toContain('[ADR-456] Gate reclassification proposal failed:');
  });

  it('proposal 모듈은 KIS 주문 API 및 live 정책 변경 토큰을 포함하지 않는다', () => {
    const src = fs.readFileSync(path.resolve('server/learning/gateReclassificationProposal.ts'), 'utf-8');

    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(src).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME|positionPct|Kelly|kelly/i);
    expect(src).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
    expect(src).not.toMatch(/write.*gateConfig|update.*weights/i);
  });
});
