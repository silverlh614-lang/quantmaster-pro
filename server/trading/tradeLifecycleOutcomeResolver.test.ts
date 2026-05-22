import { describe, expect, it } from 'vitest';
import {
  buildLifecycleLedgerFields,
  formatOutcomeStatsUpdatedFromLifecycleLog,
  formatStopLossReclassifiedByLifecycleLog,
  formatTradeLifecycleOutcomeResolvedLog,
  formatTradeLifecycleOutcomeTelegram,
  resolveShadowLearningLifecycleOutcome,
  resolveTradeLifecycleOutcome,
  summarizeLifecycleOutcomeStats,
} from './tradeLifecycleOutcomeResolver.js';

describe('Simplification Step 13 trade lifecycle outcome SSOT', () => {
  it('classifies TP1 then breakeven stop as WIN_BREAKEVEN rather than LOSS', () => {
    const outcome = resolveTradeLifecycleOutcome({
      positionId: 'pos-tp1-be',
      symbol: '005930',
      mode: 'SHADOW',
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 10_000,
      totalRealizedPnL: 15_000,
      totalRealizedPnLPct: 1.5,
      tp1Hit: true,
      stopMovedToBreakeven: true,
      finalExitReason: 'STOP_LOSS',
      remainingExitPnLPct: 0,
      resolvedAt: '2026-05-21T10:00:00.000+09:00',
    });

    expect(outcome.lifecycleOutcome).toBe('TP1_THEN_BREAKEVEN');
    expect(outcome.outcomeClass).toBe('WIN_BREAKEVEN');
    expect(outcome.outcomeClass).not.toBe('LOSS');
    expect(formatStopLossReclassifiedByLifecycleLog(outcome)).toContain('[STOP_LOSS_RECLASSIFIED_BY_LIFECYCLE]');
  });

  it('classifies TP1 then stop loss with retained total profit as WIN', () => {
    const outcome = resolveTradeLifecycleOutcome({
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 9_700,
      totalRealizedPnL: 8_000,
      totalRealizedPnLPct: 0.8,
      tp1Hit: true,
      stopMovedToBreakeven: false,
      finalExitReason: 'STOP_LOSS',
      remainingExitPnLPct: -3,
    });

    expect(outcome.lifecycleOutcome).toBe('TP1_THEN_STOP_LOSS_PROFIT_RETAINED');
    expect(outcome.outcomeClass).toBe('WIN');
  });

  it('classifies direct stop loss as LOSS', () => {
    const outcome = resolveTradeLifecycleOutcome({
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 9_400,
      totalRealizedPnL: -12_000,
      totalRealizedPnLPct: -1.2,
      tp1Hit: false,
      stopMovedToBreakeven: false,
      finalExitReason: 'STOP_LOSS',
    });

    expect(outcome.lifecycleOutcome).toBe('STOP_LOSS');
    expect(outcome.outcomeClass).toBe('LOSS');
  });

  it('classifies direct breakeven as BREAKEVEN', () => {
    const outcome = resolveTradeLifecycleOutcome({
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 10_010,
      totalRealizedPnL: 500,
      totalRealizedPnLPct: 0.1,
      tp1Hit: false,
      stopMovedToBreakeven: false,
      finalExitReason: 'STOP_LOSS',
    });

    expect(outcome.lifecycleOutcome).toBe('BREAKEVEN_EXIT');
    expect(outcome.outcomeClass).toBe('BREAKEVEN');
  });

  it('renders Telegram from lifecycleOutcome, not raw finalExitReason', () => {
    const outcome = resolveTradeLifecycleOutcome({
      symbol: 'ABC',
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 10_000,
      totalRealizedPnL: 18_500,
      totalRealizedPnLPct: 1.85,
      tp1Hit: true,
      stopMovedToBreakeven: true,
      finalExitReason: 'STOP_LOSS',
      remainingExitPnLPct: 0,
    });
    const telegram = formatTradeLifecycleOutcomeTelegram(outcome);

    expect(telegram).toContain('부분익절 후 본절 종료');
    expect(telegram).toContain('lifecycleOutcome: TP1_THEN_BREAKEVEN');
    expect(telegram).toContain('분류: WIN_BREAKEVEN');
    expect(telegram).not.toContain('분류: LOSS');
  });

  it('keeps WIN_BREAKEVEN out of loss count in monthly-style stats', () => {
    const be = resolveTradeLifecycleOutcome({
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 10_000,
      totalRealizedPnL: 15_000,
      totalRealizedPnLPct: 1.5,
      tp1Hit: true,
      stopMovedToBreakeven: true,
      finalExitReason: 'STOP_LOSS',
      remainingExitPnLPct: 0,
    });
    const loss = resolveTradeLifecycleOutcome({
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 9_400,
      totalRealizedPnL: -12_000,
      totalRealizedPnLPct: -1.2,
      tp1Hit: false,
      stopMovedToBreakeven: false,
      finalExitReason: 'STOP_LOSS',
    });
    const stats = summarizeLifecycleOutcomeStats([be, loss]);

    expect(stats.lossCount).toBe(1);
    expect(stats.breakevenCount).toBe(1);
    expect(stats.closedCountForWinRate).toBe(1);
    expect(formatOutcomeStatsUpdatedFromLifecycleLog({ tradeId: 't1', outcome: be })).toContain('breakevenIncluded=true');
  });

  it('uses lifecycleOutcome for Shadow Learning labels', () => {
    const outcome = resolveTradeLifecycleOutcome({
      entryPrice: 10_000,
      initialStopLoss: 9_500,
      finalExitPrice: 10_000,
      totalRealizedPnL: 15_000,
      totalRealizedPnLPct: 1.5,
      tp1Hit: true,
      stopMovedToBreakeven: true,
      finalExitReason: 'STOP_LOSS',
      remainingExitPnLPct: 0,
    });
    const learning = resolveShadowLearningLifecycleOutcome(outcome);
    const ledger = buildLifecycleLedgerFields(outcome);
    const log = formatTradeLifecycleOutcomeResolvedLog(outcome);

    expect(learning.learningOutcome).toBe('TP1_THEN_BREAKEVEN');
    expect(learning.learningClass).toBe('WIN_BREAKEVEN');
    expect(learning.learningLabels).toContain('PARTIAL_PROFIT_THEN_BE');
    expect(ledger.resolvedBy).toBe('TradeLifecycleOutcomeResolver');
    expect(log).toContain('[TRADE_LIFECYCLE_OUTCOME_RESOLVED]');
  });
});
