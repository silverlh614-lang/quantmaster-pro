// @responsibility Verify investor-flow correlation provenance and paired outcomes.
import { describe, expect, it } from 'vitest';
import type { PaperExperiment } from '../../../src/types/paperExperiment.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { buildPaperInvestorFlowStudy, summarizeCurrentInvestorFlow } from './paperInvestorFlowStudy.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';
import { createPaperExperiment } from './paperExperimentPolicy.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';

const asOf = '2026-09-18T01:00:00Z';
function attachFlow(experiment: PaperExperiment, foreign: number, institution: number, volume = 1000) {
  const date = previousKrxTradingDay(new Date(experiment.entryAt));
  experiment.entryObservation.investorFlow = { symbol: experiment.symbol, source: 'KIS_API', unit: 'SHARES',
    requestedTradingDate: date, tradingDate: date, observedAt: experiment.entryAt,
    foreignNetShares: foreign, institutionalNetShares: institution, volume, issue: null };
}
function samples() {
  return matureStrategySamples().map((experiment, index) => {
    const x = index - 6;
    attachFlow(experiment, x * 10, -x * 10);
    for (const outcome of experiment.outcomes) {
      outcome.netReturnPct = x * outcome.horizon;
      outcome.grossReturnPct = outcome.netReturnPct;
      outcome.netPnl = experiment.entryPrice * outcome.netReturnPct / 100;
      outcome.exitPrice = experiment.entryPrice + outcome.netPnl;
    }
    return experiment;
  });
}
const study = (rows = samples()) => buildPaperInvestorFlowStudy(rows, asOf);

