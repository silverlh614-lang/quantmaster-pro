// @responsibility Verify complete-ledger evaluation counts without transmitting detailed observations.
import { describe, expect, it } from 'vitest';
import type { PaperExperiment, PaperExperimentView } from '../../../src/types/paperExperiment.js';
import { buildPaperEvaluation } from './paperEvaluation.js';
import { AlertCategory } from '../../alerts/alertCategories.js';

const now = new Date('2026-09-21T16:30:00+09:00');
function experiment(symbol: string): PaperExperiment {
  return { id: `baseline:${symbol}:2026-09-14`, symbol, name: '관측 종목', strategyVersion: 'shadow-baseline-v1', snapshotId: 'snapshot',
    entryAt: '2026-09-14T00:10:00.000Z', tradingDate: '2026-09-14', entryPrice: 100, quantity: 1, status: 'COMPLETED',
    costModel: { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
    entryObservation: { symbol, name: '관측 종목', price: 100, observedAt: '2026-09-14T00:09:59.000Z', source: 'KIS_API',
      return1dPct: null, return5dPct: null, aboveMa20: null, dailyCloses: [], news: [] },
    outcomes: [{ horizon: 5, tradingDate: '2026-09-21', availableAt: '2026-09-21T06:30:00.000Z', exitPrice: 101, grossReturnPct: 1, netReturnPct: 0.5, netPnl: 0.5 }] };
}
function view(rows: PaperExperiment[]): PaperExperimentView {
  return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: rows.length, completedCount: rows.length,
    openCount: 0, lastRun: null, outcomes: [], groups: [], experiments: rows };
}
describe('compact daily evaluation', () => {
  it('counts all records beyond the UI cap while separating stock breadth from entry dates', () => {
    const rows = Array.from({ length: 250 }, (_, i) => experiment(String(100000 + i)));
    const result = buildPaperEvaluation(view(rows), null, null, now);
    expect(result.audit).toMatchObject({ completeLedger: true, duplicateIds: 0, duplicateSymbolDates: 0, invalidOutcomes: 0, invalidEntryTimes: 0, futureEntryEvidence: 0 });
    expect(result.baseline.horizons[2]).toMatchObject({ count: 250, symbolCount: 250, entryDateCount: 1, meanNetReturnPct: 0.5 });
    expect(result.features.mature.every(row => row.count === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('dailyCloses');
    expect(JSON.stringify(result).length).toBeLessThan(5000);
  });
  it('flags truncated inputs, duplicate symbol-days, future evidence and wrong outcome sessions', () => {
    const row = experiment('005930'); row.entryObservation.observedAt = '2026-09-15T00:00:00.000Z';
    row.outcomes[0].tradingDate = '2026-09-20';
    const input = view([row, structuredClone(row)]); input.totalCount = 400;
    expect(buildPaperEvaluation(input, null, null, now).audit).toMatchObject({ completeLedger: false, duplicateIds: 1,
      duplicateSymbolDates: 1, futureEntryEvidence: 2, invalidOutcomes: 2 });
  });
  it('reports only confirmed Telegram IDs without leaking message bodies', () => {
    const result = buildPaperEvaluation(view([]), { schemaVersion: 1, initializedAt: null, lastCheckedAt: now.toISOString(),
      health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [{ id: 'paper:morning:2026-09-21', kind: 'morning', channel: AlertCategory.INFO,
        state: 'SENT', attempts: 1, message: 'private body', messageId: 123, createdAt: '2026-09-20T23:45:00.000Z',
        expiresAt: '2026-09-21T00:30:00.000Z', nextAttemptAt: '2026-09-20T23:45:00.000Z', sentAt: '2026-09-20T23:45:01.000Z' }] }, null, now);
    expect(result.bot?.today[0]).toMatchObject({ state: 'SENT', messageId: 123, channel: 'INFO' });
    expect(JSON.stringify(result)).not.toContain('private body');
    expect(result.financials).toMatchObject({ available: false, minAgeHours: null });
  });
});
