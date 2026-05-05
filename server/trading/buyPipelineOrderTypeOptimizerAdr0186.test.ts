/**
 * @responsibility ADR-0186 (PR-A2-Wiring-1) buyPipeline.createBuyTask 의사결정 wiring 회귀.
 *
 * ENV `ORDER_TYPE_OPTIMIZER_ENABLED=true` 활성 시 decideOrderType 호출 + 결과 영속 +
 * 진단 로그. default OFF 시 호출 0건 (LIVE 매매 본체 영향 0).
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
  requestBuyApproval: vi.fn(() => Promise.resolve('SKIP')),
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

const decideOrderTypeSpy = vi.fn(() => ({
  orderType: 'IOC_MARKET' as const,
  reason: 'mock 강한 돌파',
}));

vi.mock('./orderTypeOptimizer.js', async () => {
  const actual = await vi.importActual<typeof import('./orderTypeOptimizer.js')>(
    './orderTypeOptimizer.js',
  );
  return {
    ...actual,
    decideOrderType: decideOrderTypeSpy,
  };
});

const ORIG_ENV = process.env.ORDER_TYPE_OPTIMIZER_ENABLED;

function makeMockParams(opts: { stockCode?: string; volumeZ?: number; priceMomentumPct?: number } = {}) {
  const onRejected = vi.fn();
  const onApproved = vi.fn(() => Promise.resolve());
  const trade = {
    id: 'trade-test-1',
    stockCode: opts.stockCode ?? '005930',
    stockName: 'Test',
    status: 'PENDING',
    entryRegime: 'R4_NEUTRAL',
    profitTranches: [],
  } as unknown as Parameters<typeof import('./buyPipeline.js').createBuyTask>[0]['trade'];
  return {
    trade,
    stockCode: opts.stockCode ?? '005930',
    stockName: 'TestStock',
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
    volumeZ: opts.volumeZ,
    priceMomentumPct: opts.priceMomentumPct,
  };
}

describe('ADR-0186 buyPipeline.createBuyTask Order Type Optimizer wiring', () => {
  beforeEach(() => {
    delete process.env.ORDER_TYPE_OPTIMIZER_ENABLED;
    decideOrderTypeSpy.mockClear();
  });

  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.ORDER_TYPE_OPTIMIZER_ENABLED;
    else process.env.ORDER_TYPE_OPTIMIZER_ENABLED = ORIG_ENV;
  });

  describe('default OFF (LIVE 매매 본체 영향 0)', () => {
    it('ENV 미설정 시 decideOrderType 호출 0건', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams();
      await createBuyTask(params);
      expect(decideOrderTypeSpy).not.toHaveBeenCalled();
      expect(params.trade.orderTypeDecision).toBeUndefined();
    });

    it('ENV "false" 명시 시 호출 0건', async () => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = 'false';
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams();
      await createBuyTask(params);
      expect(decideOrderTypeSpy).not.toHaveBeenCalled();
    });

    it('ENV "1" 같은 정확 비교 미통과 시 호출 0건', async () => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = '1';
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams();
      await createBuyTask(params);
      expect(decideOrderTypeSpy).not.toHaveBeenCalled();
    });
  });

  describe('ENV ORDER_TYPE_OPTIMIZER_ENABLED=true (의사결정 가시화)', () => {
    beforeEach(() => {
      process.env.ORDER_TYPE_OPTIMIZER_ENABLED = 'true';
    });

    it('decideOrderType 호출 + 결과 영속 (orderTypeDecision)', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams({ volumeZ: 2.5, priceMomentumPct: 3.0 });
      await createBuyTask(params);
      expect(decideOrderTypeSpy).toHaveBeenCalledWith({
        stockCode: '005930',
        volumeZ: 2.5,
        priceMomentumPct: 3.0,
      });
      expect(params.trade.orderTypeDecision).toBeDefined();
      expect(params.trade.orderTypeDecision?.orderType).toBe('IOC_MARKET');
      expect(params.trade.orderTypeDecision?.reason).toBe('mock 강한 돌파');
      expect(typeof params.trade.orderTypeDecision?.decidedAt).toBe('string');
    });

    it('volumeZ / priceMomentumPct 미전달 시 undefined 그대로 호출', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams();
      await createBuyTask(params);
      expect(decideOrderTypeSpy).toHaveBeenCalledWith({
        stockCode: '005930',
        volumeZ: undefined,
        priceMomentumPct: undefined,
      });
    });

    it('decideOrderType throw 시 매수 흐름 차단 안 함 (try/catch 격리)', async () => {
      decideOrderTypeSpy.mockImplementationOnce(() => {
        throw new Error('의사결정 실패 시뮬');
      });
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams();
      // throw 무시하고 정상 완료 (approval='SKIP' mock)
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('SKIP');
      expect(params.trade.orderTypeDecision).toBeUndefined();
    });

    it('잘못된 KRX code 우선 SKIP — orderTypeOptimizer 호출 안 됨', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = makeMockParams({ stockCode: 'XXXXXX' });
      await createBuyTask(params);
      // ADR-0185 site 3 KRX code guard 가 먼저 작동 — orderTypeOptimizer 미진입
      expect(decideOrderTypeSpy).not.toHaveBeenCalled();
    });
  });
});
