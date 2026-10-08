// @responsibility Supply dated autonomous Shadow fixtures.
import type { PaperExperiment, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import { PAPER_FEATURES, type PaperFeatureValues } from '../../../src/types/paperObservationFeatures.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { createPaperExperiment, updatePaperOutcomes } from './paperExperimentPolicy.js';
import { strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';

type Returns = readonly [number, number, number];
type ReturnSource = Returns | ((date: string, dateIndex: number) => Returns);
export interface AdaptiveSampleOptions {
  startDate?: string;
  entryDateCount?: number;
  /** Symbols per date; every eight repeat the same four selected and four control rows. */
  symbolCount?: number;
  selectedReturns?: ReturnSource;
  controlReturns?: ReturnSource;
  features?: (selected: boolean) => Partial<PaperFeatureValues>;
}

export function adaptiveTestSnapshot(): PaperSnapshot {
  const snapshot = strategyTestSnapshot();
  snapshot.observations[0].market = 'KOSPI';
  snapshot.observations[0].features = {
    version: 'observation-features-v1', asOf: snapshot.asOf, technicalDate: '2026-09-17', financials: null,
    values: { ...Object.fromEntries(Object.keys(PAPER_FEATURES).map(key => [key, null])) as PaperFeatureValues, rsi14: 20 },
  };
  return snapshot;
}

export function matureAdaptiveSamples(options: AdaptiveSampleOptions = {}): PaperExperiment[] {
  const start = options.startDate ?? '2026-07-20';
  if (!isKrxTradingDay(start)) throw new Error('Adaptive fixture must begin on a KRX trading day');
  const selectedReturns: ReturnSource = options.selectedReturns ?? [1, 9, 10];
  const controlReturns: ReturnSource = options.controlReturns ?? [0, 0, 0];
  const resolve = (source: ReturnSource, date: string, index: number) => typeof source === 'function' ? source(date, index) : source;
  return Array.from({ length: options.entryDateCount ?? 32 }, (_, dateIndex) => {
    const date = dateIndex ? addBusinessDaysFromKstDate(start, dateIndex) : start;
    return Array.from({ length: options.symbolCount ?? 8 }, (_, symbolIndex) => {
      const snapshot = adaptiveTestSnapshot(), selected = symbolIndex % 8 < 4;
      snapshot.tradingDate = date; snapshot.asOf = `${date}T01:00:00Z`; snapshot.id = `adaptive-${date}`;
      const observation = snapshot.observations[0];
      observation.symbol = String(100 + symbolIndex).padStart(6, '0'); observation.observedAt = snapshot.asOf;
      observation.features!.asOf = snapshot.asOf; observation.features!.technicalDate = date;
      observation.features!.values.rsi14 = selected ? 20 : 60;
      Object.assign(observation.features!.values, options.features?.(selected));
      const returns = resolve(selected ? selectedReturns : controlReturns, date, dateIndex);
      const experiment = createPaperExperiment(snapshot, observation, strategyTestCost())!;
      const dailyCloses = ([1, 3, 5] as const).map((horizon, index) => {
        const tradingDate = addBusinessDaysFromKstDate(date, horizon);
        return { tradingDate, close: observation.price! * (1 + returns[index] / 100), availableAt: `${tradingDate}T07:00:00Z` };
      });
      return updatePaperOutcomes(experiment, { ...observation, dailyCloses }, dailyCloses[2].availableAt);
    });
  }).flat();
}
