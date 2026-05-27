// @responsibility Validate MiddayRescan Telegram final-summary dedup without touching trading decisions.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchlistEntry, WatchlistSection } from '../persistence/watchlistRepo.js';
import type { TelegramAlertOptions } from '../alerts/telegramClient.js';

const SECTION_TARGETS = ['MOMENTUM', 'SWING', 'CATALYST'] as const;

function watchlistEntry(
  code: string,
  name: string,
  section: WatchlistSection = 'MOMENTUM',
): WatchlistEntry {
  return {
    code,
    name,
    entryPrice: 1000,
    stopLoss: 900,
    targetPrice: 1200,
    addedAt: '2026-05-27T04:29:00.000Z',
    addedBy: 'AUTO',
    section,
  };
}

describe('middayRescanTelegram notification dedup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midday-rescan-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* SDS-ignore: temp directory cleanup is best effort in tests. */
      // best effort cleanup for temp test directories
    }
  });

  async function loadModule() {
    return import('./middayRescanTelegram.js');
  }

  it('uses one stable cycle id for the 13:00 KST MiddayRescan window', async () => {
    const { buildMiddayRescanCycleId } = await loadModule();

    expect(buildMiddayRescanCycleId(new Date('2026-05-27T04:29:00.000Z'))).toBe('midday_20260527_1300');
    expect(buildMiddayRescanCycleId(new Date('2026-05-27T04:34:00.000Z'))).toBe('midday_20260527_1300');
  });

  it('sends one final summary and suppresses duplicate sends for the same cycle', async () => {
    const { sendMiddayRescanFinalSummary } = await loadModule();
    const sent: Array<{ message: string; opts?: TelegramAlertOptions }> = [];
    const sendTelegram = vi.fn(async (message: string, opts?: TelegramAlertOptions) => {
      sent.push({ message, opts });
      return 1;
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const input = {
      cycleId: 'midday_20260527_1300',
      tradeDate: '2026-05-27',
      triggerSource: 'ORCHESTRATOR_INTRADAY_WINDOW',
      sectionTargets: SECTION_TARGETS,
      beforeCodes: new Set<string>(),
      finalWatchlist: [
        watchlistEntry('187870', 'Device', 'MOMENTUM'),
        watchlistEntry('123860', 'Anapass', 'MOMENTUM'),
      ],
      addedCount: 2,
      now: new Date('2026-05-27T04:29:00.000Z'),
      logger,
      sendTelegram,
    };

    const first = await sendMiddayRescanFinalSummary(input);
    const second = await sendMiddayRescanFinalSummary(input);

    expect(first.telegramSent).toBe(true);
    expect(first.reason).toBe('SENT_FINAL_SUMMARY');
    expect(second.telegramSent).toBe(false);
    expect(second.reason).toBe('DEDUP_KEY_ALREADY_SENT');
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(sent[0].message).toContain('[MiddayRescan \uC644\uB8CC]');
    expect(sent[0].message).toContain('\uC2E0\uADDC \uCD94\uAC00: 2\uAC1C');
    expect(sent[0].message).toContain('\uBC1C\uC1A1 \uAE30\uC900: final summary only');
    expect(sent[0].message).toContain('\uB9E4\uB9E4 \uC601\uD5A5: \uC5C6\uC74C');
    expect(sent[0].message).toContain('executionImpact=NONE');
    expect(sent[0].opts).toMatchObject({
      priority: 'LOW',
      category: 'midday_rescan',
      dedupeKey: '2026-05-27:MIDDAY_RESCAN_WATCHLIST_ADDED:MOMENTUM:midday_20260527_1300',
      cooldownMs: 1_800_000,
    });
  });

  it('does not label already notified same-day symbols as new in a later cycle', async () => {
    const { sendMiddayRescanFinalSummary } = await loadModule();
    const sent: Array<{ message: string; opts?: TelegramAlertOptions }> = [];
    const sendTelegram = vi.fn(async (message: string, opts?: TelegramAlertOptions) => {
      sent.push({ message, opts });
      return 1;
    });
    const logger = { info: vi.fn(), warn: vi.fn() };

    await sendMiddayRescanFinalSummary({
      cycleId: 'midday_20260527_1300',
      tradeDate: '2026-05-27',
      triggerSource: 'ORCHESTRATOR_INTRADAY_WINDOW',
      sectionTargets: SECTION_TARGETS,
      beforeCodes: new Set<string>(),
      finalWatchlist: [
        watchlistEntry('187870', 'Device', 'MOMENTUM'),
        watchlistEntry('123860', 'Anapass', 'MOMENTUM'),
      ],
      addedCount: 2,
      now: new Date('2026-05-27T04:29:00.000Z'),
      logger,
      sendTelegram,
    });

    const second = await sendMiddayRescanFinalSummary({
      cycleId: 'midday_20260527_1410',
      tradeDate: '2026-05-27',
      triggerSource: 'ORCHESTRATOR_INTRADAY_WINDOW',
      sectionTargets: SECTION_TARGETS,
      beforeCodes: new Set<string>(),
      finalWatchlist: [
        watchlistEntry('187870', 'Device', 'MOMENTUM'),
        watchlistEntry('123860', 'Anapass', 'MOMENTUM'),
        watchlistEntry('999999', 'Fresh', 'MOMENTUM'),
      ],
      addedCount: 3,
      now: new Date('2026-05-27T05:10:00.000Z'),
      logger,
      sendTelegram,
    });

    expect(second.telegramSent).toBe(true);
    expect(second.newCount).toBe(1);
    expect(sendTelegram).toHaveBeenCalledTimes(2);
    expect(sent[1].message).toContain('Fresh(999999)');
    expect(sent[1].message).not.toContain('Device(187870)');
    expect(sent[1].message).not.toContain('Anapass(123860)');
  });

  it('keeps zero-add cycles as logs only when no operator signal is needed', async () => {
    const { sendMiddayRescanFinalSummary } = await loadModule();
    const sendTelegram = vi.fn(async () => 1);
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = await sendMiddayRescanFinalSummary({
      cycleId: 'midday_20260527_1300',
      tradeDate: '2026-05-27',
      triggerSource: 'ORCHESTRATOR_INTRADAY_WINDOW',
      sectionTargets: SECTION_TARGETS,
      beforeCodes: new Set<string>(['187870']),
      finalWatchlist: [watchlistEntry('187870', 'Device', 'MOMENTUM')],
      addedCount: 0,
      now: new Date('2026-05-27T04:29:00.000Z'),
      logger,
      sendTelegram,
    });

    expect(result.telegramSent).toBe(false);
    expect(result.reason).toBe('NOT_ELIGIBLE_FINAL_SUMMARY_ONLY');
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[MIDDAY_RESCAN_BATCH_ACCUMULATED]'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('telegramSent=false'));
  });
});
