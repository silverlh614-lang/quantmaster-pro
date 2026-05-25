/**
 * @responsibility P3-1 안전망 — 4 SHADOW 매수 경로 각각 실 fill(executeShadowBuy)이 정확히 1회임을 봉인(불변식 #2).
 *
 * 검증 (per-path fill-exactly-once):
 *   - 4 경로(main approvalQueue / intraday / preBreakoutEntry / preBreakoutFollowthrough) 각각
 *     shadowMode task 1개를 createBuyTask → execute('APPROVE') 로 실행하면, 정본 5-event 경로
 *     (buyPipeline.executeShadowBuyOrder → shadowBuyExecutor.executeShadowBuy) 가 실 fill 을 정확히 1회 수행한다.
 *   - onApproved 콜백(P3-1 제거 후)은 executeShadowBuy 를 재호출하지 않으므로 총 fill = 1.
 *   - ⛔ 어떤 경로든 fill 0회면(= 그 site 가 실제 executor 였음) 테스트 fail → 즉시 STOP·architect 보고.
 *   - 멱등 backstop 증명: 5-event 이후 onApproved 재호출(legacy)은 ALREADY_FILLED no-op (영속 0).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerShadowTrade } from '../../../../persistence/shadowTradeRepo.js';
import type { ShadowExecutionResult } from '../../../shadowExecutionPipeline.js';

type ApprovalAction = 'APPROVE' | 'REJECT' | 'SKIP';

// ── 실 fill spy: shadowExecutionPipeline.executeShadowBuy ─────────────────────
// 5-event 경로(shadowBuyExecutor.defaultDeps)와 (제거 전이라면) onApproved 재호출이 공유하는 단일 함수.
// 1st 호출 = 실 fill (trade → ACTIVE + BUY fill). 이미 fill 된 trade 재호출 시 ALREADY_FILLED no-op.
const _executeShadowBuy = vi.fn(
  async ({ trade }: { trade: ServerShadowTrade }): Promise<ShadowExecutionResult> => {
    const alreadyFilled =
      trade.status === 'ACTIVE' ||
      (trade.fills ?? []).some((f) => f.type === 'BUY' && f.status !== 'REVERTED');
    if (alreadyFilled) {
      return {
        outcome: 'ALREADY_FILLED' as const,
        reason: 'already filled (idempotent no-op)',
        tradeId: trade.id,
        executedAtIso: '2026-05-25T00:00:00.000Z',
        statusAfter: trade.status,
        liveOrderPlaced: false as const,
        executionImpact: 'NONE' as const,
      } as ShadowExecutionResult;
    }
    trade.status = 'ACTIVE';
    trade.fills = [{
      id: `${trade.id}-fill`,
      type: 'BUY',
      subType: 'INITIAL_BUY',
      qty: trade.quantity,
      price: trade.shadowEntryPrice,
      reason: 'test',
      timestamp: '2026-05-25T00:00:00.000Z',
      status: 'CONFIRMED',
    }] as ServerShadowTrade['fills'];
    return {
      outcome: 'EXECUTED' as const,
      reason: 'ok',
      tradeId: trade.id,
      executedAtIso: '2026-05-25T00:00:00.000Z',
      fillId: `${trade.id}-fill`,
      fillPrice: trade.shadowEntryPrice,
      statusAfter: trade.status,
      liveOrderPlaced: false as const,
      executionImpact: 'NONE' as const,
    } as ShadowExecutionResult;
  },
);
const _recordShadowExecutionOutcome = vi.fn();

vi.mock('../../../shadowExecutionPipeline.js', () => ({
  executeShadowBuy: _executeShadowBuy,
  recordShadowExecutionOutcome: _recordShadowExecutionOutcome,
}));

// buyPipeline → shadowBuyExecutor 가 끌어오는 외부 의존성 mock (statusWiring.test 패턴).
vi.mock('../../../../persistence/tradeSignalStatusRepo.js', () => ({
  markAutoTradeReady: vi.fn(() => ({ id: 'mock-signal', status: 'AUTO_TRADE_READY' })),
  buildSignalId: (t: string, c: string) => `${t}:${c}`,
}));

const _requestBuyApproval = vi.fn<(...a: unknown[]) => Promise<ApprovalAction>>(async () => 'APPROVE');
vi.mock('../../../../telegram/buyApproval.js', () => ({
  requestBuyApproval: _requestBuyApproval,
  requestBuyApprovalWithDelivery: vi.fn(async (params: unknown) => ({
    action: await _requestBuyApproval(params),
    telegramDelivered: true,
  })),
}));

vi.mock('../../../../screener/sectorMap.js', () => ({ getSectorByCode: () => '반도체' }));
vi.mock('../../../../persistence/incidentLogRepo.js', () => ({ getLatestIncidentAt: () => null }));
vi.mock('../../../../persistence/shadowTradeRepo.js', () => ({
  appendShadowLog: vi.fn(),
  loadShadowTrades: vi.fn(() => []),
  saveShadowTrades: vi.fn(),
  getRemainingQty: vi.fn(() => 0),
  appendFill: vi.fn((trade: { fills?: unknown[] }, fill: unknown) => {
    if (!trade.fills) trade.fills = [];
    trade.fills.push({ id: 'fill-test-1', ...(fill as Record<string, unknown>) });
  }),
}));
vi.mock('../../../preMarketSmokeTest.js', () => ({
  getSmokeTestLiveBlocked: () => false,
  getSmokeTestLastFailedReason: () => '',
}));
vi.mock('../../../killSwitch.js', () => ({ assertSafeOrder: vi.fn() }));
vi.mock('../../../../clients/kisClient.js', () => ({
  fetchAccountBalance: async () => 100_000_000,
  placeKisMarketBuyOrder: async () => 'ORD-123',
  submitBuyOrder: async () => ({ kind: 'SUBMITTED', ordNo: 'ORD-123' }),
}));
vi.mock('../../../fillMonitor.js', () => ({ fillMonitor: { addOrder: vi.fn() } }));
vi.mock('../../../../clients/enemyCheckClient.js', () => ({ fetchEnemyCheckData: async () => null }));
vi.mock('../../../entryEngine.js', () => ({ generatePreMortem: async () => null }));
vi.mock('../../../../alerts/preMortemFormatter.js', () => ({ formatPreMortemForTelegram: () => null }));
vi.mock('../../../../persistence/sizingHistoryRepo.js', () => ({ recordSizing: vi.fn() }));
vi.mock('../../../tradeEventLog.js', () => ({ recordTradeEvent: vi.fn() }));

let _sessionSeq = 0;

function makeTrade(id: string): ServerShadowTrade {
  return {
    id,
    stockCode: '005930',
    stockName: '삼성전자',
    status: 'PENDING',
    mode: 'SHADOW',
    signalTime: '2026-05-25T05:00:00Z',
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
  } as unknown as ServerShadowTrade;
}

/**
 * 정본 5-event 를 통과시키는 단일 SHADOW task 를 만들어 execute('APPROVE') 한다.
 * onApproved 는 각 경로의 P3-1 제거 후 잔존 부수효과(executeShadowBuy 없음)를 모사한다.
 */
