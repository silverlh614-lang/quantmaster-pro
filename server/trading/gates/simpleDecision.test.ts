import { describe, expect, it } from 'vitest';
import {
  formatLegacyStrongBuyBlockerIgnoredLog,
  formatSimpleDecisionFinalLog,
  formatStrongBuyConditionDowngradedLog,
  labelFromFinalScore,
  resolveSimpleTradeDecision,
} from './simpleDecision.js';
import { evaluateSoftGateScore, formatGateScoreEvaluatedLog } from './gateSoftEvaluation.js';

describe('Simplification Step 4 simple final decision', () => {
  it('labels finalScore 86 as HIGH_CONVICTION without a separate strong-buy condition', () => {
    const result = resolveSimpleTradeDecision({
      snapshotId: 'scan_86',
      symbol: '005930',
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      finalScore: 86,
      baseScore: 84,
      scoreAdjustment: 2,
    });

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.label).toBe('HIGH_CONVICTION');
    expect(result.learningLabel).toBe('LABEL_HIGH_CONVICTION');
    expect(result.strongBuyAsLabelOnly).toBe(true);
  });

  it('allows BUY when finalScore is 74 without any STRONG_BUY gate', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      finalScore: 74,
    });

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.label).toBe('BUY');
    expect(result.blockReasons).toEqual([]);
  });

  it('keeps RS top 3% as diagnostic only when score is enough', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      finalScore: 76,
      diagnosticEvidence: ['RS_TOP3_MISSING_DIAGNOSTIC_ONLY'],
    });

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.blockReasons).not.toContain('RS_TOP3_REQUIRED');
    expect(result.diagnosticEvidence).toContain('RS_TOP3_MISSING_DIAGNOSTIC_ONLY');
  });

  it('keeps institution 5d as diagnostic only when score is enough', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      finalScore: 78,
      diagnosticEvidence: ['INSTITUTION_5D_MISSING_DIAGNOSTIC_ONLY'],
    });

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.blockReasons).not.toContain('INSTITUTION_5D_REQUIRED');
  });

  it('keeps condition count as diagnostic only when score is enough', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      finalScore: 73,
      diagnosticEvidence: ['CONDITION_COUNT_21_OF_27_DIAGNOSTIC_ONLY'],
    });

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.label).toBe('BUY');
    expect(result.blockReasons).not.toContain('CONDITION_COUNT_REQUIRED');
  });

  it('applies enemy checklist as score penalty only', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      baseScore: 78,
      scoreAdjustment: -4,
      finalScore: 74,
      diagnosticEvidence: ['ENEMY_CHECKLIST_PENALTY_ONLY'],
    });

    expect(result.finalScore).toBe(74);
    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.blockReasons).toEqual([]);
  });

  it('returns WATCH for finalScore 67', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      finalScore: 67,
    });

    expect(result.decision).toBe('WATCH');
    expect(result.label).toBe('WATCH');
  });

  it('returns REJECT_LOW_SCORE for finalScore 52 while preserving learning', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      finalScore: 52,
    });

    expect(result.decision).toBe('REJECT_LOW_SCORE');
    expect(result.label).toBe('LOW_SCORE');
    expect(result.shadowLearning).toBe(true);
  });

  it('uses data, R:R, and slot states without STRONG_BUY blockers', () => {
    expect(resolveSimpleTradeDecision({ dataUsable: false, finalScore: 90 }).decision)
      .toBe('NO_TRADE_DATA_INCOMPLETE');
    expect(resolveSimpleTradeDecision({ dataUsable: true, riskRewardOk: false, finalScore: 90 }).decision)
      .toBe('WATCH_RR_INSUFFICIENT');
    expect(resolveSimpleTradeDecision({ dataUsable: true, slotAvailable: false, finalScore: 90 }).decision)
      .toBe('WATCH_SLOT_FULL');
    expect(labelFromFinalScore(85)).toBe('HIGH_CONVICTION');
  });

  it('emits Step 4 forensic logs without forbidden Telegram blocker wording', () => {
    const result = resolveSimpleTradeDecision({
      snapshotId: 'scan_log',
      symbol: '005930',
      dataUsable: true,
      finalScore: 87,
    });
    const logs = [
      formatSimpleDecisionFinalLog(result),
      formatStrongBuyConditionDowngradedLog({
        snapshotId: 'scan_log',
        symbol: '005930',
        conditionName: 'RS_TOP3',
        scoreImpact: 3,
      }),
      formatLegacyStrongBuyBlockerIgnoredLog({
        snapshotId: 'scan_log',
        symbol: '005930',
        blockerName: 'ENEMY_CHECKLIST',
      }),
    ].join('\n');

    expect(logs).toContain('[SIMPLE_DECISION_FINAL]');
    expect(logs).toContain('strongBuyAsLabelOnly=true');
    expect(logs).toContain('qualityDecision=TRADE_READY');
    expect(logs).toContain('[STRONG_BUY_CONDITION_DOWNGRADED]');
    expect(logs).toContain('[LEGACY_STRONG_BUY_BLOCKER_IGNORED]');
    const forbiddenPhrases = [
      ['STRONG_BUY', '조건 미충족'].join(' '),
      ['CONFIRMED_STRONG_BUY', '실패'].join(' '),
      ['STRONG_BUY', '차단'].join(' '),
      ['Kelly 부족으로', 'STRONG_BUY 불가'].join(' '),
      ['R6로', 'STRONG_BUY 불가'].join(' '),
    ];
    for (const phrase of forbiddenPhrases) {
      expect(logs).not.toContain(phrase);
    }
  });

  it('includes Step 3 Gate score state in SIMPLE_DECISION_FINAL', () => {
    const gate = evaluateSoftGateScore({
      currentPrice: 50_000,
      volume: 100_000,
      tradable: true,
      technicalTrend: 'STRONG',
      supplyTrend: 'MISSING',
    });
    const result = resolveSimpleTradeDecision({
      snapshotId: 'scan_gate',
      symbol: '005930',
      dataUsable: true,
      finalScore: 74,
      gateScoreBreakdown: gate,
    });
    const log = [
      formatGateScoreEvaluatedLog({ snapshotId: 'scan_gate', symbol: '005930', breakdown: gate }),
      formatSimpleDecisionFinalLog(result),
    ].join('\n');

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.qualityDecision).toBe('TRADE_READY');
    expect(log).toContain('[GATE_SCORE_EVALUATED]');
    expect(log).toContain('dataGateUsable=true');
    expect(log).toContain('gateTotalScore=');
    expect(log).toContain('qualityDecision=TRADE_READY');
    expect(log).toContain('softFailReasons=[SUPPLY_MISSING_DIAGNOSTIC_ONLY]');
  });

  it('keeps R6 as score adjustment only when final score remains above buy threshold', () => {
    const result = resolveSimpleTradeDecision({
      snapshotId: 'scan_r6_buy',
      symbol: '005930',
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      baseScore: 78,
      regimeAdjustment: -5,
      scoreAdjustment: -5,
      finalScore: 73,
      regime: 'R6_DEFENSE',
      maxPositions: 3,
      currentPositions: 1,
      remainingSlots: 2,
    });
    const log = formatSimpleDecisionFinalLog(result);

    expect(result.decision).toBe('BUY_ALLOWED');
    expect(result.blockReasons).not.toContain('R6_DEFENSE');
    expect(log).toContain('regimeAdjustment=-5');
    expect(log).toContain('regime=R6_DEFENSE');
    expect(log).toContain('maxPositions=3');
  });

  it('allows R6 adjustment to become WATCH only through finalScore, not direct regime block', () => {
    const result = resolveSimpleTradeDecision({
      dataUsable: true,
      riskRewardOk: true,
      slotAvailable: true,
      baseScore: 72,
      regimeAdjustment: -5,
      scoreAdjustment: -5,
      finalScore: 67,
      regime: 'R6_DEFENSE',
    });

    expect(result.decision).toBe('WATCH');
    expect(result.blockReasons).toEqual([]);
  });
});
