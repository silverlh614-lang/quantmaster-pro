/**
 * @responsibility ADR-0516 — buyList loop + candidateSelect Watchlist Tier 정책 wiring 회귀 가드
 *
 * §buyListLoop wiring 은 ADR-0019 분해로 perSymbol/steps/loopInitializer.ts 의
 * loopInitializer() 로 이동. 과거 정적 grep(readFileSync(buyListLoop.ts)) 을 폐기하고
 * loopInitializer() 를 실호출해 MOMENTUM_PASSIVE no-price → SKIP_TIER_PASSIVE_NO_REST
 * (FAIL / DATA_VACUUM / providerIssue / NEW_BUY_BLOCKED 으로 격상 안 됨) 동작을 단언한다.
 * candidateSelect / helpers / warmupJob 블록은 해당 파일이 미이동이라 정적 grep 유지.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ── loopInitializer 의 getPrice → kis client 체인 mock (no WS price / REST 차단 검증) ──
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

import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from './types.js';
import { createScanCounters } from '../scanDiagnostics/scanCounterFactory.js';
import { loopInitializer } from './steps/loopInitializer.js';

const CANDIDATE_SELECT = fs.readFileSync(
  path.resolve(__dirname, '..', 'candidateSelect.ts'),
  'utf-8',
);
const HELPERS = fs.readFileSync(
  path.resolve(__dirname, 'helpers.ts'),
  'utf-8',
);
const WARMUP_JOB = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'scheduler', 'investorFlowWarmupJob.ts'),
  'utf-8',
);

const ORIG_LOAD_STATE = process.env.KIS_LOAD_STATE;
const ORIG_TIER_DEBUG = process.env.WATCHLIST_KIS_TIER_DEBUG;

beforeEach(() => {
  fetchCurrentPrice.mockReset();
  getRealtimePrice.mockReset();
  subscribeStock.mockReset();
  requestKisWsSubscription.mockReset();
  isKisWsSubscriptionPriorityDisabled.mockReset();
  // 기본: WS 우선순위 큐 활성, 실시간 가격 맵 미보유 → getPrice 는 tier 정책에 따라 REST 차단/null.
  isKisWsSubscriptionPriorityDisabled.mockReturnValue(false);
  getRealtimePrice.mockReturnValue(null);
  fetchCurrentPrice.mockResolvedValue(70_000);
});

afterEach(() => {
  if (ORIG_LOAD_STATE === undefined) delete process.env.KIS_LOAD_STATE;
  else process.env.KIS_LOAD_STATE = ORIG_LOAD_STATE;
  if (ORIG_TIER_DEBUG === undefined) delete process.env.WATCHLIST_KIS_TIER_DEBUG;
  else process.env.WATCHLIST_KIS_TIER_DEBUG = ORIG_TIER_DEBUG;
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

/** loopInitializer 가 참조하는 필드만 채운 최소 BuyListLoopContext stub. */
function makeCtx(
  stock: WatchlistEntry,
  overrides?: Partial<BuyListLoopContext>,
): BuyListLoopContext {
  return {
    shadows: [],
    effectiveMaxPositions: 10,
    regime: 'R3_NORMAL',
    scanCounters: createScanCounters(),
    mutables: { reservedSlots: { value: 0 } },
    ...overrides,
  } as unknown as BuyListLoopContext;
}

/** MOMENTUM 섹션 + momentumRank 부재 → MOMENTUM_PASSIVE (allowRestPrice=false). */
function runMomentumPassive(stock: WatchlistEntry, ctx: BuyListLoopContext) {
  return loopInitializer({
    ctx,
    stock,
    isMomentumShadow: false,
    initialStockShadowMode: false,
    diagnosticLiveBlockLogged: false,
  });
}

