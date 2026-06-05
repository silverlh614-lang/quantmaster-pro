// @responsibility ADR-0128 verifyStockIncremental + resolveDataHoldAction wiring 회귀 가드 (behavioral)
//
// ADR-0134 분해로 §Wiring 1A(verifyStockIncremental BUY_CANDIDATE 가드) 가 4개 step
// 모듈(preBreakoutFollowthrough / preBreakoutEntry / buyListLoop / intradayLoop)로 분산,
// §Wiring 2(DATA_HOLD → resolveDataHoldAction('BUY_CANDIDATE')) 는 checkEntryPriceDrift 로 이동.
// 과거 정적 grep(readFileSync) 가드를 폐기하고:
//   - §Wiring 2 → checkEntryPriceDrift 의 DATA_HOLD 분기를 실호출(blockBuy → isDataQuarantined).
//   - §Wiring 1A → 대표 site(preBreakoutFollowthrough) 의 verify 가드를 실호출
//     (blockBuy=true → SKIP / DATA_HOLD log; verify throw → 안전 통과 continue).
// "정확히 4 site / process.env 미접근" 같은 구조 정적 카운트 tautology 는 제거(사유: 보고 표).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from './perSymbol/types.js';
import { createScanCounters } from './scanDiagnostics/scanCounterFactory.js';

vi.mock('../../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(async () => undefined),
}));

// ── §Wiring 1A mock 구성: followthrough verify-site 까지 결정적으로 도달 ──
const { verifyStockIncrementalMock } = vi.hoisted(() => ({
  verifyStockIncrementalMock: vi.fn(),
}));
vi.mock('../../data/dataVerificationIncremental.js', () => ({
  verifyStockIncremental: verifyStockIncrementalMock,
}));
const { budgetMock } = vi.hoisted(() => ({ budgetMock: vi.fn() }));
vi.mock('./perSymbol/steps/preBreakoutFollowthroughBudget.js', () => ({
  preBreakoutFollowthroughBudget: budgetMock,
}));
// 매매 본체(주문 build/queue) 차단 — verify 가드 전후 흐름만 검증.
vi.mock('../buyPipeline.js', () => ({
  buildBuyTrade: vi.fn(() => ({ stockCode: 'STUB' })),
  createBuyTask: vi.fn(async () => ({ stockCode: 'STUB' })),
  fetchGateData: vi.fn(),
}));
vi.mock('../../learning/recommendationTracker.js', () => ({ addRecommendation: vi.fn() }));
vi.mock('../../persistence/tradeSignalStatusRepo.js', () => ({
  recordAiCandidate: vi.fn(),
  buildSignalId: vi.fn(() => 'sig-stub'),
}));
vi.mock('../../persistence/blacklistRepo.js', () => ({ isBlacklisted: vi.fn(() => false) }));

import { checkEntryPriceDrift } from './perSymbol/steps/entryPriceDrift.js';
import { preBreakoutFollowthrough } from './perSymbol/steps/preBreakoutFollowthrough.js';

const ORIG_DAILYBAR = process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
const ORIG_ROLE = process.env.DATA_HOLD_ROLE_POLICY_DISABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATA_HOLD_ROLE_POLICY_DISABLED;
  process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = 'true';
});
afterEach(() => {
  if (ORIG_DAILYBAR === undefined) delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
  else process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = ORIG_DAILYBAR;
  if (ORIG_ROLE === undefined) delete process.env.DATA_HOLD_ROLE_POLICY_DISABLED;
  else process.env.DATA_HOLD_ROLE_POLICY_DISABLED = ORIG_ROLE;
});

function makeStock(overrides: Partial<WatchlistEntry> & { code: string }): WatchlistEntry {
  return {
    name: overrides.code,
    entryPrice: 1_000,
    stopLoss: 900,
    targetPrice: 1_500,
    addedAt: '2026-01-01T00:00:00Z',
    addedBy: 'AUTO',
    profileType: 'B',
    ...overrides,
  } as WatchlistEntry;
}

