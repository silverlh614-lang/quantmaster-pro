// @responsibility Verify durable paper bot delivery through the actual channel router.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import type { PaperBotMessage, PaperBotState } from '../persistence/paperBotRepo.js';
import { AlertCategory } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  channel: vi.fn<(chat: string, message: string, options?: { disableNotification?: boolean }) => Promise<number | undefined>>(),
  private: vi.fn<() => Promise<number | undefined>>(),
  load: vi.fn(), save: vi.fn(), view: vi.fn(), paused: vi.fn(), mode: vi.fn(),
  stats: vi.fn(), history: vi.fn(), ledger: vi.fn(), fetch: vi.fn(),
}));
vi.mock('./telegramClient.js', () => ({
  sendChannelAlertTo: mocks.channel, sendTelegramAlert: mocks.private,
}));
vi.mock('../persistence/paperBotRepo.js', () => ({
  loadPaperBotState: mocks.load, savePaperBotState: mocks.save,
}));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../state.js', () => ({ getTradingMode: mocks.mode, getAutoTradePaused: mocks.paused }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: () => [] }));
vi.mock('../persistence/dartRepo.js', () => ({ loadDartAlerts: () => [] }));
vi.mock('../persistence/channelStatsRepo.js', () => ({ incrementChannelStat: mocks.stats }));
vi.mock('../persistence/alertHistoryRepo.js', () => ({ appendAlertHistory: mocks.history }));
vi.mock('../persistence/notificationLedgerRepo.js', () => ({ updateNotificationLedgerState: mocks.ledger }));

import { runPaperBotTick } from './paperBot.js';
import { dispatchAlert, getChannelFlushStatus } from './alertRouter.js';
import { runScheduledNotificationScope } from './scheduledNotificationScope.js';

const friday = new Date('2026-09-18T10:00:00+09:00');
const destinations = { TRADE: 'test-trade', ANALYSIS: 'test-analysis', INFO: 'test-info', SYSTEM: 'test-system' };
const policy = {
  version: 'news-trend-v2', newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3,
  horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE',
} as const;
let persisted: PaperBotState;
let view: PaperExperimentView;

