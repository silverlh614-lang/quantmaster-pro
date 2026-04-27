/**
 * @responsibility buyPipeline ADR-0077 wiring 회귀 — signalId 전달 + AUTO_TRADE_READY 영속
 *
 * 검증:
 *   - createBuyTask params.signalId 가 requestBuyApproval 에 전달됨 (옵셔널)
 *   - SHADOW execute(APPROVE) → markAutoTradeReady('SHADOW') 호출
 *   - signalId 미전달 → markAutoTradeReady 호출 0건 (옵셔널 호환)
 *   - markAutoTradeReady throw → 매매 흐름 차단 안 함 (try/catch 가드)
 *   - SHADOW REJECT → markAutoTradeReady 호출 0건
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 외부 의존성 mock
const _markAutoTradeReady = vi.fn();
type ApprovalAction = 'APPROVE' | 'REJECT' | 'SKIP';
const _requestBuyApproval = vi.fn<(...a: unknown[]) => Promise<ApprovalAction>>(async () => 'APPROVE');

vi.mock('../persistence/tradeSignalStatusRepo.js', () => ({
  markAutoTradeReady: _markAutoTradeReady,
}));

vi.mock('../telegram/buyApproval.js', () => ({
  requestBuyApproval: _requestBuyApproval,
}));

vi.mock('../screener/sectorMap.js', () => ({
  getSectorByCode: () => '반도체',
}));

vi.mock('../persistence/incidentLogRepo.js', () => ({
  getLatestIncidentAt: () => null,
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  appendShadowLog: vi.fn(),
}));

vi.mock('./preMarketSmokeTest.js', () => ({
  getSmokeTestLiveBlocked: () => false,
  getSmokeTestLastFailedReason: () => '',
}));

vi.mock('./killSwitch.js', () => ({
  assertSafeOrder: vi.fn(),
}));

vi.mock('../clients/kisClient.js', () => ({
  fetchAccountBalance: async () => 100_000_000,
  placeKisMarketBuyOrder: async () => 'ORD-123',
}));

vi.mock('./fillMonitor.js', () => ({
  fillMonitor: { addOrder: vi.fn() },
}));

vi.mock('../clients/enemyCheckClient.js', () => ({
  fetchEnemyCheckData: async () => null,
}));

vi.mock('./entryEngine.js', () => ({
  generatePreMortem: async () => null,
}));

vi.mock('../alerts/preMortemFormatter.js', () => ({
  formatPreMortemForTelegram: () => null,
}));

vi.mock('../persistence/sizingHistoryRepo.js', () => ({
  recordSizing: vi.fn(),
}));

vi.mock('./tradeEventLog.js', () => ({
  recordTradeEvent: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  _markAutoTradeReady.mockReset();
  _requestBuyApproval.mockReset();
  _requestBuyApproval.mockResolvedValue('APPROVE');
});

async function makeShadowTask(opts: { signalId?: string; approval?: 'APPROVE' | 'REJECT' | 'SKIP' }) {
  if (opts.approval) {
    _requestBuyApproval.mockResolvedValue(opts.approval);
  }
  const { createBuyTask } = await import('./buyPipeline.js');
  // 최소 mock trade — execute 분기에 필요한 필드만
  const trade = {
    id: 'trade-shadow-1',
    stockCode: '005930',
    stockName: '삼성전자',
    status: 'PENDING',
    mode: 'SHADOW' as const,
    signalTime: '2026-04-27T05:00:00Z',
    signalPrice: 70_000,
    shadowEntryPrice: 70_000,
    quantity: 10,
    originalQuantity: 10,
    stopLoss: 65_000,
    initialStopLoss: 65_000,
    regimeStopLoss: 65_000,
    hardStopLoss: 65_000,
    targetPrice: 80_000,
    profitTranches: [],
    entryRegime: 'R2_BULL',
  } as unknown as Parameters<typeof createBuyTask>[0]['trade'];
  return createBuyTask({
    trade,
    stockCode: '005930',
    stockName: '삼성전자',
    currentPrice: 70_000,
    quantity: 10,
    entryPrice: 70_000,
    stopLoss: 65_000,
    targetPrice: 80_000,
    gateScore: 12,
    shadowMode: true,
    effectiveBudget: 700_000,
    alertMessage: 'msg',
    logEvent: 'SIGNAL',
    onApproved: vi.fn(async () => undefined),
    signalId: opts.signalId,
  });
}

describe('buyPipeline ADR-0077 wiring (SHADOW)', () => {
  it('signalId 전달 → requestBuyApproval 에 propagate', async () => {
    await makeShadowTask({ signalId: '2026-04-27T05:00:00Z:005930' });
    expect(_requestBuyApproval).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: '2026-04-27T05:00:00Z:005930' }),
    );
  });

  it('SHADOW execute(APPROVE) → markAutoTradeReady 호출', async () => {
    const task = await makeShadowTask({ signalId: '2026-04-27T05:00:00Z:005930' });
    await task.execute('APPROVE');
    expect(_markAutoTradeReady).toHaveBeenCalledWith({
      id: '2026-04-27T05:00:00Z:005930',
      reason: expect.stringContaining('SHADOW'),
    });
  });

  it('signalId 미전달 → markAutoTradeReady 호출 0건 (옵셔널 호환)', async () => {
    const task = await makeShadowTask({});
    await task.execute('APPROVE');
    expect(_markAutoTradeReady).not.toHaveBeenCalled();
  });

  it('execute(REJECT) → markAutoTradeReady 호출 0건', async () => {
    const task = await makeShadowTask({ signalId: '2026-04-27T05:00:00Z:005930' });
    await task.execute('REJECT');
    expect(_markAutoTradeReady).not.toHaveBeenCalled();
  });

  it('markAutoTradeReady throw → execute resolution 차단 안 함 (try/catch 가드)', async () => {
    _markAutoTradeReady.mockImplementation(() => {
      throw new Error('disk error');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = await makeShadowTask({ signalId: '2026-04-27T05:00:00Z:005930' });
    await task.execute('APPROVE'); // throw 안 함
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
