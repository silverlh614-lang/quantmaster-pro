import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('InvestorFlowRouter KIS official evidence wiring', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;
  const originalKrxDisabled = process.env.KRX_API_DISABLED;
  const originalKisStage = process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kis-router-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    process.env.KRX_API_DISABLED = 'true';
    delete process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;
    vi.resetModules();
  });

  afterEach(async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({});
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    if (originalKrxDisabled === undefined) delete process.env.KRX_API_DISABLED;
    else process.env.KRX_API_DISABLED = originalKrxDisabled;
    if (originalKisStage === undefined) delete process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;
    else process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE = originalKisStage;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  async function seedCache(): Promise<void> {
    const { upsertInvestorFlowCache } = await import('../persistence/investorFlowCacheRepo.js');
    upsertInvestorFlowCache({
      stockCode: '005930',
      date: '2026-05-11',
      foreignNetBuy: 1,
      institutionalNetBuy: 2,
      individualNetBuy: -3,
      provider: 'KRX_INVESTOR_FLOW',
      fetchedAt: '2026-05-11T09:30:00.000Z',
    });
  }

  it('selects KIS_API by default while keeping execution impact shadow-safe', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        individualNetBuy: -300,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
        actualInvestorFlowRowCarrier: {
          provider: 'KIS_API',
          requestSymbol: '005930',
          normalizedSymbol: '005930',
          providerScope: 'SYMBOL_LEVEL',
          actualRows: [{ frgn_ntby_qty: '100', orgn_ntby_qty: '200', prsn_ntby_qty: '-300' }],
          rowSourcePath: 'output2[0]',
          rawFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty', 'prsn_ntby_qty'],
          numericStringFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty', 'prsn_ntby_qty'],
          numberFieldKeys: [],
          placeholderFieldKeys: [],
          carriedAt: '2026-05-11T09:30:00.000Z',
        },
      }),
    });
    const { fetchInvestorFlowWithPolicy } = await import('./investorFlowRouter.js');

    const result = await fetchInvestorFlowWithPolicy('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.source).toBe('KIS_API');
    expect(result.status).toBe('OK');
    expect(result.data?.provider).toBe('KIS_API');
    expect(result.bySymbol['005930']?.actualInvestorRow).toMatchObject({ frgn_ntby_qty: '100' });
    expect(result.bySymbol['005930']?.normalizedInvestorRow).toMatchObject({ foreignNetBuy: 100, institutionNetBuy: 200 });
    expect(result.bySymbol['005930']?.semanticInvestorRow).toMatchObject({ foreignNetBuy: 100, institutionalNetBuy: 200 });
    expect(result.bySymbol['005930']?.supplySemanticRow).toMatchObject({ individualNetBuy: -300 });
    expect(result.bySymbol['005930']?.actualInvestorFlowRows).toHaveLength(1);
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'KIS_API', status: 'OK' }),
    ]));
    const kisHealth = result.health.find((entry) => entry.provider === 'KIS');
    expect(kisHealth?.status).toBe('OK');
    expect(kisHealth?.reason).toContain('promotionStage=WEIGHTED');
    expect(kisHealth?.reason).toContain('selectableForRouter=true');
    expect(kisHealth?.reason).toContain('liveExecutionAllowed=false');
  }, 15_000);

  it('records KIS OK but keeps CACHE fallback selected when stage is SHADOW_SCORE', async () => {
    process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE = 'SHADOW_SCORE';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        individualNetBuy: -300,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
      }),
    });
    await seedCache();
    const { fetchInvestorFlowWithPolicy } = await import('./investorFlowRouter.js');

    const result = await fetchInvestorFlowWithPolicy('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.source).toBe('CACHE');
    expect(result.status).toBe('OK');
    expect(result.data?.provider).toBe('CACHE');
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'KIS_API', status: 'OK' }),
      expect.objectContaining({ provider: 'CACHE', status: 'OK' }),
    ]));
    const kisHealth = result.health.find((entry) => entry.provider === 'KIS');
    expect(kisHealth?.status).toBe('OK');
    expect(kisHealth?.reason).toContain('promotionStage=SHADOW_SCORE');
    expect(kisHealth?.reason).toContain('selectableForRouter=false');
    expect(kisHealth?.reason).toContain('executionImpact=NONE');
  }, 15_000);

  it('selects KIS_API only when explicit promotion stage is WEIGHTED or higher', async () => {
    process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE = 'WEIGHTED';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        individualNetBuy: -300,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
      }),
    });
    const { fetchInvestorFlowWithPolicy } = await import('./investorFlowRouter.js');

    const result = await fetchInvestorFlowWithPolicy('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.source).toBe('KIS_API');
    expect(result.status).toBe('OK');
    expect(result.data?.provider).toBe('KIS_API');
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'KIS_API', status: 'OK' }),
    ]));
    const composite = result.health.find((entry) => entry.provider === 'COMPOSITE');
    expect(composite?.status).toBe('OK');
    expect(composite?.reason).toContain('promotionStage=WEIGHTED');
    expect(composite?.reason).toContain('executionImpact=NONE');
  }, 15_000);


  it('records degraded KIS foreign+institution evidence as KIS_API:PARTIAL before cache can override', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-11',
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
      }),
    });
    await seedCache();
    const { fetchInvestorFlowWithPolicy } = await import('./investorFlowRouter.js');

    const result = await fetchInvestorFlowWithPolicy('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.source).toBe('KIS_API');
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'KIS_API', status: 'PARTIAL' }),
    ]));
    expect(result.data).not.toHaveProperty('individualNetBuy');
    expect(result.data?.foreignNetBuy).toBe(100);
    expect(result.data?.institutionalNetBuy).toBe(200);
  }, 15_000);

  it('records KIS errors as provider issues and continues CACHE fallback', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => {
        throw new Error('KIS boom');
      },
    });
    await seedCache();
    const { fetchInvestorFlowWithPolicy } = await import('./investorFlowRouter.js');

    const result = await fetchInvestorFlowWithPolicy('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.source).toBe('CACHE');
    expect(result.status).toBe('OK');
    expect(result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'KIS_API', status: 'ERROR' }),
      expect.objectContaining({ provider: 'CACHE', status: 'OK' }),
    ]));
    const kisHealth = result.health.find((entry) => entry.provider === 'KIS');
    expect(kisHealth?.status).toBe('UNKNOWN_ERROR');
    expect(kisHealth?.semanticAvailable).toBe(false);
    expect(kisHealth?.reason).toContain('providerIssue=true');
    expect(kisHealth?.reason).toContain('marketSignal=false');
    expect(kisHealth?.reason).toContain('executionImpact=NONE');
  }, 15_000);
});
