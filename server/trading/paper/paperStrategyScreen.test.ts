// @responsibility Verify compact strategy rows keep every screen result unchanged.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { buildSignalReview, buildTradeReview, tradeRuleIdentity, tradeSignalIdentity } from '../../../src/utils/paperTradeReview.js';
import { accountSignalFixture } from './paperAccountFixtures.js';
import { buildPaperStrategyView } from './paperStrategyPolicy.js';
import { legacyStrategyLedger } from './paperStrategyFixtures.js';
import { paperStrategyScreenView, summarizePaperStrategyTrade } from './paperStrategyScreen.js';
import { readPaperStrategyTrades } from './paperStrategyRuntime.js';

function trades(): PaperStrategyTrade[] {
  const { strategy, trade } = accountSignalFixture();
  const closed = structuredClone(trade);
  Object.assign(closed, { id: `${trade.id}:closed`, status: 'CLOSED', exit: { model: 'ADAPTIVE_OBSERVED', snapshotId: 'exit',
    effectiveAt: trade.entryAt, observedAt: trade.entryAt, decisionAt: trade.entryAt, price: 110, grossReturnPct: 10, netReturnPct: 9.5,
    netPnl: 9.5, decision: { ...structuredClone(trade.entryDecision), action: 'EXIT', reason: '손실 제한' } } });
  closed.exitResearch = { ...closed.exitResearch!, baseline: { ...closed.exitResearch!.baseline!, netReturnPct: 4 } } as PaperStrategyTrade['exitResearch'];
  closed.measurement = { version: 'observed-trade-path-v1', startedAt: trade.entryAt, fromEntry: false, pointCount: 2,
    latest: {} as never, highest: {} as never, lowest: {} as never };
  const exploration = structuredClone(trade);
  exploration.id = `${trade.id}:exploration`;
  exploration.entryDecision.explorationEvidence = { ...structuredClone(trade.entryDecision.adaptiveEvidence!), trialId: 'trial', registeredAt: trade.entryAt };
  delete exploration.entryDecision.adaptiveEvidence;
  return [...strategy.trades, closed, exploration, ...legacyStrategyLedger().trades];
}

describe('strategy screen rows', () => {
  it('reproduces every scorecard, signal group and filter key from compact rows', () => {
    const full = trades(), { strategy } = accountSignalFixture(), rows = full.map(summarizePaperStrategyTrade);
    expect(buildTradeReview(rows)).toEqual(buildTradeReview(full));
    expect(buildSignalReview(rows, strategy.adaptive)).toEqual(buildSignalReview(full, strategy.adaptive));
    expect(rows.map(row => [tradeRuleIdentity(row), tradeSignalIdentity(row)]))
      .toEqual(full.map(trade => [tradeRuleIdentity(trade), tradeSignalIdentity(trade)]));
  });
  it('leaves entry observations and stored evidence statistics on the server', () => {
    const full = trades(), rows = full.map(summarizePaperStrategyTrade);
    for (const row of rows) {
      expect(row).not.toHaveProperty('entryObservation');
      expect(row.exitPolicy ?? {}).not.toHaveProperty('evidence');
      expect(row.entryDecision.adaptiveEvidence?.candidate ?? {}).not.toHaveProperty('training');
    }
    expect(JSON.stringify(rows).length).toBeLessThan(JSON.stringify(full).length / 3);
    const view = { ...buildPaperStrategyView(legacyStrategyLedger()), trades: full };
    expect(paperStrategyScreenView(view)).toEqual({ ...view, trades: rows });
  });
  it('reads full records for a page in the requested order without inventing missing trades', () => {
    const full = trades(), ledger = { ...legacyStrategyLedger(), trades: full };
    expect(readPaperStrategyTrades([full[2].id, 'missing', full[0].id], { ledger }).map(trade => trade.id)).toEqual([full[2].id, full[0].id]);
    expect(() => readPaperStrategyTrades([full[0].id], { ledger: null, error: '전략 기록을 읽을 수 없습니다' })).toThrow('전략 기록을 읽을 수 없습니다');
  });
});
