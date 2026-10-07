// @responsibility Verify durable research notification scheduling.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperAdaptiveState } from '../../src/types/paperAdaptive.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import { buildPaperStrategyView } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger } from '../trading/paper/paperStrategyFixtures.js';
import { matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { buildPaperAccountView, createPaperAccount } from '../trading/paper/paperAccount.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), view: vi.fn(), send: vi.fn(), paused: vi.fn(), account: vi.fn() }));
vi.mock('./globalNewsRuntime.js', () => ({ maintainGlobalMorningNews: () => undefined, getGlobalMorningMessage: () => null }));
vi.mock('../trading/paper/paperMorningRuntime.js', () => ({ getOrCreatePaperMorningReport: () => null, reconcilePaperMorningDelivery: () => undefined,
  getPaperMorningReviewSafely: () => ({ report: null, results: [], asOf: '2026-09-18T07:10:00Z' }) }));
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: mocks.send }));
vi.mock('./alertRouter.js', async () => ({ ...(await import('./alertCategories.js')), dispatchAlert: mocks.send }));
vi.mock('../persistence/paperBotRepo.js', () => ({ loadPaperBotState: mocks.load, savePaperBotState: mocks.save }));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../trading/paper/paperAccountRuntime.js', () => ({ readVirtualAccount: mocks.account }));
vi.mock('../state.js', () => ({ getTradingMode: () => 'SHADOW', getAutoTradePaused: mocks.paused }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: () => [] }));
vi.mock('../persistence/dartRepo.js', () => ({ loadDartAlerts: () => [] }));
import { enqueuePaperReports, enqueuePaperResearchChanges, runPaperBotTick } from './paperBot.js';
import { formatAccountSummary } from './paperAccountMessages.js';

const morning = new Date('2026-09-18T10:30:00+09:00');
const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), morning.toISOString());
let state: PaperBotState;
let view: PaperExperimentView;
function scanAt(now: Date) {
  view.lastRun = { snapshotId: 'scan', asOf: now.toISOString(), candidateCount: 2, observedCount: 2,
    missingPriceCount: 0, openedCount: 0, completedCount: 0, marketOpen: true, issues: [] };
  view.strategy!.lastRun = { snapshotId: 'scan', asOf: now.toISOString(), openedCount: 0, closedCount: 0, waitingCount: 2, holdingCount: 0 };
}
/** A started account last evaluated at `at`; a resent summary shows the time it was rebuilt. */
function accountAt(at: Date) {
  const account = createPaperAccount({ initialCash: 10_000_000, maxPositionPct: 20, includeExploration: false }, '2026-09-17T00:00:00Z', 'research-account');
  account.lastSnapshotAt = at.toISOString();
  return buildPaperAccountView(account, at.toISOString());
}
function reports(now: Date, options: { paused?: boolean } = {}) {
  enqueuePaperReports(state, view, now, { account: accountAt(now), ...options });
}
function change(at: Date, bucket = 0): PaperAdaptiveState['changes'][number] {
  return { at: at.toISOString(), feature: 'rsi14', from: null, to: { feature: 'rsi14', bucket, horizon: 3 }, reason: 'ACTIVE' };
}
beforeEach(() => {
  // Reset queued one-shot transport results so one failing test cannot leak into the next.
  vi.resetAllMocks();
  state = { schemaVersion: 1, initializedAt: '2026-09-17T00:00:00Z', lastCheckedAt: null,
    health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [] };
  view = { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 0, completedCount: 0,
    openCount: 0, experiments: [], groups: [], outcomes: [], lastRun: null,
    strategy: { ...buildPaperStrategyView(emptyStrategyLedger()), adaptive: { ...structuredClone(adaptive), changes: [] } } };
  scanAt(morning);
  mocks.load.mockImplementation(() => structuredClone(state));
  mocks.save.mockImplementation(saved => { state = structuredClone(saved); });
  mocks.view.mockImplementation(() => view);
  mocks.send.mockResolvedValue(123);
  mocks.paused.mockReturnValue(false);
  mocks.account.mockImplementation((now: Date) => accountAt(now));
});

