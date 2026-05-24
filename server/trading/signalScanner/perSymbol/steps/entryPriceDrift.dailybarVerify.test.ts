// @responsibility ADR-0518 entryPriceDrift 일봉 연속성 검증 wiring 통합 테스트
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from '../types.js';
import { createScanCounters } from '../../scanDiagnostics/scanCounterFactory.js';

// 텔레그램 전송 spy — GENUINE_RALLY 강등 시 호출 0회 확인용.
// vi.hoisted 로 선언해 vi.mock factory(hoist) 안에서 안전하게 참조.
const { sendTelegramAlert } = vi.hoisted(() => ({
  sendTelegramAlert: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('../../../../alerts/telegramClient.js', () => ({
  sendTelegramAlert,
}));

import { checkEntryPriceDrift } from './entryPriceDrift.js';

const ORIGINAL_AUTO_CORRECT = process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED;
const ORIGINAL_DAILYBAR_DISABLED = process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;

beforeEach(() => {
  sendTelegramAlert.mockClear();
  delete process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED; // default → IMMUTABLE_REMOVE 경로
  delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_AUTO_CORRECT === undefined) delete process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED;
  else process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED = ORIGINAL_AUTO_CORRECT;
  if (ORIGINAL_DAILYBAR_DISABLED === undefined) delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
  else process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = ORIGINAL_DAILYBAR_DISABLED;
});

// addedAt 을 충분히 과거로 고정 → 아래 candle 날짜(이후)가 sinceDate 필터를 통과.
const ADDED_AT = '2026-01-01T00:00:00Z';

function makeStock(overrides: Partial<WatchlistEntry> & { code: string }): WatchlistEntry {
  return {
    name: overrides.code,
    entryPrice: 4_745,
    stopLoss: 4_000,
    targetPrice: 6_000,
    addedAt: ADDED_AT,
    addedBy: 'AUTO',
    ...overrides,
  };
}

/** 최소 BuyListLoopContext stub — checkEntryPriceDrift 가 참조하는 필드만 채움. */
function makeCtx(watchlist: WatchlistEntry[]): BuyListLoopContext {
  return {
    watchlist,
    scanCounters: createScanCounters(),
    mutables: { watchlistMutated: { value: false } },
  } as unknown as BuyListLoopContext;
}

describe('ADR-0518 — checkEntryPriceDrift 일봉 검증 wiring', () => {
  it('GENUINE_RALLY: 갭 없는 다일 랠리 → 조용히 universe drop, 텔레그램 미전송', async () => {
    const stock = makeStock({ code: '147760', entryPrice: 4_745 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();

    // 4745 → 9470 (drift +99.6% > 80% → CORPORATE_ACTION 의심), 단일일 갭 없음(+5%/일).
    const fetchCandles = vi.fn(async () => {
      const out: { date: string; close: number }[] = [];
      let close = 4_745;
      let dateNum = 20260401;
      for (let i = 0; i < 16; i++) {
        out.push({ date: String(dateNum), close: Math.round(close) });
        close *= 1.05;
        dateNum += 1;
      }
      return out;
    });

    const result = await checkEntryPriceDrift(ctx, stock, 9_470, stageLog, trace, fetchCandles);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('GENUINE_RALLY_DROP');
    expect(ctx.watchlist.find(w => w.code === '147760')).toBeUndefined(); // splice 제거
    expect(ctx.mutables.watchlistMutated.value).toBe(true);
    expect(ctx.scanCounters.waitDriftRemove).toBe(1);
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(0);
    expect(sendTelegramAlert).not.toHaveBeenCalled(); // corp-action 텔레그램 없음
    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(trace).toHaveBeenCalledTimes(1);
  });

  it('CONFIRMED: 단일일 +100% 갭 → 기존 IMMUTABLE_REMOVE 경로 + 텔레그램 전송', async () => {
    const stock = makeStock({ code: '009999', entryPrice: 5_000 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();

    // 단일일 +100% 갭 → CONFIRMED → 기존 corporate action 동작 유지.
    const fetchCandles = vi.fn(async () => [
      { date: '20260401', close: 5_000 },
      { date: '20260402', close: 5_100 },
      { date: '20260403', close: 10_200 }, // +100%
      { date: '20260404', close: 10_300 },
    ]);

    const result = await checkEntryPriceDrift(ctx, stock, 10_300, stageLog, trace, fetchCandles);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('CORPORATE_ACTION_REMOVE');
    expect(ctx.watchlist.find(w => w.code === '009999')).toBeUndefined();
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(1);
    expect(ctx.scanCounters.waitDriftRemove).toBe(0);
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1); // 기존 HIGH 텔레그램 유지
  });

  it('UNVERIFIABLE(일봉 미가용): 빈 배열 → 기존 보수적 제외 + 텔레그램 (무회귀)', async () => {
    const stock = makeStock({ code: '008888', entryPrice: 5_000 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();
    const fetchCandles = vi.fn(async () => []); // KIS 미가용

    const result = await checkEntryPriceDrift(ctx, stock, 10_000, stageLog, trace, fetchCandles);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('CORPORATE_ACTION_REMOVE'); // 보수적 — 제외 유지
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(1);
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
  });

  it('일봉 조회 throw → .catch fallback → UNVERIFIABLE 보수적 동작', async () => {
    const stock = makeStock({ code: '007777', entryPrice: 5_000 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();
    const fetchCandles = vi.fn(async () => { throw new Error('KIS down'); });

    const result = await checkEntryPriceDrift(ctx, stock, 10_000, stageLog, trace, fetchCandles);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('CORPORATE_ACTION_REMOVE');
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(1);
  });

  it('검증 비활성 ENV → 일봉 미조회 + 기존 동작 (1줄 롤백)', async () => {
    process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = 'true';
    const stock = makeStock({ code: '006666', entryPrice: 4_745 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();
    const fetchCandles = vi.fn(async () => []);

    const result = await checkEntryPriceDrift(ctx, stock, 9_470, stageLog, trace, fetchCandles);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('CORPORATE_ACTION_REMOVE');
    expect(fetchCandles).not.toHaveBeenCalled(); // 검증 skip → 일봉 조회 0회
    expect(ctx.scanCounters.waitDriftCorpAction).toBe(1);
  });
});
