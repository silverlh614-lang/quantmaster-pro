// @responsibility Verify morning archive lifecycle preserves original virtual entry evidence.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperMorningReport, PaperMorningSelection } from '../../../src/types/paperMorning.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { emptyStrategyLedger, strategyTestCost } from './paperStrategyFixtures.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { formatPaperMorningFollowup } from '../../alerts/paperMorningFollowup.js';
import { validateTelegramHtml } from '../../alerts/telegramHtmlSanitizer.js';
const mocks = vi.hoisted(() => ({ load: vi.fn(), source: vi.fn(), save: vi.fn(), saveSource: vi.fn(), sent: vi.fn(),
  selection: vi.fn(), ledger: vi.fn(), format: vi.fn(), tracking: vi.fn(), saveTracking: vi.fn() }));
vi.mock('../../persistence/paperMorningRepo.js', () => ({ loadPaperMorningReport: mocks.load, loadPaperMorningSource: mocks.source,
  savePaperMorningReport: mocks.save, savePaperMorningSource: mocks.saveSource, markPaperMorningReportSent: mocks.sent,
  loadPaperMorningTracking: mocks.tracking, savePaperMorningTracking: mocks.saveTracking }));
vi.mock('../../persistence/paperStrategyRepo.js', () => ({ loadPaperStrategyLedger: mocks.ledger }));
vi.mock('./paperMorningSelection.js', () => ({ buildPaperMorningSelection: mocks.selection }));
vi.mock('../../alerts/paperMorningMessage.js', () => ({ formatPaperMorningMessage: mocks.format }));
import { capturePaperMorningSource, formatStoredPaperMorningReport, getOrCreatePaperMorningReport,
  getPaperMorningReview, capturePaperMorningTracking, linkPaperMorningRecommendations, reconcilePaperMorningDelivery } from './paperMorningRuntime.js';

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
  it('keeps all three follow-up cards within Telegram limits with escaped evidence', () => {
    const { report, ledger } = fixture(); mocks.load.mockReturnValue(report); mocks.ledger.mockReturnValue(ledger);
    const review = getPaperMorningReview(report.tradingDate, new Date('2026-09-18T05:00:00Z'));
    review.results = [1, 2, 3].map(rank => ({ ...review.results[0], rank, symbol: `00000${rank}`, name: '<&>'.repeat(100),
      entryReason: '<&>'.repeat(100), status: 'CLOSED', exitAt: '2026-09-18T04:00:00Z', exitPrice: 11000,
      exitReason: '<&>'.repeat(100), netReturnPct: 10 }));
    report.picks = review.results.map(item => ({ ...report.picks[0], rank: item.rank, symbol: item.symbol }));
    for (const compact of [false, true]) {
      const message = formatPaperMorningFollowup(review, compact);
      expect(message.length).toBeLessThan(3000);
      expect(validateTelegramHtml(message).valid).toBe(true);
      for (const item of review.results) expect(message).toContain(item.symbol);
    }
  });
  it('preserves same-snapshot intraday reasons without changing recommendation evidence', () => {
    const { report, ledger, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    const before = structuredClone(report);
    capturePaperMorningTracking(ledger, snapshot);
    expect(mocks.saveTracking).toHaveBeenCalledWith(expect.objectContaining({ reportId: report.id, snapshotId: snapshot.id,
      decisions: [expect.objectContaining({ symbol: report.picks[0].symbol, action: 'BUY', decisionAt: snapshot.asOf })] }));
    capturePaperMorningTracking(ledger, { ...snapshot, marketOpen: false });
    expect(mocks.saveTracking).toHaveBeenCalledTimes(1); expect(report).toEqual(before);
  });
  it('distinguishes unconfirmed delivery from non-entry and hides future follow-up evidence', () => {
    const { report, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    const later = { reportId: report.id, tradingDate: report.tradingDate, snapshotId: 'later', asOf: '2026-09-18T05:00:00Z',
      decisions: [{ symbol: report.picks[0].symbol, action: 'WAIT', reason: '장중 조건 불일치', decisionAt: '2026-09-18T05:00:00Z' }] };
    mocks.tracking.mockReturnValue(later);
    expect(getPaperMorningReview(report.tradingDate, new Date(snapshot.asOf)).results[0].lastDecision).toBeNull();
    const after = getPaperMorningReview(report.tradingDate, new Date('2026-09-18T08:00:00Z'));
    expect(after.results[0]).toMatchObject({ status: 'NOT_ENTERED', lastDecision: { reason: '장중 조건 불일치' } });
    delete report.delivery;
    expect(getPaperMorningReview(report.tradingDate, new Date('2026-09-18T08:00:00Z')).results[0])
      .toMatchObject({ status: 'UNSENT', lastDecision: null, tradeId: null });
  });
  it('shows historical date reasons without substituting the latest unrelated scan', () => {
    const { report, ledger } = fixture(); mocks.load.mockReturnValue(report); ledger.trades = [];
    ledger.latestDecisions[0].reason = '다음 날 장 시작 대기'; mocks.ledger.mockReturnValue(ledger);
    mocks.tracking.mockReturnValue({ reportId: report.id, asOf: '2026-09-18T05:00:00Z', decisions: [
      { symbol: report.picks[0].symbol, action: 'WAIT', reason: '진입 규칙 불일치', decisionAt: '2026-09-18T05:00:00Z' },
    ] });
    const result = getPaperMorningReview(report.tradingDate, new Date('2026-09-21T08:00:00Z')).results[0];
    expect(result.lastDecision?.reason).toBe('진입 규칙 불일치');
  });
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
    expect(formatStoredPaperMorningReport(new Date(snapshot.asOf))).toContain('가상 보유');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.selection).not.toHaveBeenCalled();
  });
  it('does not expose a later confirmed exit when reviewing an earlier observation time', () => {
    const { report, ledger, snapshot } = fixture(); mocks.load.mockReturnValue(report);
    linkPaperMorningRecommendations(ledger, snapshot);
    const exitSnapshot = structuredClone(snapshot);
    exitSnapshot.id = 'later-exit'; exitSnapshot.asOf = '2026-09-18T01:05:00Z';
    exitSnapshot.observations[0].observedAt = exitSnapshot.asOf; exitSnapshot.observations[0].price = 9400;
    exitSnapshot.observations[0].features!.asOf = exitSnapshot.asOf;
    mocks.ledger.mockReturnValue(evaluatePaperStrategyScan(ledger, exitSnapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, [], exitSnapshot.asOf)));
    expect(getPaperMorningReview('2026-09-18', new Date(snapshot.asOf)).results[0]).toMatchObject({ status: 'OPEN', exitAt: null, netReturnPct: null });
    const reviewed = getPaperMorningReview('2026-09-18', new Date(exitSnapshot.asOf));
    expect(reviewed.results[0]).toMatchObject({ status: 'CLOSED', netReturnPct: -6, exitPrice: 9400 });
    expect(formatPaperMorningFollowup(reviewed)).toContain('확정 순수익 -6.00%');
    expect(formatPaperMorningFollowup(reviewed)).toContain('매도 사유:');
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
