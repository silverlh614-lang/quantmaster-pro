import { describe, expect, it } from 'vitest';
import {
  canUseFeatureForGatePass,
  formatAiConfidenceTelegramLine,
  formatAiEstimateExcludedFromExecutionLog,
  formatScoreConfidenceSplitLog,
  makeFeatureValue,
  splitFeatureScores,
} from './aiExecutionIsolation.js';
import { resolveSimpleTradeDecision } from './simpleDecision.js';

describe('Simplification Step 7 AI execution isolation', () => {
  it('excludes AI estimated ROE from final execution score', () => {
    const breakdown = splitFeatureScores({
      snapshotId: 'scan_ai_roe',
      symbol: '005930',
      features: [{
        featureName: 'estimatedROE',
        value: 20,
        score: 10,
        confidence: 'AI_ESTIMATED',
        source: 'LLM_SEARCH_SUMMARY',
      }],
    });

    expect(breakdown.executionScore).toBe(0);
    expect(breakdown.finalScore).toBe(0);
    expect(breakdown.advisoryScore).toBe(10);
    expect(breakdown.excludedAiScore).toBe(10);
    expect(breakdown.diagnostics[0]?.reason).toBe('AI_ESTIMATED_EXCLUDED_FROM_EXECUTION');
    expect(formatAiEstimateExcludedFromExecutionLog(breakdown.diagnostics[0]!))
      .toContain('[AI_ESTIMATE_EXCLUDED_FROM_EXECUTION]');
  });

  it('includes COMPUTED RSI in execution score', () => {
    const breakdown = splitFeatureScores({
      features: [{
        featureName: 'rsi14',
        value: 62,
        score: 5,
        confidence: 'COMPUTED',
        source: 'OHLCV_COMPUTED',
      }],
    });

    expect(breakdown.executionScore).toBe(5);
    expect(breakdown.finalScore).toBe(5);
    expect(breakdown.advisoryScore).toBe(0);
  });

  it('includes KIS API reported supply in execution score', () => {
    const breakdown = splitFeatureScores({
      features: [{
        featureName: 'kisInstitutionNetBuy',
        value: 2_300_000_000,
        score: 8,
        confidence: 'API_REPORTED',
        source: 'KIS_API',
      }],
    });

    expect(breakdown.executionScore).toBe(8);
    expect(breakdown.executionEligibleFeatureCount).toBe(1);
  });

  it('does not let Gemini catalyst advisory score create BUY_ALLOWED', () => {
    const breakdown = splitFeatureScores({
      snapshotId: 'scan_ai_catalyst',
      symbol: '005930',
      adjustmentScore: 0,
      features: [
        {
          featureName: 'verifiedExecutionScore',
          value: 60,
          score: 60,
          confidence: 'VERIFIED',
          source: 'GATE_SCORE',
        },
        {
          featureName: 'geminiCatalystScore',
          value: 'positive catalyst',
          score: 30,
          confidence: 'LLM_INFERRED',
          source: 'GEMINI',
        },
      ],
    });
    const decision = resolveSimpleTradeDecision({
      snapshotId: 'scan_ai_catalyst',
      symbol: '005930',
      dataUsable: true,
      executionScore: breakdown.executionScore,
      advisoryScore: breakdown.advisoryScore,
      excludedAiScore: breakdown.excludedAiScore,
      finalScore: breakdown.finalScore,
    });

    expect(breakdown.executionScore).toBe(60);
    expect(breakdown.advisoryScore).toBe(30);
    expect(decision.finalScore).toBe(60);
    expect(decision.decision).toBe('WATCH');
  });

  it('keeps AI estimates as shadow-only counterfactual evidence', () => {
    const breakdown = splitFeatureScores({
      snapshotId: 'scan_shadow_ai',
      symbol: '005930',
      features: [{
        featureName: 'aiCatalyst',
        value: 'theme narrative',
        score: 7,
        confidence: 'SEARCH_SUMMARIZED',
        source: 'SEARCH_SUMMARY',
      }],
    });

    expect(breakdown.diagnostics[0]).toMatchObject({
      shadowOnly: true,
      learningLabel: 'AI_ESTIMATE_OBSERVED',
      executionImpact: 'NONE',
    });
  });

  it('formats score split and Telegram advisory lines', () => {
    const breakdown = splitFeatureScores({
      snapshotId: 'scan_log',
      symbol: '005930',
      adjustmentScore: -2,
      aiNarrativeScore: 9,
      features: [
        { featureName: 'rsi14', value: 62, score: 76, confidence: 'COMPUTED', source: 'OHLCV_COMPUTED' },
        { featureName: 'sectorNarrative', value: 'leader', score: 9, confidence: 'AI_ESTIMATED', source: 'GEMINI' },
      ],
    });
    const log = formatScoreConfidenceSplitLog({ snapshotId: 'scan_log', symbol: '005930', breakdown });

    expect(log).toContain('[SCORE_CONFIDENCE_SPLIT]');
    expect(log).toContain('executionScore=76');
    expect(log).toContain('adjustmentScore=-2');
    expect(log).toContain('finalScore=74');
    expect(log).toContain('advisoryScore=9');
    expect(formatAiConfidenceTelegramLine(breakdown)).toBe('AI 추정값: 실행 제외');
  });

  it('does not allow AI estimated values to make Gate PASS', () => {
    const aiRoe = makeFeatureValue({
      value: 20,
      confidence: 'AI_ESTIMATED',
      source: 'LLM_SEARCH_SUMMARY',
    });
    const computedRsi = makeFeatureValue({
      value: 62,
      confidence: 'COMPUTED',
      source: 'OHLCV_COMPUTED',
    });

    expect(canUseFeatureForGatePass(aiRoe)).toBe(false);
    expect(canUseFeatureForGatePass(computedRsi)).toBe(true);
  });
});
