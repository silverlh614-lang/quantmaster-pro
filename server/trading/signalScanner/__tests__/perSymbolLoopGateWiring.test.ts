/**
 * @responsibility ADR-0080 PR-S1 루프 게이트 자본 가중 SSOT 회귀 가드 (behavioral — loopInitializer 실호출)
 *
 * ADR-0019 분해로 루프 첫 진입 게이트가 perSymbol/steps/loopInitializer.ts 의 loopInitializer()
 * 로 이동. 과거 buyListLoop.ts 소스 grep 가드를 폐기하고 loopInitializer() 를 실호출해
 * 자본 가중(totalCommitted = slotResult.consumed + reservedSlots) 게이트 동작을 단언한다:
 *   - 사용자 시나리오 "만재 4 + 30% 잔존 4" (raw 8, consumed 5.2) 가 max 6 에서 BREAK 안 함.
 *   - 단순 카운트 회귀 시 raw 8 >= 6 으로 잘못 BREAK 되던 결함 부활 차단.
 *   - max 도달 BREAK 로그가 자본 가중(consumed.toFixed) + raw 카운트 동반 표기.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// loopInitializer 의 getPrice → kis client 체인 partial mock (BREAK 경로는 getPrice 미도달이나,
// CONTINUE 경로 검증 시 deterministic null 가격 확보용).
const fetchCurrentPrice = vi.fn<(code: string) => Promise<number | null>>();
const getRealtimePrice = vi.fn<(code: string) => number | null>();
const subscribeStock = vi.fn<(code: string) => void>();
const requestKisWsSubscription = vi.fn();
const isKisWsSubscriptionPriorityDisabled = vi.fn<() => boolean>();

vi.mock('../../../clients/kisClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../clients/kisClient.js')>()),
  fetchCurrentPrice: (code: string) => fetchCurrentPrice(code),
}));
vi.mock('../../../clients/kisStreamClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../clients/kisStreamClient.js')>()),
  getRealtimePrice: (code: string) => getRealtimePrice(code),
  subscribeStock: (code: string) => subscribeStock(code),
}));
vi.mock('../../../clients/kisWebSocketSubscriptionManager.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../clients/kisWebSocketSubscriptionManager.js')>()),
  requestKisWsSubscription: (...args: unknown[]) => requestKisWsSubscription(...args),
  isKisWsSubscriptionPriorityDisabled: () => isKisWsSubscriptionPriorityDisabled(),
}));

import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import type { BuyListLoopContext } from '../perSymbol/types.js';
import { createScanCounters } from '../scanDiagnostics/scanCounterFactory.js';
import { loopInitializer } from '../perSymbol/steps/loopInitializer.js';

const ORIG_SLOT_DISABLED = process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;

beforeEach(() => {
  fetchCurrentPrice.mockReset();
  getRealtimePrice.mockReset();
  subscribeStock.mockReset();
  requestKisWsSubscription.mockReset();
  isKisWsSubscriptionPriorityDisabled.mockReset();
  isKisWsSubscriptionPriorityDisabled.mockReturnValue(false);
  getRealtimePrice.mockReturnValue(null);
  fetchCurrentPrice.mockResolvedValue(70_000);
  delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED; // 자본 가중 활성 (default).
});

afterEach(() => {
  if (ORIG_SLOT_DISABLED === undefined) delete process.env.SLOT_CAPITAL_WEIGHTED_DISABLED;
  else process.env.SLOT_CAPITAL_WEIGHTED_DISABLED = ORIG_SLOT_DISABLED;
});

/** open ACTIVE shadow — originalQuantity 대비 quantity 비율로 consumed 산출. */
function makeShadow(code: string, originalQuantity: number, quantity: number): ServerShadowTrade {
  return {
    stockCode: code,
    status: 'ACTIVE',
    watchlistSource: 'PRE_MARKET',
    originalQuantity,
    quantity,
  } as unknown as ServerShadowTrade;
}

function makeCtx(shadows: ServerShadowTrade[], effectiveMaxPositions: number): BuyListLoopContext {
  return {
    shadows,
    effectiveMaxPositions,
    regime: 'R3_NORMAL',
    scanCounters: createScanCounters(),
    mutables: { reservedSlots: { value: 0 } },
  } as unknown as BuyListLoopContext;
}

