// @responsibility Verify Shadow bot schedules, recovery, delivery tracking.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestSnapshot, strategyTestCost } from '../trading/paper/paperStrategyFixtures.js';

const mocks = vi.hoisted(() => ({ send: vi.fn(), load: vi.fn(), save: vi.fn(), view: vi.fn(), mode: vi.fn(), paused: vi.fn(), news: vi.fn() }));
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: mocks.send }));
vi.mock('../persistence/paperBotRepo.js', () => ({ loadPaperBotState: mocks.load, savePaperBotState: mocks.save }));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../state.js', () => ({ getTradingMode: mocks.mode, getAutoTradePaused: mocks.paused }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: mocks.news }));
vi.mock('../persistence/dartRepo.js', () => ({ loadDartAlerts: () => [] }));
import { classifyPaperBotHealth, enqueuePaperHealth, enqueuePaperReports, enqueuePaperTradeChanges, runPaperBotTick } from './paperBot.js';
import { formatPaperReport, formatPaperTrades, paperTradeEvents } from './paperBotMessages.js';

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
  mocks.mode.mockReturnValue('SHADOW'); mocks.paused.mockReturnValue(false); mocks.news.mockReturnValue([]); mocks.send.mockResolvedValue(101);
});

describe('KST report slots', () => {
  it('uses Monday in Korea even on UTC Sunday and survives a restart without resending', async () => {
    await runPaperBotTick(monday);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(persisted.messages[0]).toMatchObject({ id: 'paper:morning:2026-09-14', state: 'SENT', messageId: 101 });
    await runPaperBotTick(new Date(monday.getTime() + 60_000));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.news).toHaveBeenCalledTimes(1);
  });
  it.each(['2026-09-14T08:44:00+09:00', '2026-09-14T09:30:00+09:00', '2026-09-19T08:45:00+09:00', '2026-12-25T08:45:00+09:00'])('does not enqueue outside the slot or on a closed market: %s', at => {
    enqueuePaperReports(persisted, view, new Date(at)); expect(persisted.messages).toEqual([]);
  });
  it('catches up a missed close within the grace window, only once', () => {
    enqueuePaperReports(persisted, view, new Date('2026-09-14T18:00:00+09:00'));
    enqueuePaperReports(persisted, view, new Date('2026-09-14T18:01:00+09:00'));
    expect(persisted.messages).toHaveLength(1); expect(persisted.messages[0].kind).toBe('close');
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
    expect(persisted.messages).toHaveLength(1); expect(persisted.messages[0].message).toContain('&lt;A&amp;B&gt;');
    next.exit = { decisionAt: '2026-09-18T01:02:00Z', effectiveAt: '2026-09-17T06:30:00Z', netReturnPct: 0 } as NonNullable<typeof next.exit>;
    enqueuePaperTradeChanges(persisted, view, new Date('2026-09-18T01:03:00Z'));
    expect(persisted.messages).toHaveLength(2); expect(persisted.messages[1].message).toContain('순수익률 0.00%');
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
  it('keeps startup grace from reporting a false recovery', () => {
    expect(classifyPaperBotHealth(undefined, false, monday, monday.getTime() - 60_000, 'STALE')).toBe('STALE');
    expect(classifyPaperBotHealth(undefined, false, monday, 0)).toBe('UNAVAILABLE');
    expect(classifyPaperBotHealth(view, true, monday, 0)).toBe('PAUSED');
    expect(classifyPaperBotHealth(view, false, monday, 0)).toBe('STALE');
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
