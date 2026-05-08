// @responsibility ADR-457 Human-Approved Gate Reclassification Plan 회귀 테스트
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GateConditionReclassificationProposal, GateReclassificationProposalReport } from './gateReclassificationProposal.js';
import {
  buildGateReclassificationApprovalId,
  buildGateReclassificationApprovalPlan,
  formatGateReclassificationApprovalPlan,
  isGateReclassificationApprovalPlanDisabled,
} from './gateReclassificationApprovalPlan.js';

function proposal(args: Partial<GateConditionReclassificationProposal> & Pick<GateConditionReclassificationProposal, 'condition' | 'source' | 'proposedClass' | 'verdict'>): GateConditionReclassificationProposal {
  return {
    condition: args.condition,
    source: args.source,
    currentClass: args.currentClass ?? 'UNKNOWN',
    proposedClass: args.proposedClass,
    verdict: args.verdict,
    horizonDays: args.horizonDays ?? 5,
    samples: args.samples ?? 30,
    avgReturnPct: args.avgReturnPct ?? 2.5,
    winRate: args.winRate ?? 0.6,
    lossRate: args.lossRate ?? 0.4,
    confidence: args.confidence ?? 'HIGH',
    reason: args.reason ?? 'operator review candidate',
    executionImpact: 'NONE',
    requiresHumanApproval: true,
  };
}

function report(proposals: GateConditionReclassificationProposal[]): GateReclassificationProposalReport {
  return {
    generatedAt: '2026-05-08T00:00:00.000Z',
    proposals,
    topPriority: proposals,
    holdList: proposals.filter((item) => item.confidence === 'LOW' || item.verdict === 'INSUFFICIENT_SAMPLE'),
    operatorMessage: '자동 적용 금지',
  };
}

afterEach(() => {
  delete process.env.GATE_RECLASSIFICATION_APPROVAL_PLAN_DISABLED;
});

