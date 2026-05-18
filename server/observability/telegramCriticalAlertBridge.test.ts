import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve(1)),
}));

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { clearWarnDedupStore } from './warnDedupStore.js';
import { emitTelegramCriticalAlert, formatTelegramCriticalWarn } from './telegramCriticalAlertBridge.js';

describe('telegramCriticalAlertBridge', () => {
  beforeEach(() => {
    clearWarnDedupStore();
    vi.mocked(sendTelegramAlert).mockClear();
  });

  it('formats compact P0 alert and deduplicates telegram delivery', () => {
    const payload = {
      priority: 'P0' as const,
      domain: 'EXECUTION' as const,
      code: 'LIVE_SELL_ORDER_FAILED',
      message: 'failed',
      executionImpact: 'LIVE_SELL_BLOCKED' as const,
      mode: 'LIVE' as const,
      symbol: '005930',
      dedupKey: 'railway-dedup',
      ttlSec: 30,
    };

    expect(formatTelegramCriticalWarn(payload)).toContain('🚨 P0 EXECUTION');
    emitTelegramCriticalAlert(payload);
    emitTelegramCriticalAlert(payload);

    expect(sendTelegramAlert).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlert).toHaveBeenCalledWith(
      expect.stringContaining('code=LIVE_SELL_ORDER_FAILED'),
      expect.objectContaining({
        priority: 'CRITICAL',
        dedupeKey: 'telegram:p0:LIVE_SELL_ORDER_FAILED:005930:LIVE',
      }),
    );
  });
});
