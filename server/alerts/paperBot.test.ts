// @responsibility Verify Shadow bot schedules, recovery, delivery tracking.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';
import type { PaperMorningReport } from '../../src/types/paperMorning.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost } from '../trading/paper/paperStrategyFixtures.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';

const mocks = vi.hoisted(() => ({ send: vi.fn(), load: vi.fn(), save: vi.fn(), view: vi.fn(), mode: vi.fn(), paused: vi.fn(), news: vi.fn(), morning: vi.fn(), maintain: vi.fn(), recommendation: vi.fn(), reconcile: vi.fn() }));
vi.mock('./globalNewsRuntime.js', () => ({ maintainGlobalMorningNews: mocks.maintain, getGlobalMorningMessage: mocks.morning }));
vi.mock('../trading/paper/paperMorningRuntime.js', () => ({ getOrCreatePaperMorningReport: mocks.recommendation, reconcilePaperMorningDelivery: mocks.reconcile,
  getPaperMorningReviewSafely: () => ({ report: null, results: [], asOf: '2026-09-18T07:10:00Z' }) }));
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: mocks.send }));
vi.mock('./alertRouter.js', async () => ({ ...(await import('./alertCategories.js')), dispatchAlert: mocks.send }));
vi.mock('../persistence/paperBotRepo.js', () => ({ loadPaperBotState: mocks.load, savePaperBotState: mocks.save }));
vi.mock('../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../trading/paper/paperAccountRuntime.js', () => ({ readVirtualAccount: () => ({ account: null }) }));
vi.mock('../state.js', () => ({ getTradingMode: mocks.mode, getAutoTradePaused: mocks.paused }));
vi.mock('../learning/newsSupplyLogger.js', () => ({ loadNewsSupplyRecords: mocks.news }));
vi.mock('../persistence/dartRepo.js', () => ({ loadDartAlerts: () => [] }));
import { classifyPaperBotHealth, enqueuePaperHealth, enqueuePaperReports, runPaperBotTick } from './paperBot.js';
import { formatPaperReport, formatPaperTradeAnalysis, formatPaperBotStatus, paperTradeEvents } from './paperBotMessages.js';

function emptyState(): PaperBotState { return { schemaVersion: 1, initializedAt: null, lastCheckedAt: null, health: 'OK', notifiedHealth: 'OK', seenEvents: {}, messages: [] }; }
function emptyView(): PaperExperimentView { return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 0, completedCount: 0, openCount: 0, experiments: [], groups: [], outcomes: [], lastRun: null, strategy: buildPaperStrategyView(emptyStrategyLedger()) }; }
function enteredStrategy() {
  const snapshot = adaptiveTestSnapshot();
  return evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
    selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf));
}
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
  mocks.recommendation.mockReset().mockReturnValue(null); mocks.reconcile.mockReset();
  mocks.mode.mockReturnValue('SHADOW'); mocks.paused.mockReturnValue(false); mocks.news.mockReturnValue([]); mocks.send.mockResolvedValue(101);
});

function morningReport(date: string): PaperMorningReport {
  const at = new Date(`${date}T08:30:00+09:00`).toISOString();
  return { version: 'morning-recommendation-v1', id: `morning:${date}`, tradingDate: date,
    scheduledAt: at, createdAt: at, status: 'NO_MATCH', reason: '조건 일치 없음',
    sourceSnapshotId: 'morning-scan', sourceAsOf: at, adaptiveEvaluatedAt: at, adaptiveCutoffAt: at,
    consideredCount: 100, matchedCount: 0, heldCount: 0, picks: [], message: `고정 아침 추천 ${date}` };
}

