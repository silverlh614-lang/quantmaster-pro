// @responsibility Verify indicator math, point-in-time boundaries, and independent feature research.
import { describe, expect, it } from 'vitest';
import type { PaperDailyClose, PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperFeatures, addPaperPeerComparison, summarizePaperFeatureCoverage } from './paperObservationFeatures.js';
import { buildPaperFeatureStudy } from './paperFeatureStudy.js';
import { createPaperExperiment, updatePaperOutcomes } from './paperExperimentPolicy.js';

const asOf = '2026-09-18T01:00:00Z';
function observation(count = 70, slope = 1): PaperObservation {
  let date = '2026-09-17';
  const dailyCloses: PaperDailyClose[] = [];
  for (let i = 0; i < count; i++) {
    const close = 200 - i * slope;
    dailyCloses.push({ tradingDate: date, availableAt: asOf, close, open: close, high: close + 1, low: close - 1, volume: 1000 });
    date = previousKrxTradingDay(new Date(`${date}T12:00:00+09:00`));
  }
  return { symbol: '005930', name: '삼성전자', market: 'KOSPI', price: 205, observedAt: asOf, source: 'KIS',
    dailyCloses, news: [], aboveMa20: true, return1dPct: null, return5dPct: null };
}
const snapshot: PaperSnapshot = { id: 's1', asOf, tradingDate: '2026-09-18', marketOpen: true, observations: [] };
const cost = { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 };

describe('same-snapshot observation features', () => {
  it('computes known monotonic Wilder RSI, ATR, ADX and SMA values', () => {
    const values = calculatePaperFeatures(observation(), asOf).values;
    expect(values.rsi14).toBe(100);
    expect(values.rsiChange5).toBe(0);
    expect(values.atr14Pct).toBeCloseTo(1);
    expect(values.adx14).toBeCloseTo(100);
    expect(values.volumeRatio20).toBe(1);
    expect(values.return20).toBeCloseTo((200 / 180 - 1) * 100);
    expect(values.ma20Gap).toBeCloseTo((200 / 190.5 - 1) * 100);
    expect(values.macdHistogramPct).toBeCloseTo(0, 8);
    expect(values.stochasticK14).toBeCloseTo(14 / 15 * 100);
  });
  it('continues the 60-session history across the July 17 exchange holiday', () => {
    const input = observation();
    expect(previousKrxTradingDay(new Date('2026-07-20T12:00:00+09:00'))).toBe('2026-07-16');
    expect(input.dailyCloses.some(row => row.tradingDate === '2026-07-17')).toBe(false);
    expect(calculatePaperFeatures(input, asOf).values.ma60Gap).toBeCloseTo((200 / 170.5 - 1) * 100);
  });
  it('handles flat prices and real zero volume without infinity or artificial missing values', () => {
    const input = observation(70, 0);
    input.dailyCloses[0].volume = 0;
    const values = calculatePaperFeatures(input, asOf).values;
    expect(values.rsi14).toBe(50);
    expect(values.adx14).toBe(0);
    expect(values.bollingerB).toBeNull();
    expect(values.volumeRatio20).toBe(0);
  });
  it('does not include unfinished or future candles or change daily RSI with intraday price', () => {
    const input = observation();
    const expected = calculatePaperFeatures(input, asOf);
    input.price = 99999;
    input.dailyCloses.unshift({ tradingDate: '2026-09-18', availableAt: asOf, close: 99999 });
    input.dailyCloses.push({ tradingDate: '2026-09-21', availableAt: asOf, close: 99999 });
    expect(calculatePaperFeatures(input, asOf)).toEqual(expected);
  });
  it('breaks the history at a missing session instead of shortening the trading horizon', () => {
    const input = observation();
    input.dailyCloses.splice(10, 1);
    const values = calculatePaperFeatures(input, asOf).values;
    expect(values.rsi14).toBeNull();
    expect(values.return20).toBeNull();
    expect(values.per).toBeNull();
  });
  it('rejects missing latest close, duplicate dates and bars retrieved in the future', () => {
    for (const mutate of [
      (row: PaperObservation) => { row.dailyCloses.shift(); },
      (row: PaperObservation) => { row.dailyCloses.push({ ...row.dailyCloses[0] }); },
      (row: PaperObservation) => { row.dailyCloses[0].availableAt = '2026-09-19T00:00:00Z'; },
    ]) {
      const input = observation(); mutate(input);
      expect(calculatePaperFeatures(input, asOf).technicalDate).toBeNull();
    }
  });
  it('handles Saturday using Friday completed bars and blocks stale financial cache', () => {
    const input = observation();
    input.dailyCloses.unshift({ ...input.dailyCloses[0], tradingDate: '2026-09-18', availableAt: '2026-09-18T07:00:00Z' });
    const result = calculatePaperFeatures(input, '2026-09-19T03:00:00Z', { symbol: input.symbol,
      observedAt: '2026-09-16T00:00:00Z', kis: null, dart: { period: '2026Q2', statement: 'CFS', operatingCashFlowSign: -1, equityRatio: -5 }, issues: [] });
    expect(result.technicalDate).toBe('2026-09-18');
    expect(result.financials).toBeNull();
  });
  it('invalid ranges disable range indicators while price indicators remain available', () => {
    const input = observation(); input.dailyCloses[0].high = 1;
    const result = calculatePaperFeatures(input, asOf);
    expect(result.values.atr14Pct).toBeNull();
    expect(result.values.stochasticK14).toBeNull();
    expect(result.values.rsi14).toBe(100);
  });
  it('separates same-market peer relative strength from exchange indices and requires 20 peers', () => {
    const rows = Array.from({ length: 20 }, (_, i) => { const row = observation(); row.symbol = String(i).padStart(6, '0');
      row.features = calculatePaperFeatures(row, asOf); row.features.values.return20 = i; return row; });
    addPaperPeerComparison(rows);
    expect(rows[0].features!.values.peerRelative20).toBe(-9.5);
    expect(rows[19].features!.values.peerRelative20).toBe(9.5);
    const missing = observation();
    const coverage = summarizePaperFeatureCoverage([...rows, missing], asOf);
    expect(coverage.available.peerRelative20).toBe(20);
    expect(coverage.candidateCount).toBe(21);
  });
});