describe('intraday content slots', () => {
  it('accepts the configured broad-scan gap but waits beyond its grace window', () => {
    view.scanIntervalSeconds = 600;
    scanAt(new Date(morning.getTime() - 14 * 60_000));
    reports(morning);
    expect(state.messages.some(item => item.kind === 'intraday')).toBe(true);
    state.messages = [];
    scanAt(new Date(morning.getTime() - 16 * 60_000));
    reports(morning);
    expect(state.messages).toEqual([]);
  });
  it('accepts a completed price-monitor update following a fresh broad scan', () => {
    view.strategy!.lastRun!.snapshotId = 'paper_prices_test';
    view.priceMonitor = { intervalSeconds: 30, running: false, marketOpen: true,
      startedAt: morning.toISOString(), completedAt: morning.toISOString(), durationMs: 10,
      checkedCount: 1, validCount: 1, closedCount: 0, heldCount: 1, staleCount: 0, oldestQuoteAt: morning.toISOString() };
    reports(morning);
    expect(state.messages.some(item => item.kind === 'intraday')).toBe(true);
  });
  it('keeps independent morning/afternoon IDs across repeats and restarts', () => {
    reports(morning);
    reports(new Date(morning.getTime() + 60_000));
    const afternoon = new Date('2026-09-18T13:30:00+09:00'); scanAt(afternoon);
    state = structuredClone(state); reports(afternoon);
    expect(state.messages.map(item => item.id)).toEqual(['paper:intraday:2026-09-18:630', 'paper:intraday:2026-09-18:810']);
    expect(state.messages.every(item => item.channel === 'ANALYSIS' && item.kind === 'intraday')).toBe(true);
    expect(state.messages[0].expiresAt).toBe(new Date('2026-09-18T11:15:00+09:00').toISOString());
    expect(state.messages.every(item => item.message.length <= 3500)).toBe(true);
  });
  it.each(['stale', 'future', 'mismatched', 'error', 'off-hours', 'paused'] as const)('waits for usable current evidence without consuming the slot: %s', condition => {
    if (condition === 'stale') view.strategy!.lastRun!.asOf = new Date(morning.getTime() - 11 * 60_000).toISOString();
    if (condition === 'future') view.lastRun!.asOf = new Date(morning.getTime() + 60_000).toISOString();
    if (condition === 'mismatched') view.strategy!.lastRun!.snapshotId = 'prior-scan';
    if (condition === 'error') view.strategy!.error = 'missing';
    if (condition === 'off-hours') view.lastRun!.marketOpen = false;
    reports(morning, { paused: condition === 'paused' });
    expect(state.messages).toEqual([]);
    delete view.strategy!.error; scanAt(morning);
    reports(morning);
    expect(state.messages).toHaveLength(1);
  });
  it('sends the signal check before a virtual account starts, but never guesses for an unreadable account', () => {
    enqueuePaperReports(state, view, morning);
    enqueuePaperReports(state, view, morning, { account: { ...accountAt(morning), error: '가상 계좌 처리 실패' } });
    expect(state.messages).toEqual([]);
    enqueuePaperReports(state, view, morning, { account: buildPaperAccountView(null, morning.toISOString()) });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: 'paper:intraday:2026-09-18:630', channel: 'ANALYSIS' });
    expect(state.messages[0].message).toContain('Shadow 장중 점검 · 2026-09-18');
    expect(state.messages[0].message).not.toContain('가상 계좌 운용 요약');
  });
  it('switches a retried signal check to the account summary once the account starts', async () => {
    mocks.account.mockImplementation((now: Date) => buildPaperAccountView(null, now.toISOString()));
    mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(morning);
    const original = state.messages.find(item => item.kind === 'intraday')!;
    expect(original).toMatchObject({ state: 'PENDING', attempts: 1 });
    expect(original.message).toContain('Shadow 장중 점검');
    mocks.account.mockImplementation((now: Date) => accountAt(now));
    const resumed = new Date(morning.getTime() + 2 * 60_000); scanAt(resumed);
    await runPaperBotTick(resumed);
    expect(state.messages.find(item => item.id === original.id)).toMatchObject({ state: 'SENT', attempts: 2,
      message: formatAccountSummary(accountAt(resumed), resumed) });
  });
  it.each(['2026-09-18T11:15:00+09:00', '2026-09-19T10:30:00+09:00', '2026-12-25T13:30:00+09:00'])('does not invent a report outside its trading-day window: %s', at => {
    const now = new Date(at); scanAt(now); reports(now);
    expect(state.messages).toEqual([]);
  });
  it('publishes weekly autonomous research even when historical reconstruction is absent', () => {
    const now = new Date('2026-09-20T19:00:00+09:00');
    enqueuePaperReports(state, view, now);
    expect(state.messages[0]).toMatchObject({ kind: 'weekly', channel: 'SYSTEM' });
    expect(state.messages[0].message).toContain('자율');
  });
  it.each(['stale', 'paused'] as const)('holds a previously failed delivery while %s, then sends fresh content under its original ID', async condition => {
    mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(morning);
    const original = state.messages.find(item => item.kind === 'intraday')!;
    expect(original).toMatchObject({ state: 'PENDING', attempts: 1 });
    const later = new Date(morning.getTime() + 11 * 60_000);
    if (condition === 'paused') { scanAt(later); mocks.paused.mockReturnValue(true); }
    await runPaperBotTick(later);
    expect(state.messages.find(item => item.id === original.id)).toMatchObject({ state: 'PENDING', attempts: 1 });
    const resumed = new Date(later.getTime() + 60_000); scanAt(resumed); mocks.paused.mockReturnValue(false);
    await runPaperBotTick(resumed);
    const delivered = state.messages.find(item => item.id === original.id)!;
    expect(delivered).toMatchObject({ state: 'SENT', attempts: 2, messageId: 123 });
    // Resent content is rebuilt from the account read at delivery time, not replayed from the failed attempt.
    expect(delivered.message).toBe(formatAccountSummary(accountAt(resumed), resumed));
    expect(delivered.message).not.toBe(original.message);
    expect(state.messages.filter(item => item.kind === 'intraday')).toHaveLength(1);
  });
  it('expires a paused pending slot instead of replaying it after lunch', async () => {
    mocks.send.mockResolvedValueOnce(undefined); await runPaperBotTick(morning);
    mocks.paused.mockReturnValue(true);
    await runPaperBotTick(new Date('2026-09-18T11:15:00+09:00'));
    expect(state.messages.find(item => item.kind === 'intraday')).toMatchObject({ state: 'EXPIRED', attempts: 1 });
  });
});

