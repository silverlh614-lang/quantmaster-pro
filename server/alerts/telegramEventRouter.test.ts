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
  PUBLIC_SIGNAL_DISCLAIMER: '※ 투자 판단은 각자 책임입니다.',
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

  it('STRONG_BUY_SIGNAL routes to SIGNAL channel', () => {
    expect(routeTelegramEvent('STRONG_BUY_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  it('SELL_SIGNAL routes to SIGNAL channel', () => {
    expect(routeTelegramEvent('SELL_SIGNAL')).toBe(ChannelSemantic.SIGNAL);
  });

  it('STOP_LOSS_HIT routes to EXECUTION channel', () => {
    expect(routeTelegramEvent('STOP_LOSS_HIT')).toBe(ChannelSemantic.EXECUTION);
  });

  it('BUY_FILLED routes to EXECUTION channel', () => {
    expect(routeTelegramEvent('BUY_FILLED')).toBe(ChannelSemantic.EXECUTION);
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

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(ChannelSemantic.SIGNAL, expect.stringContaining('※ 투자 판단은 각자 책임입니다.'), {
      severity: 'HIGH',
      dedupeKey: 'STRONG_BUY_SIGNAL:005930',
      eventType: 'STRONG_BUY_SIGNAL',
      cooldownMs: undefined,
      delivery: undefined,
      disableNotification: undefined,
    });
    expect(mocks.sendPrivateAlert).not.toHaveBeenCalled();
  });

  it('emits SHADOW_BUY_SIGNAL to SIGNAL with order-none and executionImpact fields', async () => {
    await emitTelegramEvent({
      type: 'SHADOW_BUY_SIGNAL',
      message: 'shadow buy candidate',
      metadata: { symbol: '005930', engineMode: 'SHADOW_ONLY', blockedBy: 'R6_DEFENSE' },
    });

    const [route, message, options] = mocks.dispatchAlert.mock.calls[0] as unknown as [unknown, string, unknown];
    expect(route).toBe(ChannelSemantic.SIGNAL);
    expect(message).toContain('[SHADOW / 주문 없음]');
    expect(message).toContain('executionImpact=NONE');
    expect(message).toContain('engineMode=SHADOW_ONLY');
    expect(message).toContain('blockedBy=R6_DEFENSE');
    expect(message).toContain('※ 투자 판단은 각자 책임입니다.');
    expect(options).toMatchObject({
      severity: 'NORMAL',
      dedupeKey: 'SHADOW_BUY_SIGNAL:005930',
      eventType: 'SHADOW_BUY_SIGNAL',
    });
  });

  it('emits BUY_FILLED to EXECUTION with actual execution marker', async () => {
    await emitTelegramEvent({
      type: 'BUY_FILLED',
      message: 'filled 005930',
      metadata: { symbol: '005930' },
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      ChannelSemantic.EXECUTION,
      expect.stringContaining('[EXECUTION / 실제 체결]'),
      expect.objectContaining({ eventType: 'BUY_FILLED' }),
    );
  });

  it('emits STOP_LOSS_HIT to EXECUTION with risk execution marker', async () => {
    await emitTelegramEvent({
      type: 'STOP_LOSS_HIT',
      message: 'stop executed',
      metadata: { symbol: '005930' },
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      ChannelSemantic.EXECUTION,
      expect.stringContaining('[RISK / 손절 실행]'),
      expect.objectContaining({ eventType: 'STOP_LOSS_HIT' }),
    );
  });

  it('swallows dispatch failures to protect trading engine flow', async () => {
    mocks.dispatchAlert.mockRejectedValueOnce(new Error('telegram down'));
    await expect(emitTelegramEvent({
      type: 'ORDER_REJECTED',
      message: 'order rejected',
    })).resolves.toBeUndefined();
  });
});
