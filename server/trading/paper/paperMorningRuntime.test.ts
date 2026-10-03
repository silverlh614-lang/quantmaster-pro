// @responsibility Verify morning archive lifecycle preserves original virtual entry evidence.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperMorningReport, PaperMorningSelection } from '../../../src/types/paperMorning.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
const mocks = vi.hoisted(() => ({ load: vi.fn(), source: vi.fn(), save: vi.fn(), saveSource: vi.fn(), sent: vi.fn(),
  selection: vi.fn(), ledger: vi.fn(), format: vi.fn() }));
vi.mock('../../persistence/paperMorningRepo.js', () => ({ loadPaperMorningReport: mocks.load, loadPaperMorningSource: mocks.source,
  savePaperMorningReport: mocks.save, savePaperMorningSource: mocks.saveSource, markPaperMorningReportSent: mocks.sent }));
vi.mock('../../persistence/paperStrategyRepo.js', () => ({ loadPaperStrategyLedger: mocks.ledger }));
vi.mock('./paperMorningSelection.js', () => ({ buildPaperMorningSelection: mocks.selection }));
vi.mock('../../alerts/paperMorningMessage.js', () => ({ formatPaperMorningMessage: mocks.format }));
import { capturePaperMorningSource, formatStoredPaperMorningReport, getOrCreatePaperMorningReport,
  getPaperMorningReview, linkPaperMorningRecommendations, reconcilePaperMorningDelivery } from './paperMorningRuntime.js';

const selection = (): PaperMorningSelection => ({ version: 'morning-recommendation-v1', id: 'paper:recommendation:2026-09-18',
  tradingDate: '2026-09-18', scheduledAt: '2026-09-17T23:30:00Z', createdAt: '2026-09-17T23:30:02Z',
  status: 'DATA_UNAVAILABLE', reason: '원천 확인 불가', sourceSnapshotId: null, sourceAsOf: null,
  adaptiveEvaluatedAt: null, adaptiveCutoffAt: null, consideredCount: 0, matchedCount: 0, heldCount: 0, picks: [] });
function fixture() {
  const snapshot = adaptiveTestSnapshot();
  const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
    selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf));
  const trade = ledger.trades[0];
  const report: PaperMorningReport = { ...selection(), status: 'READY', message: '원래 추천 메시지',
    picks: [{ rank: 1, symbol: trade.symbol, name: trade.name, purpose: 'VALIDATED',
      candidate: structuredClone(trade.entryDecision.adaptiveEvidence!.candidate), ruleValue: 20,
      referenceClose: { tradingDate: '2026-09-17', close: 9900, availableAt: '2026-09-17T07:00:00Z' },
      observation: structuredClone(trade.entryObservation) }], delivery: { sentAt: '2026-09-17T23:30:05Z', messageId: 777 } };
  return { ledger, snapshot, report };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockReturnValue(null); mocks.source.mockReturnValue(null);
  mocks.selection.mockImplementation(selection); mocks.save.mockImplementation(value => value);
  mocks.format.mockReturnValue('고정된 새 추천'); mocks.ledger.mockReturnValue(emptyStrategyLedger());
});

