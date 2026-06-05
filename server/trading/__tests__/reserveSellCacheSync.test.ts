/**
 * reserveSellCacheSync.test.ts — reserveSell 호출 후 quantity 캐시가
 * fills SSOT 와 자동으로 정합되는지 보장하는 회귀 방지 테스트.
 *
 * 버그 이력:
 *   2026-04-22 포스코퓨처엠·오픈엣지테크 사례. Tranche 40% → RRR 50% 매도 후에도
 *   trade.quantity 캐시가 원래 값 유지 → /pos 오표시 + 후속 루프 이중 매도 위험.
 *   원인: reserveSell 내부에 syncPositionCache 호출 누락. 호출측 책임으로
 *   남겨진 경로 일부가 사이에 빠짐.
 *
 * 이 테스트가 fail 하면 그 수정이 근본 버그를 다시 불러온 것이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    appendFileSync: vi.fn(),
  },
}));
vi.mock('../../persistence/paths.js', () => ({
  SHADOW_FILE: '/mock/shadow-trades.json',
  SHADOW_LOG_FILE: '/mock/shadow-log.json',
  ensureDataDir: vi.fn(),
  tradeEventsFile: vi.fn(() => '/mock/events.jsonl'),
}));
// seed 4452bd3 후 shadowTradeRepo 전이 import 그래프가 kisClient 단일 통로를 끌어들이고,
// kisClient/auth.ts 가 import-time 에 hydrateFromDisk()→emitKisAuthPersistenceWarn()→
// emitOperationalWarn() 를 호출한다. operationalWarn 은 telegramCriticalAlertBridge→
// telegramClient 의 무거운 순환 import 를 거치는데, fs/paths mock 으로 모듈 init 순서가
// 바뀌며 그 순환이 SSR transform 의 TDZ('__vite_ssr_import before initialization')로
// 노출된다. 본 테스트(회계 불변식/캐시 정합)는 운영 warn emit 과 무관하므로
// emitOperationalWarn 을 no-op 으로 격리해 import-time 순환 부작용을 차단한다
// (런타임 동작 변경 0 — warn 은 본 테스트 단언 대상이 아님).
vi.mock('../../observability/operationalWarn.js', () => ({
  emitOperationalWarn: vi.fn(() => ({ emitted: false })),
  defaultWarnTtlSec: vi.fn(() => 60),
  classifyOperationalWarnLogLevel: vi.fn(() => 'warn'),
}));

import {
  appendFill,
  syncPositionCache,
  getRemainingQty,
  type ServerShadowTrade,
  type PositionFill,
} from '../../persistence/shadowTradeRepo.js';

/** reserveSell 의 appendFill + syncPositionCache 계약을 압축 복제. */
function reserveSellContract(
  trade: ServerShadowTrade,
  fill: Omit<PositionFill, 'id'>,
): void {
  appendFill(trade, fill);
  // ⚡ 이 호출이 없으면 버그 재발.
  syncPositionCache(trade);
}

function makeTrade(quantity = 100): ServerShadowTrade {
  return {
    id: 'test-1',
    stockCode: '003670',
    stockName: '포스코퓨처엠',
    signalTime: new Date().toISOString(),
    signalPrice: 237000,
    shadowEntryPrice: 237711,
    quantity,
    originalQuantity: quantity,
    stopLoss: 215740,
    initialStopLoss: 215740,
    targetPrice: 281400,
    status: 'ACTIVE',
    mode: 'SHADOW',
    entryRegime: 'R4_NEUTRAL',
    profileType: 'B',
    profitTranches: [],
    trailingHighWaterMark: 237711,
    trailPct: 0.1,
    trailingEnabled: false,
    fills: [
      {
        type: 'BUY',
        subType: 'INITIAL_BUY',
        qty: quantity,
        price: 237711,
        reason: 'test buy',
        timestamp: new Date(Date.now() - 86_400_000).toISOString(),
        id: 'f-buy-1',
        status: 'CONFIRMED',
      },
    ],
  } as unknown as ServerShadowTrade;
}

describe('reserveSell 계약 — fill 기록 후 quantity 캐시 동기화', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SHADOW 부분 매도 1회 — quantity 캐시가 즉시 차감돼야 함', () => {
    const trade = makeTrade(100);
    expect(trade.quantity).toBe(100);

    reserveSellContract(trade, {
      type: 'SELL',
      subType: 'PARTIAL_TP',
      qty: 40,
      price: 250_000,
      pnl: 491_560,
      pnlPct: 5.16,
      reason: 'Tranche 40%',
      timestamp: new Date().toISOString(),
      status: 'CONFIRMED',
    } as Omit<PositionFill, 'id'>);

    // fills SSOT 와 cache 모두 60 주 잔여를 가리켜야 한다.
    expect(getRemainingQty(trade)).toBe(60);
    expect(trade.quantity).toBe(60);
  });

  it('SHADOW 부분 매도 2회 연속 — 누적 차감이 cache 에 반영돼야 함', () => {
    const trade = makeTrade(100);

    // 1차: Tranche 40 주 익절
    reserveSellContract(trade, {
      type: 'SELL', subType: 'PARTIAL_TP',
      qty: 40, price: 250_000, pnl: 491_560, pnlPct: 5.16,
      reason: 'Tranche 40%',
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      status: 'CONFIRMED',
    } as Omit<PositionFill, 'id'>);

    expect(trade.quantity).toBe(60);

    // 2차: RRR 붕괴 50% 익절 (잔여 60 × 50% = 30)
    reserveSellContract(trade, {
      type: 'SELL', subType: 'PARTIAL_TP',
      qty: 30, price: 260_750, pnl: 691_170, pnlPct: 9.69,
      reason: 'RRR 붕괴 50%',
      timestamp: new Date().toISOString(),
      status: 'CONFIRMED',
    } as Omit<PositionFill, 'id'>);

    // SSOT · cache 모두 잔여 30 주를 가리켜야 한다.
    expect(getRemainingQty(trade)).toBe(30);
    expect(trade.quantity).toBe(30);
    expect(trade.originalQuantity).toBe(100);
  });

  it('SSOT(fills) 와 cache(quantity) 가 절대 불일치하지 않음 — 불변 검증', () => {
    const trade = makeTrade(100);
    reserveSellContract(trade, {
      type: 'SELL', subType: 'PARTIAL_TP',
      qty: 25, price: 245_000, pnl: 182_225, pnlPct: 3.06,
      reason: 'test partial',
      timestamp: new Date().toISOString(),
      status: 'CONFIRMED',
    } as Omit<PositionFill, 'id'>);

    // 이 불변이 깨지면 /pos · /pnl 이 거짓말을 하기 시작한다.
    expect(trade.quantity).toBe(getRemainingQty(trade));
  });
});