describe('daily archived morning recommendations', () => {
  it('sends the 08:30 holiday research report while scheduled price scanning is suspended', async () => {
    persisted = emptyState(); view.scanIntervalSeconds = null;
    const report = { ...morningReport('2026-10-05'), status: 'HOLIDAY' as const, message: '휴장일 연구 현황 · 저장된 연구 결과' };
    mocks.recommendation.mockReturnValue(report);
    await runPaperBotTick(new Date(report.createdAt));
    await runPaperBotTick(new Date(Date.parse(report.createdAt) + 60_000));
    expect(persisted.health).toBe('OK');
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({ kind: 'recommendation', state: 'SENT', message: report.message });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.maintain).toHaveBeenCalledTimes(2);
  });
  it.each(['2026-09-21', '2026-09-26', '2026-12-25'])('delivers once at 08:30 even on a closed day: %s', async date => {
    const report = morningReport(date), at = new Date(report.createdAt);
    mocks.recommendation.mockReturnValue(report);
    await runPaperBotTick(new Date(at.getTime() - 60_000));
    expect(mocks.recommendation).not.toHaveBeenCalled();
    await runPaperBotTick(at);
    const message = persisted.messages.find(item => item.kind === 'recommendation');
    expect(message).toMatchObject({ id: `paper:recommendation:${date}`, channel: 'ANALYSIS', state: 'SENT', message: report.message, messageId: 101 });
    expect(mocks.send).toHaveBeenCalledWith('ANALYSIS', report.message, expect.objectContaining({ cooldownMs: 0, delivery: 'immediate' }));
    expect(mocks.reconcile).toHaveBeenCalledWith(date, message!.sentAt, 101);
    expect(Date.parse(message!.sentAt!)).toBeGreaterThanOrEqual(at.getTime());
    await runPaperBotTick(new Date(at.getTime() + 60_000));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.recommendation).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });
  it('retains the news slot and freezes the archived recommendation through retry before 09:00', async () => {
    const report = morningReport('2026-09-22'), at = new Date('2026-09-22T08:45:00+09:00');
    mocks.recommendation.mockReturnValue(report); mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(at);
    expect(persisted.messages.map(item => [item.kind, item.state])).toEqual([['recommendation', 'PENDING'], ['morning', 'SENT']]);
    mocks.recommendation.mockReturnValue({ ...report, message: '변경된 최신 추천' });
    await runPaperBotTick(new Date(persisted.messages.find(item => item.kind === 'recommendation')!.nextAttemptAt));
    expect(mocks.send.mock.calls.filter(call => call[0] === 'ANALYSIS').map(call => call[1])).toEqual([report.message, report.message]);
    expect(mocks.recommendation).toHaveBeenCalledTimes(1);
  });
  it('prioritizes recommendation retries ahead of an existing trade backlog', async () => {
    const report = morningReport('2026-09-23'), at = new Date(report.createdAt);
    persisted.messages = Array.from({ length: 5 }, (_, index) => ({ id: `paper:account:older-trade-${index}`, kind: 'trades' as const,
      channel: undefined, message: `매매 ${index}`, createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + 3_600_000).toISOString(),
      state: 'PENDING' as const, attempts: 0, nextAttemptAt: at.toISOString() }));
    mocks.recommendation.mockReturnValue(report); mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(at);
    expect(mocks.send.mock.calls[0][1]).toBe(report.message);
    expect(mocks.send).toHaveBeenCalledTimes(3);
    await runPaperBotTick(new Date(persisted.messages.find(item => item.kind === 'recommendation')!.nextAttemptAt));
    expect(mocks.send.mock.calls[3][1]).toBe(report.message);
    expect(persisted.messages.find(item => item.kind === 'recommendation')).toMatchObject({ state: 'SENT', attempts: 2 });
  });
  it('does not resend after archive acknowledgment fails and recovers from the persisted SENT outbox', async () => {
    const report = morningReport('2026-09-24'), at = new Date(report.createdAt);
    mocks.recommendation.mockReturnValue(report);
    mocks.reconcile.mockImplementationOnce(() => {
      expect(persisted.messages.find(item => item.kind === 'recommendation')).toMatchObject({ state: 'SENT', messageId: 101 });
      throw new Error('archive temporarily unavailable');
    });
    await runPaperBotTick(at);
    expect(persisted.messages[0]).toMatchObject({ state: 'SENT', error: '추천 발송 확인의 영구 보관 갱신 실패' });
    expect(formatPaperBotStatus(persisted)).toContain('추천 발송 성공 · 영구 보관의 발송 확인 갱신 필요');
    vi.resetModules();
    const restarted = await import('./paperBot.js');
    await restarted.runPaperBotTick(new Date(at.getTime() + 60_000));
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(persisted.messages[0].error).toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await restarted.runPaperBotTick(new Date(at.getTime() + 120_000));
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  });
  it('uses archived confirmed delivery without sending again after the outbox is restored separately', async () => {
    const report = morningReport('2026-09-25'), at = new Date(report.createdAt);
    report.delivery = { sentAt: at.toISOString(), messageId: 999 };
    mocks.recommendation.mockReturnValue(report);
    await runPaperBotTick(new Date(at.getTime() + 60_000));
    expect(persisted.messages[0]).toMatchObject({ state: 'SENT', messageId: 999, sentAt: report.delivery.sentAt });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('preserves an unarchived SENT acknowledgment beyond fourteen days and recovers it after restart without resending', async () => {
    const sentAt = '2026-08-31T08:30:10+09:00', id = 'paper:recommendation:2026-08-31';
    persisted.messages = [{ id, kind: 'recommendation', message: '영구 보관할 추천 원문',
      createdAt: '2026-08-31T08:30:00+09:00', expiresAt: '2026-08-31T09:00:00+09:00',
      state: 'SENT', attempts: 1, nextAttemptAt: sentAt, sentAt, messageId: 701 }];
    persisted.messages.push({ ...persisted.messages[0], id: 'old-news', kind: 'morning' });
    mocks.reconcile.mockImplementationOnce(() => { throw new Error('archive remains unavailable'); });
    await runPaperBotTick(new Date('2026-09-18T12:00:00+09:00'));
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({ id, state: 'SENT', sentAt, messageId: 701,
      message: '영구 보관할 추천 원문', error: '추천 발송 확인의 영구 보관 갱신 실패' });
    vi.resetModules();
    const restarted = await import('./paperBot.js');
    await restarted.runPaperBotTick(new Date('2026-09-19T12:00:00+09:00'));
    expect(mocks.reconcile.mock.calls).toEqual([['2026-08-31', sentAt, 701], ['2026-08-31', sentAt, 701]]);
    expect(persisted.messages).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('reports unavailable data without a view and isolates archive failure from the news report', async () => {
    const report = morningReport('2026-09-28'), at = new Date('2026-09-28T08:45:00+09:00');
    report.status = 'DATA_UNAVAILABLE'; report.message = '추천 판단 자료 미확인';
    mocks.view.mockImplementation(() => { throw new Error('view unavailable'); });
    mocks.recommendation.mockReturnValue(report);
    await runPaperBotTick(at);
    expect(mocks.recommendation).toHaveBeenCalledWith(undefined, at, false);
    expect(persisted.messages.find(item => item.kind === 'recommendation')).toMatchObject({ state: 'SENT', message: report.message });
    expect(persisted.messages.find(item => item.kind === 'morning')?.state).toBe('SENT');
    const state = emptyState();
    enqueuePaperReports(state, view, at, { morning: mocks.morning, recommendation: () => { throw new Error('archive write failed'); } });
    expect(state.messages.map(item => item.kind)).toEqual(['morning']);
  });
  it('expires an undelivered recommendation at 09:00 and never backfills a new one after the slot', async () => {
    const report = morningReport('2026-09-29');
    mocks.recommendation.mockReturnValue(report); mocks.send.mockResolvedValueOnce(undefined);
    await runPaperBotTick(new Date('2026-09-29T08:59:00+09:00'));
    const sentBefore = mocks.send.mock.calls.length;
    await runPaperBotTick(new Date('2026-09-29T09:00:00+09:00'));
    expect(persisted.messages.find(item => item.kind === 'recommendation')?.state).toBe('EXPIRED');
    expect(mocks.send).toHaveBeenCalledTimes(sentBefore);
    const state = emptyState(), generate = vi.fn(() => report);
    enqueuePaperReports(state, undefined, new Date('2026-09-30T09:00:00+09:00'), { recommendation: generate });
    expect(generate).not.toHaveBeenCalled(); expect(state.messages).toEqual([]);
  });
  it('records the actual late acknowledgment time instead of backdating delivery before a possible entry', async () => {
    const report = morningReport('2026-09-30'), at = new Date('2026-09-30T08:59:00+09:00');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(at.getTime());
    try {
      mocks.recommendation.mockReturnValue(report); mocks.morning.mockReturnValue(null);
      mocks.send.mockImplementationOnce(async () => { clock.mockReturnValue(at.getTime() + 120_000); return 801; });
      await runPaperBotTick(at);
      const sentAt = new Date('2026-09-30T09:01:00+09:00').toISOString();
      expect(persisted.messages.find(item => item.kind === 'recommendation')).toMatchObject({ state: 'SENT', messageId: 801, sentAt });
      expect(mocks.reconcile).toHaveBeenCalledWith('2026-09-30', sentAt, 801);
      expect(Date.parse(sentAt)).toBeGreaterThan(Date.parse('2026-09-30T09:00:00+09:00'));
    } finally { clock.mockRestore(); }
  });
  it('sends today’s recommendation before an expired recommendation backlog', async () => {
    const report = morningReport('2026-10-01');
    persisted.messages = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map(date => ({
      id: `paper:recommendation:${date}`, kind: 'recommendation', message: '오래된 추천', createdAt: `${date}T08:30:00+09:00`,
      expiresAt: `${date}T09:00:00+09:00`, state: 'PENDING', attempts: 1, nextAttemptAt: `${date}T08:31:00+09:00`,
    }));
    mocks.recommendation.mockReturnValue(report);
    await runPaperBotTick(new Date(report.createdAt));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][1]).toBe(report.message);
    expect(persisted.messages.find(item => item.id === 'paper:recommendation:2026-10-01')?.state).toBe('SENT');
  });
});

