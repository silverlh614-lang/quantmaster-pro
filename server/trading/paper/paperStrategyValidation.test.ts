// @responsibility Verify restored strategy decision integrity.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import * as holidays from '../krxHolidays.js';
import * as calendar from '../../calendar/krxTradingCalendar.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { EMPTY_EVIDENCE_DIGEST } from './paperStrategyEvidence.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';

const enter = () => legacyStrategyLedger();
const inactive = () => selectPaperAdaptiveState(undefined, [], strategyTestSnapshot().asOf);
function closed(): PaperStrategyLedger {
  const snapshot = strategyTestSnapshot();
  snapshot.asOf = '2026-09-28T01:00:00Z';
  snapshot.tradingDate = '2026-09-28';
  snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
  return evaluatePaperStrategyScan(enter(), snapshot, strategyTestCost, inactive());
}

afterEach(() => { vi.restoreAllMocks(); });

describe('persisted strategy evidence integrity', () => {
  it('accepts generated open/closed trades and empty evidence while awaiting samples', () => {
    const waiting = evaluatePaperStrategyScan(emptyStrategyLedger(), strategyTestSnapshot(), strategyTestCost, inactive());
    for (const ledger of [emptyStrategyLedger(), waiting, enter(), closed()]) {
      expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).not.toThrow();
    }
  });

  const corruptEvidence: Array<[string, (ledger: PaperStrategyLedger) => void]> = [
    ['duplicate horizon', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[1].horizon = 1; }],
    ['unpaired horizon count', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[0].count--; }],
    ['inconsistent daily mean', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[1].meanDailyNetReturnPct = 99; }],
    ['missing mean on mature rows', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[0].meanNetReturnPct = null; }],
    ['malformed evidence digest', (ledger) => { ledger.trades[0].entryDecision.evidence!.experimentIdsDigest = 'not-a-digest'; }],
    ['empty-set digest on mature evidence', (ledger) => { ledger.trades[0].entryDecision.evidence!.experimentIdsDigest = EMPTY_EVIDENCE_DIGEST; }],
    ['baseline and historical counts not adding up', (ledger) => { ledger.trades[0].entryDecision.evidence!.historicalSampleCount = 1; }],
    ['impossible entry-date count', (ledger) => { ledger.trades[0].entryDecision.evidence!.entryDateCount = 13; }],
    ['non-optimal selected horizon', (ledger) => { ledger.trades[0].entryDecision.evidence!.selectedHorizon = 5; }],
    ['longer horizon selected in a tie', (ledger) => {
      for (const row of ledger.trades[0].entryDecision.evidence!.horizons) {
        row.meanNetReturnPct = row.horizon * 2; row.meanDailyNetReturnPct = 2;
      }
    }],
    ['negative selected expectancy', (ledger) => {
      for (const row of ledger.trades[0].entryDecision.evidence!.horizons) {
        row.meanDailyNetReturnPct = row.horizon === 3 ? -0.1 : -1;
        row.meanNetReturnPct = row.meanDailyNetReturnPct * row.horizon;
      }
    }],
    ['decision/evidence cohort mismatch', (ledger) => { ledger.trades[0].entryDecision.cohort = 'NEWS_RECENT_ABOVE_MA20'; }],
    ['stored cohort disagrees with entry observation', (ledger) => {
      ledger.trades[0].entryDecision.cohort = 'NEWS_RECENT_ABOVE_MA20';
      ledger.trades[0].entryDecision.evidence!.cohort = 'NEWS_RECENT_ABOVE_MA20';
    }],
    ['malformed latest decision evidence', (ledger) => { ledger.latestDecisions[0].evidence!.horizons[2].count = 0; }],
  ];
  it.each(corruptEvidence)('rejects %s', (_, mutate) => {
    const ledger = enter(); mutate(ledger);
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
  });

  it('rejects fabricated non-null statistics when there are no samples', () => {
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), strategyTestSnapshot(), strategyTestCost, inactive());
    const evidence = structuredClone(enter().trades[0].entryDecision.evidence!);
    Object.assign(evidence, { sampleCount: 0, entryDateCount: 0, baselineSampleCount: 0, historicalSampleCount: 0,
      experimentIdsDigest: EMPTY_EVIDENCE_DIGEST, selectedHorizon: null });
    evidence.horizons = evidence.horizons.map(row => ({ ...row, count: 0, meanNetReturnPct: null, meanDailyNetReturnPct: null, winRatePct: null }));
    ledger.latestDecisions[0].evidence = evidence;
    ledger.latestDecisions[0].cohort = evidence.cohort;
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
    evidence.horizons[0].meanNetReturnPct = 0;
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
  });
});

