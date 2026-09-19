// @responsibility Verify bounded asynchronous financial refresh and provider-period isolation.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KisFinancials } from '../../clients/kisFinanceClient.js';
const mocks = vi.hoisted(() => ({ kis: vi.fn(), dart: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock('../../clients/kisFinanceClient.js', () => ({ getKisFinancials: mocks.kis }));
vi.mock('../gate2/gate2ExternalDataProvider.js', () => ({ fetchDartFinancialsForGate2: mocks.dart }));
vi.mock('../../persistence/paperFinancialRepo.js', () => ({ loadPaperFinancialCache: mocks.load, savePaperFinancialCache: mocks.save }));
import { capturePaperFinancials, normalizePaperFinancials, refreshPaperFinancialBatch } from './paperFinancialCollection.js';

beforeEach(() => { vi.clearAllMocks(); mocks.kis.mockResolvedValue(null); mocks.dart.mockResolvedValue({ dartFin: null, trace: {} }); });
describe('paper financial enrichment', () => {
  it('keeps KIS income and ratio periods separate and preserves negative/zero facts', () => {
    const kis = { symbol: '005930', periods: { ratio: '202512', income: '202412', stability: '202512', roe: '202512' },
      roe: 0, opm: -5, netMargin: -3, debtRatio: 200, currentRatio: 80, bps: 100, revenueYoYGrowth: 20,
      fieldSources: { roe: 'KIS_L1' } } as KisFinancials;
    const result = normalizePaperFinancials('005930', new Date().toISOString(), kis,
      { symbol: '005930', source: 'DART', reportDate: '2026Q2', totalEquity: -20, totalAssets: 100, operatingCashFlow: 0 }, 'CFS');
    expect(result.kis).toMatchObject({ period: '202512', incomePeriod: '202412', operatingMargin: -5, roe: 0 });
    expect(result.dart).toMatchObject({ period: '2026Q2', equityRatio: -20, operatingCashFlowSign: 0 });
  });
  it('does not treat unproven statement periods or AI data as financial observations', () => {
    const result = normalizePaperFinancials('005930', new Date().toISOString(), { symbol: '005930', opm: 20 } as KisFinancials,
      { symbol: '005930', source: 'AI_ESTIMATED', totalEquity: 100 }, 'CFS');
    expect(result.kis?.operatingMargin).toBeNull(); expect(result.dart).toBeNull();
  });
  it('caps refresh at eight symbols, persists failed attempts, and skips immediate retries', async () => {
    const cache = { schemaVersion: 1 as const, records: {} };
    const symbols = Array.from({ length: 12 }, (_, i) => String(i).padStart(6, '0'));
    await refreshPaperFinancialBatch(symbols, cache);
    expect(mocks.kis).toHaveBeenCalledTimes(8);
    expect(mocks.save).toHaveBeenCalledTimes(8);
    await refreshPaperFinancialBatch(symbols, cache);
    expect(mocks.kis).toHaveBeenCalledTimes(12);
  });
  it('returns the frozen cache immediately while refresh is pending', async () => {
    const cache = { schemaVersion: 1 as const, records: {} };
    mocks.load.mockReturnValue(cache);
    let finish!: (value: null) => void;
    mocks.kis.mockImplementation(() => new Promise<null>(resolve => { finish = resolve; }));
    const rows = capturePaperFinancials(['005930']);
    expect(rows.size).toBe(0);
    capturePaperFinancials(['005930']);
    await vi.waitFor(() => expect(mocks.kis).toHaveBeenCalledTimes(1));
    expect(mocks.kis).toHaveBeenCalledTimes(1);
    finish(null);
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(rows.size).toBe(0);
  });
});