describe('frozen feature outcome research', () => {
  it('preserves entry features through later outcomes and does not block baseline for missing features', () => {
    const input = observation(); input.features = calculatePaperFeatures(input, asOf);
    const record = createPaperExperiment(snapshot, input, cost)!;
    input.features.values.rsi14 = 20;
    expect(record.entryObservation.features!.values.rsi14).toBe(100);
    expect(createPaperExperiment(snapshot, { ...input, features: undefined }, cost)).not.toBeNull();
    const updated = updatePaperOutcomes(record, { ...input, dailyCloses: [{ tradingDate: '2026-09-21', close: 220, availableAt: '2026-09-21T07:00:00Z' }] }, '2026-09-21T07:00:00Z');
    const study = buildPaperFeatureStudy([updated, updated], '2026-09-21T07:00:00Z');
    expect(study.totalCount).toBe(1);
    const rsi = study.features.find(item => item.key === 'rsi14')!;
    expect(rsi.groups[3].outcomes[0]).toMatchObject({ count: 1, entryDateCount: 1 });
    expect(rsi.groups[3].outcomes[0].meanNetReturnPct).toBeCloseTo((220 / 205 - 1) * 100);
    expect(rsi.groups[0].count).toBe(0);
    expect(buildPaperFeatureStudy([updated], asOf).features[0].groups[3].outcomes[0].count).toBe(0);
  });
  it('does not backfill legacy entries or accept future entry features', () => {
    const row = createPaperExperiment(snapshot, observation(), cost)!;
    expect(buildPaperFeatureStudy([row], asOf).recordedCount).toBe(0);
    row.entryObservation.features = calculatePaperFeatures(observation(), '2026-09-19T03:00:00Z');
    expect(buildPaperFeatureStudy([row], '2026-09-20T03:00:00Z').recordedCount).toBe(0);
  });
});
