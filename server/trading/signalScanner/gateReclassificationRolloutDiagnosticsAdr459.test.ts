import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  formatGateReclassificationRolloutSummary,
  summarizeGateReclassificationRollout,
} from '../../learning/gateReclassificationRolloutPolicy.js';
import type { GateReclassificationRolloutPlan } from '../../learning/gateReclassificationRolloutPolicy.js';

describe('ADR-459 rollout diagnostics exposure', () => {
  it('rollout summary는 diagnostics/report 전용 stage count와 executionImpact NONE을 출력한다', () => {
    const plan: GateReclassificationRolloutPlan = {
      generatedAt: '2026-05-08T00:00:00.000Z',
      items: [{
        id: 'approval-volume__SHADOW_SCORE',
        approvalItemId: 'approval-volume',
        condition: 'volume_breakout',
        source: 'thresholdNotMetConditions',
        proposedClass: 'WAIT_TRIGGER',
        rolloutStage: 'SHADOW_SCORE',
        status: 'ACTIVE',
        dryRunEvidence: {
          samples: 10,
          avgReturnPct: 2,
          winRate: 0.55,
          lossRate: 0.45,
          rescuedCount: 5,
          horizonDays: 5,
        },
        promotionReason: 'shadow diagnostic only',
        startedAt: '2026-05-08T00:00:00.000Z',
        expiresAt: '2026-06-07T00:00:00.000Z',
        executionImpact: 'NONE',
        createLiveOrder: false,
        modifiesCoreGate: false,
        requiresHumanApproval: true,
      }],
      activeCount: 1,
      pausedCount: 0,
      maxStage: 'SHADOW_SCORE',
      operatorMessage: 'diagnostic only',
    };

    const formatted = formatGateReclassificationRolloutSummary(summarizeGateReclassificationRollout(plan));

    expect(formatted).toContain('SHADOW_SCORE: 1');
    expect(formatted).toContain('executionImpact: NONE');
    expect(formatted).toContain('volume_breakout→SHADOW_SCORE');
  });

  it('/learning_status wiring loads rollout repo read-only and does not mention live mutation fields', () => {
    const src = fs.readFileSync(path.resolve('server/telegram/commands/system/learningStatus.cmd.ts'), 'utf-8');

    expect(src).toContain('loadGateReclassificationRolloutPlan');
    expect(src).toContain('formatGateReclassificationRolloutSummary');
    expect(src).toContain('[ADR-459] Gate reclassification rollout failed:');
    expect(src).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|kisPost\(/);
    expect(src).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD_BY_REGIME/);
    expect(src).not.toMatch(/normalizedGateScore.*signalType|signalType.*normalizedGateScore/);
  });
});