describe('KST report slots', () => {
  it('requests comparisons for a new weekly report, then reuses the archived message without computing them again', async () => {
    view.strategy = buildPaperStrategyView(enteredStrategy());
    const sunday = new Date('2026-09-20T19:00:00+09:00');
    await runPaperBotTick(sunday);
    expect(mocks.view).toHaveBeenLastCalledWith(true, { includeComparisons: true });
    expect(persisted.messages.some(message => message.kind === 'weekly')).toBe(true);
    await runPaperBotTick(new Date(sunday.getTime() + 60_000));
    expect(mocks.view).toHaveBeenLastCalledWith(true, { includeComparisons: false });
    expect(persisted.messages.filter(message => message.kind === 'weekly')).toHaveLength(1);
  });
  it('uses Monday in Korea even on UTC Sunday and survives a restart without resending', async () => {
    await runPaperBotTick(monday);
    expect(mocks.view).toHaveBeenCalledWith(true, { includeComparisons: false });
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
    expect(persisted.messages[0].message).toContain('기본 관측 · 오늘과 누적');
    expect(persisted.messages[0].message).toContain('오늘 장중 대기 사유 미기록');
  });
  it('keeps a previously sent closing summary without rewriting or resending after a format update', () => {
    enqueuePaperReports(persisted, view, new Date('2026-09-14T16:10:00+09:00'));
    const original = persisted.messages[0]; original.state = 'SENT'; original.message = '기존 마감 요약'; original.messageId = 7;
    enqueuePaperReports(persisted, view, new Date('2026-09-14T18:01:00+09:00'));
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
    enqueuePaperReports(persisted, undefined, monday, { morning: mocks.morning });
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
  it('splits open trades by strategy and reports scheduled closes still missing after their date', () => {
    const ledger = enteredStrategy(), legacy = legacyStrategyLedger();
    ledger.trades.push(...legacy.trades);
    const status = (asOf: string) => {
      ledger.lastRun = { ...ledger.lastRun!, asOf };
      return formatPaperReport({ ...emptyView(), strategy: buildPaperStrategyView(ledger) }, 'status', asOf.slice(0, 10));
    };
    expect(buildPaperStrategyView(ledger).openCount).toBe(2);
    expect(status('2026-09-23T07:00:00Z')).toContain('보유 구성: 현행 자율 1 · 구전략 1\n');
    expect(status('2026-09-25T01:00:00Z')).toContain('보유 구성: 현행 자율 1 · 구전략 1 · 예정일 지나 종가 미확인 1건(가장 오래된 예정일 2026-09-23)');
  });


  it('preserves zero performance, missing samples and escaped headlines', () => {
    view.outcomes = [{ horizon: 1, label: 'D1', count: 1, meanNetReturnPct: 0, winRatePct: 0 }, { horizon: 3, label: 'D3', count: 0, meanNetReturnPct: null, winRatePct: null }];
    const text = formatPaperReport(view, 'status', '2026-09-14', ['<b>뉴스 & 공시</b>']);
    expect(text).toContain('D1: 0.00%'); expect(text).toContain('D3: 집계 대기'); expect(text).toContain('&lt;b&gt;뉴스 &amp; 공시&lt;/b&gt;');
  });
});

describe('operational health transitions', () => {
  it('treats intentionally suspended holiday scans as normal without hiding pause or strategy failures', () => {
    const now = new Date('2026-10-05T11:00:00+09:00');
    view.scanIntervalSeconds = null;
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    scanAt('2026-10-02T16:00:00+09:00');
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    expect(classifyPaperBotHealth(view, true, now, 0)).toBe('PAUSED');
    view.strategy!.error = 'unreadable';
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STRATEGY_ERROR');
    expect(classifyPaperBotHealth(view, false, now, now.getTime())).toBe('STRATEGY_ERROR');
    expect(classifyPaperBotHealth(undefined, false, now, 0)).toBe('UNAVAILABLE');
    delete view.strategy!.error;
    expect(classifyPaperBotHealth(view, false, new Date('2026-10-06T11:00:00+09:00'), 0)).toBe('STALE');
  });
  it('still detects stalled manually requested collection during a holiday', () => {
    const now = new Date('2026-10-05T11:00:00+09:00'); view.scanIntervalSeconds = null;
    scanAt('2026-10-05T10:59:00+09:00');
    view.collection = { startedAt: '2026-10-05T10:59:30+09:00', lastProgressAt: '2026-10-05T10:59:30+09:00', completed: 0, total: 0 };
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    expect(classifyPaperBotHealth(view, false, new Date(now.getTime() + 3 * 60_000), now.getTime())).toBe('STALE');
    view.collection = { startedAt: '2026-10-05T10:59:30+09:00', lastProgressAt: '2026-10-05T11:00:00+09:00', completed: 50, total: 100 };
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    expect(classifyPaperBotHealth(view, false, now, 0, 'STALE')).toBe('STALE');
    persisted = emptyState(); enqueuePaperHealth(persisted, 'STALE', now, view);
    expect(persisted.messages[0].message).toContain('휴장일에 실행한 수집의 진행 상태');
    expect(persisted.messages[0].message).not.toContain('60분 넘게');
  });
  it.each(['invalid', '2026-10-06T11:00:00+09:00'])('does not hide a bad holiday observation timestamp: %s', asOf => {
    const now = new Date('2026-10-05T11:00:00+09:00'); view.scanIntervalSeconds = null;
    scanAt(asOf);
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
    expect(classifyPaperBotHealth(view, false, now, now.getTime())).toBe('STALE');
    persisted = emptyState(); enqueuePaperHealth(persisted, 'STALE', now, view);
    expect(persisted.messages[0].message).toContain('마지막 관측 시각을 정상으로 확인할 수 없습니다');
    expect(persisted.messages[0].message).not.toContain('휴장일에 실행한 수집의 진행 상태');
  });
  it('cancels holiday stale retries without claiming recovery and announces a later real completion once', () => {
    const now = new Date('2026-10-05T11:00:00+09:00');
    persisted = emptyState(); scanAt('2026-10-02T16:00:00+09:00');
    enqueuePaperHealth(persisted, 'STALE', new Date('2026-10-02T20:00:00+09:00'), view);
    persisted.messages[0].state = 'SENT'; persisted.notifiedHealth = 'STALE';
    persisted.health = 'OK'; enqueuePaperHealth(persisted, 'STALE', now, view);
    view.scanIntervalSeconds = null;
    enqueuePaperHealth(persisted, 'OK', now, view);
    expect(persisted.health).toBe('OK');
    expect(persisted.notifiedHealth).toBe('STALE');
    expect(persisted.messages.map(item => item.state)).toEqual(['SENT', 'SUPERSEDED']);
    enqueuePaperHealth(persisted, 'OK', new Date(now.getTime() + 60_000), view);
    expect(persisted.messages).toHaveLength(2);
    view.scanIntervalSeconds = 600; scanAt('2026-10-06T09:10:00+09:00');
    enqueuePaperHealth(persisted, 'OK', new Date('2026-10-06T09:11:00+09:00'), view);
    expect(persisted.messages).toHaveLength(3);
    expect(persisted.messages[2]).toMatchObject({ health: 'OK', state: 'PENDING' });
    expect(persisted.messages[2].message).toContain('관측이 다시 갱신');
    enqueuePaperHealth(persisted, 'OK', new Date('2026-10-06T09:12:00+09:00'), view);
    expect(persisted.messages).toHaveLength(3);
  });
  it('preserves holiday grace while allowing the intraday interval plus five minutes', () => {
    const now = new Date('2026-10-04T11:00:00+09:00');
    view.scanIntervalSeconds = 3600;
    scanAt(new Date(now.getTime() - 65 * 60_000).toISOString());
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    scanAt(new Date(now.getTime() - 70 * 60_000).toISOString());
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    scanAt(new Date(now.getTime() - 71 * 60_000).toISOString());
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
    persisted = emptyState(); enqueuePaperHealth(persisted, 'STALE', now, view);
    expect(persisted.messages[0].message).toContain('휴장·장외 70분');
    const open = new Date('2026-09-18T11:00:00+09:00');
    view.scanIntervalSeconds = 600;
    scanAt(new Date(open.getTime() - 14 * 60_000).toISOString());
    expect(classifyPaperBotHealth(view, false, open, 0)).toBe('OK');
    scanAt(new Date(open.getTime() - 16 * 60_000).toISOString());
    expect(classifyPaperBotHealth(view, false, open, 0)).toBe('STALE');
    persisted = emptyState(); enqueuePaperHealth(persisted, 'STALE', open, view);
    expect(persisted.messages[0].message).toContain('장중 15분');
    expect(persisted.messages[0].message).not.toContain('장중 10분');
  });
  it('recognizes an eight-minute collection under the ten-minute cadence without hiding stalled work', () => {
    const now = new Date('2026-09-18T13:35:00+09:00'); view.scanIntervalSeconds = 600;
    scanAt('2026-09-18T13:17:00+09:00');
    view.collection = { startedAt: '2026-09-18T13:27:00+09:00', lastProgressAt: '2026-09-18T13:34:55+09:00', completed: 204, total: 830 };
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('OK');
    view.collection.lastProgressAt = '2026-09-18T13:32:00+09:00';
    expect(classifyPaperBotHealth(view, false, now, 0)).toBe('STALE');
  });
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
  it('pairs an exit with the original entry evidence instead of current research', () => {
    const trade = enteredStrategy().trades[0];
    trade.exit = { decisionAt: '2026-09-23T07:00:00Z', effectiveAt: '2026-09-23T06:30:00Z', netReturnPct: -2 } as NonNullable<typeof trade.exit>;
    const text = formatPaperTradeAnalysis([paperTradeEvents([trade])[1]]);
    expect(text).toContain('청산 복기');
    expect(text).toContain('<b>후반 확인 40건/10진입일</b>\n평균 순수익률 +9.00%');
    expect(text).toContain('청산 순수익률 <b>-2.00%</b>');
    expect(text).toContain('(005930)');
    expect(text).toContain('매수 10,000원 · 2026-09-18');
    expect(formatPaperBotStatus(persisted)).toContain('CH1 매매: 가상 계좌 체결만');
  });
});
