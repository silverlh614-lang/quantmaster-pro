// @responsibility ADR-0118 분기별 카운터 wiring 회귀 가드 (behavioral — step 함수 실호출로 scanCounters 단언)
//
// ADR-0134 분해로 분기별 카운터 증가가 perSymbol/steps/* 로 이동:
//   waitDataHold / waitDriftRemove / waitDriftCorpAction → checkEntryPriceDrift
//   waitGateFail / gateMisses / (waitReason==='DATA_HOLD'→waitDataHold) → handleEntryRevalidationGate
//   waitSizingBlocked → sizingTierDeciderFinal
//   waitPreBreakout → preBreakoutEntry (ENTRY_PRICE_DEVIATION 경로)
// 과거 정적 grep(readFileSync) 가드를 폐기하고 실제 함수 호출 후 카운터 증분을 단언한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from './perSymbol/types.js';
import { createScanCounters } from './scanDiagnostics/scanCounterFactory.js';

// 텔레그램·KIS-WS·shadow 영속 부수효과 차단 (단위 격리).
vi.mock('../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(async () => undefined),
}));
vi.mock('../../clients/kisWebSocketSubscriptionManager.js', () => ({
  requestKisWsSubscription: vi.fn(() => undefined),
}));

// entryRevalidationStep / sizingTierDecider 는 분기 결과를 결정적으로 제어하기 위해 mock.
const { entryRevalidationStepMock } = vi.hoisted(() => ({
  entryRevalidationStepMock: vi.fn(),
}));
vi.mock('./revalidationSteps/index.js', () => ({
  entryRevalidationStep: entryRevalidationStepMock,
}));
const { sizingTierDeciderMock } = vi.hoisted(() => ({
  sizingTierDeciderMock: vi.fn(),
}));
vi.mock('./sizingDeciders/index.js', () => ({
  sizingTierDecider: sizingTierDeciderMock,
}));

import { checkEntryPriceDrift } from './perSymbol/steps/entryPriceDrift.js';
import { handleEntryRevalidationGate } from './perSymbol/steps/entryRevalidationGate.js';
import { sizingTierDeciderFinal } from './perSymbol/steps/sizingTierDecider.js';

const ORIG_DAILYBAR = process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = 'true'; // corp-action 경로 결정적
});
afterEach(() => {
  if (ORIG_DAILYBAR === undefined) delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
  else process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = ORIG_DAILYBAR;
});

function makeStock(overrides: Partial<WatchlistEntry> & { code: string }): WatchlistEntry {
  return {
    name: overrides.code,
    entryPrice: 1_000,
    stopLoss: 900,
    targetPrice: 1_500,
    addedAt: '2026-01-01T00:00:00Z',
    addedBy: 'AUTO',
    ...overrides,
  } as WatchlistEntry;
}

function makeCtx(watchlist: WatchlistEntry[] = []): BuyListLoopContext {
  return {
    watchlist,
    shadows: [],
    regime: 'R4_NEUTRAL',
    macroState: null,
    resolvedMarketSessionState: 'OPEN',
    totalAssets: 100_000_000,
    banditDecision: {} as never,
    scanCounters: createScanCounters(),
    mutables: {
      watchlistMutated: { value: false },
      probingReservedSlots: { value: 0 },
      reservedSlots: { value: 0 },
    },
  } as unknown as BuyListLoopContext;
}