function newTrade(index = 0): PaperStrategyTrade {
  const symbol = String(100000 + index);
  const id = 'news-trend-v2:2026-09-18:' + symbol;
  return {
    id, strategyVersion: 'news-trend-v2', symbol, name: '테스트 종목 ' + index,
    status: 'OPEN', entrySnapshotId: 'scan-' + index, entryAt: friday.toISOString(),
    tradingDate: '2026-09-18', entryPrice: 10000, quantity: 1,
    entryObservation: {
      symbol, name: '테스트 종목 ' + index, price: 10000, observedAt: friday.toISOString(),
      source: 'KIS_REST_REQUEST_OBSERVED', return1dPct: 1, return5dPct: 2, aboveMa20: true,
      news: [], dailyCloses: [],
    },
    entryDecision: {
      snapshotId: 'scan-' + index, decisionAt: friday.toISOString(), symbol, name: '테스트 종목 ' + index,
      action: 'BUY', reasonCode: 'POSITIVE_COHORT_EXPECTANCY', reason: '동일 조건의 성숙 표본에 양의 순수익',
      cohort: 'NEWS_ABSENT_ABOVE_MA20', tradeId: id,
      evidence: {
        cutoffAt: friday.toISOString(), cohort: 'NEWS_ABSENT_ABOVE_MA20', sampleCount: 12,
        entryDateCount: 3, experimentIds: ['sample-1'], selectedHorizon: 3,
        historicalSampleCount: 4, baselineSampleCount: 8,
        horizons: [{ horizon: 3, count: 12, meanNetReturnPct: 1.5, meanDailyNetReturnPct: 0.5, winRatePct: 75 }],
      },
    },
    policy, costModel: { version: 'test-cost', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
    horizon: 3, scheduledExitDate: '2026-09-23', scheduledExitAt: '2026-09-23T06:30:00Z', exit: null,
  };
}

function pending(id: string, channel?: AlertCategory): PaperBotMessage {
  return {
    id, kind: 'trades', message: 'Shadow 기록 ' + id, ...(channel ? { channel } : {}),
    createdAt: friday.toISOString(), expiresAt: new Date(friday.getTime() + 3600000).toISOString(),
    state: 'PENDING', attempts: 0, nextAttemptAt: friday.toISOString(),
  };
}

async function tick(at = friday): Promise<void> {
  view.lastRun!.asOf = at.toISOString();
  await runScheduledNotificationScope('paper_bot', () => runPaperBotTick(at));
}

beforeEach(() => {
  vi.resetAllMocks();
  persisted = {
    schemaVersion: 1, initializedAt: '2026-09-14T00:00:00Z', lastCheckedAt: null,
    health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [],
  };
  view = {
    mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 0, openCount: 0, completedCount: 0,
    experiments: [], groups: [], outcomes: [],
    lastRun: {
      snapshotId: 'scan', asOf: friday.toISOString(), candidateCount: 1, observedCount: 1,
      openedCount: 0, completedCount: 0, missingPriceCount: 0, marketOpen: true, issues: [],
    },
    strategy: {
      strategyVersion: 'news-trend-v2', mode: 'SHADOW', policy, totalCount: 0, openCount: 0,
      performance: { closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
      lastRun: null, latestDecisions: [], trades: [],
    },
  };
  mocks.load.mockImplementation(() => structuredClone(persisted));
  mocks.save.mockImplementation((state: PaperBotState) => { persisted = structuredClone(state); });
  mocks.view.mockImplementation(() => view);
  mocks.mode.mockReturnValue('SHADOW');
  mocks.paused.mockReturnValue(false);
  mocks.channel.mockResolvedValue(101);
  mocks.private.mockResolvedValue(901);
  mocks.fetch.mockImplementation(() => { throw new Error('Real network is forbidden in paper bot channel tests'); });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('CHANNEL_ENABLED', 'true');
  vi.stubEnv('CHANNEL_MAP', JSON.stringify(destinations));
  vi.stubEnv('TELEGRAM_CHAT_ID', 'test-private');
  for (const category of Object.values(AlertCategory)) vi.stubEnv(category + '_CHANNEL_ENABLED', 'true');
  vi.stubEnv('TELEGRAM_TRADE_CHANNEL_ID', '');
  vi.stubEnv('TELEGRAM_ANALYSIS_CHANNEL_ID', '');
  vi.stubEnv('TELEGRAM_PICK_CHANNEL_ID', '');
  vi.stubEnv('TELEGRAM_INFO_CHANNEL_ID', '');
  vi.stubEnv('TELEGRAM_SYSTEM_CHANNEL_ID', '');
});
afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('paper bot through the real four-channel router', () => {
  it('routes scheduled reports and strategy events to all four channels without digest buffering', async () => {
    await tick(new Date('2026-09-14T08:45:00+09:00'));
    await tick(new Date('2026-09-14T16:10:00+09:00'));
    view.strategy!.trades = [newTrade()];
    await tick();
    expect(mocks.channel.mock.calls.map(call => call[0])).toEqual([
      destinations.INFO, destinations.SYSTEM, destinations.TRADE, destinations.ANALYSIS,
    ]);
    expect(persisted.messages.filter(item => item.state === 'SENT').map(item => item.channel)).toEqual([
      AlertCategory.INFO, AlertCategory.SYSTEM, AlertCategory.TRADE, AlertCategory.ANALYSIS,
    ]);
    expect(mocks.channel).toHaveBeenCalledWith(destinations.TRADE, expect.any(String), { disableNotification: false });
    expect(mocks.channel).toHaveBeenCalledWith(destinations.ANALYSIS,
      expect.stringContaining('※ 투자 판단은 각자 책임입니다.'), { disableNotification: true });
    expect(getChannelFlushStatus()).toMatchObject({
      infoDailyDigestBufferLength: 0, systemDailyBufferLength: 0, systemWeeklyBufferLength: 0,
    });
    expect(mocks.private).not.toHaveBeenCalled();
    await tick(new Date(friday.getTime() + 60000));
    expect(mocks.channel).toHaveBeenCalledTimes(4);
  });

  it('retries only the failed channel with the same ID through the real cooldown guard', async () => {
    view.strategy!.trades = [newTrade()];
    mocks.channel.mockImplementation(async chat => chat === destinations.TRADE ? 201 : undefined);
    await tick();
    const trade = persisted.messages.find(item => item.channel === AlertCategory.TRADE)!;
    const signal = persisted.messages.find(item => item.channel === AlertCategory.ANALYSIS)!;
    expect(trade).toMatchObject({ state: 'SENT', messageId: 201, attempts: 1 });
    expect(signal).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect(signal.messageId).toBeUndefined();
    expect(trade.id).not.toBe(signal.id);
    expect(trade.id).toMatch(/:TRADE$/);
    expect(signal.id).toMatch(/:ANALYSIS$/);
    await tick(new Date(friday.getTime() + 30000));
    expect(mocks.channel).toHaveBeenCalledTimes(2);
    mocks.channel.mockResolvedValue(202);
    await tick(new Date(friday.getTime() + 60000));
    expect(mocks.channel.mock.calls.map(call => call[0])).toEqual([
      destinations.TRADE, destinations.ANALYSIS, destinations.ANALYSIS,
    ]);
    expect(persisted.messages.find(item => item.id === signal.id)).toMatchObject({ state: 'SENT', messageId: 202, attempts: 2 });
    expect(persisted.messages.find(item => item.id === trade.id)).toMatchObject({ state: 'SENT', messageId: 201, attempts: 1 });
    await tick(new Date(friday.getTime() + 120000));
    expect(mocks.channel).toHaveBeenCalledTimes(3);
  });

  it.each(['disabled', 'missing'] as const)('keeps a %s channel pending until delivery is confirmed', async condition => {
    persisted.messages = [pending('paper:test-analysis:' + condition, AlertCategory.ANALYSIS)];
    if (condition === 'disabled') vi.stubEnv('ANALYSIS_CHANNEL_ENABLED', 'false');
    else vi.stubEnv('CHANNEL_MAP', JSON.stringify({ TRADE: destinations.TRADE, INFO: destinations.INFO, SYSTEM: destinations.SYSTEM }));
    await tick();
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(persisted.messages[0]).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect(persisted.messages[0].messageId).toBeUndefined();
    vi.stubEnv('ANALYSIS_CHANNEL_ENABLED', 'true');
    vi.stubEnv('CHANNEL_MAP', JSON.stringify(destinations));
    await tick(new Date(friday.getTime() + 60000));
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    expect(persisted.messages[0]).toMatchObject({ state: 'SENT', messageId: 101, attempts: 2 });
  });

  it('preserves old unchannelled DM records and does not rebroadcast past successful DMs', async () => {
    persisted.messages = [
      pending('old-pending-dm'),
      { ...pending('old-sent-dm'), state: 'SENT', messageId: 801, sentAt: friday.toISOString(), attempts: 1 },
    ];
    await tick();
    expect(mocks.private).toHaveBeenCalledTimes(1);
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(persisted.messages[0]).toMatchObject({ state: 'SENT', messageId: 901 });
    expect(persisted.messages[0].channel).toBeUndefined();
    expect(persisted.messages[1]).toMatchObject({ state: 'SENT', messageId: 801, attempts: 1 });
    await tick(new Date(friday.getTime() + 60000));
    expect(mocks.private).toHaveBeenCalledTimes(1);
  });

  it('keeps operational health in DM instead of sending it as a trading signal', async () => {
    mocks.paused.mockReturnValue(true);
    await tick();
    expect(mocks.private).toHaveBeenCalledTimes(1);
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({ kind: 'health', health: 'PAUSED', state: 'SENT', messageId: 901 });
    expect(persisted.messages[0].channel).toBeUndefined();
  });

  it('retains legacy scheduled suppression while permitting execution events', async () => {
    await runScheduledNotificationScope('legacy_report', () =>
      dispatchAlert(AlertCategory.ANALYSIS, 'legacy routine signal', { priority: 'NORMAL' }));
    expect(mocks.channel).not.toHaveBeenCalled();
    await runScheduledNotificationScope('legacy_report', () =>
      dispatchAlert(AlertCategory.TRADE, 'execution event', { priority: 'NORMAL' }));
    expect(mocks.channel).toHaveBeenCalledWith(destinations.TRADE, expect.any(String), { disableNotification: false });
  });
  it('delivers every event across independently tracked channel batches', async () => {
    view.strategy!.trades = Array.from({ length: 6 }, (_, index) => newTrade(index));
    await tick();
    const messages = persisted.messages.filter(item => item.kind === 'trades');
    expect(messages).toHaveLength(4);
    expect(new Set(messages.map(item => item.id)).size).toBe(4);
    for (const category of [AlertCategory.TRADE, AlertCategory.ANALYSIS]) {
      const channelMessages = messages.filter(item => item.channel === category);
      expect(channelMessages).toHaveLength(2);
      for (const trade of view.strategy!.trades) {
        expect(channelMessages.map(item => item.message).join('\n')).toContain(trade.symbol);
      }
    }
    await tick(new Date(friday.getTime() + 60000));
    expect(mocks.channel).toHaveBeenCalledTimes(4);
    expect(persisted.messages.every(item => item.state === 'SENT')).toBe(true);
    await tick(new Date(friday.getTime() + 120000));
    expect(mocks.channel).toHaveBeenCalledTimes(4);
  });

});
