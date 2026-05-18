import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyOperatorWarning,
  formatOperatorWarningQueue,
  sortOperatorWarnings,
} from './operatorWarningPriority.js';

describe('operator warning priority taxonomy', () => {
  it('classifies order and position warnings as priority 1', () => {
    expect(classifyOperatorWarning({ code: 'PENDING_APPROVALS' })).toMatchObject({
      priorityRank: 1,
      domain: 'ORDER_POSITION',
      urgency: 'IMMEDIATE_OPERATOR_REVIEW',
      executionImpact: 'NONE',
    });

    expect(classifyOperatorWarning({ code: 'invalidation warn' })).toMatchObject({
      normalizedCode: 'INVALIDATION_WARN',
      priorityRank: 1,
      domain: 'ORDER_POSITION',
    });
  });

  it('sorts priority 1 order-flow warnings ahead of unmapped warnings', () => {
    const sorted = sortOperatorWarnings([
      { code: 'REGIME_SAMPLE_DUPLICATION_SUSPECT', count: 3 },
      { code: 'PORTFOLIO_RISK_PASS_WARN', count: 1, source: 'portfolioRiskGate' },
      { code: 'PENDING_APPROVALS', count: 2, source: 'oneDecisionResolver' },
    ]);

    expect(sorted.map((warning) => warning.normalizedCode)).toEqual([
      'PENDING_APPROVALS',
      'PORTFOLIO_RISK_PASS_WARN',
      'REGIME_SAMPLE_DUPLICATION_SUSPECT',
    ]);
    expect(sorted[0].priorityRank).toBe(1);
    expect(sorted[2].priorityRank).toBe(5);
  });

  it('formats a compact read-only queue for operator surfaces', () => {
    const text = formatOperatorWarningQueue([
      { code: 'ENEMY_CHECKLIST_CAUTION', source: 'enemyChecklist', count: 1 },
    ]);

    expect(text).toContain('P1 / ORDER_POSITION / ENEMY_CHECKLIST_CAUTION');
    expect(text).toContain('executionImpact=NONE');
  });

  it('contains no provider calls, persistence writes, order calls, or threshold mutation', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/diagnostics/operatorWarningPriority.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/from ['"].*(?:kis|krx|order|trade|repo|storage|persistence).*['"]/i);
    expect(source).not.toMatch(/writeFile|appendFile|rename|mkdir|rmSync|createWriteStream/);
    expect(source).not.toMatch(/placeKis|submitOrder|executeTrade|cancelOrder/i);
    expect(source).not.toMatch(/setRuntimeThresholdDelta|GATE_SCORE_THRESHOLD\s*=|conditionWeights?\s*=|kellyMultiplier\s*=/i);
  });
});
