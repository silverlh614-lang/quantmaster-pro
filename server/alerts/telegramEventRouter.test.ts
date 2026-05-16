import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertCategory, ChannelSemantic } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  dispatchAlert: vi.fn(async () => 101),
  sendPrivateAlert: vi.fn(async () => 202),
  incrementChannelStat: vi.fn(),
}));

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: mocks.dispatchAlert,
  ChannelSemantic: {
    EXECUTION: 'TRADE',
    SIGNAL: 'ANALYSIS',
    REGIME: 'INFO',
    JOURNAL: 'SYSTEM',
  },
}));

vi.mock('./telegramClient.js', () => ({
  sendPrivateAlert: mocks.sendPrivateAlert,
}));

vi.mock('../persistence/channelStatsRepo.js', () => ({
  incrementChannelStat: mocks.incrementChannelStat,
}));

const { routeTelegramEvent, emitTelegramEvent } = await import('./telegramEventRouter.js');

beforeEach(() => {
  mocks.dispatchAlert.mockClear();
  mocks.sendPrivateAlert.mockClear();
  mocks.incrementChannelStat.mockClear();
});

describe('telegramEventRouter ADR-0466 taxonomy', () => {
  it('BUY_SIGNAL routes to SIGNAL channel', () => {
    expect(routeTelegramEvent('BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  it('STOP_LOSS_HIT routes to EXECUTION channel', () => {
    expect(routeTelegramEvent('STOP_LOSS_HIT')).toBe(ChannelSemantic.EXECUTION);
  });

  it('REGIME_CHANGE routes to REGIME channel', () => {
    expect(routeTelegramEvent('REGIME_CHANGE')).toBe(ChannelSemantic.REGIME);
  });

  it('SHADOW_SUMMARY routes to JOURNAL channel', () => {
    expect(routeTelegramEvent('SHADOW_SUMMARY')).toBe(ChannelSemantic.JOURNAL);
  });

  it('ACCOUNT_BALANCE bypasses channels and sends private only', async () => {
    await emitTelegramEvent({
      type: 'ACCOUNT_BALANCE',
      message: 'private balance summary',
      metadata: { scope: 'balance' },
    });

    expect(mocks.dispatchAlert).not.toHaveBeenCalled();
    expect(mocks.sendPrivateAlert).toHaveBeenCalledTimes(1);
    expect(mocks.incrementChannelStat).toHaveBeenCalledWith(AlertCategory.SYSTEM, 'directDmBypass', {
      eventType: 'ACCOUNT_BALANCE',
    });
  });

  it('emits channel events with automatic severity and dedupe key', async () => {
    await emitTelegramEvent({
      type: 'STRONG_BUY_SIGNAL',
      message: '[SHADOW / order none / executionImpact=NONE] TEST',
      metadata: { symbol: '005930' },
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(ChannelSemantic.SIGNAL, expect.any(String), {
      severity: 'HIGH',
      dedupeKey: 'STRONG_BUY_SIGNAL:005930',
      eventType: 'STRONG_BUY_SIGNAL',
      cooldownMs: undefined,
      delivery: undefined,
      disableNotification: undefined,
    });
    expect(mocks.sendPrivateAlert).not.toHaveBeenCalled();
  });

  it('swallows dispatch failures to protect trading engine flow', async () => {
    mocks.dispatchAlert.mockRejectedValueOnce(new Error('telegram down'));
    await expect(emitTelegramEvent({
      type: 'ORDER_REJECTED',
      message: 'order rejected',
    })).resolves.toBeUndefined();
  });
});