describe('ADR-0516 §buyList loop wiring — loopInitializer behavioral', () => {
  it('MOMENTUM_PASSIVE no-price → SKIP + getPrice REST 차단(fetchCurrentPrice 미호출)', async () => {
    // MOMENTUM 섹션 + rank 부재 → resolveWatchlistKisPolicy = MOMENTUM_PASSIVE → allowRestFallback=false.
    const stock = makeStock({ code: '900001', section: 'MOMENTUM' });
    const result = await runMomentumPassive(stock, makeCtx(stock));

    expect(result.action).toBe('SKIP');
    // tier 정책이 allowRestFallback=false 를 getPrice 로 전달 → REST(fetchCurrentPrice) 미호출.
    expect(fetchCurrentPrice).not.toHaveBeenCalled();
  });

  it('SKIP_TIER_PASSIVE_NO_REST 마킹 (stageLog.price) — FAIL 아님', async () => {
    const stock = makeStock({ code: '900002', section: 'MOMENTUM' });
    const ctx = makeCtx(stock);
    let captured: Record<string, string> = {};
    // pushTrace 가 stageLog 사본을 trace 로 밀어넣음 — pendingTraces 에서 회수.
    await runMomentumPassive(stock, ctx);
    const trace = ctx.scanCounters.pendingTraces.find((t) => t.stock === '900002');
    captured = (trace?.stages as Record<string, string>) ?? {};
    expect(captured.price).toBe('SKIP_TIER_PASSIVE_NO_REST');
    // FAIL 이 아님을 명시 — DATA_VACUUM 등 격상 어휘 부재.
    expect(captured.price).not.toBe('FAIL');
  });

  it('tier 차단 카운터 waitTierRestSuppressed 누적 (분기별 진단)', async () => {
    const stock = makeStock({ code: '900003', section: 'MOMENTUM' });
    const ctx = makeCtx(stock);
    await runMomentumPassive(stock, ctx);
    expect(ctx.scanCounters.waitTierRestSuppressed).toBe(1);
  });

  it('SKIP 은 providerIssue/marketSignal/DATA_VACUUM 격상 없이 이번 사이클만 스킵', async () => {
    // 격상 어휘가 stageLog / 카운터에 부수효과로 남지 않음을 확인 (Shadow learning 차단 아님).
    const stock = makeStock({ code: '900004', section: 'MOMENTUM' });
    const ctx = makeCtx(stock);
    const result = await runMomentumPassive(stock, ctx);

    expect(result.action).toBe('SKIP');
    const trace = ctx.scanCounters.pendingTraces.find((t) => t.stock === '900004');
    const stages = (trace?.stages as Record<string, string>) ?? {};
    // stageLog 에는 price=SKIP_TIER_PASSIVE_NO_REST 만 — 격상 마커 부재.
    expect(Object.values(stages)).not.toContain('DATA_VACUUM');
    expect(stages.providerIssue).toBeUndefined();
    expect(stages.marketSignal).toBeUndefined();
  });

  /**
   * console.debug 캡처 — vi.spyOn(console,'debug') 는 본 import 체인에서 호출을 누락하므로
   * (vitest console intercept 와 상호작용) 직접 메서드 교체로 결정적으로 회수한다.
   */
  async function captureDebug(stock: WatchlistEntry, ctx: BuyListLoopContext): Promise<string[]> {
    const out: string[] = [];
    const orig = console.debug;
    console.debug = (...args: unknown[]) => { out.push(args.map(String).join(' ')); };
    try {
      await runMomentumPassive(stock, ctx);
    } finally {
      console.debug = orig;
    }
    return out;
  }

  it('compact DEBUG 로그 — WATCHLIST_KIS_TIER + executionImpact=NONE + marketSignal=false (ENV 게이팅)', async () => {
    process.env.WATCHLIST_KIS_TIER_DEBUG = 'true';
    const stock = makeStock({ code: '900005', section: 'MOMENTUM' });
    const lines = await captureDebug(stock, makeCtx(stock));
    const tierLine = lines.find((l) => /\[WATCHLIST_KIS_TIER\]/.test(l));
    expect(tierLine).toBeDefined();
    expect(tierLine).toContain('executionImpact=NONE');
    expect(tierLine).toContain('marketSignal=false');
  });

  it('WATCHLIST_KIS_TIER_DEBUG 미설정 시 [WATCHLIST_KIS_TIER] DEBUG 로그 없음 (minimal logging)', async () => {
    delete process.env.WATCHLIST_KIS_TIER_DEBUG;
    const stock = makeStock({ code: '900006', section: 'MOMENTUM' });
    const lines = await captureDebug(stock, makeCtx(stock));
    expect(lines.filter((l) => /\[WATCHLIST_KIS_TIER\]/.test(l))).toHaveLength(0);
  });

  it('보유 종목(isOpenPosition) → OPEN_POSITION tier → REST 허용 (PASSIVE 격상 아님, P0 보호)', async () => {
    // 동일 MOMENTUM 종목이라도 shadows 에 OPEN 포지션이면 isHeldPosition=true → OPEN_POSITION,
    // allowRestPrice=true → getPrice 가 REST(fetchCurrentPrice) 호출 → 가격 PASS.
    const stock = makeStock({ code: '900007', section: 'MOMENTUM' });
    const ctx = makeCtx(stock, {
      shadows: [
        { stockCode: '900007', status: 'ACTIVE' } as unknown as BuyListLoopContext['shadows'][number],
      ],
    });
    const result = await runMomentumPassive(stock, ctx);
    expect(fetchCurrentPrice).toHaveBeenCalledWith('900007');
    // 가격 확보 → SKIP_TIER 아님 (CONTINUE 또는 후속 진행).
    expect(result.action).toBe('CONTINUE');
    expect(ctx.scanCounters.waitTierRestSuppressed).toBe(0);
  });

  it('force buy (isForceBuy) → ENTRY_CANDIDATE tier → REST 허용 (무성 실패 차단, P0 보호)', async () => {
    const stock = makeStock({ code: '900008', section: 'MOMENTUM' });
    (stock as { isForceBuy?: boolean }).isForceBuy = true;
    const ctx = makeCtx(stock);
    const result = await runMomentumPassive(stock, ctx);
    expect(fetchCurrentPrice).toHaveBeenCalledWith('900008');
    expect(result.action).toBe('CONTINUE');
    expect(ctx.scanCounters.waitTierRestSuppressed).toBe(0);
  });
});

