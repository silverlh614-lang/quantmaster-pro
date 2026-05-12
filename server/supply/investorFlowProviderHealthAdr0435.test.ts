import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('ADR-0435 InvestorFlowProviderHealth SSOT', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;
  const originalKrxDisabled = process.env.KRX_API_DISABLED;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0435-flow-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    process.env.KRX_API_DISABLED = 'true';
    vi.resetModules();
  });

  afterEach(async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({});
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    if (originalKrxDisabled === undefined) delete process.env.KRX_API_DISABLED;
    else process.env.KRX_API_DISABLED = originalKrxDisabled;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    vi.restoreAllMocks();
  });

  it('classifies lunch break and non-trading day as retry-suppressed DATA_UNAVAILABLE states', async () => {
    const {
      shouldSuppressInvestorFlowFetch,
      classifyInvestorFlowMarketSession,
    } = await import('./investorFlowProviderHealth.js');

    const lunch = new Date('2026-05-07T03:10:00.000Z'); // 12:10 KST
    expect(classifyInvestorFlowMarketSession(lunch)).toBe('LUNCH_BREAK');
    expect(shouldSuppressInvestorFlowFetch(lunch)).toMatchObject({
      suppress: true,
      status: 'LUNCH_BREAK',
      sourceDateKst: '2026-05-07',
    });

    const saturday = new Date('2026-05-09T03:00:00.000Z');
    expect(shouldSuppressInvestorFlowFetch(saturday)).toMatchObject({
      suppress: true,
      status: 'NON_TRADING_DAY',
    });
  });

  it('keeps HTTP400 and parser-empty classifications explicit and non-negative', async () => {
    const { makeInvestorFlowProviderHealth } = await import('./investorFlowProviderHealth.js');
    const http400 = makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: 'HTTP_400',
      reason: 'endpoint=MDCSTAT02203;market=ALL;date=2026-05-07;session=REGULAR;retryable=false;cacheFallback=true',
      now: new Date('2026-05-07T01:00:00.000Z'),
      sourceDateKst: '2026-05-07',
      endpoint: 'MDCSTAT02203',
      retryable: false,
      cacheFallback: true,
    });
    expect(http400.dataAvailable).toBe(false);
    expect(http400.semanticAvailable).toBe(false);
    expect(http400.isNegativeFlowConfirmed).toBe(false);

    const emptyRows = makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: 'PARSER_EMPTY_ROWS',
      reason: 'rows=0;endpoint=MDCSTAT02203',
      now: new Date('2026-05-07T01:00:00.000Z'),
    });
    expect(emptyRows.dataAvailable).toBe(false);
    expect(emptyRows.isNegativeFlowConfirmed).toBe(false);
  });

  it('negative cache suppresses repeated HTTP400/empty retries but expires on session change', async () => {
    const {
      getInvestorFlowNegativeCache,
      makeInvestorFlowProviderHealth,
      setInvestorFlowNegativeCache,
      __resetInvestorFlowProviderHealthForTests,
    } = await import('./investorFlowProviderHealth.js');
    __resetInvestorFlowProviderHealthForTests();

    const lunch = new Date('2026-05-07T03:10:00.000Z');
    const health = makeInvestorFlowProviderHealth({
      provider: 'KRX',
      status: 'LUNCH_BREAK',
      reason: 'KRX lunch-break retry suppressed',
      now: lunch,
      sourceDateKst: '2026-05-07',
    });
    setInvestorFlowNegativeCache('KRX', '005930', health, lunch, 60 * 60_000);

    const sameSession = getInvestorFlowNegativeCache('KRX', '005930', new Date('2026-05-07T03:20:00.000Z'));
    expect(sameSession?.status).toBe('LUNCH_BREAK');
    expect(sameSession?.reason).toMatch(/negative cache hit/);

    const regular = getInvestorFlowNegativeCache('KRX', '005930', new Date('2026-05-07T04:05:00.000Z'));
    expect(regular).toBeNull();
  });

  it('routes KRX empty rows, NAVER not wired, cache empty, and semantic collector unavailable without FAIL', async () => {
    const { setKisClientOverrides } = await import('../clients/kisClient/overrides.js');
    setKisClientOverrides({ fetchKisInvestorFlow: async () => null });
    const { fetchInvestorFlowWithPolicy, summarizeInvestorFlowProviderHealth } = await import('./investorFlowRouter.js');
    const result = await fetchInvestorFlowWithPolicy('005930', new Date('2026-05-07T01:00:00.000Z'));

    expect(result.data).toBeNull();
    expect(result.health.some((h) => h.provider === 'KRX' && ['PARSER_EMPTY_ROWS', 'PROVIDER_EMPTY_RESPONSE', 'PARSER_KEY_MISMATCH', 'PARSER_FIELD_MISMATCH'].includes(h.status))).toBe(true);
    expect(result.health.some((h) => h.provider === 'NAVER' && h.status === 'NOT_WIRED')).toBe(true);
    expect(result.health.some((h) => h.provider === 'CACHE' && h.status === 'CACHE_EMPTY')).toBe(true);
    const composite = result.health.find((h) => h.provider === 'COMPOSITE');
    expect(composite?.status).toBe('PROVIDER_UNAVAILABLE');
    expect(composite?.isNegativeFlowConfirmed).toBe(false);

    const summary = summarizeInvestorFlowProviderHealth(result.health);
    expect(summary).toContain('NAVER: NOT_WIRED');
    expect(summary).toContain('- supply_confluence:');
    expect(summary).toContain('signal=DATA_UNAVAILABLE');
    expect(summary).toContain('dataStatus=DATA_UNAVAILABLE');
    expect(summary).toContain('providerIssue=false');
    expect(summary).toContain('executionImpact=NONE');
    expect(summary).toContain('shadowObservableAllowed: true');
  }, 15_000);


  it('renders bearish supply_confluence as OK data interpretation, not provider failure', async () => {
    const { summarizeInvestorFlowProviderHealth } = await import('./investorFlowProviderHealth.js');
    const summary = summarizeInvestorFlowProviderHealth([], {
      status: 'OK',
      selectedProvider: 'KIS_API',
      selectedReason: 'KIS verified semantic net-buy',
      providerTried: ['KIS_API'],
      providerStatuses: { KIS_API: 'VERIFIED', SEMANTIC_NETBUY: 'READY_FOR_SHADOW' },
      signal: 'BEARISH',
      coverage: { available: 10, total: 10 },
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
    });

    expect(summary).toContain('signal=BEARISH');
    expect(summary).toContain('dataStatus=OK');
    expect(summary).toContain('providerIssue=false');
    expect(summary).toContain('interpretation=actual KIS verified flow is bearish, not provider failure');
    expect(summary).toContain('executionImpact=NONE');
  });
});
