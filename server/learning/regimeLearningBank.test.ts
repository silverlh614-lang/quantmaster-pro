import { describe, expect, it } from 'vitest';
import {
  collectRegimeLearningBank,
  collectRegimeLearningConsistency,
  formatRegimeLearningDetail,
  formatRegimeLearningSummary,
  formatRegimeConditionAttribution,
} from './regimeLearningBank.js';
import type { ShadowCase } from '../shadow/shadowTypes.js';
import type { CounterfactualShadowLearningLedgerEntry } from '../persistence/counterfactualShadowLearningRepo.js';
import type { LearningGhostCase } from './learningTypes.js';
import type { ServerAttributionRecord } from '../persistence/attributionRepo.js';
import type { CounterfactualEntry } from './counterfactualShadow.js';

function shadow(id: string, patch: Partial<ShadowCase>): ShadowCase {
  const now = '2026-05-17T00:00:00.000Z';
  return {
    caseId: id,
    signalId: id,
    symbol: id,
    symbolName: id,
    detectedAt: now,
    marketSession: 'OPEN',
    engineMode: 'NORMAL',
    dataHealth: 'OK',
    providerHealth: 'OK',
    confidenceLevel: 'VERIFIED',
    executionImpact: 'NONE',
    sourceConfidence: 'CALCULATED',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function cf(symbol: string, patch: Partial<CounterfactualShadowLearningLedgerEntry>): CounterfactualShadowLearningLedgerEntry {
  return {
    symbol,
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: false,
    label: 'R3_COUNTERFACTUAL_UNDER_HARD_BLOCK',
    reasons: ['LEARNING_ONLY'],
    blockedBy: ['HARD_BLOCK'],
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    virtualAccountImpact: 'NONE',
    createdAtKst: '2026-05-17T09:00:00+09:00',
    ...patch,
  };
}

describe('Regime Learning Bank', () => {
  it('separates R1/R6 Shadow cases into regime-specific stats', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      shadowCases: [
        shadow('r1-win', {
          rawRegime: 'R1_TURBO',
          effectiveRegime: 'R1_TURBO',
          outcomeLabel: 'WIN',
          returnR: 1.2,
          cohortType: 'FRESH_SHADOW',
          conditionTags: ['RS_ACCELERATION'],
          sectorTag: 'semiconductor',
        }),
        shadow('r6-loss', {
          rawRegime: 'R6_DEFENSE',
          effectiveRegime: 'R6_DEFENSE',
          outcomeLabel: 'LOSS',
          returnR: -0.2,
          cohortType: 'FRESH_SHADOW',
          conditionTags: ['LOW_BETA_SURVIVOR'],
          sectorTag: 'auto',
        }),
      ],
      counterfactualEntries: [],
    });

    const r1 = bank.stats.find((s) => s.regimePhase === 'R1_RECOVERY');
    const r6 = bank.stats.find((s) => s.regimePhase === 'R6_DEFENSE');
    expect(r1?.sampleSize).toBe(1);
    expect(r1?.expectancyR).toBe(1.2);
    expect(r1?.qualityStatus).toBe('LOW_SAMPLE');
    expect(r1?.reversalPattern).toContain('R1 reversal pattern');
    expect(r6?.sampleSize).toBe(1);
    expect(r6?.expectancyR).toBe(-0.2);
    expect(r6?.survivorPattern).toContain('R6 survivor pattern');
    expect(bank.activeRegime).toBe('R6_DEFENSE');
    expect(bank.promotionAllowed).toBe(false);
    expect(bank.recommendationOnly).toBe(true);
    expect(bank.brokerOrdersCreated).toBe(0);
  });

  it('counts SELL_ONLY Shadow samples and HARD_BLOCK counterfactual samples without promotion', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R2_BULL',
      effectiveRegime: 'R2_BULL',
      shadowCases: [
        shadow('sell-only-fresh', {
          engineMode: 'SELL_ONLY',
          outcomeLabel: 'BREAKEVEN',
          cohortType: 'FRESH_SHADOW',
          returnR: 0,
        }),
      ],
      counterfactualEntries: [
        cf('cf-hard', {
          rawRegime: 'R2_BULL',
          effectiveRegime: 'R2_BULL',
          hardBlockActive: true,
          blockedBy: ['HARD_BLOCK'],
        }),
      ],
    });

    expect(bank.stats.find((s) => s.regimePhase === 'SELL_ONLY')?.freshShadowCount).toBe(1);
    expect(bank.stats.find((s) => s.regimePhase === 'HARD_BLOCK')?.counterfactualCount).toBe(1);
    expect(bank.stats.every((s) => s.promotionAllowed === false && s.diagnosticOnly === true)).toBe(true);
  });

  it('marks regime condition attribution as LOW_SAMPLE below 30 samples', () => {
    const rows = Array.from({ length: 3 }, (_, i) => shadow(`r3-${i}`, {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      outcomeLabel: i === 0 ? 'LOSS' : 'WIN',
      returnR: i === 0 ? -0.5 : 0.4,
      conditionTags: ['VCP_BREAKOUT'],
    }));

    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: rows,
      counterfactualEntries: [],
    });
    const r3 = bank.stats.find((s) => s.regimePhase === 'R3_EXPANSION');

    expect(r3?.lowSampleConditions[0]?.conditionId).toBe('VCP_BREAKOUT');
    expect(r3?.lowSampleConditions[0]?.confidence).toBe('LOW_SAMPLE');
    expect(r3?.lowSampleConditions[0]?.direction).toBe('INSUFFICIENT_SAMPLE');
    expect(r3?.lowSampleConditions[0]?.recommendation).toBe('INSUFFICIENT_SAMPLE_NO_WEIGHT_UPDATE');
    expect(r3?.breakoutPattern).toContain('R3 trend continuation pattern');
  });

  it('computes quality status from sample size, label completion, and recovery confidence', () => {
    const lowSample = collectRegimeLearningBank({
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      shadowCases: [shadow('r6-low', { effectiveRegime: 'R6_DEFENSE', outcomeLabel: 'WIN', returnR: 0.1 })],
      counterfactualEntries: [],
    }).stats.find((s) => s.regimePhase === 'R6_DEFENSE');

    const learningRows = Array.from({ length: 40 }, (_, i) => shadow(`r3-${i}`, {
      effectiveRegime: 'R3_EARLY',
      outcomeLabel: 'WIN',
      returnR: 0.1,
    }));
    const learning = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: learningRows,
      counterfactualEntries: [],
    }).stats.find((s) => s.regimePhase === 'R3_EXPANSION');

    const lowConfidenceRows = Array.from({ length: 80 }, (_, i) => shadow(`r2-low-conf-${i}`, {
      effectiveRegime: 'R2_BULL',
      regimeRecoveryConfidence: i < 20 ? 'HIGH' : 'LOW',
      outcomeLabel: 'WIN',
      returnR: 0.1,
    }));
    const lowConfidence = collectRegimeLearningBank({
      rawRegime: 'R2_BULL',
      effectiveRegime: 'R2_BULL',
      shadowCases: lowConfidenceRows,
      counterfactualEntries: [],
    }).stats.find((s) => s.regimePhase === 'R2_EARLY');

    expect(lowSample?.qualityStatus).toBe('LOW_SAMPLE');
    expect(learning?.qualityStatus).toBe('LEARNING');
    expect(lowConfidence?.qualityStatus).toBe('LOW_CONFIDENCE');
    expect(lowConfidence?.sourceConfidenceHighRatio).toBeLessThan(0.7);
  });

  it('formats summary and detail with recommendation-only safety markers', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      shadowCases: [shadow('r6-win', { effectiveRegime: 'R6_DEFENSE', outcomeLabel: 'WIN', returnR: 0.3 })],
      counterfactualEntries: [cf('cf-r6', { effectiveRegime: 'R6_DEFENSE', rawRegime: 'R6_DEFENSE', blockedBy: ['R6_DEFENSE'] })],
    });

    const summary = formatRegimeLearningSummary(bank);
    const detail = formatRegimeLearningDetail('R6_DEFENSE', bank);
    expect(summary).toContain('Regime Learning Bank');
    expect(summary).toContain('R6_DEFENSE');
    expect(summary).toContain('promotionAllowed=false');
    expect(summary).toContain('liveEntryAllowed=');
    expect(summary).toContain('brokerOrdersCreated=0');
    expect(detail).toContain('Regime Learning Detail: R6_DEFENSE');
    expect(detail).toContain('recommendationOnly=true');
    expect(detail).toContain('survivorPattern=');
  });

  it('renders R2/R3/R6 regime-specific interpretation layers', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: [
        shadow('r2', { effectiveRegime: 'R2_BULL', outcomeLabel: 'WIN', returnR: 0.3, conditionTags: ['RS_ACCELERATION'] }),
        shadow('r3', { effectiveRegime: 'R3_EARLY', outcomeLabel: 'WIN', returnR: 0.4, conditionTags: ['VCP_BREAKOUT'] }),
        shadow('r6', { effectiveRegime: 'R6_DEFENSE', outcomeLabel: 'WIN', returnR: 0.1, conditionTags: ['LOW_BETA_SURVIVOR'] }),
      ],
      counterfactualEntries: [],
    });

    expect(formatRegimeLearningDetail('R2_EARLY', bank)).toContain('earlyLeaderPattern=R2 early leader pattern');
    expect(formatRegimeLearningDetail('R3_EXPANSION', bank)).toContain('trendContinuationPattern=R3 trend continuation pattern');
    expect(formatRegimeLearningDetail('R6_DEFENSE', bank)).toContain('supplyRetentionPattern=');
  });

  it('details R3_EXPANSION with only R3 samples', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: [
        shadow('r3-win', { effectiveRegime: 'R3_EARLY', outcomeLabel: 'WIN', returnR: 0.7, conditionTags: ['VCP_BREAKOUT'] }),
        shadow('r6-win', { effectiveRegime: 'R6_DEFENSE', outcomeLabel: 'WIN', returnR: 2.1, conditionTags: ['LOW_BETA_SURVIVOR'] }),
      ],
      counterfactualEntries: [],
    });

    const detail = formatRegimeLearningDetail('R3_EXPANSION', bank);
    expect(detail).toContain('Regime Learning Detail: R3_EXPANSION');
    expect(detail).toContain('sampleSize=1');
    expect(detail).toContain('VCP_BREAKOUT');
    expect(detail).not.toContain('LOW_BETA_SURVIVOR');
  });

  it('connects legacy ghost, counterfactual, outcome, and attribution samples by regime without duplicate outcome counting', () => {
    const ghost = {
      id: 'trade-r6',
      tradeId: 'trade-r6',
      stockCode: '005930',
      stockName: 'Samsung',
      signalPriceKrw: 100,
      signalDate: '2026-05-17',
      rejectionReason: 'R6_DEFENSE_BLOCK',
      trackUntil: '2026-06-17',
      closed: true,
      outcomeLabel: 'WIN',
      returnR: 0.5,
      caseKind: 'ghost',
      regimePhase: 'R6_DEFENSE',
    } as LearningGhostCase & { tradeId: string };
    const attribution: ServerAttributionRecord = {
      schemaVersion: 2,
      tradeId: 'trade-r6',
      stockCode: '005930',
      stockName: 'Samsung',
      closedAt: '2026-05-17T06:00:00.000Z',
      returnPct: 5,
      isWin: true,
      conditionScores: { 1: 9 },
      holdingDays: 1,
      regimePhase: 'R6_DEFENSE',
    };
    const legacyCf: CounterfactualEntry = {
      id: 'cf-r3',
      stockCode: '000660',
      stockName: 'SK Hynix',
      signalDate: '2026-05-17',
      signalTime: '2026-05-17T01:00:00.000Z',
      priceAtSignal: 100,
      gateScore: 5,
      regime: 'R3_EARLY',
      conditionKeys: ['VCP_BREAKOUT'],
      skipReason: 'GATE_UNDER',
      outcomeStatus: 'PENDING',
    };

    const bank = collectRegimeLearningBank({
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      shadowCases: [],
      counterfactualEntries: [],
      ghostCases: [ghost],
      attributionRecords: [attribution],
      legacyCounterfactualEntries: [legacyCf],
    });
    const r6 = bank.stats.find((s) => s.regimePhase === 'R6_DEFENSE');
    const r3 = bank.stats.find((s) => s.regimePhase === 'R3_EXPANSION');
    const consistency = collectRegimeLearningConsistency(bank);

    expect(r6?.sampleSize).toBe(1);
    expect(r6?.ghostRepairCount).toBe(1);
    expect(r3?.counterfactualCount).toBe(1);
    expect(bank.duplicateCaseCount).toBe(1);
    expect(consistency.regimeSumMatchesTotal).toBe(true);
    expect(consistency.duplicateCaseCount).toBe(1);
    expect(consistency.unknownRatio).toBe(0);
  });

  it('formats condition attribution with insufficient sample and N/A effect for unlabeled rows', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: [
        shadow('open-r3', { effectiveRegime: 'R3_EARLY', conditionTags: ['VCP_BREAKOUT'] }),
      ],
      counterfactualEntries: [],
    });

    const msg = formatRegimeConditionAttribution('R3_EXPANSION', bank);
    expect(msg).toContain('conditionId=VCP_BREAKOUT');
    expect(msg).toContain('direction=INSUFFICIENT_SAMPLE');
    expect(msg).toContain('effect=N/A');
    expect(msg).toContain('recommendationOnly=true');
    expect(msg).toContain('promotionAllowed=false');
  });
});