describe('research change lifecycle', () => {
  it('silently baselines existing history on upgrade, then preserves new events across retries and restarts', async () => {
    view.strategy!.adaptive!.changes = [change(morning)];
    await runPaperBotTick(morning);
    expect(state.researchInitializedAt).toBe(morning.toISOString());
    expect(state.messages.filter(item => item.kind === 'research')).toEqual([]);
    const later = new Date(morning.getTime() + 60_000); scanAt(later);
    view.strategy!.adaptive!.evaluatedAt = later.toISOString();
    view.strategy!.adaptive!.changes.push(change(later, 1));
    mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(later);
    const pending = state.messages.find(item => item.kind === 'research')!;
    expect(pending).toMatchObject({ channel: 'SYSTEM', state: 'PENDING', attempts: 1 });
    expect(pending.messageId).toBeUndefined();
    await runPaperBotTick(new Date(later.getTime() + 60_000));
    expect(state.messages.find(item => item.id === pending.id)).toMatchObject({ state: 'SENT', attempts: 2, messageId: 123 });
    await runPaperBotTick(new Date(later.getTime() + 120_000));
    expect(state.messages.filter(item => item.kind === 'research')).toHaveLength(1);
  });
  it('notifies the first actual research after a healthy empty state', () => {
    const saved = view.strategy!.adaptive!; delete view.strategy!.adaptive;
    enqueuePaperResearchChanges(state, view, morning);
    expect(state.researchInitializedAt).toBe(morning.toISOString());
    view.strategy!.adaptive = saved; saved.changes = [change(morning)];
    enqueuePaperResearchChanges(state, view, morning);
    expect(state.messages).toHaveLength(1);
  });
  it('batches distinct changes without losing or repeating an event', () => {
    state.researchInitializedAt = new Date(morning.getTime() - 60_000).toISOString();
    view.strategy!.adaptive!.changes = [0, 1, 2, 3].map(bucket => change(morning, bucket));
    enqueuePaperResearchChanges(state, view, morning);
    enqueuePaperResearchChanges(state, structuredClone(view), morning);
    expect(state.messages).toHaveLength(2);
    expect(state.messages.every(item => item.message.length <= 3500 && item.channel === 'SYSTEM')).toBe(true);
    expect(Object.keys(state.seenEvents)).toHaveLength(4);
  });
  it('does not consume failed or future research, and ignores backfilled history', () => {
    view.strategy!.error = 'bad'; enqueuePaperResearchChanges(state, view, morning);
    expect(state.researchInitializedAt).toBeUndefined();
    delete view.strategy!.error;
    view.strategy!.adaptive!.evaluatedAt = new Date(morning.getTime() + 60_000).toISOString();
    enqueuePaperResearchChanges(state, view, morning); expect(state.researchInitializedAt).toBeUndefined();
    view.strategy!.adaptive!.evaluatedAt = morning.toISOString();
    enqueuePaperResearchChanges(state, view, morning);
    view.strategy!.adaptive!.changes = [change(new Date(morning.getTime() - 60_000)), change(new Date(morning.getTime() + 60_000))];
    enqueuePaperResearchChanges(state, view, morning); expect(state.messages).toEqual([]);
    expect(Object.keys(state.seenEvents)).toHaveLength(1);
  });
});
