import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertCategory, ChannelSemantic } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  dispatchAlert: vi.fn(async () => 1),
  sendPrivateAlert: vi.fn(async () => 11),
}));

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: mocks.dispatchAlert,
}));
vi.mock('./telegramClient.js', async () => {
  const actual = await vi.importActual<typeof import('./telegramClient.js')>('./telegramClient.js');
  return {
    ...actual,
    sendPrivateAlert: mocks.sendPrivateAlert,
  };
});

const {
  channelBuySignalEmitted,
  channelSellSignal,
  channelMarketBriefing,
  channelPerformance,
  channelShadowBuyFilled,
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
  mocks.sendPrivateAlert.mockClear();
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

  it('shadow paper-fill: channel disabled still sends private alert', async () => {
    process.env.CHANNEL_ENABLED = 'false';

    await channelShadowBuyFilled({
      stockName: 'TEST',
      stockCode: '000001',
      fillPrice: 1000,
      quantity: 2,
      fillId: 'FILL-1',
      tradeId: 'TRADE-1',
    });

    expect(mocks.dispatchAlert).not.toHaveBeenCalled();
    expect(mocks.sendPrivateAlert).toHaveBeenCalledTimes(1);
    const privateCall = mocks.sendPrivateAlert.mock.calls[0] as unknown[];
    expect(privateCall[1]).toMatchObject({
      category: 'SHADOW_PAPER_FILLED',
      dedupeKey: 'SHADOW_PAPER_FILLED:000001:TRADE-1:FILL-1',
    });
  });

  it('shadow paper-fill: trade channel enabled dispatches and sends private alert with same dedupeKey', async () => {
    process.env.TRADE_CHANNEL_ENABLED = 'true';

    await channelShadowBuyFilled({
      stockName: 'TEST',
      stockCode: '000001',
      fillPrice: 1000,
      quantity: 2,
      fillId: 'FILL-2',
      tradeId: 'TRADE-2',
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendPrivateAlert).toHaveBeenCalledTimes(1);
    const dispatchCall = mocks.dispatchAlert.mock.calls[0] as unknown[];
    const privateCall = mocks.sendPrivateAlert.mock.calls[0] as unknown[];
    expect(dispatchCall[2]).toMatchObject({
      eventType: 'SHADOW_PAPER_FILLED',
      dedupeKey: 'SHADOW_PAPER_FILLED:000001:TRADE-2:FILL-2',
    });
    expect(privateCall[1]).toMatchObject({
      dedupeKey: 'SHADOW_PAPER_FILLED:000001:TRADE-2:FILL-2',
    });
  });
});
