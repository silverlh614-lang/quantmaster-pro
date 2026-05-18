import { describe, expect, it } from 'vitest';
import {
  collectRegimeLearningBank,
  collectRegimeLearningConsistency,
  collectRegimeResolvedStatus,
  formatRegimeLearningDetail,
  formatRegimeLearningSummary,
  formatRegimeConditionAttribution,
  formatRegimeLearningQuality,
  formatRegimeResolvedStatus,
  regimeAttributionRecalcDryRun,
  regimeAttributionRecalcRun,
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
    expect(r1?.qualityStatus).toBe('LOW_RESOLVED_SAMPLE');
    expect(r1?.reversalPattern).toContain('R1 reversal pattern');
    expect(r6?.sampleSize).toBe(1);
    expect(r6?.expectancyR).toBe(-0.2);
    expect(r6?.survivorPattern).toContain('R6 survivor pattern');
    expect(bank.R1QualityStatus).toBe('LOW_RESOLVED_SAMPLE');
    expect(bank.R2QualityStatus).toBe('NO_SAMPLE');
    expect(bank.R3QualityStatus).toBe('NO_SAMPLE');
    expect(bank.R4QualityStatus).toBe('NO_SAMPLE');
    expect(bank.R5QualityStatus).toBe('NO_SAMPLE');
    expect(bank.R6QualityStatus).toBe('LOW_RESOLVED_SAMPLE');
    expect(bank.R6ResolvedSampleSize).toBe(1);
    expect(bank.R6ResolvedPromotionMin).toBe(100);
    expect(bank.R6PromotionGateSatisfied).toBe(false);
    expect(bank.R6PromotionBlocker).toBe('R6_RESOLVED_SAMPLE_LT_100');
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

    expect(lowSample?.qualityStatus).toBe('LOW_RESOLVED_SAMPLE');
    expect(learning?.qualityStatus).toBe('OVERFIT_RISK');
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
    expect(msg).toContain('conditionAttributionInput=RESOLVED_ONLY');
    expect(msg).toContain('conditionRows=N/A');
    expect(msg).toContain('reason=NO_ATTRIBUTABLE_RESOLVED_CONDITIONS');
    expect(msg).toContain('recommendationOnly=true');
    expect(msg).toContain('promotionAllowed=false');
  });

  it('splits R3 total samples from resolved and pending counterfactual samples', () => {
    const resolved = Array.from({ length: 3 }, (_, i) => shadow(`r3-resolved-${i}`, {
      effectiveRegime: 'R3_EARLY',
      outcomeLabel: i === 0 ? 'LOSS' : 'WIN',
      returnR: i === 0 ? -0.5 : 0.4,
      conditionTags: ['VCP_BREAKOUT'],
    }));
    const pending = Array.from({ length: 453 }, (_, i) => cf(`cf-r3-${i}`, {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      blockedBy: ['GATE2_NOT_CONFIRMED'],
    }));
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: resolved,
      counterfactualEntries: pending,
    });
    const r3 = bank.stats.find((s) => s.regimePhase === 'R3_EXPANSION');

    expect(r3?.totalSampleSize).toBe(456);
    expect(r3?.resolvedSampleSize).toBe(3);
    expect(r3?.pendingCounterfactualCount).toBe(453);
    expect(r3?.attributableSampleSize).toBe(3);
    expect(r3?.qualityStatus).toBe('LOW_RESOLVED_SAMPLE');
    expect(r3?.expectancyConfidence).toBe('VERY_LOW');
    expect(formatRegimeLearningDetail('R3_EXPANSION', bank)).toContain('Only 3 resolved samples; 453 counterfactual cases still pending maturity.');
  });

  it('renders R6 expectancy as N/A when no resolved samples exist', () => {
    const pending = Array.from({ length: 13 }, (_, i) => cf(`cf-r6-${i}`, {
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      regimePhase: 'R6_DEFENSE',
      blockedBy: ['R6_DEFENSE'],
    }));
    const bank = collectRegimeLearningBank({
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      shadowCases: [],
      counterfactualEntries: pending,
    });
    const detail = formatRegimeLearningDetail('R6_DEFENSE', bank);

    expect(detail).toContain('resolvedSampleSize=0');
    expect(detail).toContain('expectancyR=N/A');
    expect(detail).toContain('expectancyReason=NO_RESOLVED_SAMPLE');
    expect(detail).toContain('R6 생존 패턴은 아직 라벨링 전');
  });

  it('excludes pending counterfactuals from expectancy and condition attribution', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: [
        shadow('r3-one-win', {
          effectiveRegime: 'R3_EARLY',
          outcomeLabel: 'WIN',
          returnR: 1,
          conditionTags: ['VCP_BREAKOUT'],
        }),
      ],
      counterfactualEntries: Array.from({ length: 99 }, (_, i) => cf(`cf-r3-pending-${i}`, {
        rawRegime: 'R3_EARLY',
        effectiveRegime: 'R3_EARLY',
        regimePhase: 'R3_EXPANSION',
        blockedBy: [],
      })),
    });
    const r3 = bank.stats.find((s) => s.regimePhase === 'R3_EXPANSION');

    expect(r3?.expectancyR).toBe(1);
    expect(r3?.pendingCounterfactualCount).toBe(99);
    expect(r3?.conditionAttributions[0]?.samples).toBe(1);
    expect(r3?.conditionAttributions[0]?.direction).toBe('INSUFFICIENT_SAMPLE');
    expect(r3?.conditionAttributions[0]?.recommendation).toBe('INSUFFICIENT_SAMPLE_NO_WEIGHT_UPDATE');
  });

  it('does not promote low-sample positive conditions to ALPHA_DRIVER', () => {
    const rows = [
      shadow('r3-closed', { effectiveRegime: 'R3_EARLY', outcomeLabel: 'WIN', returnR: 2, conditionTags: ['TREND_VCP_PULLBACK'] }),
      ...Array.from({ length: 50 }, (_, i) => shadow(`r3-open-${i}`, { effectiveRegime: 'R3_EARLY', conditionTags: ['TREND_VCP_PULLBACK'] })),
    ];
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: rows,
      counterfactualEntries: [],
    });
    const condition = bank.stats.find((s) => s.regimePhase === 'R3_EXPANSION')?.conditionAttributions[0];

    expect(condition?.samples).toBe(1);
    expect(condition?.direction).toBe('INSUFFICIENT_SAMPLE');
    expect(condition?.direction).not.toBe('ALPHA_DRIVER');
  });

  it('isolates UNKNOWN samples from promotion metrics and quality output', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'UNKNOWN',
      effectiveRegime: 'UNKNOWN',
      shadowCases: [
        shadow('unknown-win', {
          effectiveRegime: 'UNKNOWN',
          outcomeLabel: 'WIN',
          returnR: 0.2,
          sourceConfidence: 'UNKNOWN',
          confidenceLevel: 'FALLBACK',
        }),
      ],
      counterfactualEntries: [],
    });
    const detail = formatRegimeLearningDetail('UNKNOWN', bank);
    const quality = formatRegimeLearningQuality(bank);

    expect(detail).toContain('UNKNOWNPromotionIsolation=UNKNOWN samples are excluded from promotion metrics');
    expect(quality).toContain('UNKNOWN condition attribution is diagnostic-only');
    expect(quality).toContain('promotionAllowed=false');
  });

  it('formats regime learning quality with resolved and pending ratios', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: [
        shadow('r3-win-quality', { effectiveRegime: 'R3_EARLY', outcomeLabel: 'WIN', returnR: 0.3 }),
      ],
      counterfactualEntries: [
        cf('cf-r3-quality', { rawRegime: 'R3_EARLY', effectiveRegime: 'R3_EARLY' }),
      ],
    });
    const msg = formatRegimeLearningQuality(bank);

    expect(msg).toContain('Regime Learning Quality');
    expect(msg).toContain('resolvedSampleSize=1');
    expect(msg).toContain('pendingCounterfactualCount=1');
    expect(msg).toContain('resolvedRatio=');
    expect(msg).toContain('executionImpact=NONE');
    expect(msg).toContain('brokerOrdersCreated=0');
    expect(msg).toContain('recommendationOnly=true');
  });

  it('tracks R2/R3/R6 resolved status and maturity buckets by regime', () => {
    const now = new Date('2026-05-17T00:00:00.000Z');
    const r3Resolved = Array.from({ length: 3 }, (_, i) => shadow(`r3-status-${i}`, {
      effectiveRegime: 'R3_EARLY',
      outcomeLabel: i === 0 ? 'LOSS' : 'WIN',
      returnR: i === 0 ? -0.1 : 0.2,
      conditionTags: ['VCP_BREAKOUT'],
    }));
    const r3Pending = Array.from({ length: 453 }, (_, i) => cf(`cf-r3-status-${i}`, {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      regimePhase: 'R3_EXPANSION',
      signalTime: '2026-05-16T00:00:00.000Z',
      maxHoldingMinutes: i === 0 ? 24 * 60 : 8 * 24 * 60,
    } as Partial<CounterfactualShadowLearningLedgerEntry> & Record<string, unknown>));
    const r6Pending = Array.from({ length: 13 }, (_, i) => cf(`cf-r6-status-${i}`, {
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      regimePhase: 'R6_DEFENSE',
      signalTime: '2026-05-16T00:00:00.000Z',
      maxHoldingMinutes: 2 * 24 * 60,
    } as Partial<CounterfactualShadowLearningLedgerEntry> & Record<string, unknown>));

    const status = collectRegimeResolvedStatus({
      now,
      rawRegime: 'R6_DEFENSE',
      effectiveRegime: 'R6_DEFENSE',
      shadowCases: r3Resolved,
      counterfactualEntries: [...r3Pending, ...r6Pending],
    });
    const r3 = status.rows.find((row) => row.regimePhase === 'R3_EXPANSION');
    const r6 = status.rows.find((row) => row.regimePhase === 'R6_DEFENSE');
    const r3Maturity = status.maturityByRegime.find((row) => row.regimePhase === 'R3_EXPANSION');
    const r6Maturity = status.maturityByRegime.find((row) => row.regimePhase === 'R6_DEFENSE');
    const formatted = formatRegimeResolvedStatus(status);

    expect(r3?.totalSampleSize).toBe(456);
    expect(r3?.resolvedSampleSize).toBe(3);
    expect(r3?.pendingCounterfactualCount).toBe(453);
    expect(r3?.qualityStatus).toBe('LOW_RESOLVED_SAMPLE');
    expect(r3?.dueWithin7d).toBe(453);
    expect(r6?.totalSampleSize).toBe(13);
    expect(r6?.resolvedSampleSize).toBe(0);
    expect(r6?.pendingCounterfactualCount).toBe(13);
    expect(r3Maturity?.dueIn4to7CalendarDays).toBe(452);
    expect((r6Maturity?.dueNextTradingDay ?? 0) + (r6Maturity?.dueIn2to3CalendarDays ?? 0)).toBe(13);
    expect(formatted).toContain('Regime Resolved Status');
    expect(formatted).toContain('executionImpact=NONE');
    expect(formatted).toContain('promotionAllowed=false');
  });

  it('keeps R6 counterfactual samples in their entry regime after later recovery states', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'R5_CAUTION',
      effectiveRegime: 'R5_CAUTION',
      shadowCases: [],
      counterfactualEntries: [
        cf('cf-r6-resolved-transition', {
          rawRegime: 'R6_DEFENSE',
          effectiveRegime: 'R5_CAUTION',
          entryRegime: 'R6_DEFENSE',
          entryEffectiveState: 'R6_DEFENSE',
          exitRegime: 'R5_STABILIZING',
          resolvedAfterRegimeTransition: true,
          transitionPath: ['R6_DEFENSE', 'R6_RECOVERY_WATCH', 'R5_STABILIZING'],
          outcomeLabel: 'MISSED_WIN',
          outcomeStatus: 'LABELED',
          outcomeR: 1.2,
          maturityWindow: 'TARGET_HIT',
          resolvedAt: '2026-05-18T00:10:00.000Z',
        } as Partial<CounterfactualShadowLearningLedgerEntry> & Record<string, unknown>),
        cf('cf-r6-pending-transition', {
          rawRegime: 'R6_DEFENSE',
          effectiveRegime: 'R5_CAUTION',
          entryRegime: 'R6_DEFENSE',
          entryEffectiveState: 'R6_DEFENSE',
          transitionPath: ['R6_DEFENSE'],
          signalTime: '2026-05-18T00:00:00.000Z',
          maxHoldingMinutes: 3 * 24 * 60,
        } as Partial<CounterfactualShadowLearningLedgerEntry> & Record<string, unknown>),
      ],
    });

    const r6 = bank.stats.find((s) => s.regimePhase === 'R6_DEFENSE');
    const r5 = bank.stats.find((s) => s.regimePhase === 'R5_CAUTION');
    expect(r6?.sampleSize).toBe(2);
    expect(r6?.resolvedSampleSize).toBe(1);
    expect(r6?.pendingCounterfactualCount).toBe(1);
    expect(r6?.expectancyR).toBe(1.2);
    expect(r6?.expectancyReason).toBeUndefined();
    expect(r5?.sampleSize ?? 0).toBe(0);
    expect(bank.R6ResolvedSampleSize).toBe(1);
    expect(bank.R6PendingCounterfactualCount).toBe(1);
    expect(bank.R6PromotionGateSatisfied).toBe(false);
    expect(bank.R6PromotionBlocker).toBe('R6_RESOLVED_SAMPLE_LT_100');
    expect(bank.promotionAllowed).toBe(false);
  });

  it('registers resolved deltas as attribution recalc candidates without weight updates', () => {
    const rows = Array.from({ length: 30 }, (_, i) => shadow(`r3-recalc-${i}`, {
      effectiveRegime: 'R3_EARLY',
      outcomeLabel: i % 2 === 0 ? 'WIN' : 'LOSS',
      returnR: i % 2 === 0 ? 0.3 : -0.1,
      conditionTags: ['TREND_VCP_PULLBACK'],
    }));
    const transitionState = {
      lastResolvedAt: '2026-05-17T00:00:00.000Z',
      lastResolvedCount: 31,
      lastResolvedByRegime: { R3_EXPANSION: 30, R6_DEFENSE: 1 },
      attributionRecalcNeeded: true,
      executionImpact: 'NONE' as const,
      brokerOrdersCreated: 0 as const,
      promotionAllowed: false as const,
      recommendationOnly: true as const,
    };
    const dryrun = regimeAttributionRecalcDryRun({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: rows,
      counterfactualEntries: [],
      transitionState,
    });
    const run = regimeAttributionRecalcRun({
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R3_EARLY',
      shadowCases: rows,
      counterfactualEntries: [],
      transitionState,
      persist: false,
    });

    expect(dryrun.regimesNeedingRecalc).toEqual(['R3_EXPANSION', 'R6_DEFENSE']);
    expect(dryrun.attributableSampleSizeByRegime.R3_EXPANSION).toBe(30);
    expect(dryrun.stillInsufficientRegimes).toContain('R6_DEFENSE');
    expect(run.recalculatedRegimes).toEqual(['R3_EXPANSION']);
    expect(run.skippedLowSampleRegimes).toEqual(['R6_DEFENSE']);
    expect(run.noWeightUpdate).toBe(true);
    expect(run.recommendationOnly).toBe(true);
    expect(run.executionImpact).toBe('NONE');
    expect(run.brokerOrdersCreated).toBe(0);
    expect(run.promotionAllowed).toBe(false);
  });

  it('excludes UNKNOWN from bestRegimeByExpectancy and marks it diagnostic-only', () => {
    const bank = collectRegimeLearningBank({
      rawRegime: 'UNKNOWN',
      effectiveRegime: 'UNKNOWN',
      shadowCases: [
        shadow('unknown-big-win', {
          effectiveRegime: 'UNKNOWN',
          outcomeLabel: 'WIN',
          returnR: 5,
          sourceConfidence: 'UNKNOWN',
          confidenceLevel: 'FALLBACK',
        }),
        shadow('r3-small-win', {
          effectiveRegime: 'R3_EARLY',
          outcomeLabel: 'WIN',
          returnR: 0.1,
        }),
      ],
      counterfactualEntries: [],
    });

    expect(bank.bestRegimeByExpectancy).toBe('R3_EXPANSION');
    expect(formatRegimeLearningDetail('UNKNOWN', bank)).toContain('UNKNOWNPromotionIsolation=');
  });
});
