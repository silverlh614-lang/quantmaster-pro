import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('KIS official investor-flow evidence adapter', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;
  const originalStage = process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kis-flow-evidence-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;
    vi.resetModules();
  });

  afterEach(async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({});
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    if (originalStage === undefined) delete process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE;
    else process.env.KIS_INVESTOR_FLOW_PROMOTION_STAGE = originalStage;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  it('keeps missing strict KIS fields as provider issue, not market signal', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({ fetchKisInvestorFlow: async () => null });
    const { fetchKisInvestorFlowEvidence } = await import('./kisInvestorFlowEvidence.js');

    const result = await fetchKisInvestorFlowEvidence('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.data).toBeNull();
    expect(result.officialSource).toBe(true);
    expect(result.promotionStage).toBe('WEIGHTED');
    expect(result.selectableForRouter).toBe(true);
    expect(result.sample).toBeNull();
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.health.provider).toBe('KIS');
    expect(result.health.status).toBe('PROVIDER_UNAVAILABLE');
    expect(result.health.semanticAvailable).toBe(false);
    expect(result.health.reason).toContain('source=KIS_OFFICIAL_STANDARD_API');
    expect(result.health.reason).toContain('hasRealInvestorFields=false');
    expect(result.health.reason).toContain('providerIssue=true');
    expect(result.health.reason).toContain('marketSignal=false');
    expect(result.health.reason).toContain('executionImpact=NONE');
  }, 15_000);

  it('maps real strict KIS investor fields into shadow-safe evidence', async () => {
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
    const { fetchKisInvestorFlowEvidence } = await import('./kisInvestorFlowEvidence.js');

    const result = await fetchKisInvestorFlowEvidence('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.data).toMatchObject({
      stockCode: '005930',
      foreignNetBuy: 100,
      institutionalNetBuy: 200,
      individualNetBuy: -300,
      provider: 'KIS_API',
    });
    expect(result.sample).toMatchObject({ sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY', confidence: 'VERIFIED', hasRealFields: true, executionImpact: 'NONE' });
    expect(result.promotionStage).toBe('WEIGHTED');
    expect(result.selectableForRouter).toBe(true);
    expect(result.health.provider).toBe('KIS');
    expect(result.health.status).toBe('OK');
    expect(result.health.semanticAvailable).toBe(true);
    expect(result.health.isPositiveFlowConfirmed).toBe(true);
    expect(result.health.isNegativeFlowConfirmed).toBe(false);
    expect(result.health.reason).toContain('safeOfficialSource=true');
    expect(result.health.reason).toContain('liveExecutionAllowed=false');
    expect(result.health.reason).toContain('executionImpact=NONE');
  }, 15_000);

  it('uses KIS investor_trade_by_stock_daily when strict investor fields are missing', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 10,
        institutionalNetBuy: 20,
        individualNetBuy: -30,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
      }),
    });
    const { fetchKisInvestorFlowEvidence } = await import('./kisInvestorFlowEvidence.js');

    const result = await fetchKisInvestorFlowEvidence('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.data).toMatchObject({
      provider: 'KIS_API',
      foreignNetBuy: 10,
      institutionalNetBuy: 20,
      individualNetBuy: -30,
      tradingDate: '2026-05-08',
    });
    expect(result.sample).toMatchObject({ sourceKind: 'INVESTOR_TRADE_BY_STOCK_DAILY', confidence: 'VERIFIED', usableForShadow: true });
    expect(result.health.status).toBe('OK');
    expect(result.health.reason).toContain('endpoint=KIS_INVESTOR_TRADE_BY_STOCK_DAILY');
    expect(result.health.reason).toContain('KIS=OK');
    expect(result.health.reason).toContain('executionImpact=NONE');
  }, 15_000);

  it('allows degraded symbol-level KIS evidence without fake individual zero', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 10,
        institutionalNetBuy: 20,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
      }),
    });
    const { fetchKisInvestorFlowEvidence } = await import('./kisInvestorFlowEvidence.js');

    const result = await fetchKisInvestorFlowEvidence('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.data?.foreignNetBuy).toBe(10);
    expect(result.data?.institutionalNetBuy).toBe(20);
    expect(result.data).not.toHaveProperty('individualNetBuy');
    expect(result.sample?.confidence).toBe('DEGRADED');
    expect(result.sample?.usableForShadow).toBe(true);
    expect(result.sample).not.toHaveProperty('individualNetBuy');
    expect(result.health.reason).toContain('confidence=DEGRADED');
    expect(result.health.reason).toContain('KIS=PARTIAL');
    expect(result.health.reason).toContain('marketSignal=false');
  }, 15_000);

  it('uses investor_trade_by_stock_daily as the only semantic KIS investor source', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({
      fetchKisInvestorTradeByStockDaily: async () => ({
        stockCode: '005930',
        tradingDate: '2026-05-08',
        foreignNetBuy: 10,
        institutionalNetBuy: 20,
        individualNetBuy: -30,
        source: 'KIS_API',
        fetchedAt: '2026-05-11T09:30:00.000Z',
      }),
    });
    const { fetchKisInvestorFlowEvidence } = await import('./kisInvestorFlowEvidence.js');

    const result = await fetchKisInvestorFlowEvidence('005930', new Date('2026-05-11T09:30:00.000Z'));

    expect(result.data?.foreignNetBuy).toBe(10);
    expect(result.sample?.sourceKind).toBe('INVESTOR_TRADE_BY_STOCK_DAILY');
    expect(result.health.reason).toContain('KIS=OK');
    expect(result.executionImpact).toBe('NONE');
  }, 15_000);

});
