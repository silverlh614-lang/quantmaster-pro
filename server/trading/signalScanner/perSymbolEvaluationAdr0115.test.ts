// @responsibility ADR-0115 wiring 동작 회귀 가드 (behavioral — checkEntryPriceDrift + shouldIncrementFailCount 실호출)
//
// ADR-0134 분해로 CORPORATE_ACTION entryPrice 보존 / failCount Critical-only 정책이
// perSymbol/steps/entryPriceDrift.ts(checkEntryPriceDrift) + signalScanner/failureClassifier.ts
// (shouldIncrementFailCount) 로 이동. 과거 정적 grep(readFileSync) 가드를 폐기하고
// 실제 함수를 호출해 상태/카운터/텔레그램 부수효과를 단언한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
import type { BuyListLoopContext } from './perSymbol/types.js';
import { createScanCounters } from './scanDiagnostics/scanCounterFactory.js';

// 텔레그램 전송 spy — dedupeKey 정합 + HIGH 알림 호출 단언용.
const { sendTelegramAlert } = vi.hoisted(() => ({
  sendTelegramAlert: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('../../alerts/telegramClient.js', () => ({ sendTelegramAlert }));

import { checkEntryPriceDrift } from './perSymbol/steps/entryPriceDrift.js';
import { shouldIncrementFailCount } from './failureClassifier.js';

const ORIGINAL_AUTO_CORRECT = process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED;
const ORIGINAL_DAILYBAR_DISABLED = process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
const ORIGINAL_FAILCOUNT_DISABLED = process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED;

beforeEach(() => {
  sendTelegramAlert.mockClear();
  delete process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED; // default → IMMUTABLE_REMOVE(RAW 보존)
  // 일봉 검증 비활성 → GENUINE_RALLY 강등 배제, IMMUTABLE_REMOVE 경로 결정적.
  process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = 'true';
  delete process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED; // default → 정책 적용(Non-critical 미증가)
});
afterEach(() => {
  if (ORIGINAL_AUTO_CORRECT === undefined) delete process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED;
  else process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED = ORIGINAL_AUTO_CORRECT;
  if (ORIGINAL_DAILYBAR_DISABLED === undefined) delete process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED;
  else process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED = ORIGINAL_DAILYBAR_DISABLED;
  if (ORIGINAL_FAILCOUNT_DISABLED === undefined) delete process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED;
  else process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED = ORIGINAL_FAILCOUNT_DISABLED;
});

function makeStock(overrides: Partial<WatchlistEntry> & { code: string }): WatchlistEntry {
  return {
    name: overrides.code,
    entryPrice: 12_610,
    stopLoss: 11_000,
    targetPrice: 18_000,
    addedAt: '2026-01-01T00:00:00Z',
    addedBy: 'AUTO',
    ...overrides,
  } as WatchlistEntry;
}

function makeCtx(watchlist: WatchlistEntry[]): BuyListLoopContext {
  return {
    watchlist,
    scanCounters: createScanCounters(),
    mutables: { watchlistMutated: { value: false } },
  } as unknown as BuyListLoopContext;
}

describe('ADR-0115 CORPORATE_ACTION — entryPrice 자동 재설정 *제거* (default 정책)', () => {
  it('IMMUTABLE_REMOVE: entryPrice 보존(RAW immutable) + universe splice 제외', async () => {
    // 098460 고영 시나리오: entryPrice=12,610 → currentPrice=40,500 (+221% > 80% corp action 의심).
    const stock = makeStock({ code: '098460', entryPrice: 12_610 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};
    const trace = vi.fn();

    const result = await checkEntryPriceDrift(ctx, stock, 40_500, stageLog, trace);

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('CORPORATE_ACTION_REMOVE');
    // 사용자 절대 원칙 — entryPrice 자동 보정 금지(RAW immutable).
    expect(stock.entryPrice).toBe(12_610);
    expect(stock.corporateActionAdjusted).toBeUndefined();
    // universe 제외 (watchlist splice).
    expect(ctx.watchlist.find((w) => w.code === '098460')).toBeUndefined();
    expect(ctx.mutables.watchlistMutated.value).toBe(true);
    expect(trace).toHaveBeenCalledTimes(1);
  });

  it('IMMUTABLE_REMOVE 시 corp_action_immutable dedupeKey 로 HIGH 텔레그램 전송', async () => {
    const stock = makeStock({ code: '336260', entryPrice: 13_000 });
    const ctx = makeCtx([stock]);

    await checkEntryPriceDrift(ctx, stock, 40_000, {}, vi.fn());

    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
    const opts = sendTelegramAlert.mock.calls[0][1] as { dedupeKey?: string; priority?: string };
    expect(opts.dedupeKey).toBe('corp_action_immutable:336260');
    expect(opts.priority).toBe('HIGH');
  });

  it('waitDriftCorpAction++ 카운터 증가 (CORPORATE_ACTION 분기)', async () => {
    const stock = makeStock({ code: '098470', entryPrice: 12_610 });
    const ctx = makeCtx([stock]);

    await checkEntryPriceDrift(ctx, stock, 40_500, {}, vi.fn());

    expect(ctx.scanCounters.waitDriftCorpAction).toBe(1);
    expect(ctx.scanCounters.waitDriftRemove).toBe(0);
  });

  it('레거시(AUTO_CORRECT) 분기 보존: ENV 활성 시 entryPrice=currentPrice 재설정 (ADR-0113 호환)', async () => {
    // 명시 ENV false → isEntryPriceAutoCorrectDisabled=false → 레거시 else 분기.
    process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED = 'false';
    const stock = makeStock({ code: '009900', entryPrice: 12_610 });
    const ctx = makeCtx([stock]);
    const stageLog: Record<string, string> = {};

    const result = await checkEntryPriceDrift(ctx, stock, 40_500, stageLog, vi.fn());

    expect(result).toBe('SKIP');
    expect(stageLog.drift).toBe('CORPORATE_ACTION');
    // 레거시 동작 — entryPrice 현재가로 보정 + adjusted 마커.
    expect(stock.entryPrice).toBe(40_500);
    expect(stock.corporateActionAdjusted).toBe(true);
    // 레거시 분기 dedupeKey 는 corp_action: (immutable 아님).
    const opts = sendTelegramAlert.mock.calls[0][1] as { dedupeKey?: string };
    expect(opts.dedupeKey).toBe('corp_action:009900');
  });
});

describe('ADR-0115 pre-breakout WAIT — failCount Critical-only', () => {
  // shouldIncrementFailCount 는 preBreakoutEntry / entryRevalidationGate step 의 failCount 증가
  // 게이트 SSOT. default 정책(PRE_BREAKOUT_FAILCOUNT_DISABLED≠'false') 에서 Non-critical 사유는
  // false → failCount 미증가. 분기별 호출 site 가 정확한 reason 을 넘기는지는 0118/scanner
  // 통합 테스트가 카운터로 별도 단언.
  it('PRE_BREAKOUT_MISS → false (Non-critical, failCount 미증가)', () => {
    expect(shouldIncrementFailCount('PRE_BREAKOUT_MISS')).toBe(false);
  });

  it('ENTRY_PRICE_DEVIATION → false (Non-critical, failCount 미증가)', () => {
    expect(shouldIncrementFailCount('ENTRY_PRICE_DEVIATION')).toBe(false);
  });

  it('GATE_REVALIDATION_FAIL → false (Non-critical, failCount 미증가)', () => {
    expect(shouldIncrementFailCount('GATE_REVALIDATION_FAIL')).toBe(false);
  });

  it('CORPORATE_ACTION → true (Critical, failCount 증가 — 정책 무관 보존)', () => {
    expect(shouldIncrementFailCount('CORPORATE_ACTION')).toBe(true);
  });

  it('레거시 ENV(false) → 모든 사유 true (ADR-0113 동작 복원)', () => {
    process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED = 'false';
    expect(shouldIncrementFailCount('PRE_BREAKOUT_MISS')).toBe(true);
    expect(shouldIncrementFailCount('ENTRY_PRICE_DEVIATION')).toBe(true);
    expect(shouldIncrementFailCount('GATE_REVALIDATION_FAIL')).toBe(true);
  });
});