describe('ADR-0118 분기별 카운터 — checkEntryPriceDrift 경로', () => {
  it('waitDataHold++ (DATA_HOLD: drift > 250%)', async () => {
    const stock = makeStock({ code: 'AAA', entryPrice: 1_000 });
    const ctx = makeCtx([stock]);
    await checkEntryPriceDrift(ctx, stock, 4_000, {}, vi.fn());
    expect(ctx.scanCounters.waitDataHold).toBe(1);
  });

  it('waitDriftCorpAction++ (CORPORATE_ACTION: drift > 80%)', async () => {
    const stock = makeStock({ code: 'BBB', entryPrice: 12_610 });
    const ctx = makeCtx([stock]);
    await checkEntryPriceDrift(ctx, stock, 40_500, {}, vi.fn());
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(1);
  });

  it('waitDriftRemove++ (REMOVE: AUTO 항목 +15% drift)', async () => {
    const stock = makeStock({ code: 'CCC', entryPrice: 1_000, addedBy: 'AUTO' });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    await checkEntryPriceDrift(ctx, stock, 1_150, stageLog, vi.fn());
    expect(stageLog.drift).toBe('REMOVE');
    expect(ctx.scanCounters.waitDriftRemove).toBe(1);
  });
});

describe('ADR-0118 분기별 카운터 — handleEntryRevalidationGate 경로', () => {
  it('waitGateFail++ + gateMisses++ (proceed=false, 일반 게이트 미달)', async () => {
    entryRevalidationStepMock.mockReturnValue({
      proceed: false,
      stageLogValue: 'FAILED',
      logMessage: 'gate fail',
      failReasons: ['LOW_SCORE'],
      waitReason: undefined,
    });
    const stock = makeStock({ code: 'DDD' });
    const ctx = makeCtx([stock]);
    const result = await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 5 } as never, undefined as never, 1_000, null, {}, vi.fn(), [],
    );
    expect(result.decision).toBe('SKIP');
    expect(ctx.scanCounters.waitGateFail).toBe(1);
    expect(ctx.scanCounters.gateMisses).toBe(1);
    expect(ctx.scanCounters.waitDataHold).toBe(0);
  });

  it("waitDataHold 우선 (revalResult.waitReason === 'DATA_HOLD' → waitGateFail 대신 waitDataHold)", async () => {
    entryRevalidationStepMock.mockReturnValue({
      proceed: false,
      stageLogValue: 'DATA_HOLD',
      logMessage: 'data hold',
      failReasons: ['DATA_HOLD'],
      waitReason: 'DATA_HOLD',
    });
    const stock = makeStock({ code: 'EEE' });
    const ctx = makeCtx([stock]);
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 5 } as never, undefined as never, 1_000, null, {}, vi.fn(), [],
    );
    expect(ctx.scanCounters.waitDataHold).toBe(1);
    expect(ctx.scanCounters.waitGateFail).toBe(0);
    expect(ctx.scanCounters.gateMisses).toBe(1); // gateMisses 후방호환 보존
  });

  it('proceed=true → CONTINUE, 카운터 미증가', async () => {
    entryRevalidationStepMock.mockReturnValue({
      proceed: true,
      stageLogValue: 'PASS',
      logMessage: 'ok',
      failReasons: [],
    });
    const stock = makeStock({ code: 'FFF' });
    const ctx = makeCtx([stock]);
    const result = await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 9 } as never, undefined as never, 1_000, null, {}, vi.fn(), [],
    );
    expect(result.decision).toBe('CONTINUE');
    expect(ctx.scanCounters.waitGateFail).toBe(0);
    expect(ctx.scanCounters.gateMisses).toBe(0);
  });
});

describe('ADR-0118 분기별 카운터 — sizingTierDeciderFinal 경로', () => {
  it('waitSizingBlocked++ (sizingTierDecider ok=false → shouldSkip)', async () => {
    sizingTierDeciderMock.mockReturnValue({ ok: false, logMessage: 'tier BLOCKED' });
    const stock = makeStock({ code: 'GGG' });
    const ctx = makeCtx([stock]);
    const result = await sizingTierDeciderFinal(ctx, stock, 1_000, {} as never, {
      liveGateScore: 5, gateScore: 5, shadowEntryPrice: 1_000,
      currentActive: 0, isMomentumShadow: false, isStrongBuy: false,
    });
    expect(result.shouldSkip).toBe(true);
    expect(ctx.scanCounters.waitSizingBlocked).toBe(1);
  });
});
