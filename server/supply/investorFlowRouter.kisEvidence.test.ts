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

  it('records KIS OK but keeps CACHE fallback selected at default SHADOW_SCORE stage', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorFlow: async () => ({
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        individualNetBuy: -300,
        source: 'KIS_API',
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
    expect(kisHealth?.reason).toContain('liveExecutionAllowed=false');
  }, 15_000);

  it('selects KIS_API only when explicit promotion stage is WEIGHTED or higher', async () => {
    process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE = 'WEIGHTED';
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorFlow: async () => ({
        foreignNetBuy: 100,
        institutionalNetBuy: 200,
        individualNetBuy: -300,
        source: 'KIS_API',
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

  it('records KIS errors as provider issues and continues CACHE fallback', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorFlow: async () => {
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
