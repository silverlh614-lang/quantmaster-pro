/**
 * @responsibility buyPipeline.createBuyTask ETF/특수종목 최종 funnel 가드 회귀 (gap fix).
 *
 * 모든 후보 경로의 마지막 방어선 — 특수종목(ETF/우선주)이면 즉시 SKIP +
 * markBlocked('DATA', 'SPECIAL_SECURITY_EXCLUDED') + onRejected. 보통주는 통과.
 * flag=false(WATCHLIST_EXCLUDE_SPECIAL_SECURITIES) 시 미차단(byte-equivalent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

vi.mock('../persistence/tradeSignalStatusRepo.js', () => ({
  markAutoTradeReady: vi.fn(),
  markBlocked: vi.fn(),
}));

vi.mock('./entryEngine.js', () => ({
  generatePreMortem: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../telegram/buyApproval.js', () => ({
  requestBuyApproval: vi.fn(() => Promise.resolve('APPROVE')),
  requestBuyApprovalWithDelivery: vi.fn(() => Promise.resolve({
    action: 'APPROVE',
    telegramDelivered: true,
  })),
}));

vi.mock('../clients/enemyCheckClient.js', () => ({
  fetchEnemyCheckData: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('./enemyAutoBlock.js', () => ({
  evaluateEnemyAutoBlock: vi.fn(() => ({ shouldBlock: false, reason: '' })),
}));

vi.mock('./preMortemStructured.js', () => ({
  buildPreMortemStructured: vi.fn(() => null),
}));

const ORIG_FLAG = process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;

interface MakeParamsOpts {
  stockCode: string;
  stockName: string;
  signalId?: string;
}

async function makeMockParams(opts: MakeParamsOpts) {
  const onRejected = vi.fn();
  const onApproved = vi.fn(() => Promise.resolve());
  const trade = {
    id: 'trade-special-1',
    stockCode: opts.stockCode,
    stockName: opts.stockName,
    status: 'PENDING',
    entryRegime: 'R4_NEUTRAL',
    profitTranches: [],
  } as unknown as Parameters<typeof import('./buyPipeline.js').createBuyTask>[0]['trade'];
  return {
    trade,
    stockCode: opts.stockCode,
    stockName: opts.stockName,
    currentPrice: 10000,
    quantity: 10,
    entryPrice: 10000,
    stopLoss: 9500,
    targetPrice: 11000,
    gateScore: 7,
    shadowMode: true,
    effectiveBudget: 100000,
    onApproved,
    onRejected,
    alertMessage: 'test',
    logEvent: 'TEST_BUY',
    signalId: opts.signalId,
  };
}

describe('buyPipeline.createBuyTask ETF/특수종목 funnel 가드', () => {
  beforeEach(() => {
    delete process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIG_FLAG === undefined) delete process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
    else process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES = ORIG_FLAG;
  });

  describe('default ON (회귀 차단)', () => {
    it('UNICORN ETF (cold-start name fallback) 는 즉시 SKIP + REJECTED', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({
        stockCode: '494220',
        stockName: 'UNICORN SK하이닉스밸류체인액티브',
      });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('SKIP');
      await task.execute(result);
      expect(params.trade.status).toBe('REJECTED');
      expect(params.onRejected).toHaveBeenCalledWith(params.trade, 'SKIP');
    });

    it('signalId 있을 시 markBlocked(DATA, SPECIAL_SECURITY_EXCLUDED) 호출', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const tradeSignalRepo = await import('../persistence/tradeSignalStatusRepo.js');
      const params = await makeMockParams({
        stockCode: '494220',
        stockName: 'UNICORN SK하이닉스밸류체인액티브',
        signalId: 'sig-etf',
      });
      await createBuyTask(params);
      expect(tradeSignalRepo.markBlocked).toHaveBeenCalledWith({
        id: 'sig-etf',
        gate: 'DATA',
        reason: expect.stringContaining('SPECIAL_SECURITY_EXCLUDED'),
      });
    });

    it('보통주(삼성전자) 는 가드 통과 — 후속 흐름 진입(APPROVE)', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({ stockCode: '005930', stockName: '삼성전자' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('APPROVE');
    });
  });

  describe('flag=false (byte-equivalent legacy)', () => {
    beforeEach(() => {
      process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES = 'false';
    });

    it('flag=false 시 ETF 도 가드 미작동 → 후속 흐름 진입(APPROVE)', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({
        stockCode: '494220',
        stockName: 'UNICORN SK하이닉스밸류체인액티브',
      });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('APPROVE');
    });
  });
});
