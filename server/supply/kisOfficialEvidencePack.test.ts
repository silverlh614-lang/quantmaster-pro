import { describe, expect, it } from 'vitest';
import { fetchKisOfficialEvidencePack } from './kisOfficialEvidencePack.js';

describe('KIS official evidence pack', () => {
  it('selects fresh KIS price evidence without relying on Yahoo', async () => {
    const pack = await fetchKisOfficialEvidencePack('005930', new Date('2026-05-11T09:30:00.000Z'), {
      fetchCurrentPrice: async () => 70000,
      fetchPrevClose: async () => ({
        stockCode: '005930',
        prevClose: 69000,
        tradingDate: '2026-05-08',
        fetchedAt: '2026-05-11T00:30:00.000Z',
      }),
      fetchStockName: async () => 'Samsung Electronics',
      fetchInvestorFlow: async () => null,
      fetchStockProgramTrade: async () => null,
      fetchMarketProgramTrade: async () => null,
      fetchMarketSupply: async () => null,
    });

    expect(pack.provider).toBe('KIS_API');
    expect(pack.officialSource).toBe(true);
    expect(pack.price?.currentPrice).toBe(70000);
    expect(pack.price?.freshness).toBe('FRESH');
    expect(pack.diagnostics.priceProvider).toBe('KIS_PRICE');
    expect(pack.confidence).toBe('VERIFIED');
    expect(pack.executionImpact).toBe('NONE');
    expect(pack.liveExecutionAllowed).toBe(false);
  });

  it('keeps real KIS investor fields usable and does not treat them as market signal', async () => {
    const pack = await fetchKisOfficialEvidencePack('005930', new Date('2026-05-11T09:30:00.000Z'), {
      fetchCurrentPrice: async () => null,
      fetchPrevClose: async () => null,
      fetchStockName: async () => null,
      fetchInvestorFlow: async () => ({
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        individualNetBuy: -300,
        source: 'KIS_API',
      }),
      fetchStockProgramTrade: async () => null,
      fetchMarketProgramTrade: async () => null,
      fetchMarketSupply: async () => null,
    });

    expect(pack.investorFlow).toEqual({
      foreignNetBuy: 100,
      institutionalNetBuy: 200,
      individualNetBuy: -300,
      hasRealFields: true,
    });
    expect(pack.diagnostics.investorFlowStatus).toBe('OK');
    expect(pack.marketSignal).toBe(false);
    expect(pack.providerIssue).toBe(false);
    expect(pack.executionImpact).toBe('NONE');
  });

  it('keeps missing KIS investor fields unavailable instead of zero-filled or bearish', async () => {
    const pack = await fetchKisOfficialEvidencePack('005930', new Date('2026-05-11T09:30:00.000Z'), {
      fetchCurrentPrice: async () => null,
      fetchPrevClose: async () => null,
      fetchStockName: async () => null,
      fetchInvestorFlow: async () => null,
      fetchStockProgramTrade: async () => null,
      fetchMarketProgramTrade: async () => null,
      fetchMarketSupply: async () => null,
    });

    expect(pack.investorFlow).toEqual({ hasRealFields: false });
    expect(pack.diagnostics.investorFlowStatus).toBe('DATA_UNAVAILABLE');
    expect(pack.confidence).toBe('MISSING');
    expect(pack.providerIssue).toBe(true);
    expect(pack.marketSignal).toBe(false);
  });

  it('excludes accepted-empty program responses from usable evidence', async () => {
    const pack = await fetchKisOfficialEvidencePack('005930', new Date('2026-05-11T09:30:00.000Z'), {
      fetchCurrentPrice: async () => null,
      fetchPrevClose: async () => null,
      fetchStockName: async () => null,
      fetchInvestorFlow: async () => null,
      fetchStockProgramTrade: async () => ({
        stockCode: '005930',
        programNetBuyQty: 0,
        programNetBuyAmount: 0,
        programBuyRatio: null,
        fetchedAt: '2026-05-11T09:30:00.000Z',
        source: 'KIS_API',
      }),
      fetchMarketProgramTrade: async () => ({
        programNetBuyQty: 0,
        programNetBuyAmount: 0,
        programArbitrageNetBuy: null,
        fetchedAt: '2026-05-11T09:30:00.000Z',
        source: 'KIS_API',
      }),
      fetchMarketSupply: async () => null,
    });

    expect(pack.stockProgram).toBeUndefined();
    expect(pack.marketProgram).toBeUndefined();
    expect(pack.diagnostics.stockProgramStatus).toBe('DATA_UNAVAILABLE');
    expect(pack.diagnostics.marketProgramStatus).toBe('DATA_UNAVAILABLE');
    expect(pack.executionImpact).toBe('NONE');
  });
});