// ─────────────────────────────────────────────────────────────────────────────
// §Wiring 2 — DATA_HOLD 분기 resolveDataHoldAction('BUY_CANDIDATE') 위임 (behavioral)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADR-0128 §Wiring 2 — checkEntryPriceDrift DATA_HOLD → resolveDataHoldAction(BUY_CANDIDATE)', () => {
  function makeDriftCtx(watchlist: WatchlistEntry[]): BuyListLoopContext {
    return {
      watchlist,
      scanCounters: createScanCounters(),
      mutables: { watchlistMutated: { value: false } },
    } as unknown as BuyListLoopContext;
  }

  it("DATA_HOLD(drift>250%) → blockBuy=true 경로: isDataQuarantined + dataQuality 영속 + SKIP", async () => {
    const stock = makeStock({ code: '111111', entryPrice: 1_000 });
    const ctx = makeDriftCtx([stock]);
    const result = await checkEntryPriceDrift(ctx, stock, 4_000, {}, vi.fn());

    expect(result).toBe('SKIP');
    expect(stock.isDataQuarantined).toBe(true);
    expect(stock.dataQuality?.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(ctx.scanCounters.waitDataHold).toBe(1);
  });

  it('action.reason SSOT 정합 — WAIT / DATA_HOLD / 매수 후보 자동 탈락 (당일)', async () => {
    const stock = makeStock({ code: '222222', entryPrice: 1_000 });
    const ctx = makeDriftCtx([stock]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let lines: string[] = [];
    try {
      await checkEntryPriceDrift(ctx, stock, 4_000, {}, vi.fn());
      lines = logSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      logSpy.mockRestore();
    }
    expect(lines.some((l) => /WAIT \/ DATA_HOLD \/ 매수 후보 자동 탈락 \(당일\)/.test(l))).toBe(true);
  });

  it('DATA_HOLD_ROLE_POLICY_DISABLED=true → 안전 default(blockBuy=true) 동일 격리', async () => {
    process.env.DATA_HOLD_ROLE_POLICY_DISABLED = 'true';
    const stock = makeStock({ code: '333333', entryPrice: 1_000 });
    const ctx = makeDriftCtx([stock]);
    await checkEntryPriceDrift(ctx, stock, 4_000, {}, vi.fn());
    // ENV 우회시에도 blockBuy=true 유지 → 격리 보존(매수 차단).
    expect(stock.isDataQuarantined).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §Wiring 1A — verifyStockIncremental('BUY_CANDIDATE') 가드 (대표 site: followthrough)
// ─────────────────────────────────────────────────────────────────────────────
describe('ADR-0128 §Wiring 1A — verify 가드 (preBreakoutFollowthrough 실호출)', () => {
  function makeFollowCtx(stock: WatchlistEntry): BuyListLoopContext {
    return {
      shadows: [
        { stockCode: stock.code, watchlistSource: 'PRE_BREAKOUT', status: 'ACTIVE', shadowEntryPrice: 950, signalTime: '2026-01-01T00:00:00Z' },
      ],
      regime: 'R4_NEUTRAL',
      macroState: null,
      shadowMode: true,
      supplyHealthSnapshot: undefined,
      scanCounters: createScanCounters(),
      mutables: {
        watchlistMutated: { value: false },
        liveBuyQueue: [],
        reservedSlots: { value: 0 },
        reservedTiers: [],
        reservedSectorValues: [],
        pendingSectorValue: new Map(),
        orderableCash: { value: 100_000_000 },
      },
    } as unknown as BuyListLoopContext;
  }

  function makeBudget(stock: WatchlistEntry) {
    return {
      followEntryPrice: stock.entryPrice,
      gateScoreFollow: 8,
      reCheckGateFollow: { mtas: 7, compressionScore: 1, availableMaxScore: 10, gateLayerSummary: {} },
      reCheckQuoteFollow: { atr: 50 },
      posPctFollow: 0.1,
      fullQty: 10,
      followQty: 7,
      sizingSourceFollow: 'LEGACY',
      sizingEngineSnapshotFollow: undefined,
    };
  }

  function makeInput(stock: WatchlistEntry, ctx: BuyListLoopContext, overrides: Record<string, unknown> = {}) {
    return {
      ctx,
      stock,
      currentPrice: stock.entryPrice, // >= entryPrice → 추종 매수 진입 조건 충족
      today: '2026-01-01',
      stockShadowMode: true,
      macroDiagnosticLiveBlock: false,
      shadowApprovalCtx: { tradeDate: '2026-01-01', marketSession: 'REGULAR' as const },
      applyBuySupplyHealthPolicy: () => ({
        blocked: false, shadowMode: true, finalQuantity: 7, finalSignal: 'STRONG_BUY' as const, healthDecision: {},
      }),
      suppressDiagnosticLiveBuyTask: vi.fn(),
      ...overrides,
    };
  }

  it('verified=false + action.blockBuy=true → SKIP + DATA_HOLD 로그 (매수 차단)', async () => {
    verifyStockIncrementalMock.mockResolvedValue({
      verified: false,
      action: { blockBuy: true },
      reason: 'KIS mismatch',
      source: 'KIS_DAILY',
    });
    const stock = makeStock({ code: '444444', entryPrice: 1_000 });
    const ctx = makeFollowCtx(stock);
    budgetMock.mockResolvedValue(makeBudget(stock));
    const suppress = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    let lines: string[] = [];
    let result: string;
    try {
      result = await preBreakoutFollowthrough(makeInput(stock, ctx, { suppressDiagnosticLiveBuyTask: suppress }) as never);
      lines = logSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      logSpy.mockRestore();
    }

    expect(result).toBe('SKIP');
    expect(verifyStockIncrementalMock).toHaveBeenCalledWith('444444', 'BUY_CANDIDATE');
    expect(lines.some((l) => /→ DATA_HOLD \/ KIS mismatch \/ KIS_DAILY/.test(l))).toBe(true);
    // 차단 — 주문 큐 미적재 + suppress 미호출(verify 단계에서 즉시 SKIP).
    expect(ctx.mutables.liveBuyQueue.length).toBe(0);
    expect(suppress).not.toHaveBeenCalled();
  });

  it('verify throw → 안전 통과(console.warn) + 매매 흐름 계속 (verify 단계 차단 안 함)', async () => {
    verifyStockIncrementalMock.mockRejectedValue(new Error('KIS down'));
    const stock = makeStock({ code: '555555', entryPrice: 1_000 });
    const ctx = makeFollowCtx(stock);
    budgetMock.mockResolvedValue(makeBudget(stock));
    const suppress = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let warns: string[] = [];
    let result: string;
    try {
      // diagnosticLiveBlockReason 설정 → verify 통과 후 suppress 분기에서 SKIP (createBuyTask 도달 전 종료).
      result = await preBreakoutFollowthrough(
        makeInput(stock, ctx, {
          suppressDiagnosticLiveBuyTask: suppress,
          diagnosticLiveBlockReason: 'LIVE_BLOCKED_DIAG',
        }) as never,
      );
      warns = warnSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      warnSpy.mockRestore();
    }

    expect(result).toBe('SKIP');
    // 안전 통과 — verify error 가 흐름 차단 안 함 → suppress 분기까지 진행.
    expect(warns.some((l) => /verifyStockIncremental error \(안전 통과\)/.test(l))).toBe(true);
    expect(suppress).toHaveBeenCalledTimes(1);
  });

  it("verify 호출 role 은 'BUY_CANDIDATE' (HELD_POSITION 등 다른 role 미사용)", async () => {
    verifyStockIncrementalMock.mockResolvedValue({ verified: true, reason: 'ok', source: 'KIS_DAILY' });
    const stock = makeStock({ code: '666666', entryPrice: 1_000 });
    const ctx = makeFollowCtx(stock);
    budgetMock.mockResolvedValue(makeBudget(stock));
    // diagnostic block → createBuyTask 도달 전 SKIP, verify role 호출만 단언.
    await preBreakoutFollowthrough(makeInput(stock, ctx, { diagnosticLiveBlockReason: 'X' }) as never);

    expect(verifyStockIncrementalMock).toHaveBeenCalledWith('666666', 'BUY_CANDIDATE');
    for (const call of verifyStockIncrementalMock.mock.calls) {
      expect(call[1]).toBe('BUY_CANDIDATE');
    }
  });
});