describe('morning recommendation lifecycle', () => {
  it('reuses the frozen report without rebuilding its selection or reading live sources', () => {
    const { report } = fixture(); mocks.load.mockReturnValue(report);
    expect(getOrCreatePaperMorningReport(undefined, new Date('2026-09-17T23:40:00Z'), false)).toBe(report);
    expect(mocks.selection).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('persists the exact message before returning it to the outbox and keeps pause visible', () => {
    const report = getOrCreatePaperMorningReport(undefined, new Date('2026-09-17T23:30:02Z'), true);
    expect(report).toMatchObject({ status: 'DATA_UNAVAILABLE', reason: expect.stringContaining('일시정지'), message: '고정된 새 추천' });
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(report);
    reconcilePaperMorningDelivery('2026-09-18', '2026-09-17T23:30:05Z', 777);
    expect(mocks.sent).toHaveBeenCalledWith('2026-09-18', '2026-09-17T23:30:05Z', 777);
  });
  it('links a sent recommendation without changing frozen evidence and distinguishes different entry rules', () => {
    const { report, ledger, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    const evidence = structuredClone(ledger.trades[0].entryDecision);
    linkPaperMorningRecommendations(ledger, snapshot);
    expect(ledger.trades[0].morningRecommendation).toMatchObject({ reportId: report.id, rank: 1, matchesEntryRule: true });
    expect(ledger.trades[0].entryDecision).toEqual(evidence);
    delete ledger.trades[0].morningRecommendation;
    report.picks[0].candidate.rule.bucket++;
    linkPaperMorningRecommendations(ledger, snapshot);
    expect(ledger.trades[0].morningRecommendation!.matchesEntryRule).toBe(false);
  });
  it('never attributes an earlier entry to a recommendation sent later or lacking delivery confirmation', () => {
    const { report, ledger, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    report.delivery!.sentAt = '2026-09-18T02:00:00Z';
    linkPaperMorningRecommendations(ledger, snapshot);
    expect(ledger.trades[0].morningRecommendation).toBeUndefined();
    delete report.delivery;
    linkPaperMorningRecommendations(ledger, snapshot);
    expect(ledger.trades[0].morningRecommendation).toBeUndefined();
  });
  it('isolates optional archive failures from strategy state and preserves a paired source', () => {
    const { ledger, snapshot } = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.saveSource.mockImplementation(() => { throw new Error('disk full'); });
    mocks.load.mockImplementation(() => { throw new Error('archive unreadable'); });
    const before = structuredClone(ledger);
    expect(() => capturePaperMorningSource(ledger, snapshot)).not.toThrow();
    expect(mocks.saveSource).toHaveBeenCalledWith({ version: 'morning-source-v1', snapshot, adaptive: ledger.adaptive, openSymbols: ['005930'] });
    expect(() => linkPaperMorningRecommendations(ledger, snapshot)).not.toThrow();
    expect(ledger).toEqual(before); expect(log).toHaveBeenCalledTimes(2); log.mockRestore();
  });
  it('shows unmatched recommendations instead of counting only successful entries and never regenerates on read', () => {
    const { report, ledger, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    expect(getPaperMorningReview('2026-09-18', new Date('2026-09-18T08:00:00Z')).results[0])
      .toMatchObject({ status: 'NOT_ENTERED', tradeId: null, netReturnPct: null });
    linkPaperMorningRecommendations(ledger, snapshot); mocks.ledger.mockReturnValue(ledger);
    expect(getPaperMorningReview('2026-09-18', new Date(snapshot.asOf)).results[0])
      .toMatchObject({ status: 'OPEN', tradeId: ledger.trades[0].id, netReturnPct: null, matchesEntryRule: true });
    expect(formatStoredPaperMorningReport(new Date(snapshot.asOf))).toContain('가상 매수 후 보유');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.selection).not.toHaveBeenCalled();
  });
  it('does not expose a later confirmed exit when reviewing an earlier observation time', () => {
    const { report, ledger, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    linkPaperMorningRecommendations(ledger, snapshot);
    const exitSnapshot = structuredClone(snapshot);
    exitSnapshot.id = 'later-exit'; exitSnapshot.asOf = '2026-09-23T07:00:00Z';
    exitSnapshot.tradingDate = '2026-09-23'; exitSnapshot.marketOpen = false;
    exitSnapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: exitSnapshot.asOf }];
    mocks.ledger.mockReturnValue(evaluatePaperStrategyScan(ledger, exitSnapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, [], exitSnapshot.asOf)));
    expect(getPaperMorningReview('2026-09-18', new Date(snapshot.asOf)).results[0]).toMatchObject({ status: 'OPEN', exitAt: null, netReturnPct: null });
    expect(getPaperMorningReview('2026-09-18', new Date(exitSnapshot.asOf)).results[0]).toMatchObject({ status: 'CLOSED', netReturnPct: 10 });
  });
  it('recovers the read-only trade join when delivery archival was repaired on a later day', () => {
    const { report, ledger } = fixture(); mocks.load.mockReturnValue(report); mocks.ledger.mockReturnValue(ledger);
    expect(ledger.trades[0].morningRecommendation).toBeUndefined();
    expect(getPaperMorningReview('2026-09-18', new Date('2026-09-21T07:00:00Z')).results[0])
      .toMatchObject({ status: 'OPEN', tradeId: ledger.trades[0].id, matchesEntryRule: true });
    expect(ledger.trades[0].morningRecommendation).toBeUndefined();
    report.delivery!.sentAt = '2026-09-18T02:00:00Z';
    expect(getPaperMorningReview('2026-09-18', new Date('2026-09-21T07:00:00Z')).results[0])
      .toMatchObject({ status: 'NOT_ENTERED', tradeId: null });
  });
});
