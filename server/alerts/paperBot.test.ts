// @responsibility Verify Shadow bot schedules, recovery, delivery tracking.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestSnapshot, strategyTestCost } from '../trading/paper/paperStrategyFixtures.js';

const mocks = vi.hoisted(() => ({ send: vi.fn(), load: vi.fn(), save: vi.fn(), view: vi.fn(), mode: vi.fn(), paused: vi.fn(), news: vi.fn(), morning: vi.fn(), maintain: vi.fn() }));
vi.mock('./globalNewsRuntime.js', () => ({ maintainGlobalMorningNews: mocks.maintain, getGlobalMorningMessage: mocks.morning }));
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: mocks.send }));
vi.mock('./alertRouter.js', async () => ({ ...(await import('./alertCategories.js')), dispatchAlert: mocks.send }));
vi.mock('../persistence/paperBotRepo.js', () => ({ loadPaperBotState: mocks.load, savePaperBotState: mocks.save }));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../state.js', () => ({ getTradingMode: mocks.mode, getAutoTradePaused: mocks.paused }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: mocks.news }));
vi.mock('../persistence/dartRepo.js', () => ({ loadDartAlerts: () => [] }));
import { classifyPaperBotHealth, enqueuePaperHealth, enqueuePaperReports, enqueuePaperTradeChanges, runPaperBotTick } from './paperBot.js';
import { formatPaperReport, formatPaperTrades, formatPaperTradeAnalysis, formatPaperBotStatus, paperTradeEvents } from './paperBotMessages.js';

function emptyState(): PaperBotState { return { schemaVersion: 1, initializedAt: null, lastCheckedAt: null, health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [] }; }
function emptyView(): PaperExperimentView { return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 0, completedCount: 0, openCount: 0, experiments: [], groups: [], outcomes: [], lastRun: null, strategy: buildPaperStrategyView(emptyStrategyLedger()) }; }
const monday = new Date('2026-09-14T08:45:00+09:00');
let persisted: PaperBotState;
let view: PaperExperimentView;
beforeEach(() => {
  vi.clearAllMocks(); persisted = emptyState(); view = emptyView();
  // Delivery cases use a known, unchanged stale source; health transitions have separate cases.
  persisted.health = 'STALE'; persisted.notifiedHealth = 'STALE';
  mocks.load.mockImplementation(() => structuredClone(persisted));
  mocks.save.mockImplementation((state: PaperBotState) => { persisted = structuredClone(state); });
  mocks.view.mockImplementation(() => view);
  mocks.morning.mockReturnValue('해외 뉴스·국내 연관주');
  mocks.mode.mockReturnValue('SHADOW'); mocks.paused.mockReturnValue(false); mocks.news.mockReturnValue([]); mocks.send.mockResolvedValue(101);
});

