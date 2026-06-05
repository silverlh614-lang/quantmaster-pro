// @responsibility ADR-0117 DATA_HOLD 분기 동작 회귀 가드 (behavioral — checkEntryPriceDrift 실호출)
//
// ADR-0134 분해로 DATA_HOLD wiring 이 perSymbol/steps/entryPriceDrift.ts 의
// checkEntryPriceDrift() 로 이동. 과거 정적 grep(readFileSync) 가드를 폐기하고,
// 실제 함수를 호출해 DATA_HOLD 입력(drift > 250%) 의 결과 상태/카운터/로그를 단언한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from './perSymbol/types.js';
import { createScanCounters } from './scanDiagnostics/scanCounterFactory.js';
import { checkEntryPriceDrift } from './perSymbol/steps/entryPriceDrift.js';

const ORIGINAL_ROLE_POLICY = process.env.DATA_HOLD_ROLE_POLICY_DISABLED;

beforeEach(() => {
  delete process.env.DATA_HOLD_ROLE_POLICY_DISABLED; // default → BUY_CANDIDATE blockBuy=true
});
afterEach(() => {
  if (ORIGINAL_ROLE_POLICY === undefined) delete process.env.DATA_HOLD_ROLE_POLICY_DISABLED;
  else process.env.DATA_HOLD_ROLE_POLICY_DISABLED = ORIGINAL_ROLE_POLICY;
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

/** 최소 BuyListLoopContext stub — checkEntryPriceDrift 가 참조하는 필드만 채움. */
function makeCtx(watchlist: WatchlistEntry[]): BuyListLoopContext {
  return {
    watchlist,
    scanCounters: createScanCounters(),
    mutables: { watchlistMutated: { value: false } },
  } as unknown as BuyListLoopContext;
}

// entryPrice=1,000 → currentPrice=4,000 (+300% > 250% ABSOLUTE_DEAD_ZONE) → applyEntryPriceDrift='DATA_HOLD'.
const DATA_HOLD_ENTRY = 1_000;
const DATA_HOLD_CURRENT = 4_000;

describe('ADR-0117 DATA_HOLD 분기 — checkEntryPriceDrift behavioral', () => {
  it('DATA_HOLD 입력(drift > 250%) → SKIP 반환 + stageLog.drift = DATA_HOLD', async () => {
    const stock = makeStock({ code: '098460', entryPrice: DATA_HOLD_ENTRY });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();

    const result = await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, stageLog, trace);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('DATA_HOLD');
    expect(trace).toHaveBeenCalledTimes(1);
  });

  it('isDataQuarantined = true 마커 부착 (blockBuy=true)', async () => {
    const stock = makeStock({ code: '098461', entryPrice: DATA_HOLD_ENTRY });
    const ctx = makeCtx([stock]);

    await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, {}, vi.fn());

    expect(stock.isDataQuarantined).toBe(true);
  });

  it('dataQuality 영속 — status = STALE_BASE_OR_SPLIT_ADJUSTMENT', async () => {
    const stock = makeStock({ code: '098462', entryPrice: DATA_HOLD_ENTRY });
    const ctx = makeCtx([stock]);

    await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, {}, vi.fn());

    expect(stock.dataQuality).toBeDefined();
    expect(stock.dataQuality?.status).toBe('STALE_BASE_OR_SPLIT_ADJUSTMENT');
    expect(stock.dataQuality?.base).toBe(DATA_HOLD_ENTRY);
    expect(stock.dataQuality?.current).toBe(DATA_HOLD_CURRENT);
  });

  it('WAIT / DATA_HOLD 메시지 출력 (resolveDataHoldAction SSOT reason)', async () => {
    const stock = makeStock({ code: '098463', entryPrice: DATA_HOLD_ENTRY });
    const ctx = makeCtx([stock]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    let lines: string[];
    try {
      await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, {}, vi.fn());
      lines = logSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      logSpy.mockRestore();
    }

    // resolveDataHoldAction('BUY_CANDIDATE').reason === '매수 후보 자동 탈락 (당일)' SSOT 위임.
    expect(lines.some((l) => /WAIT \/ DATA_HOLD \/ 매수 후보 자동 탈락 \(당일\)/.test(l))).toBe(true);
  });

  it('failCount 미증가 — DATA_HOLD 분기는 stock.entryFailCount 건드리지 않음', async () => {
    const stock = makeStock({ code: '098464', entryPrice: DATA_HOLD_ENTRY, entryFailCount: 2 });
    const ctx = makeCtx([stock]);

    await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, {}, vi.fn());

    // 격리 마커만 부여, 실패 누적 없음 (Non-critical 보존).
    expect(stock.entryFailCount).toBe(2);
  });

  it('waitDataHold++ 카운터 증가 (분기별 진단 카운터)', async () => {
    const stock = makeStock({ code: '098465', entryPrice: DATA_HOLD_ENTRY });
    const ctx = makeCtx([stock]);

    await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, {}, vi.fn());

    expect(ctx.scanCounters.waitDataHold).toBe(1);
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(0);
  });

  it('drift update skipped 진단 로그 (console.warn) 출력', async () => {
    const stock = makeStock({ code: '098466', entryPrice: DATA_HOLD_ENTRY });
    const ctx = makeCtx([stock]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let lines: string[];
    try {
      await checkEntryPriceDrift(ctx, stock, DATA_HOLD_CURRENT, {}, vi.fn());
      lines = warnSpy.mock.calls.map((c) => String(c[0]));
    } finally {
      warnSpy.mockRestore();
    }

    expect(lines.some((l) => /drift update skipped/.test(l))).toBe(true);
  });
});
