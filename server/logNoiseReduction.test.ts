import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPreEntryWaitDedupeKey,
  resetPreEntryWaitLogDedupeForTest,
  shouldEmitPreEntryWaitLog,
} from './trading/signalScanner/perSymbol/buyListLoop.js';
import {
  formatPreBreakoutNoiseSummary,
  logPreBreakoutNoiseSummary,
} from './trading/signalScanner/scanDiagnostics.js';
import {
  formatKisWsNoiseSummary,
  logKisWsNoiseSummary,
  requestKisWsSubscription,
  __resetKisWsSubscriptionStateForTests,
} from './clients/kisWebSocketSubscriptionManager.js';
import {
  formatKisMtasNoiseSummary,
  logKisMtasNoiseSummary,
} from './screener/adapters/kisQuoteAdapter.js';

describe('log noise reduction', () => {
  beforeEach(() => {
    resetPreEntryWaitLogDedupeForTest();
    __resetKisWsSubscriptionStateForTests();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PRE_ENTRY_WAIT는 INFO로 찍히지 않고 반복은 30분 dedupe된다', () => {
    const key = buildPreEntryWaitDedupeKey({
      tradeDate: '2026-05-12',
      session: 'MORNING_BUY',
      stockCode: '005930',
      entryPrice: 70000,
      reason: 'PRE_BREAKOUT_MISS',
    });

    expect(key).toBe('PRE_ENTRY_WAIT:2026-05-12:MORNING_BUY:005930:70000:PRE_BREAKOUT_MISS');
    expect(shouldEmitPreEntryWaitLog(key, 1_000_000)).toBe(true);
    expect(shouldEmitPreEntryWaitLog(key, 1_000_000 + 29 * 60 * 1000)).toBe(false);
    expect(shouldEmitPreEntryWaitLog(key, 1_000_000 + 31 * 60 * 1000)).toBe(true);
    expect(console.info).not.toHaveBeenCalled();
  });

  it('PreBreakoutSummary는 INFO로 1회 찍힌다', () => {
    const logger = { info: vi.fn() };
    logPreBreakoutNoiseSummary({ scanned: 39, wait: 24, approaching: 2, gateFail: 8, ready: 0, rejected: 5 }, logger);

    expect(formatPreBreakoutNoiseSummary({ scanned: 39, wait: 24, approaching: 2, gateFail: 8, ready: 0, rejected: 5 }))
      .toBe('[PreBreakoutSummary] scanned=39 wait=24 approaching=2 gateFail=8 ready=0 rejected=5');
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('[PreBreakoutSummary] scanned=39 wait=24 approaching=2 gateFail=8 ready=0 rejected=5');
  });

  it('KIS-WS low priority reject는 DEBUG다', () => {
    const subscribedPriorities = new Map();
    requestKisWsSubscription(
      { code: '005930', priority: 500, reasons: ['WATCHLIST'] },
      { subscribedPriorities, limit: 1, subscribeFn: vi.fn(), unsubscribeFn: vi.fn(), now: 1_000 },
    );
    requestKisWsSubscription(
      { code: '000660', priority: 100, reasons: ['UNKNOWN'] },
      { subscribedPriorities, limit: 1, subscribeFn: vi.fn(), unsubscribeFn: vi.fn(), now: 2_000 },
    );

    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('[KIS-WS] reject low priority 000660'));
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('[KIS-WS] reject low priority'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('[KIS-WS] reject low priority'));
  });

  it('KIS-WSSummary는 INFO다', () => {
    const logger = { info: vi.fn() };
    logKisWsNoiseSummary({ active: 30, queued: 18, keep: 12, rejectedLowPriority: 34, limitReached: 9 }, logger);

    expect(formatKisWsNoiseSummary({ active: 30, queued: 18, keep: 12, rejectedLowPriority: 34, limitReached: 9 }))
      .toBe('[KIS-WSSummary] active=30 queued=18 keep=12 rejectedLowPriority=34 limitReached=9');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('KisMTAS detail은 DEBUG다', () => {
    const source = readFileSync('server/screener/adapters/kisQuoteAdapter.ts', 'utf8');

    expect(source).toMatch(/console\.debug\([\s\S]*\[KisMTAS\].*월봉 KIS 보강/);
    expect(source).toMatch(/console\.debug\([\s\S]*\[KisMTAS\].*주봉 KIS 보강/);
    expect(source).not.toMatch(/console\.log\([\s\S]*\[KisMTAS\].*(월봉|주봉) KIS 보강/);
  });

  it('KisMTASSummary는 INFO다', () => {
    const logger = { info: vi.fn() };
    logKisMtasNoiseSummary({ scanned: 39, monthlyBull: 24, weeklyBull: 27, bothBull: 21, failed: 0 }, logger);

    expect(formatKisMtasNoiseSummary({ scanned: 39, monthlyBull: 24, weeklyBull: 27, bothBull: 21, failed: 0 }))
      .toBe('[KisMTASSummary] scanned=39 monthlyBull=24 weeklyBull=27 bothBull=21 failed=0');
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});
