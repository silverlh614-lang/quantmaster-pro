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

// ── ADR-0608 Phase 2: entryRegime(learningRegime) 교정 + input.regime 무변경 ──
describe('ADR-0608/0624 Phase 2 — handleEntryRevalidationGate entryRegime 교정', () => {
  const ENV_KEY = 'GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED';
  const KILL_KEY = 'SHADOW_LIBERALIZATION_KILL';
  let savedEnv: string | undefined;
  let savedKill: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    savedKill = process.env[KILL_KEY];
    // ADR-0624 D1: default ON 이므로 OFF baseline 은 `='false'` 로 명시(미설정=ON 회피).
    process.env[ENV_KEY] = 'false';
    delete process.env[KILL_KEY];
    entryRevalidationStepMock.mockReturnValue({ proceed: true, entryThresholdMode: 'LEGACY' });
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
    if (savedKill === undefined) delete process.env[KILL_KEY];
    else process.env[KILL_KEY] = savedKill;
  });

  function makeR6ClampCtx(stock: WatchlistEntry): BuyListLoopContext {
    // R6 회복 누수 시나리오: live regime 은 R4_NEUTRAL 로 clamp, learningRegime 은 정규 R3_EARLY.
    const ctx = makeCtx([stock]) as unknown as { regime: string; learningRegime: string };
    ctx.regime = 'R4_NEUTRAL';
    ctx.learningRegime = 'R3_EARLY';
    return ctx as unknown as BuyListLoopContext;
  }

  it('ENV ON + SHADOW → entryRegime=learningRegime(R3_EARLY), regime=ctx.regime(R4_NEUTRAL) 무변경', async () => {
    process.env[ENV_KEY] = 'true';
    const stock = makeStock({ code: 'P2A' });
    const ctx = makeR6ClampCtx(stock);
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 4 } as never, undefined as never, 1_000, null, {}, vi.fn(), [], true,
    );
    const arg = entryRevalidationStepMock.mock.calls[0][0];
    expect(arg.entryRegime).toBe('R3_EARLY'); // 진입 임계는 learningRegime
    expect(arg.regime).toBe('R4_NEUTRAL');    // macroRegime/진단은 ctx.regime 무변경 (#6)
    expect(arg.isShadow).toBe(true);
  });

  it('ENV ON + LIVE → entryRegime=ctx.regime (byte-equivalent, learningRegime 무시)', async () => {
    process.env[ENV_KEY] = 'true';
    const stock = makeStock({ code: 'P2B' });
    const ctx = makeR6ClampCtx(stock);
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 4 } as never, undefined as never, 1_000, null, {}, vi.fn(), [], false,
    );
    const arg = entryRevalidationStepMock.mock.calls[0][0];
    expect(arg.entryRegime).toBe('R4_NEUTRAL'); // LIVE → ctx.regime
    expect(arg.regime).toBe('R4_NEUTRAL');
  });

  it('flag OFF(`=false`) + SHADOW → entryRegime=ctx.regime (byte-equivalent, learningRegime 무시)', async () => {
    process.env[ENV_KEY] = 'false';
    const stock = makeStock({ code: 'P2C' });
    const ctx = makeR6ClampCtx(stock);
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 4 } as never, undefined as never, 1_000, null, {}, vi.fn(), [], true,
    );
    const arg = entryRevalidationStepMock.mock.calls[0][0];
    expect(arg.entryRegime).toBe('R4_NEUTRAL'); // flag OFF → ctx.regime (clamp 그대로)
    expect(arg.regime).toBe('R4_NEUTRAL');
  });

  it('ADR-0624 미설정(default ON) + SHADOW → entryRegime=learningRegime(R3_EARLY) (운영자 미개입 교정)', async () => {
    delete process.env[ENV_KEY];
    const stock = makeStock({ code: 'P2C2' });
    const ctx = makeR6ClampCtx(stock);
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 4 } as never, undefined as never, 1_000, null, {}, vi.fn(), [], true,
    );
    const arg = entryRevalidationStepMock.mock.calls[0][0];
    expect(arg.entryRegime).toBe('R3_EARLY'); // default ON → learningRegime 교정 활성
    expect(arg.regime).toBe('R4_NEUTRAL');    // macroRegime/진단은 ctx.regime 무변경
  });

  it('kill-switch ON(미설정 default ON) + SHADOW → entryRegime=ctx.regime (byte-equivalent 롤백)', async () => {
    delete process.env[ENV_KEY];
    process.env[KILL_KEY] = 'true';
    const stock = makeStock({ code: 'P2C3' });
    const ctx = makeR6ClampCtx(stock);
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 4 } as never, undefined as never, 1_000, null, {}, vi.fn(), [], true,
    );
    const arg = entryRevalidationStepMock.mock.calls[0][0];
    expect(arg.entryRegime).toBe('R4_NEUTRAL'); // kill → ctx.regime (clamp 그대로)
    expect(arg.regime).toBe('R4_NEUTRAL');
  });

  it('ENV ON + SHADOW + learningRegime 부재 → entryRegime=ctx.regime fallback', async () => {
    process.env[ENV_KEY] = 'true';
    const stock = makeStock({ code: 'P2D' });
    const ctx = makeCtx([stock]); // learningRegime 미설정 → ctx.regime=R4_NEUTRAL
    await handleEntryRevalidationGate(
      ctx, stock, { gateScore: 4 } as never, undefined as never, 1_000, null, {}, vi.fn(), [], true,
    );
    const arg = entryRevalidationStepMock.mock.calls[0][0];
    expect(arg.entryRegime).toBe('R4_NEUTRAL'); // learningRegime ?? ctx.regime
    expect(arg.regime).toBe('R4_NEUTRAL');
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
