import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertCategory, ChannelSemantic } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  dispatchAlert: vi.fn(async () => 1),
}));

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: mocks.dispatchAlert,
}));

const {
  channelBuySignalEmitted,
  channelSellSignal,
  channelMarketBriefing,
  channelPerformance,
} = await import('./channelPipeline.js');

const ENV_KEYS = [
  'CHANNEL_ENABLED',
  'TRADE_CHANNEL_ENABLED',
  'ANALYSIS_CHANNEL_ENABLED',
  'INFO_CHANNEL_ENABLED',
  'SYSTEM_CHANNEL_ENABLED',
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  mocks.dispatchAlert.mockClear();
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('channelPipeline category-specific enable gates', () => {
  it('emits BUY_SIGNAL with ANALYSIS_CHANNEL_ENABLED only', async () => {
    process.env.ANALYSIS_CHANNEL_ENABLED = 'true';

    await channelBuySignalEmitted({
      mode: 'SHADOW',
      stockName: 'TEST',
      stockCode: '000001',
      price: 1000,
      quantity: 1,
      gateScore: 7.1,
      mtas: 8,
      cs: 0.7,
      stopLoss: 900,
      targetPrice: 1200,
      rrr: 2,
      signalType: 'BUY',
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(AlertCategory.ANALYSIS, expect.any(String));
  });

  it('emits STOP/SELL events with TRADE_CHANNEL_ENABLED only', async () => {
    process.env.TRADE_CHANNEL_ENABLED = 'true';

    await channelSellSignal({
      stockName: 'TEST',
      stockCode: '000001',
      exitPrice: 900,
      entryPrice: 1000,
      pnlPct: -10,
      reason: 'STOP',
      holdingDays: 1,
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(AlertCategory.TRADE, expect.any(String));
  });

  it('emits REGIME events with INFO_CHANNEL_ENABLED only', async () => {
    process.env.INFO_CHANNEL_ENABLED = 'true';

    await channelMarketBriefing({
      regime: 'R6_DEFENSE',
      mhs: 70,
      watchlistCount: 3,
      focusCount: 1,
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(AlertCategory.INFO, expect.any(String));
  });

  it('emits JOURNAL events with SYSTEM_CHANNEL_ENABLED only', async () => {
    process.env.SYSTEM_CHANNEL_ENABLED = 'true';

    await channelPerformance({
      period: 'DAILY',
      totalTrades: 1,
      winCount: 1,
      lossCount: 0,
      totalPnlPct: 2.3,
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(ChannelSemantic.JOURNAL, expect.any(String));
  });

  it('does not require global CHANNEL_ENABLED when category-specific flag is enabled', async () => {
    process.env.ANALYSIS_CHANNEL_ENABLED = 'true';
    expect(process.env.CHANNEL_ENABLED).toBeUndefined();

    await channelBuySignalEmitted({
      mode: 'LIVE',
      stockName: 'TEST',
      stockCode: '000001',
      price: 1000,
      quantity: 1,
      gateScore: 7.1,
      mtas: 8,
      cs: 0.7,
      stopLoss: 900,
      targetPrice: 1200,
      rrr: 2,
      signalType: 'STRONG_BUY',
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledTimes(1);
  });
});