describe('persisted strategy lifecycle integrity', () => {
  const corruptEntry: Array<[string, (ledger: PaperStrategyLedger) => void]> = [
    ['future entry quote', (ledger) => { ledger.trades[0].entryObservation.observedAt = '2026-09-18T02:00:00Z'; }],
    ['stale entry quote date', (ledger) => { ledger.trades[0].entryObservation.observedAt = '2026-09-17T01:00:00Z'; }],
    ['future entry news', (ledger) => {
      ledger.trades[0].entryObservation.news.push({ id: 'future', headline: '미래 관측', source: 'DART', observedAt: '2026-09-18T02:00:00Z' });
    }],
    ['future available close in entry observation', (ledger) => {
      ledger.trades[0].entryObservation.dailyCloses.push({ tradingDate: '2026-09-17', close: 10000, availableAt: '2026-09-18T02:00:00Z' });
    }],
    ['mismatched entry name', (ledger) => { ledger.trades[0].entryDecision.name = '다른 종목'; }],
    ['non-buy entry reason', (ledger) => { ledger.trades[0].entryDecision.reasonCode = 'INSUFFICIENT_MATURE_SAMPLES'; }],
    ['same-day exit schedule', (ledger) => {
      ledger.trades[0].scheduledExitDate = '2026-09-18'; ledger.trades[0].scheduledExitAt = '2026-09-18T06:30:00Z';
    }],
    ['inconsistent frozen close time', (ledger) => { ledger.trades[0].scheduledExitAt = '2026-09-23T06:00:00Z'; }],
  ];
  it.each(corruptEntry)('rejects %s', (_, mutate) => {
    const ledger = enter(); mutate(ledger);
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
  });

  const corruptExit: Array<[string, (ledger: PaperStrategyLedger) => void]> = [
    ['exit decision symbol', (ledger) => { ledger.trades[0].exit!.decision.symbol = '000660'; }],
    ['exit decision name', (ledger) => { ledger.trades[0].exit!.decision.name = '다른 종목'; }],
    ['exit decision snapshot', (ledger) => { ledger.trades[0].exit!.decision.snapshotId = 'other-scan'; }],
    ['exit decision time', (ledger) => { ledger.trades[0].exit!.decision.decisionAt = '2026-09-28T02:00:00Z'; }],
    ['exit decision trade ID', (ledger) => { ledger.trades[0].exit!.decision.tradeId = 'other-trade'; }],
    ['exit decision reason', (ledger) => { ledger.trades[0].exit!.decision.reasonCode = 'HORIZON_PENDING'; }],
    ['changed exit evidence', (ledger) => { ledger.trades[0].exit!.decision.evidence!.experimentIdsDigest = 'a'.repeat(64); }],
    ['premature observed exit', (ledger) => { ledger.trades[0].exit!.observedAt = '2026-09-23T06:00:00Z'; }],
  ];
  it.each(corruptExit)('rejects mismatched %s metadata', (_, mutate) => {
    const ledger = closed(); mutate(ledger);
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('PAPER_STRATEGY_INVALID');
  });

  it('loads accepted schedules after the mutable holiday calendar changes', () => {
    const ledgers = [enter(), closed()];
    const businessDays = vi.spyOn(holidays, 'addBusinessDaysFromKstDate').mockReturnValue('2026-09-24');
    const tradingDay = vi.spyOn(calendar, 'isKrxTradingDay').mockReturnValue(false);
    for (const ledger of ledgers) {
      expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).not.toThrow();
      expect(ledger.trades[0].scheduledExitDate).toBe('2026-09-23');
    }
    expect(businessDays).not.toHaveBeenCalled();
    expect(tradingDay).not.toHaveBeenCalled();
  });
});