describe('entry-frozen investor-flow research', () => {
  it('shows current cross-sectional flows without inventing baseline entries or outcomes', () => {
    const rows = samples().slice(0, 4);
    rows.forEach((row, index) => {
      row.entryAt = asOf;
      attachFlow(row, index * 10, index * 20);
    });
    const observations = rows.map(row => row.entryObservation);
    const missing = { ...observations[0], symbol: '999999', investorFlow: undefined };
    const current = summarizeCurrentInvestorFlow([...observations, missing, observations[0]], asOf);
    expect(current).toMatchObject({ tradingDate: '2026-09-17', candidateCount: 5, availableCount: 4,
      flowCorrelation: { count: 4, symbolCount: 4, entryDateCount: 1, pearson: 1, spearman: 1 } });
    expect(current.groups).toContainEqual({ group: 'BOTH_BUY', count: 3 });
    expect(current.groups).toContainEqual({ group: 'OTHER', count: 1 });
    expect(buildPaperInvestorFlowStudy([], asOf).availableCount).toBe(0);
  });

  it('measures positive and negative relations and distinguishes a constant combined flow', () => {
    const result = study();
    const all = result.segments[0];
    expect(result.availableCount).toBe(12);
    expect(all.flowCorrelation).toMatchObject({ count: 12, symbolCount: 4, entryDateCount: 3, pearson: -1, spearman: -1 });
    expect(all.correlations.find(item => item.actor === 'FOREIGN' && item.horizon === 1)).toMatchObject({ pearson: 1, spearman: 1, count: 12 });
    expect(all.correlations.find(item => item.actor === 'INSTITUTION' && item.horizon === 3)?.pearson).toBeCloseTo(-1);
    expect(all.correlations.find(item => item.actor === 'COMBINED')).toMatchObject({ pearson: null, spearman: null, status: 'NO_VARIATION' });
  });

  it('normalizes each stock by its own volume, rather than pooling raw share counts', () => {
    const rows = samples();
    const original = study(rows);
    for (const [index, row] of rows.entries()) {
      const flow = row.entryObservation.investorFlow!;
      flow.foreignNetShares! *= index + 2;
      flow.institutionalNetShares! *= index + 2;
      flow.volume! *= index + 2;
    }
    expect(study(rows).segments).toEqual(original.segments);
  });

  it('keeps zero net purchases and handles tied ranks without fabricating correlation', () => {
    const rows = samples();
    rows.forEach(row => attachFlow(row, 0, 0));
    expect(study(rows).availableCount).toBe(12);
    expect(study(rows).segments[0].flowCorrelation.status).toBe('NO_VARIATION');
    expect(study(rows.slice(0, 2)).segments[0].flowCorrelation).toMatchObject({ count: 2, pearson: null, status: 'INSUFFICIENT_PAIRS' });
    rows.forEach((row, index) => attachFlow(row, Math.floor(index / 2), Math.floor(index / 2) * 2));
    expect(study(rows).segments[0].flowCorrelation.spearman).toBeCloseTo(1);
  });

  it('excludes missing, future, mismatched and duplicated flows without backfilling old records', () => {
    const rows = samples();
    delete rows[0].entryObservation.investorFlow;
    rows[1].entryObservation.investorFlow!.observedAt = asOf;
    rows[2].entryObservation.investorFlow!.tradingDate = '2026-08-27';
    rows[3].entryObservation.investorFlow!.foreignNetShares = null;
    rows[4].entryObservation.investorFlow!.volume = 0;
    rows[5].entryObservation.investorFlow!.symbol = '999999';
    rows[6].entryObservation.investorFlow!.volume = 1;
    rows[6].entryObservation.investorFlow!.foreignNetShares = 100;
    rows.push(structuredClone(rows[7]));
    const before = JSON.stringify(rows);
    expect(study(rows)).toMatchObject({ availableCount: 5, missing: { NOT_RECORDED: 1, TIME_INVALID: 1, DATE_MISMATCH: 1,
      QUANTITY_MISSING: 1, VOLUME_MISSING: 1, SYMBOL_MISMATCH: 1, VOLUME_MISMATCH: 1, DUPLICATE_ENTRY: 1 } });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('pairs only the exact completed horizon known at the report cutoff', () => {
    const rows = samples();
    rows[0].outcomes = rows[0].outcomes.filter(item => item.horizon !== 1);
    rows[1].outcomes.find(item => item.horizon === 1)!.availableAt = '2026-09-19T01:00:00Z';
    rows[2].outcomes.find(item => item.horizon === 1)!.tradingDate = '2026-09-17';
    const correlations = study(rows).segments[0].correlations;
    expect(correlations.find(item => item.actor === 'FOREIGN' && item.horizon === 1)!.count).toBe(9);
    expect(correlations.find(item => item.actor === 'FOREIGN' && item.horizon === 3)!.count).toBe(12);
  });

  it('separates news directions and same-direction buying from divergent flows', () => {
    const rows = samples();
    rows.forEach((row, index) => {
      attachFlow(row, index + 1, index < 6 ? index + 2 : -(index + 2));
      row.entryObservation.news = [{ id: row.id, headline: '당시 공시', source: 'DART', observedAt: row.entryAt,
        assessment: { version: 'headline-rules-v1', method: 'DISCLOSURE_TITLE_RULES', assessedAt: row.entryAt,
          direction: index < 6 ? 'POSITIVE' : 'NEGATIVE', reason: '당시 제목 근거' } }];
    });
    const segments = study(rows).segments;
    expect(segments.find(item => item.news === 'POSITIVE')?.groups.find(item => item.group === 'BOTH_BUY')?.observationCount).toBe(6);
    expect(segments.find(item => item.news === 'NEGATIVE')?.groups.find(item => item.group === 'DIVERGENT')?.observationCount).toBe(6);
    expect(segments.find(item => item.news === 'UNKNOWN')?.observationCount).toBe(0);
  });

  it('freezes both baseline and strategy flow without adding an entry condition', () => {
    const snapshot = strategyTestSnapshot();
    const experiment = createPaperExperiment(snapshot, snapshot.observations[0], strategyTestCost())!;
    attachFlow(experiment, -100, -200);
    snapshot.observations[0].investorFlow = experiment.entryObservation.investorFlow;
    const baseline = createPaperExperiment(snapshot, snapshot.observations[0], strategyTestCost())!;
    const strategy = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples(), snapshot, strategyTestCost);
    expect(strategy.latestDecisions[0]).toMatchObject({ action: 'BUY', investorFlow: { foreignNetShares: -100 } });
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(strategy)))).not.toThrow();
    snapshot.observations[0].investorFlow!.foreignNetShares = 999;
    expect(baseline.entryObservation.investorFlow!.foreignNetShares).toBe(-100);
    expect(strategy.trades[0].entryObservation.investorFlow!.foreignNetShares).toBe(-100);
  });
});