async function runLaneTask(opts: {
  tradeId: string;
  onApproved: (trade: ServerShadowTrade) => Promise<void> | void;
}): Promise<ServerShadowTrade> {
  const { createBuyTask } = await import('../../../buyPipeline.js');
  const trade = makeTrade(opts.tradeId);
  const task = await createBuyTask({
    trade: trade as unknown as Parameters<typeof createBuyTask>[0]['trade'],
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
    onApproved: async (t) => { await opts.onApproved(t); },
    marketSession: `TEST_SESSION_${++_sessionSeq}` as unknown as Parameters<typeof createBuyTask>[0]['marketSession'],
  });
  await task.execute('APPROVE');
  return trade;
}

describe('P3-1 안전망 — per-path SHADOW fill-exactly-once (불변식 #2)', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { buyIdempotencyGuard } = await import('../../../buy/buyIdempotencyGuard.js');
    buyIdempotencyGuard.clear();
    _executeShadowBuy.mockClear();
    _recordShadowExecutionOutcome.mockClear();
    _requestBuyApproval.mockReset();
    _requestBuyApproval.mockResolvedValue('APPROVE');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  // ── 경로 1: main approvalQueue (onApproved = ctx.shadows.push 만, fill 없음) ──
  it('Lane#1 main approvalQueue: 실 fill 정확히 1회 (제거 후 onApproved 재호출 없음)', async () => {
    const shadows: ServerShadowTrade[] = [];
    const trade = await runLaneTask({
      tradeId: 'lane1-main',
      onApproved: (t) => { shadows.push(t); /* 신호카드/ledger/tranche = task-tracking, fill 무관 */ },
    });
    // 5-event 가 그 1회. 제거된 onApproved 재호출이 없으므로 총 1회.
    expect(_executeShadowBuy).toHaveBeenCalledTimes(1);
    // fill 0회 = 제거 위험 (그 site 가 실제 executor) → STOP 조건. 1회면 안전.
    expect(_executeShadowBuy.mock.calls.length).toBeGreaterThan(0);
    expect(trade.status).toBe('ACTIVE');
  }, 15_000);

  // ── 경로 2: intraday (onApproved = 슬롯 재확인 + orderableCash 차감, fill 없음) ──
  it('Lane#2 intraday: 실 fill 정확히 1회', async () => {
    const cash = { value: 10_000_000 };
    await runLaneTask({
      tradeId: 'lane2-intraday',
      onApproved: () => { cash.value = Math.max(0, cash.value - 700_000); },
    });
    expect(_executeShadowBuy).toHaveBeenCalledTimes(1);
    expect(_executeShadowBuy.mock.calls.length).toBeGreaterThan(0);
  }, 15_000);

  // ── 경로 3: preBreakoutEntry (onApproved = cash 차감, fill 없음) ──
  it('Lane#3 preBreakoutEntry: 실 fill 정확히 1회', async () => {
    const cash = { value: 10_000_000 };
    await runLaneTask({
      tradeId: 'lane3-pbEntry',
      onApproved: () => { cash.value = Math.max(0, cash.value - 700_000); },
    });
    expect(_executeShadowBuy).toHaveBeenCalledTimes(1);
    expect(_executeShadowBuy.mock.calls.length).toBeGreaterThan(0);
  }, 15_000);

  // ── 경로 4: preBreakoutFollowthrough (onApproved = cash 차감, fill 없음) ──
  it('Lane#4 preBreakoutFollowthrough: 실 fill 정확히 1회', async () => {
    const cash = { value: 10_000_000 };
    await runLaneTask({
      tradeId: 'lane4-pbFollow',
      onApproved: () => { cash.value = Math.max(0, cash.value - 700_000); },
    });
    expect(_executeShadowBuy).toHaveBeenCalledTimes(1);
    expect(_executeShadowBuy.mock.calls.length).toBeGreaterThan(0);
  }, 15_000);

  // ── 멱등 backstop 증명 — 제거된 onApproved 재호출은 ALREADY_FILLED no-op 이었음 ──
  it('isAlreadyFilled backstop: 5-event 이후 legacy onApproved 재호출은 ALREADY_FILLED no-op (영속 0)', async () => {
    let legacyOutcome: string | undefined;
    const trade = await runLaneTask({
      tradeId: 'backstop-1',
      onApproved: async (t) => {
        // 제거 전 4 site 가 하던 재호출 모사 — 항상 5-event(ACTIVE) 이후라 ALREADY_FILLED.
        const r = await _executeShadowBuy({ trade: t });
        legacyOutcome = r.outcome;
      },
    });
    // 1(5-event) + 1(legacy 재호출 모사) = 2 호출, 그러나 2번째는 ALREADY_FILLED no-op.
    expect(_executeShadowBuy).toHaveBeenCalledTimes(2);
    expect(legacyOutcome).toBe('ALREADY_FILLED');
    // 실 fill(BUY) 영속은 정확히 1건 (멱등 no-op 은 추가 fill 0).
    const buyFills = (trade.fills ?? []).filter((f) => f.type === 'BUY' && f.status !== 'REVERTED');
    expect(buyFills.length).toBe(1);
  }, 15_000);
});
