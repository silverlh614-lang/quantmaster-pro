// @responsibility Verify restored strategy decision integrity.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import * as holidays from '../krxHolidays.js';
import * as calendar from '../../calendar/krxTradingCalendar.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';

const enter = () => evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), strategyTestSnapshot(), strategyTestCost);
function closed(): PaperStrategyLedger {
  const snapshot = strategyTestSnapshot();
  snapshot.asOf = '2026-09-28T01:00:00Z';
  snapshot.tradingDate = '2026-09-28';
  snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: snapshot.asOf }];
  return evaluatePaperStrategyScan(enter(), [], snapshot, strategyTestCost);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('persisted strategy evidence integrity', () => {
  it('accepts generated open/closed trades and empty evidence while awaiting samples', () => {
    const waiting = evaluatePaperStrategyScan(emptyStrategyLedger(), [], strategyTestSnapshot(), strategyTestCost);
    for (const ledger of [emptyStrategyLedger(), waiting, enter(), closed()]) {
      expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).not.toThrow();
    }
  });

  const corruptEvidence: Array<[string, (ledger: PaperStrategyLedger) => void]> = [
    ['duplicate horizon', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[1].horizon = 1; }],
    ['unpaired horizon count', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[0].count--; }],
    ['inconsistent daily mean', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[1].meanDailyNetReturnPct = 99; }],
    ['missing mean on mature rows', (ledger) => { ledger.trades[0].entryDecision.evidence!.horizons[0].meanNetReturnPct = null; }],
    ['duplicate evidence IDs', (ledger) => { const ids = ledger.trades[0].entryDecision.evidence!.experimentIds; ids[0] = ids[1]; }],
    ['missing evidence ID', (ledger) => { ledger.trades[0].entryDecision.evidence!.experimentIds.pop(); }],
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
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), [], strategyTestSnapshot(), strategyTestCost);
    ledger.latestDecisions[0].evidence!.horizons[0].meanNetReturnPct = 0;
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
    ['changed exit evidence', (ledger) => { ledger.trades[0].exit!.decision.evidence!.experimentIds[0] = 'different-evidence'; }],
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
