/**
 * @responsibility ADR-0185 (PR-B12-B) site 3 — buyPipeline.createBuyTask KRX code sanity 가드 회귀.
 *
 * 잘못된 code (예: `0070X0`) 가 우회 경로로 buyPipeline 진입 시 즉시 SKIP +
 * markBlocked + onRejected 정합 검증. default ON + ENV `EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED=true` 우회.
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

const ORIG_DISABLE = process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED;

interface MakeParamsOpts {
  stockCode: string;
  signalId?: string;
}

async function makeMockParams(opts: MakeParamsOpts) {
  const onRejected = vi.fn();
  const onApproved = vi.fn(() => Promise.resolve());
  const trade = {
    id: 'trade-test-1',
    stockCode: opts.stockCode,
    stockName: 'Test',
    status: 'PENDING',
    entryRegime: 'R4_NEUTRAL',
    profitTranches: [],
  } as unknown as Parameters<typeof import('./buyPipeline.js').createBuyTask>[0]['trade'];
  return {
    trade,
    stockCode: opts.stockCode,
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
    signalId: opts.signalId,
  };
}

describe('ADR-0185 buyPipeline.createBuyTask KRX code sanity 가드', () => {
  beforeEach(() => {
    delete process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIG_DISABLE === undefined) delete process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED;
    else process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = ORIG_DISABLE;
  });

  describe('default ON (회귀 차단)', () => {
    it('정상 6자리 KRX code 는 가드 통과 — 후속 흐름 진입', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({ stockCode: '005930' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      // 정상 code 는 가드 통과 → mock approval='APPROVE'
      expect(result).toBe('APPROVE');
    });

    it('잘못된 code "0070X0" 는 즉시 SKIP', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({ stockCode: '0070X0' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('SKIP');
      await task.execute(result);
      expect(params.trade.status).toBe('REJECTED');
      expect(params.onRejected).toHaveBeenCalledWith(params.trade, 'SKIP');
    });

    it('잘못된 code "XXXXXX" 자동 SKIP', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({ stockCode: 'XXXXXX' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('SKIP');
    });

    it('빈 문자열 code 즉시 SKIP', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({ stockCode: '' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      expect(result).toBe('SKIP');
    });

    it('signalId 있을 시 markBlocked 호출 (DATA gate)', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const tradeSignalRepo = await import('../persistence/tradeSignalStatusRepo.js');
      const params = await makeMockParams({ stockCode: '0070X0', signalId: 'sig-test' });
      await createBuyTask(params);
      expect(tradeSignalRepo.markBlocked).toHaveBeenCalledWith({
        id: 'sig-test',
        gate: 'DATA',
        reason: expect.stringContaining('INVALID_KRX_CODE'),
      });
    });

    it('signalId 미전달 시 markBlocked 미호출', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const tradeSignalRepo = await import('../persistence/tradeSignalStatusRepo.js');
      const params = await makeMockParams({ stockCode: '0070X0' });
      await createBuyTask(params);
      expect(tradeSignalRepo.markBlocked).not.toHaveBeenCalled();
    });

    it('markBlocked throw 시 매수 흐름 차단 안 함 (try/catch 격리)', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const tradeSignalRepo = await import('../persistence/tradeSignalStatusRepo.js');
      vi.mocked(tradeSignalRepo.markBlocked).mockImplementation(() => {
        throw new Error('영속 실패 시뮬');
      });
      const params = await makeMockParams({ stockCode: '0070X0', signalId: 'sig' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      // throw 무시하고 SKIP 정상 반환
      expect(result).toBe('SKIP');
    });
  });

  describe('ENV EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED=true (legacy 동작)', () => {
    beforeEach(() => {
      process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED = 'true';
    });

    it('ENV 우회 시 잘못된 code 도 진입 가능 (legacy 회귀)', async () => {
      const { createBuyTask } = await import('./buyPipeline.js');
      const params = await makeMockParams({ stockCode: '0070X0' });
      const task = await createBuyTask(params);
      const result = await task.approvalPromise;
      // ENV 우회 시 가드 미작동 → mock approval='APPROVE'
      expect(result).toBe('APPROVE');
    });
  });
});
