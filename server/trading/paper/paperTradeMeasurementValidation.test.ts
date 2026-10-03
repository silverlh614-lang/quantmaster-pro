// @responsibility Verify observed trade measurement integrity.
import { describe, expect, it } from 'vitest';
import type { PaperStrategyLedger, PaperStrategyTrade, PaperTradeMeasurementPoint, PaperTradeMeasurementRow } from '../../../src/types/paperStrategy.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from './paperAdaptiveFixtures.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { emptyStrategyLedger, legacyStrategyLedger, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { assertPaperTradeMeasurement, assertPaperTradeMeasurementRows } from './paperTradeMeasurementValidation.js';
import { capturePaperTradeMeasurements } from './paperTradeMeasurements.js';

function point(trade: PaperStrategyTrade, fields: Partial<PaperTradeMeasurementPoint> = {}): PaperTradeMeasurementPoint {
  const price = fields.price ?? trade.entryPrice;
  return { snapshotId: 'quote-1', kind: 'QUOTE', effectiveAt: '2026-09-18T01:01:00Z', observedAt: '2026-09-18T01:01:00Z',
    recordedAt: '2026-09-18T01:01:05Z', price, source: 'KIS_REST_REQUEST_OBSERVED',
    netPnl: calculatePaperReturn(trade.entryPrice, price, trade.costModel).netPnl,
    netReturnPct: calculatePaperReturn(trade.entryPrice, price, trade.costModel).netReturnPct,
    action: 'HOLD', reasonCode: 'HORIZON_PENDING', ruleValue: null, ruleMatches: null, ruleConnected: null, featureAsOf: null, ...fields };
}
function measured(): PaperStrategyLedger {
  const ledger = legacyStrategyLedger(), trade = ledger.trades[0];
  trade.entryObservation.observedAt = '2026-09-18T00:59:55Z';
  trade.costModel = { version: 'frozen-cost', buyFeeRate: 0.001, sellFeeRate: 0.002, sellTaxRate: 0.003, slippageRate: 0.004 };
  const entry = point(trade, { snapshotId: trade.entrySnapshotId, kind: 'ENTRY', effectiveAt: trade.entryAt,
    observedAt: trade.entryObservation.observedAt, recordedAt: trade.entryAt, action: 'BUY', reasonCode: trade.entryDecision.reasonCode });
  trade.measurement = { version: 'observed-trade-path-v1', startedAt: trade.entryAt, fromEntry: true,
    pointCount: 1, latest: structuredClone(entry), highest: structuredClone(entry), lowest: structuredClone(entry) };
  return ledger;
}
function path(): PaperStrategyLedger {
  const ledger = measured(), trade = ledger.trades[0], measurement = trade.measurement!;
  measurement.lowest = point(trade, { price: 9000 });
  measurement.highest = point(trade, { snapshotId: 'quote-2', price: 12000, effectiveAt: '2026-09-18T01:02:00Z',
    observedAt: '2026-09-18T01:02:00Z', recordedAt: '2026-09-18T01:02:05Z' });
  measurement.latest = point(trade, { snapshotId: 'quote-3', price: 10500, effectiveAt: '2026-09-18T01:03:00Z',
    observedAt: '2026-09-18T01:03:00Z', recordedAt: '2026-09-18T01:03:05Z' });
  measurement.pointCount = 4;
  ledger.lastRun!.asOf = measurement.latest.recordedAt;
  return ledger;
}
function closed(): PaperStrategyLedger {
  const snapshot = strategyTestSnapshot();
  snapshot.id = 'late-close'; snapshot.asOf = '2026-09-28T01:00:00Z'; snapshot.tradingDate = '2026-09-28';
  snapshot.observations[0].dailyCloses = [{ tradingDate: '2026-09-23', close: 11000, availableAt: '2026-09-28T00:59:50Z' }];
  const ledger = evaluatePaperStrategyScan(measured(), snapshot, strategyTestCost, selectPaperAdaptiveState(undefined, [], snapshot.asOf));
  const trade = ledger.trades[0], exit = trade.exit!;
  const close = point(trade, { snapshotId: exit.snapshotId, kind: 'SCHEDULED_CLOSE', price: exit.price,
    effectiveAt: exit.effectiveAt, observedAt: exit.observedAt, recordedAt: exit.decisionAt,
    source: 'SCHEDULED_CLOSE_CONFIRMED', action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED' });
  trade.measurement = { version: 'observed-trade-path-v1', startedAt: close.recordedAt, fromEntry: false, pointCount: 1,
    latest: structuredClone(close), highest: structuredClone(close), lowest: structuredClone(close) };
  return ledger;
}
function row(trade: PaperStrategyTrade, sample = trade.measurement!.latest): PaperTradeMeasurementRow {
  return { ...sample, tradeId: trade.id, entrySnapshotId: trade.entrySnapshotId };
}

describe('persisted observed price path', () => {
  it('accepts old ledgers without measurement plus entry quotes observed before the entry decision', () => {
    for (const ledger of [legacyStrategyLedger(), measured(), path(), closed()]) {
      expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).not.toThrow();
    }
    expect(measured().trades[0].measurement!.latest.netReturnPct).toBeLessThan(0);
  });

  it('allows a partial legacy path without importing the entry price as an observed extreme', () => {
    const ledger = path(), trade = ledger.trades[0], measurement = trade.measurement!;
    measurement.fromEntry = false; measurement.startedAt = measurement.lowest.recordedAt; measurement.pointCount = 3;
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
    measurement.lowest = point(trade, { snapshotId: trade.entrySnapshotId, kind: 'ENTRY', action: 'BUY',
      reasonCode: trade.entryDecision.reasonCode, effectiveAt: trade.entryAt, observedAt: trade.entryObservation.observedAt, recordedAt: trade.entryAt });
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('INVALID');
  });

  it('permits a delayed close as the first actual record with distinct effective and recording times', () => {
    const trade = closed().trades[0];
    expect(Date.parse(trade.measurement!.startedAt)).toBeGreaterThan(Date.parse(trade.measurement!.latest.effectiveAt));
    expect(() => assertPaperTradeMeasurement(trade, trade.exit!.decisionAt)).not.toThrow();
  });

  const corrupt: Array<[string, (trade: PaperStrategyTrade) => void]> = [
    ['zero samples', trade => { trade.measurement!.pointCount = 0; }],
    ['too few samples for the retained distinct points', trade => { trade.measurement!.pointCount = 2; }],
    ['wrong full-history start', trade => { trade.measurement!.startedAt = '2026-09-18T01:00:01Z'; }],
    ['history before entry', trade => { trade.measurement!.startedAt = '2026-09-18T00:59:00Z'; }],
    ['quote before entry', trade => { trade.measurement!.lowest.effectiveAt = trade.measurement!.lowest.observedAt = '2026-09-18T00:59:56Z'; }],
    ['quote after scheduled exit', trade => { Object.assign(trade.measurement!.latest, { effectiveAt: '2026-09-23T07:00:00Z', observedAt: '2026-09-23T07:00:00Z', recordedAt: '2026-09-23T07:00:00Z' }); }],
    ['quote effective time differs from observation', trade => { trade.measurement!.latest.effectiveAt = '2026-09-18T01:03:01Z'; }],
    ['future observation', trade => { trade.measurement!.latest.observedAt = '2026-09-18T01:04:00Z'; }],
    ['future recorded point', trade => { trade.measurement!.latest.recordedAt = '2026-09-18T01:04:00Z'; }],
    ['highest below the latest price', trade => { trade.measurement!.highest.price = 10400; }],
    ['lowest above the latest price', trade => { trade.measurement!.lowest.price = 10600; }],
    ['future highest', trade => { trade.measurement!.highest.recordedAt = '2026-09-18T01:04:00Z'; }],
    ['invented net return', trade => { trade.measurement!.highest.netReturnPct += 1; }],
    ['invented net profit', trade => { trade.measurement!.lowest.netPnl += 1; }],
    ['mutated frozen cost', trade => { trade.costModel.sellFeeRate += 0.01; }],
    ['entry snapshot reused as quote', trade => { trade.measurement!.latest.snapshotId = trade.entrySnapshotId; }],
    ['two meanings for one snapshot', trade => { trade.measurement!.latest.snapshotId = trade.measurement!.highest.snapshotId; }],
    ['quote marked as BUY', trade => { trade.measurement!.latest.action = 'BUY'; }],
    ['quote given an EXIT reason', trade => { trade.measurement!.latest.reasonCode = 'SCHEDULED_CLOSE_REACHED'; }],
  ];
  it.each(corrupt)('rejects %s', (_, mutate) => {
    const ledger = path(); mutate(ledger.trades[0]);
    expect(() => assertPaperStrategyLedger(ledger)).toThrow('INVALID');
  });

  it('requires identical points for a single observation', () => {
    const trade = measured().trades[0];
    trade.measurement!.highest.observedAt = '2026-09-18T00:59:54Z';
    expect(() => assertPaperTradeMeasurement(trade)).toThrow('INVALID');
  });

  it('rejects fabricated repeated entry counts and quotes imported from an earlier date', () => {
    const trade = measured().trades[0]; trade.measurement!.pointCount = 2;
    expect(() => assertPaperTradeMeasurement(trade)).toThrow('INVALID');
    const sample = row(path().trades[0]); sample.recordedAt = '2026-09-21T01:00:00Z';
    expect(() => assertPaperTradeMeasurementRows([sample])).toThrow('INVALID');
  });

  it.each(['price', 'effectiveAt', 'observedAt', 'recordedAt', 'snapshotId', 'source'] as const)('rejects altered close %s', key => {
    const trade = closed().trades[0], close = trade.measurement!.latest;
    if (key === 'price') close.price += 1;
    else if (key === 'snapshotId' || key === 'source') close[key] = 'different';
    else close[key] = '2026-09-28T01:01:00Z';
    expect(() => assertPaperTradeMeasurement(trade)).toThrow('INVALID');
  });

  it('preserves the previous valid summary when close measurement capture failed', () => {
    const ledger = closed(); ledger.trades[0].measurement = path().trades[0].measurement;
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
  });
});

describe('measurement journal validation', () => {
  it('accepts the actual capture helper through entry, holding, restart and confirmed close', () => {
    const snapshot = adaptiveTestSnapshot();
    snapshot.observations[0].observedAt = '2026-09-18T00:59:55Z';
    const adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf);
    let ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, () => measured().trades[0].costModel, adaptive);
    const check = () => {
      const rows = capturePaperTradeMeasurements(ledger, snapshot);
      expect(rows).toHaveLength(1);
      expect(() => assertPaperTradeMeasurementRows(rows, ledger.trades)).not.toThrow();
      expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
      ledger = JSON.parse(JSON.stringify(ledger));
    };
    check();
    snapshot.id = 'holding'; snapshot.asOf = '2026-09-18T01:01:00Z';
    snapshot.observations[0].observedAt = '2026-09-18T01:00:55Z'; snapshot.observations[0].price = 11000;
    snapshot.observations[0].features!.asOf = snapshot.asOf;
    ledger = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, adaptive); check();
    snapshot.id = 'confirmed-close'; snapshot.asOf = '2026-09-28T01:00:00Z'; snapshot.tradingDate = '2026-09-28';
    snapshot.observations[0].dailyCloses = [{ tradingDate: ledger.trades[0].scheduledExitDate,
      close: 10500, availableAt: '2026-09-28T00:59:50Z' }];
    ledger = evaluatePaperStrategyScan(ledger, snapshot, strategyTestCost, adaptive); check();
  });

  it('validates standalone rows plus frozen trade accounting when context is supplied', () => {
    const trade = path().trades[0], rows = [row(trade)];
    expect(() => assertPaperTradeMeasurementRows(rows)).not.toThrow();
    expect(() => assertPaperTradeMeasurementRows(rows, [trade])).not.toThrow();
    rows[0].netPnl += 1;
    expect(() => assertPaperTradeMeasurementRows(rows, [trade])).toThrow('INVALID');
  });

  it('rejects duplicate trade/snapshot records, unknown trades, mismatched entry links and malformed rows', () => {
    const trade = path().trades[0], sample = row(trade);
    for (const rows of [[sample, sample], [{ ...sample, tradeId: 'missing' }],
      [{ ...sample, entrySnapshotId: 'other-entry' }], [{ ...sample, observedAt: 'tomorrow' }], [{ ...sample, price: NaN }]]) {
      expect(() => assertPaperTradeMeasurementRows(rows, [trade])).toThrow('INVALID');
    }
  });

  it('keeps feature capture time distinct from the slightly earlier quote time', () => {
    const sample = row(path().trades[0]);
    Object.assign(sample, { ruleValue: 20, ruleMatches: true, ruleConnected: false, featureAsOf: sample.recordedAt });
    expect(() => assertPaperTradeMeasurementRows([sample])).not.toThrow();
    sample.featureAsOf = '2026-09-18T01:04:00Z';
    expect(() => assertPaperTradeMeasurementRows([sample])).toThrow('INVALID');
    sample.featureAsOf = '2026-09-17T01:03:05Z';
    expect(() => assertPaperTradeMeasurementRows([sample])).toThrow('INVALID');
  });

  it('checks a frozen adaptive rule reading while allowing missing later input independently of connection', () => {
    const snapshot = adaptiveTestSnapshot(), adaptive = selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf);
    const trade = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost, adaptive).trades[0];
    const entry = point(trade, { snapshotId: trade.entrySnapshotId, kind: 'ENTRY', effectiveAt: trade.entryAt,
      observedAt: trade.entryObservation.observedAt, recordedAt: trade.entryAt, action: 'BUY', reasonCode: trade.entryDecision.reasonCode,
      ruleValue: 20, ruleMatches: true, ruleConnected: true, featureAsOf: snapshot.asOf });
    expect(() => assertPaperTradeMeasurementRows([row(trade, entry)], [trade])).not.toThrow();
    expect(() => assertPaperTradeMeasurementRows([row(trade, { ...entry, ruleValue: 21 })], [trade])).toThrow('INVALID');
    expect(() => assertPaperTradeMeasurementRows([row(trade, point(trade, { ruleConnected: true }))], [trade])).not.toThrow();
    expect(() => assertPaperTradeMeasurementRows([row(trade, point(trade, { ruleValue: 80, ruleMatches: true,
      featureAsOf: '2026-09-18T01:01:05Z' }))], [trade])).toThrow('INVALID');
  });
});
