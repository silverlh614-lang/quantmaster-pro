import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GateReclassificationApprovalItem } from './gateReclassificationApprovalPlan.js';
import {
  buildGateReclassificationRolloutPlan,
  clampMaxStage,
  formatGateReclassificationRolloutSummary,
  isGateReclassificationRolloutDisabled,
  summarizeGateReclassificationRollout,
} from './gateReclassificationRolloutPolicy.js';
import type { GateReclassificationDryRunRecord } from './gateReclassificationRolloutPolicy.js';

function approval(overrides: Partial<GateReclassificationApprovalItem> = {}): GateReclassificationApprovalItem {
  return {
    id: 'approval-supply',
    condition: 'supply_confluence',
    source: 'unavailableConditions',
    currentClass: 'HARD_BLOCK',
    proposedClass: 'SOFT_PENALTY',
    verdict: 'OVER_STRICT',
    horizonDays: 5,
    samples: 20,
    avgReturnPct: 3,
    winRate: 0.6,
    lossRate: 0.4,
    confidence: 'MEDIUM',
    riskLevel: 'HIGH',
    status: 'APPROVED',
    reason: 'approved by operator',
    expectedEffect: 'shadow only',
    rollbackPlan: 'pause rollout',
    executionImpact: 'NONE',
    requiresHumanApproval: true,
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

function dryRun(overrides: Partial<GateReclassificationDryRunRecord> = {}): GateReclassificationDryRunRecord {
  return {
    id: 'dry-run-supply',
    approvalItemId: 'approval-supply',
    condition: 'supply_confluence',
    source: 'unavailableConditions',
    proposedClass: 'SOFT_PENALTY',
    samples: 20,
    avgReturnPct: 3,
    winRate: 0.6,
    lossRate: 0.4,
    rescuedCount: 6,
    horizonDays: 5,
    recordedAt: '2026-05-08T00:00:00.000Z',
    executionImpact: 'NONE',
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.GATE_RECLASSIFICATION_ROLLOUT_DISABLED;
});

describe('ADR-459 Gate Reclassification Rollout policy', () => {
  it('APPROVED가 아닌 approval item은 rollout에서 제외한다', () => {
    const plan = buildGateReclassificationRolloutPlan({
      approvalItems: [approval({ status: 'PENDING_APPROVAL' })],
      dryRunRecords: [dryRun()],
      now: new Date('2026-05-08T00:00:00.000Z'),
    });

    expect(plan.items).toEqual([]);
    expect(plan.activeCount).toBe(0);
  });

  it('samples < 10이면 rollout item을 생성하지 않는다', () => {
    const plan = buildGateReclassificationRolloutPlan({
      approvalItems: [approval()],
      dryRunRecords: [dryRun({ samples: 9, avgReturnPct: 99, winRate: 0.99, rescuedCount: 99 })],
    });

    expect(plan.items).toEqual([]);
  });

  it('avgReturnPct >= 2.0 / winRate >= 0.55 / rescuedCount >= 5 이면 SHADOW_SCORE로 승격한다', () => {
    const plan = buildGateReclassificationRolloutPlan({
      approvalItems: [approval()],
      dryRunRecords: [dryRun({ samples: 10, avgReturnPct: 2.0, winRate: 0.55, rescuedCount: 5 })],
    });

    expect(plan.items[0].rolloutStage).toBe('SHADOW_SCORE');
  });

  it('avgReturnPct >= 3.0 / winRate >= 0.60 / samples >= 20 이면 ADVISORY로 승격한다', () => {
    const plan = buildGateReclassificationRolloutPlan({
      approvalItems: [approval()],
      dryRunRecords: [dryRun({ samples: 20, avgReturnPct: 3.0, winRate: 0.60, rescuedCount: 5 })],
    });

    expect(plan.items[0].rolloutStage).toBe('ADVISORY');
  });

  it('avgReturnPct >= 4.0 / winRate >= 0.65 / samples >= 30 이면 WEIGHTED로 승격한다', () => {
    const plan = buildGateReclassificationRolloutPlan({
      approvalItems: [approval()],
      dryRunRecords: [dryRun({ samples: 30, avgReturnPct: 4.0, winRate: 0.65, rescuedCount: 5 })],
    });

    expect(plan.items[0].rolloutStage).toBe('WEIGHTED');
    expect(plan.maxStage).toBe('WEIGHTED');
  });

  it('CORE는 절대 생성되지 않고 clampMaxStage는 CORE를 GATED로 제한한다', () => {
    const plan = buildGateReclassificationRolloutPlan({
      approvalItems: [approval()],
      dryRunRecords: [dryRun({ samples: 100, avgReturnPct: 99, winRate: 0.99, rescuedCount: 99 })],
    });

    expect(plan.items.map((item) => item.rolloutStage)).not.toContain('CORE');
    expect(clampMaxStage('CORE')).toBe('GATED');
  });

  it('safety literals are forced on every rollout item', () => {
    const plan = buildGateReclassificationRolloutPlan({ approvalItems: [approval()], dryRunRecords: [dryRun()] });

    expect(plan.items[0].executionImpact).toBe('NONE');
    expect(plan.items[0].createLiveOrder).toBe(false);
    expect(plan.items[0].modifiesCoreGate).toBe(false);
    expect(plan.items[0].requiresHumanApproval).toBe(true);
  });

  it('ENV disabled 시 rollout 생성을 skip하고 정확히 true만 disabled로 처리한다', () => {
    process.env.GATE_RECLASSIFICATION_ROLLOUT_DISABLED = 'true';
    expect(isGateReclassificationRolloutDisabled()).toBe(true);
    expect(buildGateReclassificationRolloutPlan({ approvalItems: [approval()], dryRunRecords: [dryRun()] }).items).toEqual([]);

    process.env.GATE_RECLASSIFICATION_ROLLOUT_DISABLED = 'TRUE';
    expect(isGateReclassificationRolloutDisabled()).toBe(false);
    process.env.GATE_RECLASSIFICATION_ROLLOUT_DISABLED = '1';
    expect(isGateReclassificationRolloutDisabled()).toBe(false);
  });

  it('rollout summary/report는 stage counts와 executionImpact NONE을 표시한다', () => {
    const plan = buildGateReclassificationRolloutPlan({ approvalItems: [approval()], dryRunRecords: [dryRun()] });
    const summary = summarizeGateReclassificationRollout(plan);
    const formatted = formatGateReclassificationRolloutSummary(summary);

    expect(summary.executionImpact).toBe('NONE');
    expect(summary.byStage.ADVISORY).toBe(1);
    expect(formatted).toContain('Gate Reclassification Rollout (ADR-459)');
    expect(formatted).toContain('executionImpact: NONE');
    expect(formatted).toContain('supply_confluence→ADVISORY');
  });

  it('rollout policy 모듈은 KIS order API와 live scoring policy 변경 토큰을 포함하지 않는다', () => {
    const src = fs.readFileSync(path.resolve('server/learning/gateReclassificationRolloutPolicy.ts'), 'utf-8');

    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(src).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME|positionPct|Kelly|kelly/i);
    expect(src).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
    expect(src).not.toMatch(/createLiveOrder:\s*true/);
    expect(src).not.toMatch(/modifiesCoreGate:\s*true/);
    expect(src).not.toMatch(/rolloutStage:\s*['"]CORE['"]/);
  });
});
