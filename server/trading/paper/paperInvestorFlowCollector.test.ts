// @responsibility Verify dated share-unit investor-flow collection.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KisInvestorTradeByStockDaily } from '../../clients/kisClient.js';
const fetchFlow = vi.hoisted(() => vi.fn());
vi.mock('../../clients/kisClient.js', () => ({ fetchKisInvestorTradeByStockDaily: fetchFlow }));

const at = '2026-09-18T01:00:00.000Z';
const flow = (): KisInvestorTradeByStockDaily => ({ stockCode: '005930', tradingDate: '2026-09-17', fetchedAt: at,
  source: 'KIS_API', foreignNetBuy: 999999, institutionalNetBuy: 999999,
  actualRows: [{ stck_bsop_date: '20260917', frgn_ntby_qty: '1,000', orgn_ntby_qty: '-200' }] });
const bars = [{ tradingDate: '2026-09-17', close: 10000, volume: 2000, availableAt: at }];

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date(at)); fetchFlow.mockReset(); fetchFlow.mockResolvedValue(flow()); });
afterEach(() => vi.useRealTimers());

describe('paper investor source', () => {
  it('uses same-row raw share quantities, not ambiguous normalized money aliases', async () => {
    const { observePaperInvestorFlow } = await import('./paperInvestorFlowCollector.js');
    expect(observePaperInvestorFlow('005930', flow(), bars, at)).toMatchObject({ foreignNetShares: 1000, institutionalNetShares: -200, volume: 2000, issue: null });
    const amountOnly = flow();
    amountOnly.actualRows = [{ stck_bsop_date: '20260917', frgn_ntby_tr_pbmn: '10000', orgn_ntby_tr_pbmn: '20000' }];
    expect(observePaperInvestorFlow('005930', amountOnly, bars, at).issue).toBe('QUANTITY_MISSING');
  });

  it.each(['symbol', 'date', 'future', 'before_close', 'blank', 'volume', 'excess', 'split_rows'] as const)('isolates %s data without inventing zero purchases', async kind => {
    const { observePaperInvestorFlow } = await import('./paperInvestorFlowCollector.js');
    const item = flow(); const closes = structuredClone(bars);
    if (kind === 'symbol') item.stockCode = '000660';
    if (kind === 'date') item.tradingDate = '2026-09-16';
    if (kind === 'future') item.fetchedAt = '2026-09-18T02:00:00Z';
    if (kind === 'before_close') item.fetchedAt = '2026-09-17T06:20:00Z';
    if (kind === 'blank') item.actualRows![0].frgn_ntby_qty = '';
    if (kind === 'volume') closes[0].volume = 0;
    if (kind === 'excess') closes[0].volume = 100;
    if (kind === 'split_rows') item.actualRows = [{ stck_bsop_date: '20260917', frgn_ntby_qty: '10' }, { stck_bsop_date: '20260916', orgn_ntby_qty: '20' }];
    expect(observePaperInvestorFlow('005930', item, closes, at).issue).not.toBeNull();
    expect(observePaperInvestorFlow('005930', null, bars, at)).toMatchObject({ foreignNetShares: null, institutionalNetShares: null, issue: 'UNAVAILABLE' });
  });

  it('preserves genuine zero values', async () => {
    const { observePaperInvestorFlow } = await import('./paperInvestorFlowCollector.js');
    const item = flow(); item.actualRows![0].frgn_ntby_qty = '0'; item.actualRows![0].orgn_ntby_qty = '0';
    expect(observePaperInvestorFlow('005930', item, bars, at)).toMatchObject({ issue: null, foreignNetShares: 0, institutionalNetShares: 0 });
  });

  it('caches daily requests, preserves the actual fetch time and retries missing responses', async () => {
    const { collectPaperInvestorFlow } = await import('./paperInvestorFlowCollector.js');
    const first = await collectPaperInvestorFlow('005930');
    first!.actualRows![0].frgn_ntby_qty = '999';
    vi.setSystemTime(new Date('2026-09-18T01:01:00Z'));
    expect(await collectPaperInvestorFlow('005930')).toMatchObject({ fetchedAt: at, actualRows: [{ frgn_ntby_qty: '1,000' }] });
    expect(fetchFlow).toHaveBeenCalledTimes(1);
    expect(fetchFlow).toHaveBeenCalledWith('005930', 'LOW', '2026-09-17');
    vi.setSystemTime(new Date('2026-09-18T02:00:00Z'));
    fetchFlow.mockResolvedValueOnce(null);
    expect(await collectPaperInvestorFlow('005930')).toBeNull();
    await collectPaperInvestorFlow('005930');
    expect(fetchFlow).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-09-18T02:05:00Z'));
    await collectPaperInvestorFlow('005930');
    expect(fetchFlow).toHaveBeenCalledTimes(3);
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    await collectPaperInvestorFlow('005930');
    expect(fetchFlow).toHaveBeenLastCalledWith('005930', 'LOW', '2026-09-18');
  });
});
