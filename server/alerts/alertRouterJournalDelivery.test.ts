import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertCategory } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  sendChannelAlertTo: vi.fn(async () => 777),
  incrementChannelStat: vi.fn(),
  appendAlertHistory: vi.fn(),
}));

vi.mock('./telegramClient.js', () => ({
  sendChannelAlertTo: mocks.sendChannelAlertTo,
}));

vi.mock('../persistence/channelStatsRepo.js', () => ({
  incrementChannelStat: mocks.incrementChannelStat,
}));

vi.mock('../persistence/alertHistoryRepo.js', () => ({
  appendAlertHistory: mocks.appendAlertHistory,
}));

const { dispatchAlert, getChannelFlushStatus } = await import('./alertRouter.js');

const originalSystemEnabled = process.env.SYSTEM_CHANNEL_ENABLED;
const originalSystemChannel = process.env.TELEGRAM_SYSTEM_CHANNEL_ID;
const originalChannelEnabled = process.env.CHANNEL_ENABLED;

beforeEach(() => {
  mocks.sendChannelAlertTo.mockClear();
  mocks.incrementChannelStat.mockClear();
  mocks.appendAlertHistory.mockClear();
  process.env.SYSTEM_CHANNEL_ENABLED = 'true';
  process.env.TELEGRAM_SYSTEM_CHANNEL_ID = '-100system';
  delete process.env.CHANNEL_ENABLED;
});

afterEach(() => {
  if (originalSystemEnabled === undefined) delete process.env.SYSTEM_CHANNEL_ENABLED;
  else process.env.SYSTEM_CHANNEL_ENABLED = originalSystemEnabled;
  if (originalSystemChannel === undefined) delete process.env.TELEGRAM_SYSTEM_CHANNEL_ID;
  else process.env.TELEGRAM_SYSTEM_CHANNEL_ID = originalSystemChannel;
  if (originalChannelEnabled === undefined) delete process.env.CHANNEL_ENABLED;
  else process.env.CHANNEL_ENABLED = originalChannelEnabled;
});

describe('alertRouter JOURNAL delivery policy ADR-0466', () => {
  it('does not force non-critical SYSTEM alerts into weekly buffer', async () => {
    await dispatchAlert(AlertCategory.SYSTEM, 'daily learning journal', {
      severity: 'NORMAL',
      dedupeKey: 'journal-default',
    });

    expect(mocks.sendChannelAlertTo).toHaveBeenCalledWith('-100system', 'daily learning journal', {
      disableNotification: true,
    });
    expect(getChannelFlushStatus().systemWeeklyBufferLength).toBe(0);
  });

  it('buffers SYSTEM alerts only when weekly_digest is explicitly requested', async () => {
    await dispatchAlert(AlertCategory.SYSTEM, 'weekly journal item', {
      severity: 'LOW',
      dedupeKey: 'journal-weekly',
      delivery: 'weekly_digest',
    });

    expect(mocks.sendChannelAlertTo).not.toHaveBeenCalled();
    expect(getChannelFlushStatus().systemWeeklyBufferLength).toBeGreaterThanOrEqual(1);
    expect(mocks.incrementChannelStat).toHaveBeenCalledWith(AlertCategory.SYSTEM, 'buffered', {
      eventType: 'journal-weekly',
    });
  });
});