describe('ADR-0516 §candidateSelect wiring 정적 가드', () => {
  it('assignMomentumRanks import (watchlistKisTierPolicy SSOT)', () => {
    expect(CANDIDATE_SELECT).toMatch(
      /import \{ assignMomentumRanks \} from ['"]\.\.\/watchlistKisTierPolicy\.js['"]/,
    );
  });

  it('momentumList 에 assignMomentumRanks 호출', () => {
    expect(CANDIDATE_SELECT).toMatch(/assignMomentumRanks\(momentumList\)/);
  });

  it('isForceBuy runtime 플래그 부여 (영속 schema 변경 아님 — cast 사용)', () => {
    expect(CANDIDATE_SELECT).toMatch(
      /\(w as \{ isForceBuy\?: boolean \}\)\.isForceBuy = forceCodes\.has\(w\.code\)/,
    );
  });

  it('watchlistRepo 영속 schema 변경 없음 — momentumRank/isForceBuy 는 runtime-only cast', () => {
    // candidateSelect 는 WatchlistEntry 에 momentumRank/isForceBuy 를 직접 선언하지 않는다.
    expect(CANDIDATE_SELECT).not.toMatch(/interface WatchlistEntry/);
  });

  it('ADR-0516 추적 주석', () => {
    expect(CANDIDATE_SELECT).toMatch(/ADR-0516/);
  });
});

describe('ADR-0516 §helpers.getPrice 정적 가드', () => {
  it('GetPriceSubscriptionContext 에 allowRestFallback 옵셔널 필드 추가', () => {
    expect(HELPERS).toMatch(/allowRestFallback\?: boolean/);
    expect(HELPERS).toMatch(/restTtlMs\?: number/);
    expect(HELPERS).toMatch(/pricePurpose\?:/);
  });

  it('allowRestFallback === false 일 때만 REST 차단 (후방호환 — undefined 는 기존 동작)', () => {
    expect(HELPERS).toMatch(/ctx\?\.allowRestFallback === false/);
  });

  it('REST 차단 분기에서 fetchCurrentPrice 미호출 + null 반환', () => {
    const block = HELPERS.match(
      /if \(ctx\?\.allowRestFallback === false\) \{[\s\S]+?return null;\s*\}/,
    );
    expect(block).not.toBeNull();
    expect(block?.[0]).not.toMatch(/fetchCurrentPrice/);
  });

  it('requestKisWsSubscription (ADR-0437 priority queue) 은 REST 차단보다 먼저 — 무변경', () => {
    const wsIdx = HELPERS.indexOf('requestKisWsSubscription({');
    const restBlockIdx = HELPERS.indexOf('ctx?.allowRestFallback === false');
    expect(wsIdx).toBeGreaterThan(0);
    expect(restBlockIdx).toBeGreaterThan(wsIdx);
  });

  it('ADR-0516 추적 주석', () => {
    expect(HELPERS).toMatch(/ADR-0516/);
  });
});

describe('ADR-0516 §investorFlowWarmupJob tier-aware 선정 정적 가드', () => {
  it('watchlistKisTierPolicy SSOT import (assignMomentumRanks + resolveWatchlistKisPolicy)', () => {
    expect(WARMUP_JOB).toMatch(
      /import \{ assignMomentumRanks, resolveWatchlistKisPolicy \} from ['"]\.\.\/trading\/watchlistKisTierPolicy\.js['"]/,
    );
  });

  it('MOMENTUM_PASSIVE 는 후순위 (passive bucket — lower-priority)', () => {
    expect(WARMUP_JOB).toMatch(/MOMENTUM_PASSIVE/);
    // active / passive 2-bucket 분리 후 [...active, ...passive] concat.
    expect(WARMUP_JOB).toMatch(/\[\.\.\.active, \.\.\.passive\]/);
  });

  it('section 분류 — computeFocusCodes + assignSection 직접 호출 (자체 watchlist 사본)', () => {
    expect(WARMUP_JOB).toMatch(/computeFocusCodes\(watchlist\)/);
    expect(WARMUP_JOB).toMatch(/assignSection\(w, focusCodes\)/);
  });

  it('selectWarmupCodes 가 resolveWatchlistKisPolicy 로 tier 도출', () => {
    expect(WARMUP_JOB).toMatch(/resolveWatchlistKisPolicy\(\{/);
  });

  it('ADR-0516 추적 주석', () => {
    expect(WARMUP_JOB).toMatch(/ADR-0516/);
  });
});