function runGate(ctx: BuyListLoopContext) {
  const stock = {
    code: '005930',
    name: 'Samsung',
    section: undefined,
    entryPrice: 1_000,
    addedAt: '2026-01-01T00:00:00Z',
    addedBy: 'AUTO',
  } as unknown as Parameters<typeof loopInitializer>[0]['stock'];
  return loopInitializer({
    ctx,
    stock,
    isMomentumShadow: false,
    initialStockShadowMode: false,
    diagnosticLiveBlockLogged: false,
  });
}

describe('ADR-0080 PR-S1 루프 게이트 — loopInitializer 자본 가중 behavioral', () => {
  it('단순 만재 (consumed 1.0 × max) → BREAK + 자본 가중 BREAK 로그', async () => {
    // effectiveMaxPositions=1, full 포지션 1개 → consumed=1.0 ≥ 1 → BREAK.
    const ctx = makeCtx([makeShadow('111111', 10, 10)], 1);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let lines: string[];
    try {
      const result = await runGate(ctx);
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(result.action).toBe('BREAK');
    } finally {
      logSpy.mockRestore();
    }
    // BREAK 로그가 자본 가중(consumed.toFixed) + raw 카운트 동반 표기 (운영자 가시성).
    const breakLine = lines.find((l) => /max positions reached/.test(l));
    expect(breakLine).toBeDefined();
    expect(breakLine).toMatch(/1\.00 \+ reserved 0 = 1\.00\/1/); // consumed.toFixed(2)
    expect(breakLine).toMatch(/raw=1/); // slotResult.rawCount 동반
  });

  it('사용자 시나리오 — 만재 4 + 30% 잔존 4 (raw 8, consumed 5.2), max 6 → BREAK 안 함 (자본 가중)', async () => {
    // 단순 카운트(raw 8 ≥ 6) 로 회귀하면 잘못 BREAK 됨. 자본 가중 consumed 5.2 < 6 → 진행.
    const fullPositions = Array.from({ length: 4 }, (_, i) => makeShadow(`10000${i}`, 10, 10)); // consumed 1.0 each
    const residual = Array.from({ length: 4 }, (_, i) => makeShadow(`20000${i}`, 10, 3)); // consumed 0.3 each
    const ctx = makeCtx([...fullPositions, ...residual], 6);
    const result = await runGate(ctx);
    // consumed 5.2 < 6 → BREAK 아님 (CONTINUE 또는 후속 — 최소한 max-positions BREAK 미발생).
    expect(result.action).not.toBe('BREAK');
  });

  it('자본 가중 비활성(ENV) 시 단순 카운트 — raw 8 ≥ max 6 → BREAK (회귀 대조)', async () => {
    // SLOT_CAPITAL_WEIGHTED_DISABLED=true 시 consumed=1.0 강제 → 8.0 ≥ 6 → BREAK.
    process.env.SLOT_CAPITAL_WEIGHTED_DISABLED = 'true';
    const positions = Array.from({ length: 8 }, (_, i) => makeShadow(`30000${i}`, 10, 3));
    const ctx = makeCtx(positions, 6);
    const result = await runGate(ctx);
    expect(result.action).toBe('BREAK');
  });

  it('reservedSlots 가 totalCommitted 에 합산 — consumed 5 + reserved 1 = 6 ≥ max 6 → BREAK', async () => {
    // 자본 가중 합산에 mutables.reservedSlots.value 포함 (예약 슬롯 누락 차단).
    const positions = Array.from({ length: 5 }, (_, i) => makeShadow(`40000${i}`, 10, 10)); // consumed 5.0
    const ctx = makeCtx(positions, 6);
    ctx.mutables.reservedSlots.value = 1; // 5.0 + 1 = 6.0 ≥ 6 → BREAK.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let lines: string[];
    try {
      const result = await runGate(ctx);
      lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(result.action).toBe('BREAK');
    } finally {
      logSpy.mockRestore();
    }
    const breakLine = lines.find((l) => /max positions reached/.test(l));
    expect(breakLine).toMatch(/5\.00 \+ reserved 1 = 6\.00\/6/);
  });
});
