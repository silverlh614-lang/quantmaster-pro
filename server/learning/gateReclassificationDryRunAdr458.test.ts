// @responsibility ADR-458 Gate Reclassification Dry-Run Engine 회귀 테스트
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GateReclassificationApprovalItem } from './gateReclassificationApprovalPlan.js';
import {
  evaluateGateReclassificationDryRun,
  formatGateReclassificationDryRunSection,
  isGateReclassificationDryRunDisabled,
  buildGateReclassificationDryRunSummary,
} from './gateReclassificationDryRun.js';

function item(args: Partial<GateReclassificationApprovalItem> & Pick<GateReclassificationApprovalItem, 'condition' | 'source' | 'proposedClass'>): GateReclassificationApprovalItem {
  return {
    id: `${args.condition}-${args.proposedClass}`,
    condition: args.condition,
    source: args.source,
    currentClass: args.currentClass ?? 'HARD_BLOCK',
    proposedClass: args.proposedClass,
    verdict: args.verdict ?? 'OVER_STRICT',
    horizonDays: args.horizonDays ?? 5,
    samples: args.samples ?? 20,
    avgReturnPct: args.avgReturnPct ?? 2.2,
    winRate: args.winRate ?? 0.6,
    lossRate: args.lossRate ?? 0.4,
    confidence: args.confidence ?? 'HIGH',
    riskLevel: args.riskLevel ?? 'LOW',
    status: args.status ?? 'APPROVED',
    reason: args.reason ?? 'approved by operator',
    expectedEffect: args.expectedEffect ?? 'dry-run only',
    rollbackPlan: args.rollbackPlan ?? 'disable dry-run',
    executionImpact: 'NONE',
    requiresHumanApproval: true,
    createdAt: args.createdAt ?? '2026-05-08T00:00:00.000Z',
    updatedAt: args.updatedAt ?? '2026-05-08T00:00:00.000Z',
  };
}

function run(overrides: Partial<Parameters<typeof evaluateGateReclassificationDryRun>[0]> = {}) {
  return evaluateGateReclassificationDryRun({
    code: '005930',
    name: 'Samsung',
    gateScore: 62,
    rawScore: 62,
    availableMaxScore: 80,
    normalizedGateScore: 0.68,
    unavailableConditions: ['supply/confluence'],
    thresholdNotMetConditions: ['entry_price'],
    providerDegradedConditions: ['sector_stale'],
    originalBucket: 'REJECTED',
    approvedItems: [],
    ...overrides,
  });
}

afterEach(() => {
  delete process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED;
});

describe('ADR-458 Approved Gate Reclassification Dry-Run Engine', () => {
  it('approved item이 없으면 NO_CHANGE', () => {
    expect(run().dryRunDecision).toBe('NO_CHANGE');
  });

  it('APPROVED가 아닌 item은 무시', () => {
    const result = run({ approvedItems: [item({ condition: 'supply/confluence', source: 'unavailableConditions', proposedClass: 'SOFT_PENALTY', status: 'PENDING_APPROVAL' })] });
    expect(result.dryRunDecision).toBe('NO_CHANGE');
  });

  it('SOFT_PENALTY approved item 매칭 → DRY_RUN_RESCUED_TO_PROBING', () => {
    const result = run({ approvedItems: [item({ condition: 'supply/confluence', source: 'unavailableConditions', proposedClass: 'SOFT_PENALTY' })] });
    expect(result.dryRunDecision).toBe('DRY_RUN_RESCUED_TO_PROBING');
  });

  it('WAIT_TRIGGER approved item 매칭 → DRY_RUN_RESCUED_TO_WAIT_TRIGGER', () => {
    const result = run({ approvedItems: [item({ condition: 'entry_price', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER' })] });
    expect(result.dryRunDecision).toBe('DRY_RUN_RESCUED_TO_WAIT_TRIGGER');
  });

  it('SCORE_ONLY approved item 매칭 → DRY_RUN_RESCUED_TO_SCORE_ONLY', () => {
    const result = run({ approvedItems: [item({ condition: 'sector_stale', source: 'providerDegradedConditions', proposedClass: 'SCORE_ONLY' })] });
    expect(result.dryRunDecision).toBe('DRY_RUN_RESCUED_TO_SCORE_ONLY');
  });

  it('DATA_BLOCKED_NEAR_MISS + normalized >= 0.70 + approved match → DRY_RUN_RESCUED_TO_EXECUTABLE_SHADOW', () => {
    const result = run({
      originalBucket: 'DATA_BLOCKED_NEAR_MISS',
      normalizedGateScore: 0.71,
      approvedItems: [item({ condition: 'supply/confluence', source: 'unavailableConditions', proposedClass: 'SOFT_PENALTY' })],
    });
    expect(result.dryRunDecision).toBe('DRY_RUN_RESCUED_TO_EXECUTABLE_SHADOW');
  });

  it('모든 result는 executionImpact=NONE, createLiveOrder=false, requiresHumanApproval=true', () => {
    const result = run({ approvedItems: [item({ condition: 'entry_price', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER' })] });
    expect(result.executionImpact).toBe('NONE');
    expect(result.createLiveOrder).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('formatter가 executionImpact: NONE 출력', () => {
    const result = run({ approvedItems: [item({ condition: 'entry_price', source: 'thresholdNotMetConditions', proposedClass: 'WAIT_TRIGGER' })] });
    const formatted = formatGateReclassificationDryRunSection(buildGateReclassificationDryRunSummary([result]));
    expect(formatted).toContain('executionImpact: NONE');
  });

  it('ENV disabled 시 dry-run skip 플래그가 정확히 true 문자열만 인식한다', () => {
    process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED = 'true';
    expect(isGateReclassificationDryRunDisabled()).toBe(true);
    process.env.GATE_RECLASSIFICATION_DRY_RUN_DISABLED = 'TRUE';
    expect(isGateReclassificationDryRunDisabled()).toBe(false);
  });

  it('KIS order API 및 live Gate/Kelly/normalized decision import 또는 연결이 없다', () => {
    const src = fs.readFileSync(path.resolve('server/learning/gateReclassificationDryRun.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(src).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME|positionPct|Kelly|kelly/i);
    expect(src).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
    expect(src).not.toMatch(/createLiveOrder:\s*true/);
    expect(src).not.toMatch(/executionImpact:\s*['"]FULL['"]|executionImpact:\s*['"]PARTIAL['"]/);
  });
});
