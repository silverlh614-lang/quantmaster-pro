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
      { code: 'UNMAPPED_AUDIT_NOTICE', count: 3 },
      { code: 'PORTFOLIO_RISK_PASS_WARN', count: 1, source: 'portfolioRiskGate' },
      { code: 'PENDING_APPROVALS', count: 2, source: 'oneDecisionResolver' },
    ]);

    expect(sorted.map((warning) => warning.normalizedCode)).toEqual([
      'PENDING_APPROVALS',
      'PORTFOLIO_RISK_PASS_WARN',
      'UNMAPPED_AUDIT_NOTICE',
    ]);
    expect(sorted[0].priorityRank).toBe(1);
    expect(sorted[2].priorityRank).toBe(5);
  });

  it('classifies price and data quality warnings as priority 2', () => {
    expect(classifyOperatorWarning({ code: 'PRICE_WARN' })).toMatchObject({
      priorityRank: 2,
      domain: 'PRICE_DATA',
      urgency: 'DATA_TRUST_REVIEW',
    });

    expect(classifyOperatorWarning({ code: 'warn-drift' })).toMatchObject({
      normalizedCode: 'WARN_DRIFT',
      priorityRank: 2,
      domain: 'PRICE_DATA',
    });
  });

  it('keeps order-flow warnings above data-trust warnings', () => {
    const sorted = sortOperatorWarnings([
      { code: 'MACRO_STALE', count: 10 },
      { code: 'PENDING_APPROVALS', count: 1 },
      { code: 'UNKNOWN_LOW_TOUCH', count: 99 },
    ]);

    expect(sorted.map((warning) => `${warning.priorityRank}:${warning.normalizedCode}`)).toEqual([
      '1:PENDING_APPROVALS',
      '2:MACRO_STALE',
      '5:UNKNOWN_LOW_TOUCH',
    ]);
  });

  it('classifies scan and gate diagnostic warnings as priority 3', () => {
    expect(classifyOperatorWarning({ code: 'R3_WARNING_ONLY' })).toMatchObject({
      priorityRank: 3,
      domain: 'SCAN_GATE',
      urgency: 'DIAGNOSTIC_REVIEW',
    });

    expect(classifyOperatorWarning({ code: 'DATA_BLOCKED_NEAR_MISS' })).toMatchObject({
      priorityRank: 3,
      domain: 'SCAN_GATE',
    });
  });

  it('keeps scan and gate diagnostics below data trust but above unmapped warnings', () => {
    const sorted = sortOperatorWarnings([
      { code: 'REGIME_SAMPLE_DUPLICATION_SUSPECT', count: 10 },
      { code: 'DATA_UNAVAILABLE_DOMINANT', count: 1 },
      { code: 'PRICE_WARN', count: 1 },
    ]);

    expect(sorted.map((warning) => `${warning.priorityRank}:${warning.normalizedCode}`)).toEqual([
      '2:PRICE_WARN',
      '3:DATA_UNAVAILABLE_DOMINANT',
      '4:REGIME_SAMPLE_DUPLICATION_SUSPECT',
    ]);
  });

  it('classifies learning quality and metric warnings as priority 4', () => {
    expect(classifyOperatorWarning({ code: 'LOW_RESOLVED_SAMPLE' })).toMatchObject({
      priorityRank: 4,
      domain: 'LEARNING_METRIC',
      urgency: 'LEARNING_INTEGRITY_REVIEW',
    });

    expect(classifyOperatorWarning({ code: 'REGIME_SAMPLE_DUPLICATION_SUSPECT' })).toMatchObject({
      priorityRank: 4,
      domain: 'LEARNING_METRIC',
    });
  });

  it('keeps learning metric warnings below scan diagnostics but above unmapped audit items', () => {
    const sorted = sortOperatorWarnings([
      { code: 'UNKNOWN_AUDIT_NOTICE', count: 20 },
      { code: 'LOW_CONFIDENCE_REGIME_BACKFILL', count: 5 },
      { code: 'R3_WARNING_ONLY', count: 1 },
    ]);

    expect(sorted.map((warning) => `${warning.priorityRank}:${warning.normalizedCode}`)).toEqual([
      '3:R3_WARNING_ONLY',
      '4:LOW_CONFIDENCE_REGIME_BACKFILL',
      '5:UNKNOWN_AUDIT_NOTICE',
    ]);
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