describe('ADR-457 Human-Approved Gate Reclassification Plan', () => {
  it('ProposalReport 를 ApprovalPlan 으로 변환하고 deterministic id 를 생성한다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'supply/confluence', source: 'unavailableConditions', proposedClass: 'SOFT_PENALTY', verdict: 'OVER_STRICT', confidence: 'MEDIUM', samples: 18, avgReturnPct: 3.1, winRate: 0.61 }),
    ]));

    expect(plan.items).toHaveLength(1);
    expect(plan.pendingCount).toBe(1);
    expect(plan.highRiskCount).toBe(1);
    expect(plan.items[0]).toMatchObject({
      id: 'supply_confluence__unavailableConditions__SOFT_PENALTY__5d',
      condition: 'supply/confluence',
      riskLevel: 'HIGH',
      status: 'PENDING_APPROVAL',
      executionImpact: 'NONE',
      requiresHumanApproval: true,
    });
    expect(buildGateReclassificationApprovalId('a/b', 'source:x', 'WAIT_TRIGGER', 10)).toBe('a_b__source_x__WAIT_TRIGGER__10d');
  });

  it('LOW confidence 는 DEFERRED 상태로 보류한다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'late_session', source: 'thresholdNotMetConditions', proposedClass: 'SCORE_ONLY', verdict: 'MIXED', confidence: 'LOW', samples: 4 }),
    ]));

    expect(plan.items[0].status).toBe('DEFERRED');
    expect(plan.pendingCount).toBe(0);
  });

  it('INSUFFICIENT_SAMPLE verdict 는 DEFERRED 상태로 보류한다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'thin_history', source: 'providerDegradedConditions', proposedClass: 'SCORE_ONLY', verdict: 'INSUFFICIENT_SAMPLE', confidence: 'MEDIUM', samples: 10 }),
    ]));

    expect(plan.items[0].status).toBe('DEFERRED');
  });

  it('HIGH confidence + SOFT_PENALTY 는 자동 승인 없이 PENDING_APPROVAL 이다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'provider_delay', source: 'providerDegradedConditions', proposedClass: 'SOFT_PENALTY', verdict: 'MIXED', confidence: 'HIGH' }),
    ]));

    expect(plan.items[0]).toMatchObject({ riskLevel: 'LOW', status: 'PENDING_APPROVAL' });
  });

  it('WAIT_TRIGGER 제안은 MEDIUM/HIGH risk 로만 산정한다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'volume_breakout', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER', verdict: 'OVER_STRICT', confidence: 'MEDIUM', samples: 22 }),
      proposal({ condition: 'entry_price_not_reached', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER', verdict: 'OVER_STRICT', confidence: 'HIGH', samples: 31 }),
    ]));

    expect(plan.items.map((item) => item.riskLevel)).toEqual(['MEDIUM', 'HIGH']);
  });

  it('HARD_BLOCK 관련 제안은 GOOD_DEFENSE 유지 시 LOW/MEDIUM 또는 변경 시 MEDIUM 이상이다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'bad_liquidity', source: 'thresholdNotMetConditions', proposedClass: 'HARD_BLOCK', verdict: 'GOOD_DEFENSE', confidence: 'HIGH', avgReturnPct: -2.5, winRate: 0.35, lossRate: 0.65 }),
      proposal({ condition: 'legacy_block', source: 'thresholdNotMetConditions', currentClass: 'HARD_BLOCK', proposedClass: 'SCORE_ONLY', verdict: 'MIXED', confidence: 'HIGH' }),
    ]));

    expect(plan.items[0].riskLevel).toBe('LOW');
    expect(plan.items[1].riskLevel).toBe('MEDIUM');
  });

  it('모든 item 의 executionImpact 는 NONE, requiresHumanApproval 은 true 로 강제된다', () => {
    const plan = buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'supply_confluence', source: 'unavailableConditions', proposedClass: 'SOFT_PENALTY', verdict: 'OVER_STRICT' }),
      proposal({ condition: 'rsi_zone', source: 'thresholdNotMetConditions', proposedClass: 'SCORE_ONLY', verdict: 'MIXED' }),
    ]));

    for (const item of plan.items) {
      expect(item.executionImpact).toBe('NONE');
      expect(item.requiresHumanApproval).toBe(true);
    }
  });

  it('formatter 는 approval REQUIRED 와 evidence 를 출력한다', () => {
    const formatted = formatGateReclassificationApprovalPlan(buildGateReclassificationApprovalPlan(report([
      proposal({ condition: 'volume_breakout', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER', verdict: 'OVER_STRICT', confidence: 'MEDIUM', samples: 22, avgReturnPct: 2.4, winRate: 0.58 }),
    ])));

    expect(formatted).toContain('Gate Reclassification Approval Plan (ADR-457)');
    expect(formatted).toContain('approval: REQUIRED');
    expect(formatted).toContain('5d avg +2.4%, winRate 58%, samples 22');
    expect(formatted).toContain('Operator note');
  });

  it('formatter 는 no proposal 일 때 null 을 반환한다', () => {
    expect(formatGateReclassificationApprovalPlan(buildGateReclassificationApprovalPlan(report([])))).toBeNull();
  });

  it('ENV rollback 은 정확히 true 일 때만 learning_status 연결을 skip 할 수 있다', () => {
    process.env.GATE_RECLASSIFICATION_APPROVAL_PLAN_DISABLED = 'true';
    expect(isGateReclassificationApprovalPlanDisabled()).toBe(true);

    process.env.GATE_RECLASSIFICATION_APPROVAL_PLAN_DISABLED = 'TRUE';
    expect(isGateReclassificationApprovalPlanDisabled()).toBe(false);

    process.env.GATE_RECLASSIFICATION_APPROVAL_PLAN_DISABLED = '1';
    expect(isGateReclassificationApprovalPlanDisabled()).toBe(false);

    const commandSource = fs.readFileSync(path.resolve('server/telegram/commands/system/learningStatus.cmd.ts'), 'utf-8');
    expect(commandSource).toContain('!isGateReclassificationApprovalPlanDisabled()');
    expect(commandSource).toContain('formatGateReclassificationApprovalPlan');
    expect(commandSource).toContain('[ADR-457] Gate reclassification approval plan failed:');
  });

  it('approval plan 모듈은 KIS 주문 API import 를 포함하지 않는다', () => {
    const src = fs.readFileSync(path.resolve('server/learning/gateReclassificationApprovalPlan.ts'), 'utf-8');

    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
  });

  it('approval plan 모듈은 live threshold/position/score 정책 변경 토큰을 포함하지 않는다', () => {
    const src = fs.readFileSync(path.resolve('server/learning/gateReclassificationApprovalPlan.ts'), 'utf-8');

    expect(src).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME|positionPct|Kelly|kelly/i);
    expect(src).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
    expect(src).not.toMatch(/write.*gateConfig|update.*weights/i);
  });
});
