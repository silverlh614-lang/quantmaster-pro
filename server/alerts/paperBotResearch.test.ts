// @responsibility Verify durable research notification scheduling.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperAdaptiveState } from '../../src/types/paperAdaptive.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import { buildPaperStrategyView } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger } from '../trading/paper/paperStrategyFixtures.js';
import { matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), view: vi.fn(), send: vi.fn(), paused: vi.fn() }));
vi.mock('./globalNewsRuntime.js', () => ({ maintainGlobalMorningNews: () => undefined, getGlobalMorningMessage: () => null }));
vi.mock('../trading/paper/paperMorningRuntime.js', () => ({ getOrCreatePaperMorningReport: () => null, reconcilePaperMorningDelivery: () => undefined,
  getPaperMorningReviewSafely: () => ({ report: null, results: [], asOf: '2026-09-18T07:10:00Z' }) }));
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: mocks.send }));
vi.mock('./alertRouter.js', async () => ({ ...(await import('./alertCategories.js')), dispatchAlert: mocks.send }));
vi.mock('../persistence/paperBotRepo.js', () => ({ loadPaperBotState: mocks.load, savePaperBotState: mocks.save }));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../state.js', () => ({ getTradingMode: () => 'SHADOW', getAutoTradePaused: mocks.paused }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: () => [] }));
vi.mock('../persistence/dartRepo.js', () => ({ loadDartAlerts: () => [] }));
import { enqueuePaperReports, enqueuePaperResearchChanges, runPaperBotTick } from './paperBot.js';

const morning = new Date('2026-09-18T10:30:00+09:00');
const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), morning.toISOString());
let state: PaperBotState;
let view: PaperExperimentView;
function scanAt(now: Date) {
  view.lastRun = { snapshotId: 'scan', asOf: now.toISOString(), candidateCount: 2, observedCount: 2,
    missingPriceCount: 0, openedCount: 0, completedCount: 0, marketOpen: true, issues: [] };
  view.strategy!.lastRun = { snapshotId: 'scan', asOf: now.toISOString(), openedCount: 0, closedCount: 0, waitingCount: 2, holdingCount: 0 };
}
function change(at: Date, bucket = 0): PaperAdaptiveState['changes'][number] {
  return { at: at.toISOString(), feature: 'rsi14', from: null, to: { feature: 'rsi14', bucket, horizon: 3 }, reason: 'ACTIVE' };
}
beforeEach(() => {
  vi.clearAllMocks();
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
});

describe('intraday content slots', () => {
  it('keeps independent morning/afternoon IDs across repeats and restarts', () => {
    enqueuePaperReports(state, view, morning);
    enqueuePaperReports(state, view, new Date(morning.getTime() + 60_000));
    const afternoon = new Date('2026-09-18T13:30:00+09:00'); scanAt(afternoon);
    state = structuredClone(state); enqueuePaperReports(state, view, afternoon);
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
    enqueuePaperReports(state, view, morning, { paused: condition === 'paused' });
    expect(state.messages).toEqual([]);
    delete view.strategy!.error; scanAt(morning);
    enqueuePaperReports(state, view, morning);
    expect(state.messages).toHaveLength(1);
  });
  it.each(['2026-09-18T11:15:00+09:00', '2026-09-19T10:30:00+09:00', '2026-12-25T13:30:00+09:00'])('does not invent a report outside its trading-day window: %s', at => {
    const now = new Date(at); scanAt(now); enqueuePaperReports(state, view, now);
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
    expect(delivered.message).toContain('10:42');
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
