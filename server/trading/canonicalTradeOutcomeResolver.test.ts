import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatCanonicalTradeOutcomeTelegram,
  resolveCanonicalTradeOutcome,
  resolveCanonicalTradeOutcomeFromShadowTrade,
} from './canonicalTradeOutcomeResolver.js';
import {
  summarizeAttributionOutcomeQuality,
  type AttributionOutcomeQualitySummary,
} from '../learning/attributionEvidenceAggregator.js';
import type { AttributionEvidenceRecord } from '../learning/attributionEvidenceTypes.js';

const originalDataDir = process.env.PERSIST_DATA_DIR;
let tmpDir = '';

function baseInput(overrides: Partial<Parameters<typeof resolveCanonicalTradeOutcome>[0]> = {}) {
  return {
    tradeId: 'trade-1',
    symbol: '005930',
    source: 'SHADOW' as const,
    grossReturnPct: 4,
    returnR: 1,
    realizedProfit: 50_000,
    maxRiskAmount: 50_000,
    entryPrice: 10_000,
    finalExitPrice: 10_800,
    totalQty: 10,
    exitedQty: 10,
    remainingQty: 0,
    tp1Hit: true,
    tp2Hit: true,
    stopHit: false,
    breakevenStopActivated: false,
    trailingStopActivated: false,
    forcedExit: false,
    now: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<AttributionEvidenceRecord>): AttributionEvidenceRecord {
  const now = '2026-05-20T00:00:00.000Z';
  return {
    evidenceId: overrides.evidenceId ?? `ev-${Math.random()}`,
    tradeDate: '2026-05-20',
    symbol: '005930',
    regime: 'R2_BULL',
    conditionKeys: ['momentum'],
    source: 'LIVE',
    eligibility: 'CORE_ELIGIBLE',
    outcomeStatus: 'CONFIRMED',
    executionStatus: 'EXECUTED',
    engineMode: 'NORMAL',
    dataConfidence: 'VERIFIED',
    returnPct: 0,
    returnR: 0,
    executionImpact: 'NONE',
    createdAt: now,
    updatedAt: now,
    auditTags: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-outcome-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('resolveCanonicalTradeOutcome', () => {
  it('classifies full target exit as FULL_WIN / WIN_FULL', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput());
    expect(outcome.outcome).toBe('FULL_WIN');
    expect(outcome.winRateBucket).toBe('WIN_FULL');
    expect(outcome.exitPath).toBe('TP1_THEN_TP2');
  });

  it('classifies TP1 then breakeven stop as PARTIAL_WIN_BREAKEVEN / WIN_PARTIAL', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      returnR: 0.42,
      grossReturnPct: 2.1,
      finalExitPrice: 10_000,
      tp2Hit: false,
      stopHit: true,
      breakevenStopActivated: true,
    }));
    expect(outcome.outcome).toBe('PARTIAL_WIN_BREAKEVEN');
    expect(outcome.winRateBucket).toBe('WIN_PARTIAL');
    expect(outcome.exitPath).toBe('TP1_THEN_BREAKEVEN_EXIT');
    expect(outcome.lifecycleOutcome).toBe('TP1_THEN_BREAKEVEN');
    expect(outcome.outcomeClass).toBe('WIN_BREAKEVEN');
    expect(outcome.learningTags).toContain('TP1_THEN_BREAKEVEN_EXIT');
  });

  it('classifies TP1 then profitable trailing stop as PARTIAL_WIN / WIN_PARTIAL', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      returnR: 0.5,
      tp2Hit: false,
      finalExitPrice: 10_300,
      trailingStopActivated: true,
    }));
    expect(outcome.outcome).toBe('PARTIAL_WIN');
    expect(outcome.winRateBucket).toBe('WIN_PARTIAL');
    expect(outcome.exitPath).toBe('TP1_THEN_TRAILING_STOP');
  });

  it('classifies direct breakeven as BREAKEVEN / BREAKEVEN', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      returnR: 0.02,
      grossReturnPct: 0.02,
      finalExitPrice: 10_002,
      tp1Hit: false,
      tp2Hit: false,
      breakevenStopActivated: true,
    }));
    expect(outcome.outcome).toBe('BREAKEVEN');
    expect(outcome.winRateBucket).toBe('BREAKEVEN');
  });

  it('classifies direct stop loss as FULL_LOSS / LOSS', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      returnR: -1,
      grossReturnPct: -5,
      finalExitPrice: 9_500,
      tp1Hit: false,
      tp2Hit: false,
      stopHit: true,
      realizedProfit: -50_000,
    }));
    expect(outcome.outcome).toBe('FULL_LOSS');
    expect(outcome.winRateBucket).toBe('LOSS');
    expect(outcome.exitPath).toBe('STOP_LOSS_DIRECT');
  });

  it('classifies profitable forced exit as FORCED_EXIT_WIN / WIN_PARTIAL', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      returnR: 0.2,
      tp1Hit: false,
      tp2Hit: false,
      forcedExit: true,
      forcedExitReason: 'R6_FORCE_EXIT',
    }));
    expect(outcome.outcome).toBe('FORCED_EXIT_WIN');
    expect(outcome.winRateBucket).toBe('WIN_PARTIAL');
    expect(outcome.exitPath).toBe('R6_FORCE_EXIT');
  });

  it('classifies losing forced exit as FORCED_EXIT_LOSS / LOSS', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      returnR: -0.4,
      realizedProfit: -20_000,
      forcedExit: true,
      forcedExitReason: 'R6_FORCE_EXIT',
    }));
    expect(outcome.outcome).toBe('FORCED_EXIT_LOSS');
    expect(outcome.winRateBucket).toBe('LOSS');
  });

  it('classifies open position as PENDING / EXCLUDED', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      finalExitPrice: undefined,
      exitedQty: 4,
      remainingQty: 6,
      tp2Hit: false,
    }));
    expect(outcome.outcome).toBe('PENDING');
    expect(outcome.winRateBucket).toBe('EXCLUDED');
    expect(outcome.attributionEligible).toBe(false);
  });

  it('classifies incomplete risk data as INVALID / EXCLUDED', () => {
    const outcome = resolveCanonicalTradeOutcome(baseInput({
      entryPrice: undefined,
      maxRiskAmount: 0,
    }));
    expect(outcome.outcome).toBe('INVALID');
    expect(outcome.winRateBucket).toBe('EXCLUDED');
  });

  it('excludes PENDING and INVALID from monthly win-rate math', () => {
    const summary: AttributionOutcomeQualitySummary = summarizeAttributionOutcomeQuality([
      evidence({ evidenceId: 'full', canonicalOutcome: 'FULL_WIN', winRateBucket: 'WIN_FULL', returnR: 1 }),
      evidence({ evidenceId: 'pbe', canonicalOutcome: 'PARTIAL_WIN_BREAKEVEN', winRateBucket: 'WIN_PARTIAL', returnR: 0.42 }),
      evidence({ evidenceId: 'loss', canonicalOutcome: 'FULL_LOSS', winRateBucket: 'LOSS', returnR: -1 }),
      evidence({ evidenceId: 'pending', outcomeStatus: 'PENDING', canonicalOutcome: 'PENDING', winRateBucket: 'EXCLUDED' }),
      evidence({ evidenceId: 'invalid', outcomeStatus: 'INVALID', canonicalOutcome: 'INVALID', winRateBucket: 'EXCLUDED' }),
    ]);

    expect(summary.denominator).toBe(3);
    expect(summary.standardWinRate).toBeCloseTo(2 / 3, 5);
    expect(summary.conservativeWinRate).toBeCloseTo(1 / 3, 5);
    expect(summary.pendingExcluded).toBe(1);
    expect(summary.invalidExcluded).toBe(1);
  });

  it('does not aggregate PARTIAL_WIN_BREAKEVEN as a loss', () => {
    const summary = summarizeAttributionOutcomeQuality([
      evidence({ canonicalOutcome: 'PARTIAL_WIN_BREAKEVEN', winRateBucket: 'WIN_PARTIAL', returnR: 0.42 }),
    ]);
    expect(summary.partialWinBreakeven).toBe(1);
    expect(summary.loss).toBe(0);
    expect(summary.standardWinRate).toBe(1);
  });

  it('stores canonical fields on Attribution Evidence records', async () => {
    const repo = await import('../persistence/attributionEvidenceLedgerRepo.js');
    const stored = repo.upsertAttributionEvidenceRecord({
      tradeDate: '2026-05-20',
      symbol: '005930',
      regime: 'R2_BULL',
      conditionKeys: ['momentum'],
      source: 'SHADOW',
      outcomeStatus: 'CONFIRMED',
      executionStatus: 'PAPER_FILLED',
      engineMode: 'NORMAL',
      dataConfidence: 'VERIFIED',
      signalId: 'signal-1',
      shadowPositionId: 'shadow-1',
      returnPct: 1.1,
      returnR: 0.42,
      canonicalOutcome: 'PARTIAL_WIN_BREAKEVEN',
      winRateBucket: 'WIN_PARTIAL',
      exitPath: 'TP1_THEN_BREAKEVEN_EXIT',
      learningTags: ['TP1_THEN_BREAKEVEN_EXIT'],
      executionImpact: 'NONE',
    });

    expect(stored.canonicalOutcome).toBe('PARTIAL_WIN_BREAKEVEN');
    expect(stored.winLoss).toBe('PARTIAL_WIN');
    expect(repo.loadAttributionEvidenceForMonth('2026-05')[0].exitPath).toBe('TP1_THEN_BREAKEVEN_EXIT');
  });

  it('resolves SHADOW paper fills through the same canonical resolver', () => {
    const outcome = resolveCanonicalTradeOutcomeFromShadowTrade({
      id: 'shadow-1',
      stockCode: '005930',
      signalPrice: 10_000,
      shadowEntryPrice: 10_000,
      stopLoss: 9_000,
      targetPrice: 11_000,
      quantity: 0,
      originalQuantity: 10,
      status: 'HIT_STOP',
      fills: [
        { type: 'BUY', qty: 10, price: 10_000, reason: 'ENTRY', timestamp: '2026-05-20T00:00:00.000Z' },
        { type: 'SELL', subType: 'PARTIAL_TP', qty: 5, price: 11_000, pnl: 5_000, pnlPct: 10, reason: 'TP1', timestamp: '2026-05-20T01:00:00.000Z' },
        { type: 'SELL', subType: 'STOP_LOSS', qty: 5, price: 10_000, pnl: 0, pnlPct: 0, reason: 'BREAKEVEN_STOP', timestamp: '2026-05-20T02:00:00.000Z' },
      ],
      mode: 'SHADOW',
    });

    expect(outcome.source).toBe('SHADOW');
    expect(outcome.outcome).toBe('PARTIAL_WIN_BREAKEVEN');
    expect(outcome.lifecycleOutcome).toBe('TP1_THEN_BREAKEVEN');
    expect(formatCanonicalTradeOutcomeTelegram(outcome, '[SHADOW 청산 결과]')).toContain('PARTIAL_WIN_BREAKEVEN');
    expect(formatCanonicalTradeOutcomeTelegram(outcome, '[SHADOW 청산 결과]')).toContain('lifecycleOutcome: TP1_THEN_BREAKEVEN');
  });
});
