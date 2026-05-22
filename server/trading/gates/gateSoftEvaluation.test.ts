import { describe, expect, it } from 'vitest';
import {
  evaluateSoftGateScore,
  formatGateEvaluatedPartialLog,
  formatGateHardFailLimitedLog,
  formatGateScoreEvaluatedLog,
  resolveQualityDecisionFromGate,
} from './gateSoftEvaluation.js';
import { resolveSimpleTradeDecision } from './simpleDecision.js';

describe('Simplification Step 3 soft Gate evaluation', () => {
  it('keeps RS top 3% miss as score evidence, not hard fail', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      technicalTrend: 'STRONG',
      supplyTrend: 'BOTH_BUY',
      volumeTrend: 'STRONG',
      rsPercentile: 15,
      tradePlan: { entryPrice: 50_000, stopLoss: 47_000, targetPrice: 56_000, riskReward: 2, riskRewardOk: true },
    });

    expect(gate.hardFailReasons).toEqual([]);
    expect(gate.softFailReasons).toContain('RS_TOP3_NOT_REQUIRED_SCORE_ONLY');
    expect(gate.momentumScore).toBeGreaterThan(0);
  });

  it('keeps institution 5d miss as score/diagnostic only', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      supplyTrend: 'NEUTRAL',
      institution5d: false,
    });

    expect(gate.supplyScore).toBe(0);
    expect(gate.hardFailReasons).toEqual([]);
    expect(gate.softFailReasons).toContain('INSTITUTION_5D_NOT_REQUIRED_SCORE_ONLY');
  });

  it('does not skip the whole Gate when supply is missing', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      technicalTrend: 'STRONG',
      supplyTrend: 'MISSING',
      fundamentalStatus: 'MISSING',
    });

    expect(gate.evaluatedAxes).toContain('technical');
    expect(gate.missingAxes).toEqual(expect.arrayContaining(['supply', 'fundamental']));
    expect(gate.missingFields).toEqual(expect.arrayContaining(['supplyTrend', 'fundamental']));
    expect(gate.counterfactualRecorded).toBe(true);
    expect(formatGateEvaluatedPartialLog({ snapshotId: 's1', symbol: '005930', breakdown: gate }))
      .toContain('[GATE_EVALUATED_PARTIAL]');
  });

  it('treats missing price as Data Gate hard fail while preserving counterfactual', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: null,
      volume: 100_000,
      tradable: true,
    });
    const decision = resolveSimpleTradeDecision({
      dataUsable: true,
      finalScore: 90,
      gateScoreBreakdown: gate,
    });

    expect(gate.dataGateUsable).toBe(false);
    expect(gate.hardFailReasons).toContain('PRICE_MISSING');
    expect(decision.decision).toBe('NO_TRADE_DATA_INCOMPLETE');
    expect(decision.qualityDecision).toBe('DATA_INCOMPLETE');
    expect(gate.counterfactualRecorded).toBe(true);
  });

  it('applies Enemy Checklist warnings as diagnostic penalty only', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      enemyWarnings: 2,
    });

    expect(gate.diagnosticPenalty).toBe(-4);
    expect(gate.hardFailReasons).toEqual([]);
    expect(gate.softFailReasons).toContain('ENEMY_CHECKLIST_SCORE_PENALTY_ONLY');
  });

  it('allows BUY_ALLOWED with 21/27 conditions when finalScore is enough', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      passedConditions: 21,
      totalConditions: 27,
      tradePlan: { entryPrice: 50_000, stopLoss: 47_000, targetPrice: 56_000, riskReward: 2, riskRewardOk: true },
    });
    const decision = resolveSimpleTradeDecision({
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      finalScore: 73,
      gateScoreBreakdown: gate,
    });

    expect(gate.softFailReasons).toContain('CONDITION_COUNT_DIAGNOSTIC_ONLY');
    expect(decision.decision).toBe('BUY_ALLOWED');
  });

  it('emits gate score and limited-hard-fail logs', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      technicalTrend: 'WEAK',
    });
    const scoreLog = formatGateScoreEvaluatedLog({ snapshotId: 's1', symbol: '005930', breakdown: gate });
    const limitedLog = formatGateHardFailLimitedLog({
      snapshotId: 's1',
      symbol: '005930',
      previousHardFailReason: 'RS_TOP3_REQUIRED',
    });

    expect(scoreLog).toContain('[GATE_SCORE_EVALUATED]');
    expect(limitedLog).toContain('[GATE_HARD_FAIL_LIMITED]');
    expect(limitedLog).toContain("newRole='SOFT_FAIL_OR_SCORE_PENALTY'");
  });

  it('derives relaxed QualityDecision states', () => {
    const gate = evaluateSoftGateScore({ currentPrice: 50_000, volume: 100_000, tradable: true });
    expect(resolveQualityDecisionFromGate({ gateScoreBreakdown: gate, finalScore: 74 })).toBe('TRADE_READY');
    expect(resolveQualityDecisionFromGate({ gateScoreBreakdown: gate, finalScore: 60 })).toBe('WATCH_READY');
  });
});
