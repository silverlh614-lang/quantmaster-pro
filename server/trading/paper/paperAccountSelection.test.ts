// @responsibility Verify prospective account policy selection preserves trading evidence.
import { describe, expect, it } from 'vitest';
import { accountSignalFixture } from './paperAccountFixtures.js';
import { selectAccountPolicy } from './paperAccountSelection.js';
import { createPaperAccount, advancePaperAccount } from './paperAccount.js';
import { assertPaperAccount } from './paperAccountValidation.js';
import { signalRuleKey } from '../../../src/utils/paperTradeReview.js';

function setup() {
  const f = accountSignalFixture();
  const account = createPaperAccount({ initialCash: 10000, maxPositionPct: 100, includeExploration: false }, '2026-09-18T00:00:00Z', 'account');
  const candidate = f.strategy.adaptive!.candidates.find(item => item.active)!;
  return { ...f, account, candidate };
}
describe('prospective account policy', () => {
  it('compares equivalent evidence regardless of persisted object field order', () => {
    const f = setup(), evidence = f.trade.entryDecision.adaptiveEvidence!;
    evidence.candidate.validation = Object.fromEntries(Object.entries(evidence.candidate.validation).reverse()) as typeof evidence.candidate.validation;
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(result.orders[0].status).toBe('FILLED'); assertPaperAccount(result);
  });
  it('selects the largest verified net return rather than training rank, preserving all alternatives', () => {
    const f = setup(), second = structuredClone(f.candidate);
    second.rule.bucket = 1; second.validation.meanNetReturnPct = 50;
    second.training.meanNetReturnPct = 1; second.training.meanDailyExcessPct = 0.1;
    f.strategy.adaptive!.candidates.push(second);
    const before = JSON.stringify(f.strategy);
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(result.selections![0].selectedRuleKey).toBe(signalRuleKey(second.rule));
    expect(result.selections![0].candidates.map(item => item.validation.meanNetReturnPct)).toEqual([50, f.candidate.validation.meanNetReturnPct]);
    expect(result.orders[0]).toMatchObject({ status: 'REJECTED', statusReason: '당일 선택한 수익성 우선 규칙과 다른 신호' });
    expect(JSON.stringify(f.strategy)).toBe(before); assertPaperAccount(result);
  });
  it('keeps daily choices unchanged through restart and considers changes on the next trading day', () => {
    const f = setup(), first = advancePaperAccount(f.account, f.strategy, f.snapshot);
    const changed = structuredClone(f.candidate); changed.rule.bucket = 1; changed.validation.meanNetReturnPct = 90;
    f.strategy.adaptive!.candidates.push(changed);
    f.snapshot.asOf = '2026-09-18T02:00:00Z';
    const resumed = advancePaperAccount(JSON.parse(JSON.stringify(first)), f.strategy, f.snapshot);
    expect(resumed.selections).toEqual(first.selections);
    f.snapshot.tradingDate = '2026-09-21'; f.snapshot.asOf = '2026-09-21T01:00:00Z';
    f.strategy.adaptive!.tradingDate = f.snapshot.tradingDate;
    f.strategy.adaptive!.cutoffAt = '2026-09-20T15:00:00Z'; f.strategy.adaptive!.evaluatedAt = f.snapshot.asOf;
    const next = advancePaperAccount(resumed, f.strategy, f.snapshot);
    expect(next.selections).toHaveLength(2); expect(next.selections![1].selectedRuleKey).toBe(signalRuleKey(changed.rule));
    expect(next.orders).toEqual(first.orders); assertPaperAccount(next);
  });
  it.each(['missing', 'stale', 'future', 'intraday-data', 'quote-only'] as const)('waits for valid dated evidence on %s input', kind => {
    const f = setup();
    if (kind === 'missing') delete f.strategy.adaptive;
    if (kind === 'stale') f.strategy.adaptive!.tradingDate = '2026-09-17';
    if (kind === 'future') f.strategy.adaptive!.evaluatedAt = '2026-09-18T02:00:00Z';
    if (kind === 'intraday-data') f.strategy.adaptive!.cutoffAt = f.snapshot.asOf;
    if (kind === 'quote-only') f.snapshot.quoteOnly = true;
    expect(selectAccountPolicy(f.account, f.strategy.adaptive, f.snapshot)).toBeUndefined();
    expect(f.account.selections).toBeUndefined();
  });
  it.each(['samples', 'dates', 'negative', 'inactive', 'overlap'] as const)('rejects %s evidence without weakening Shadow research', kind => {
    const f = setup(); f.strategy.adaptive!.candidates = [f.candidate];
    if (kind === 'samples') f.candidate.validation.sampleCount = 1;
    if (kind === 'dates') f.candidate.validation.dateCount = 1;
    if (kind === 'negative') f.candidate.validation.meanNetReturnPct = -1;
    if (kind === 'inactive') { f.candidate.active = false; f.candidate.reason = 'RANKED_OUT'; }
    if (kind === 'overlap') f.candidate.validation = structuredClone(f.candidate.training);
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(result.selections![0].selectedRuleKey).toBeNull();
    expect(result.orders[0].status).toBe('REJECTED'); expect(f.strategy.trades[0].status).toBe('OPEN'); assertPaperAccount(result);
  });
  it('requires matching entry evidence and rejects altered persisted winner or rank', () => {
    const f = setup(); f.trade.entryDecision.adaptiveEvidence!.candidate.validation.meanNetReturnPct! += 1;
    const result = advancePaperAccount(f.account, f.strategy, f.snapshot);
    expect(result.orders[0].statusReason).toBe('진입 당시 검증 성적 불일치'); assertPaperAccount(result);
    result.selections![0].selectedRuleKey = 'different';
    expect(() => assertPaperAccount(result)).toThrow('policy winner');
  });
  it('keeps sales active when no policy qualifies for new buys, including pre-policy holdings', () => {
    const f = setup(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    delete bought.selections; delete bought.orders[0].selectionId;
    f.snapshot.id = 'exit-scan'; f.snapshot.asOf = '2026-09-18T01:01:00Z';
    f.snapshot.observations[0].observedAt = f.snapshot.asOf;
    f.trade.status = 'CLOSED';
    f.trade.exit = { model: 'ADAPTIVE_OBSERVED', snapshotId: f.snapshot.id, price: 100, netPnl: 0, netReturnPct: 0, grossReturnPct: 0,
      observedAt: f.snapshot.asOf, effectiveAt: f.snapshot.asOf, decisionAt: f.snapshot.asOf,
      decision: { ...f.trade.entryDecision, action: 'EXIT', reason: '보존된 매도 기준' } };
    f.strategy.adaptive!.candidates = [];
    const sold = advancePaperAccount(bought, f.strategy, f.snapshot);
    expect(sold.selections![0].selectedRuleKey).toBeNull();
    expect(sold.orders[1]).toMatchObject({ side: 'SELL', status: 'FILLED', signalReason: '보존된 매도 기준' }); assertPaperAccount(sold);
  });
  it('measures drawdown only from fresh valuations and never backfills an old account', () => {
    const f = setup(), bought = advancePaperAccount(f.account, f.strategy, f.snapshot);
    f.snapshot.id = 'drop'; f.snapshot.asOf = '2026-09-18T01:01:00Z';
    f.snapshot.observations[0].observedAt = f.snapshot.asOf; f.snapshot.observations[0].price = 90;
    const dropped = advancePaperAccount(bought, f.strategy, f.snapshot);
    expect(dropped.risk!.maxDrawdownPct).toBeCloseTo(10);
    f.snapshot.id = 'stale'; f.snapshot.asOf = '2026-09-18T01:10:00Z';
    const stale = advancePaperAccount(dropped, f.strategy, f.snapshot);
    expect(stale.risk).toEqual(dropped.risk);
    delete stale.risk; f.snapshot.asOf = '2026-09-18T01:11:00Z'; f.snapshot.observations[0].observedAt = f.snapshot.asOf;
    const upgraded = advancePaperAccount(stale, f.strategy, f.snapshot);
    expect(upgraded.risk).toMatchObject({ since: f.snapshot.asOf, observations: 1, maxDrawdownPct: 0 }); assertPaperAccount(upgraded);
  });
});
