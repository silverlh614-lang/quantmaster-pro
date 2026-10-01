// @responsibility Verify KIS index benchmark collection for Shadow research.
import { describe, expect, it } from 'vitest';
import { collectPaperIndexSeries } from './paperIndexCollection.js';

const row = (baseDate: string, close: number) => ({ baseDate, close, open: close, high: close + 1, low: close - 1, volume: 0, value: 0 });
type Fetch = NonNullable<Parameters<typeof collectPaperIndexSeries>[1]>;

describe('paper index benchmark collection', () => {
  it('keeps only completed sessions for both indices with stable benchmark symbols', async () => {
    const calls: string[] = [];
    const fetch = (async (iscd: string, from?: string, to?: string) => {
      calls.push(`${iscd}:${from}:${to}`);
      return { sectorIscd: iscd, sectorName: '', currentIndex: null, changePct: null, fetchedAt: '', source: 'KIS_API',
        series: [row('20260930', iscd === '0001' ? 3000 : 800), row('20261001', 1), row('20260927', 5)] };
    }) as unknown as Fetch;
    // 2026-10-01 11:00 KST: today's session is not closed; 09-27 is a holiday.
    const result = await collectPaperIndexSeries(new Date('2026-10-01T02:00:00Z'), fetch);
    expect(result.closedDate).toBe('2026-09-30');
    expect(result.series.map(item => [item.symbol, item.market, item.closes.map(bar => bar.date)])).toEqual([
      ['^KS11', 'KOSPI', ['2026-09-30']], ['^KQ11', 'KOSDAQ', ['2026-09-30']]]);
    expect(result.series[0]).toMatchObject({ id: 'kis-index:^KS11', source: 'KIS_SNAPSHOT', closes: [{ close: 3000, high: 3001 }] });
    expect(result.inventory).toMatchObject({ status: 'FOUND', records: 2 });
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(calls.every(call => /^\d{4}:\d{8}:\d{8}$/.test(call))).toBe(true);
  });

  it('reports a missing benchmark when KIS index access is disabled', async () => {
    const result = await collectPaperIndexSeries(new Date('2026-10-01T08:00:00Z'), (async () => null) as unknown as Fetch);
    expect(result.closedDate).toBe('2026-10-01');
    expect(result.series).toEqual([]);
    expect(result.inventory).toMatchObject({ status: 'MISSING', records: 0 });
    expect(result.inventory.issue).toContain('KIS_SECTOR_INDEX_DAILY_ENABLED');
  });
});
