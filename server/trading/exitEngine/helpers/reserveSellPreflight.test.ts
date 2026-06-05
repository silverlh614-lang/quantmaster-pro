import { beforeEach, describe, expect, it, vi } from 'vitest';

// seed 4452bd3 후 import 그래프 확장(reserveSell → … → buyPipeline → liveBuyExecutor)으로
// kisClient 단일 통로 배럴에서 placeKisSellOrder 외 fetchAccountBalance/submitBuyOrder 도
// import-time 에 요구된다.
// 주의: kisClient.ts 는 `export * from './kisClient/index.js'` 배럴이라 importActual spread
// 후 placeKisSellOrder 를 덮어써도 re-export binding 이 우선해 실 구현(getTradingMode()=
// SHADOW → SHADOW_ONLY)이 호출되어 override 가 무시된다(LIVE 경로 단언이 SHADOW 로 오염).
// → 명시 factory 로 필요한 export 만 vi.fn() stub 한다(placeKisSellOrder 단언 정합 보장).
// liveBuyExecutor/buyPipeline 은 본 테스트에서 호출되지 않으므로 no-op stub 으로 충분.
vi.mock('../../../clients/kisClient.js', () => ({
  placeKisSellOrder: vi.fn(),
  fetchAccountBalance: vi.fn(async () => 0),
  submitBuyOrder: vi.fn(async () => ({ kind: 'SUBMITTED', ordNo: 'TEST-ORD' })),
}));

vi.mock('../../../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<any>('../../../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    appendShadowLog: vi.fn(),
    appendFill: vi.fn((trade: any, fill: any) => {
      trade.fills = [...(trade.fills ?? []), { ...fill, id: `fill-${trade.fills?.length ?? 0}` }];
    }),
    syncPositionCache: vi.fn(),
    getRemainingQty: vi.fn((trade: any) => trade.quantity ?? 0),
    getTotalRealizedPnl: vi.fn(() => 0),
  };
});

vi.mock('../../tradeEventLog.js', () => ({
  appendTradeEvent: vi.fn(),
}));

vi.mock('../../shadowPositionLifecycle.js', () => ({
  emitShadowSellSignal: vi.fn(() => ({ outcome: 'RECORDED' })),
  emitShadowSellPaperFilled: vi.fn(() => ({ outcome: 'RECORDED' })),
  emitShadowPositionClosed: vi.fn(() => ({ outcome: 'RECORDED' })),
  recordShadowLifecycleOutcome: vi.fn(),
}));

vi.mock('./attribution.js', () => ({
  emitPartialAttributionForSell: vi.fn(),
}));

import { placeKisSellOrder } from '../../../clients/kisClient.js';
import { sellReservationManager } from '../../exit/sellReservation/sellReservationManager.js';
import { placeReservedSellOrder } from './reserveSell.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';

function trade(): ServerShadowTrade {
  return {
    id: 'pos-dup',
    stockCode: '005930',
    stockName: 'Samsung',
    signalTime: '2026-05-19T00:00:00.000Z',
    signalPrice: 100,
    shadowEntryPrice: 100,
    quantity: 100,
    originalQuantity: 100,
    stopLoss: 90,
    targetPrice: 130,
    status: 'ACTIVE',
    mode: 'LIVE',
    fills: [
      {
        id: 'buy-1',
        type: 'BUY',
        qty: 100,
        price: 100,
        reason: 'BUY',
        timestamp: '2026-05-19T00:00:00.000Z',
        status: 'CONFIRMED',
      },
    ],
  };
}

describe('placeReservedSellOrder preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sellReservationManager.__testOnly.clear();
  });

  it('blocks duplicate sell intent before sending a second KIS order', async () => {
    vi.mocked(placeKisSellOrder).mockResolvedValue({
      ordNo: 'OD-1',
      placed: true,
      outcome: 'LIVE_ORDERED',
    });

    const t = trade();
    const fill = {
      type: 'SELL' as const,
      subType: 'STOP_LOSS' as const,
      qty: 30,
      price: 95,
      pnl: -150,
      pnlPct: -5,
      reason: 'STOP_LOSS',
      exitRuleTag: 'HARD_STOP',
      timestamp: '2026-05-19T01:00:00.000Z',
    };

    const first = await placeReservedSellOrder(t, 30, 'STOP_LOSS', fill, 'HARD_STOP');
    const second = await placeReservedSellOrder(t, 30, 'STOP_LOSS', fill, 'HARD_STOP');

    expect(first.kind).toBe('PENDING');
    expect(second).toEqual(expect.objectContaining({
      kind: 'FAILED',
      recorded: false,
      reason: expect.stringContaining('DUPLICATE_BLOCKED'),
    }));
    expect(placeKisSellOrder).toHaveBeenCalledTimes(1);
  });
});