describe('persisted morning recommendation links', () => {
  function linked(): PaperStrategyLedger {
    const snapshot = adaptiveTestSnapshot();
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf));
    ledger.trades[0].morningRecommendation = { reportId: 'paper:recommendation:2026-09-18', rank: 1, purpose: 'VALIDATED',
      recommendedAt: '2026-09-17T23:30:00Z', sentAt: '2026-09-17T23:30:05Z', matchesEntryRule: true };
    return ledger;
  }

  it('preserves valid frozen recommendation references through serialization and scheduled exit', () => {
    const ledger = linked(), reference = structuredClone(ledger.trades[0].morningRecommendation);
    const entryEvidence = structuredClone(ledger.trades[0].entryDecision);
    const restored = JSON.parse(JSON.stringify(ledger));
    expect(() => assertPaperStrategyLedger(restored)).not.toThrow();
    expect(restored.trades[0].morningRecommendation).toEqual(reference);
    const snapshot = adaptiveTestSnapshot();
    snapshot.id = 'morning-reference-exit'; snapshot.tradingDate = '2026-09-23'; snapshot.asOf = '2026-09-23T07:00:00Z'; snapshot.marketOpen = false;
    snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
    const exited = evaluatePaperStrategyScan(restored, snapshot, strategyTestCost, inactive());
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(exited)))).not.toThrow();
    expect(exited.trades[0].status).toBe('CLOSED');
    expect(exited.trades[0].morningRecommendation).toEqual(reference);
    expect(exited.trades[0].entryDecision).toEqual(entryEvidence);
  });

  it('accepts absent references on old ledgers and honest entry-rule differences', () => {
    for (const ledger of [enter(), closed(), linked()]) {
      if (ledger.trades[0].morningRecommendation) {
        ledger.trades[0].morningRecommendation!.matchesEntryRule = false;
        ledger.trades[0].morningRecommendation!.purpose = 'EXPLORATION';
        ledger.trades[0].morningRecommendation!.rank = 3;
      }
      const restored = JSON.parse(JSON.stringify(ledger));
      expect(() => assertPaperStrategyLedger(restored)).not.toThrow();
      expect(restored.trades[0].morningRecommendation).toEqual(ledger.trades[0].morningRecommendation);
    }
  });

  const invalidReferences: Array<[string, (ledger: PaperStrategyLedger) => void]> = [
    ['a report from another trading date', ledger => { ledger.trades[0].morningRecommendation!.reportId = 'paper:recommendation:2026-09-17'; }],
    ['an unrelated report ID', ledger => { ledger.trades[0].morningRecommendation!.reportId = 'paper:morning:2026-09-18'; }],
    ['rank zero', ledger => { ledger.trades[0].morningRecommendation!.rank = 0; }],
    ['rank above the three-pick limit', ledger => { ledger.trades[0].morningRecommendation!.rank = 4; }],
    ['fractional rank', ledger => { ledger.trades[0].morningRecommendation!.rank = 1.5; }],
    ['creation before the 08:30 recommendation slot', ledger => { ledger.trades[0].morningRecommendation!.recommendedAt = '2026-09-17T23:29:59Z'; }],
    ['delivery before report creation', ledger => { ledger.trades[0].morningRecommendation!.sentAt = '2026-09-17T23:29:59Z'; }],
    ['a recommendation actually sent after entry', ledger => { ledger.trades[0].morningRecommendation!.sentAt = '2026-09-18T01:00:01Z'; }],
    ['an invalid delivery timestamp', ledger => { ledger.trades[0].morningRecommendation!.sentAt = 'invalid'; }],
    ['an unknown recommendation purpose', ledger => { ledger.trades[0].morningRecommendation!.purpose = 'UNKNOWN' as never; }],
  ];
  it.each(invalidReferences)('rejects %s using the actual ledger validator', (_, mutate) => {
    const ledger = linked(); mutate(ledger);
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).toThrow('PAPER_STRATEGY_INVALID');
  });
});
