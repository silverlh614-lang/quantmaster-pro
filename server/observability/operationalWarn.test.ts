import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./telegramCriticalAlertBridge.js', () => ({
  emitTelegramCriticalAlert: vi.fn(),
}));

import { emitOperationalWarn, defaultWarnTtlSec } from './operationalWarn.js';
import { clearWarnDedupStore } from './warnDedupStore.js';
import { getOperationalWarnSummary, resetOperationalWarnSummary } from './warnSummaryReporter.js';
import { emitTelegramCriticalAlert } from './telegramCriticalAlertBridge.js';

describe('emitOperationalWarn', () => {
  beforeEach(() => {
    clearWarnDedupStore();
    resetOperationalWarnSummary();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(emitTelegramCriticalAlert).mockClear();
  });

  it('prints P0 with priority/domain/code/impact/dedup metadata and sends compact alert', () => {
    const result = emitOperationalWarn({
      priority: 'P0',
      domain: 'EXECUTION',
      code: 'LIVE_SELL_ORDER_FAILED',
      message: 'sell failed',
      executionImpact: 'LIVE_SELL_BLOCKED',
      mode: 'LIVE',
      symbol: '005930',
      dedupKey: 'p0:sell:005930',
      ttlSec: 30,
    });

    expect(result.emitted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[P0][EXECUTION][LIVE_SELL_ORDER_FAILED]'),
      expect.objectContaining({
        priority: 'P0',
        domain: 'EXECUTION',
        code: 'LIVE_SELL_ORDER_FAILED',
        executionImpact: 'LIVE_SELL_BLOCKED',
        dedupKey: 'p0:sell:005930',
      }),
    );
    expect(emitTelegramCriticalAlert).toHaveBeenCalledOnce();
    expect(getOperationalWarnSummary().P0).toBe(1);
  });

  it('deduplicates by dedupKey within ttl', () => {
    const payload = {
      priority: 'P0' as const,
      domain: 'EXECUTION' as const,
      code: 'P0_SELL_DUPLICATE_BLOCKED',
      message: 'duplicate',
      executionImpact: 'LIVE_SELL_BLOCKED' as const,
      dedupKey: 'dup-key',
      ttlSec: 30,
    };

    expect(emitOperationalWarn(payload).emitted).toBe(true);
    const duplicate = emitOperationalWarn(payload);

    expect(duplicate).toEqual(expect.objectContaining({
      emitted: false,
      suppressed: true,
      suppressedCount: 1,
    }));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(emitTelegramCriticalAlert).toHaveBeenCalledTimes(1);
  });

  it('fills reason details for P0/P1 NONE impact warnings', () => {
    const result = emitOperationalWarn({
      priority: 'P1',
      domain: 'DIAGNOSTIC',
      code: 'P1_NONE_IMPACT',
      message: 'none impact',
      executionImpact: 'NONE',
      dedupKey: 'none-impact',
      ttlSec: 60,
    });

    expect(result.payload.details).toEqual(expect.objectContaining({
      reason: 'EXECUTION_IMPACT_NONE_REQUIRES_REASON',
    }));
  });

  it('keeps documented default ttl values available', () => {
    expect(defaultWarnTtlSec('P0')).toBe(30);
    expect(defaultWarnTtlSec('P1')).toBe(60);
    expect(defaultWarnTtlSec('P2')).toBe(300);
    expect(defaultWarnTtlSec('P3')).toBe(600);
  });
});