describe('KST report slots', () => {
  it('uses Monday in Korea even on UTC Sunday and survives a restart without resending', async () => {
    await runPaperBotTick(monday);
    expect(mocks.view).toHaveBeenCalledWith(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(persisted.messages[0]).toMatchObject({ id: 'paper:morning:2026-09-14', state: 'SENT', messageId: 101 });
    await runPaperBotTick(new Date(monday.getTime() + 60_000));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.morning).toHaveBeenCalledTimes(1);
    expect(mocks.news).not.toHaveBeenCalled();
  });
  it.each(['2026-09-14T08:44:00+09:00', '2026-09-14T09:30:00+09:00', '2026-09-19T08:45:00+09:00', '2026-12-25T08:45:00+09:00'])('does not enqueue outside the slot or on a closed market: %s', at => {
    enqueuePaperReports(persisted, view, new Date(at)); expect(persisted.messages).toEqual([]);
  });
  it('catches up a missed close within the grace window, only once', () => {
    enqueuePaperReports(persisted, view, new Date('2026-09-14T18:00:00+09:00'));
    enqueuePaperReports(persisted, view, new Date('2026-09-14T18:01:00+09:00'));
    expect(persisted.messages).toHaveLength(1); expect(persisted.messages[0].kind).toBe('close');
    expect(persisted.messages[0].message).toContain('1. 기본 관측 · 오늘과 누적');
    expect(persisted.messages[0].message).toContain('오늘 장중 대기 사유 미기록');
  });
  it('keeps a previously sent closing summary without rewriting or resending after a format update', () => {
    enqueuePaperReports(persisted, view, new Date('2026-09-14T16:10:00+09:00'));
    const original = persisted.messages[0]; original.state = 'SENT'; original.message = '기존 마감 요약'; original.messageId = 7;
    enqueuePaperReports(persisted, view, new Date('2026-09-14T18:01:00+09:00'), mocks.news);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({ state: 'SENT', message: '기존 마감 요약', messageId: 7 });
    expect(mocks.news).not.toHaveBeenCalled();
  });
  it('waits for research loading before consuming Sunday slot', () => {
    const sunday = new Date('2026-09-13T19:00:00+09:00');
    enqueuePaperReports(persisted, view, sunday); expect(persisted.messages).toHaveLength(0);
    view.research = { asOf: sunday.toISOString(), sampleCount: 4519, learningSampleCount: 6, symbols: 74, featureStudies: [] } as unknown as NonNullable<PaperExperimentView['research']>;
    enqueuePaperReports(persisted, view, sunday); expect(persisted.messages[0].kind).toBe('weekly');
    expect(persisted.messages[0].message).toContain('4,519건');
  });
});

describe('delivery ledger', () => {
  it('waits for the brief without consuming the daily slot or delaying other deliveries', async () => {
    mocks.morning.mockReturnValueOnce(null);
    await runPaperBotTick(monday);
    expect(persisted.messages.filter(item => item.kind === 'morning')).toHaveLength(0);
    await runPaperBotTick(new Date(monday.getTime() + 60_000));
    expect(persisted.messages.find(item => item.kind === 'morning')).toMatchObject({ state: 'SENT', message: '해외 뉴스·국내 연관주' });
  });
  it('can send sourced news when the observation view is unavailable', () => {
    enqueuePaperReports(persisted, undefined, monday, mocks.news, mocks.morning);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0].channel).toBe('INFO');
  });
  it('retries an unconfirmed send after restart without marking success', async () => {
    mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(monday);
    expect(persisted.messages[0]).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect(persisted.messages[0].messageId).toBeUndefined();
    await runPaperBotTick(new Date(monday.getTime() + 30_000)); expect(mocks.send).toHaveBeenCalledTimes(1);
    await runPaperBotTick(new Date(monday.getTime() + 60_000));
    expect(persisted.messages[0]).toMatchObject({ state: 'SENT', attempts: 2, messageId: 101 });
  });
  it('stops retrying after six failures and exposes a failed state', async () => {
    mocks.send.mockResolvedValue(undefined);
    for (const minutes of [0, 1, 3, 7, 15, 30, 31]) await runPaperBotTick(new Date(monday.getTime() + minutes * 60_000));
    expect(mocks.send).toHaveBeenCalledTimes(6);
    expect(persisted.messages[0]).toMatchObject({ state: 'FAILED', attempts: 6 });
  });
  it('expires stale morning messages instead of replaying them at lunch', async () => {
    mocks.send.mockResolvedValueOnce(undefined); await runPaperBotTick(monday);
    await runPaperBotTick(new Date('2026-09-14T12:00:00+09:00'));
    expect(persisted.messages.find(item => item.kind === 'morning')?.state).toBe('EXPIRED');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('coalesces overlapping coordinator ticks into one delivery', async () => {
    let finish!: (id: number) => void;
    mocks.send.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = runPaperBotTick(monday); const second = runPaperBotTick(monday);
    expect(first).toBe(second); finish(202); await Promise.all([first, second]);
    expect(mocks.send).toHaveBeenCalledTimes(1); expect(persisted.messages[0].messageId).toBe(202);
  });
  it('does nothing in another trading mode', async () => {
    mocks.mode.mockReturnValue('LIVE'); await runPaperBotTick(monday);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('new strategy events', () => {
  it('baselines old entries silently, then emits each new entry and delayed exit once', () => {
    const strategy = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);
    view.strategy = buildPaperStrategyView(strategy);
    const now = new Date('2026-09-18T01:01:00Z');
    enqueuePaperTradeChanges(persisted, view, now); expect(persisted.messages).toHaveLength(0);
    persisted.initializedAt = now.toISOString();
    const next = structuredClone(strategy.trades[0]); next.id = 'new'; next.entryAt = now.toISOString(); next.name = '<A&B>';
    view.strategy.trades.push(next);
    enqueuePaperTradeChanges(persisted, view, now); enqueuePaperTradeChanges(persisted, view, now);
    expect(persisted.messages).toHaveLength(2); expect(persisted.messages[0].message).toContain('&lt;A&amp;B&gt;');
    expect(persisted.messages.map(item => item.channel)).toEqual(['TRADE', 'ANALYSIS']);
    next.exit = { decisionAt: '2026-09-18T01:02:00Z', effectiveAt: '2026-09-17T06:30:00Z', netReturnPct: 0 } as NonNullable<typeof next.exit>;
    enqueuePaperTradeChanges(persisted, view, new Date('2026-09-18T01:03:00Z'));
    expect(persisted.messages).toHaveLength(4); expect(persisted.messages[2].message).toContain('순수익률 0.00%');
    expect(paperTradeEvents([next])[1].at).toBe(next.exit.decisionAt);
    expect(formatPaperTrades(Array.from({ length: 100 }, () => paperTradeEvents([next])[0])).length).toBeLessThan(3500);
  });
  it('preserves zero performance, missing samples and escaped headlines', () => {
    view.outcomes = [{ horizon: 1, label: 'D1', count: 1, meanNetReturnPct: 0, winRatePct: 0 }, { horizon: 3, label: 'D3', count: 0, meanNetReturnPct: null, winRatePct: null }];
    const text = formatPaperReport(view, 'status', '2026-09-14', ['<b>뉴스 & 공시</b>']);
    expect(text).toContain('D1: 0.00%'); expect(text).toContain('D3: 집계 대기'); expect(text).toContain('&lt;b&gt;뉴스 &amp; 공시&lt;/b&gt;');
  });
});

describe('operational health transitions', () => {
  const scanAt = (at: string) => {
    view.lastRun = { snapshotId: 'scan', asOf: at, candidateCount: 863, durationMs: 140_000,
      observedCount: 849, missingPriceCount: 14, openedCount: 0, completedCount: 0, marketOpen: true, issues: [] };
  };
  it.each(['2026-09-19T11:28:00+09:00', '2026-09-18T23:28:00+09:00', '2026-12-25T11:28:00+09:00'])(
    'keeps short off-hours delays quiet and detects a prolonged outage: %s', at => {
      const now = new Date(at);
      scanAt(new Date(now.getTime() - 12 * 60_000).toISOString());
      expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
      scanAt(new Date(now.getTime() - 61 * 60_000).toISOString());
      expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
    });
  it('recognizes advancing work, bounds long scans and rejects invalid progress timestamps', () => {
    const now = new Date('2026-09-18T13:35:00+09:00');
    scanAt('2026-09-18T13:24:00+09:00');
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
    view.collection = { startedAt: '2026-09-18T13:33:00+09:00', lastProgressAt: '2026-09-18T13:34:55+09:00', completed: 204, total: 830 };
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    expect(classifyPaperBotHealth(view, false, now, 0, 'STALE')).toBe('STALE');
    view.collection.lastProgressAt = '2026-09-18T13:36:00+09:00';
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
    view.collection.lastProgressAt = '2026-09-18T13:34:55+09:00';
    view.collection.startedAt = '2026-09-18T13:00:00+09:00';
    scanAt('2026-09-18T12:59:00+09:00');
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
    view.collection.startedAt = '2026-09-18T13:30:00+09:00';
    view.collection.lastProgressAt = '2026-09-18T13:31:00+09:00';
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
  });
  it('does not replay an old market price outage during the weekend or hide ledger errors', () => {
    const now = new Date('2026-09-19T12:00:00+09:00');
    scanAt('2026-09-19T11:55:00+09:00');
    view.lastRun!.observedCount = 0;
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    view.strategy!.error = 'unreadable';
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STRATEGY_ERROR');
    expect(classifyPaperBotHealth(undefined, false, now, 0)).toBe('UNAVAILABLE');
  });
  it('cancels brief delays without recovery spam and persists repeat-warning spacing', () => {
    const now = new Date('2026-09-19T12:00:00+09:00');
    persisted = emptyState();
    enqueuePaperHealth(persisted, 'STALE', now, view);
    expect(persisted.messages[0].nextAttemptAt).toBe(new Date(now.getTime() + 5 * 60_000).toISOString());
    expect(persisted.messages[0].message).toContain('휴장·장외 60분');
    enqueuePaperHealth(persisted, 'OK', new Date(now.getTime() + 60_000), view);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0].state).toBe('SUPERSEDED');
    persisted.messages[0].state = 'SENT'; persisted.messages[0].sentAt = now.toISOString();
    persisted = JSON.parse(JSON.stringify(persisted));
    enqueuePaperHealth(persisted, 'STALE', new Date(now.getTime() + 10 * 60_000), view);
    expect(persisted.messages[1].nextAttemptAt).toBe(new Date(now.getTime() + 60 * 60_000).toISOString());
    view.collection = { startedAt: now.toISOString(), lastProgressAt: now.toISOString(), completed: 50, total: 863 };
    enqueuePaperHealth(persisted, 'STALE', new Date(now.getTime() + 11 * 60_000), view);
    expect(persisted.messages[1].message).toContain('수집 50/863종목');
    expect(persisted.messages[1].nextAttemptAt).toBe(new Date(now.getTime() + 60 * 60_000).toISOString());
  });
  it('keeps startup grace from reporting a false recovery', () => {
    expect(classifyPaperBotHealth(undefined, false, monday, monday.getTime() - 60_000, 'STALE')).toBe('STALE');
    expect(classifyPaperBotHealth(undefined, false, monday, 0)).toBe('UNAVAILABLE');
    expect(classifyPaperBotHealth(view, true, monday, 0)).toBe('PAUSED');
    expect(classifyPaperBotHealth(view, false, monday, 0)).toBe('STALE');
  });
  it('requires a new completion before announcing recovery when the market closes', () => {
    const now = new Date('2026-09-18T15:20:00+09:00');
    persisted = emptyState();
    scanAt('2026-09-18T15:00:00+09:00');
    enqueuePaperHealth(persisted, 'STALE', now, view);
    persisted.messages[0].state = 'SENT'; persisted.notifiedHealth = 'STALE';
    enqueuePaperHealth(persisted, 'OK', new Date('2026-09-18T15:31:00+09:00'), view);
    expect(persisted.messages).toHaveLength(1);
    scanAt('2026-09-18T15:32:00+09:00');
    enqueuePaperHealth(persisted, 'OK', new Date('2026-09-18T15:33:00+09:00'), view);
    expect(persisted.messages).toHaveLength(2);
    expect(persisted.messages[1].health).toBe('OK');
  });
  it('delivers a persistent weekend failure after confirmation, then exactly one recovery', async () => {
    const now = new Date(Math.max(Date.now() + 3_600_000, Date.parse('2026-10-10T12:00:00+09:00')));
    persisted = emptyState();
    scanAt(new Date(now.getTime() - 61 * 60_000).toISOString());
    await runPaperBotTick(now);
    expect(mocks.send).not.toHaveBeenCalled();
    await runPaperBotTick(new Date(now.getTime() + 5 * 60_000));
    expect(persisted.messages.filter(item => item.kind === 'health' && item.state === 'SENT')).toHaveLength(1);
    scanAt(new Date(now.getTime() + 6 * 60_000).toISOString());
    await runPaperBotTick(new Date(now.getTime() + 6 * 60_000));
    await runPaperBotTick(new Date(now.getTime() + 7 * 60_000));
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(persisted.notifiedHealth).toBe('OK');
  });
  it('supersedes an undelivered failure and sends recovery only for a delivered incident', () => {
    persisted = emptyState();
    enqueuePaperHealth(persisted, 'STALE', monday); enqueuePaperHealth(persisted, 'STALE', monday);
    expect(persisted.messages).toHaveLength(1);
    enqueuePaperHealth(persisted, 'OK', new Date(monday.getTime() + 60_000));
    expect(persisted.messages).toHaveLength(1); expect(persisted.messages[0].state).toBe('SUPERSEDED');
    persisted.health = 'STALE'; persisted.notifiedHealth = 'STALE';
    enqueuePaperHealth(persisted, 'OK', new Date(monday.getTime() + 120_000));
    expect(persisted.messages[1].message).toContain('복구');
  });
});

describe('signal and learning linkage', () => {
  it('keeps all events in bounded channel batches and freezes their evidence', () => {
    const strategy = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);
    const template = strategy.trades[0];
    const now = new Date('2026-09-18T01:01:00Z');
    persisted.initializedAt = '2026-09-18T00:00:00Z';
    view.strategy = buildPaperStrategyView(strategy);
    view.strategy.trades = Array.from({ length: 23 }, (_, index) => ({ ...structuredClone(template), id: `signal-${index}`, symbol: `1000${String(index).padStart(2, '0')}`, name: '<&>'.repeat(40) }));
    const before = structuredClone(view.strategy.trades);
    enqueuePaperTradeChanges(persisted, view, now);
    expect(persisted.messages).toHaveLength(10);
    expect(Object.keys(persisted.seenEvents)).toHaveLength(23);
    for (const channel of ['TRADE', 'ANALYSIS']) {
      const messages = persisted.messages.filter(item => item.channel === channel);
      for (const trade of view.strategy.trades) expect(messages.filter(item => item.message.includes(trade.symbol))).toHaveLength(1);
      for (const item of messages) expect(item.message.length).toBeLessThan(3800);
    }
    expect(view.strategy.trades).toEqual(before);
    expect(persisted.messages[1].message).toContain('12건 · 3개 진입일');
    expect(persisted.messages[1].message).toContain('D3 평균 순수익률 +9.00%');
    enqueuePaperTradeChanges(persisted, view, now);
    expect(persisted.messages).toHaveLength(10);
    const longView = structuredClone(view);
    for (const trade of longView.strategy!.trades) {
      trade.entryObservation.news = [{ id: 'long-news', headline: '&'.repeat(70), source: 'DART', observedAt: trade.entryAt }];
      trade.exit = { decisionAt: now.toISOString(), netReturnPct: -2 } as NonNullable<typeof trade.exit>;
    }
    const longState = emptyState(); longState.initializedAt = persisted.initializedAt;
    enqueuePaperTradeChanges(longState, longView, now);
    expect(Object.keys(longState.seenEvents)).toHaveLength(46);
    for (const channel of ['TRADE', 'ANALYSIS']) {
      const messages = longState.messages.filter(item => item.channel === channel);
      for (const trade of longView.strategy!.trades) {
        const body = messages.map(item => item.message).join('');
        expect(body.split(`(${trade.symbol})`).length - 1).toBe(2);
      }
      for (const item of messages) expect(item.message.length).toBeLessThanOrEqual(3500);
    }
  });
  it('pairs an exit with the original entry evidence instead of current research', () => {
    const trade = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost).trades[0];
    trade.exit = { decisionAt: '2026-09-23T07:00:00Z', effectiveAt: '2026-09-23T06:30:00Z', netReturnPct: -2 } as NonNullable<typeof trade.exit>;
    const text = formatPaperTradeAnalysis([paperTradeEvents([trade])[1]]);
    expect(text).toContain('청산 복기');
    expect(text).toContain('D3 평균 순수익률 +9.00%');
    expect(text).toContain('해당 시그널 청산 순수익률 -2.00%');
    expect(text).toContain('005930 · 2026-09-18');
    expect(formatPaperBotStatus(persisted)).toContain('signal: 진입·청산');
  });
});
