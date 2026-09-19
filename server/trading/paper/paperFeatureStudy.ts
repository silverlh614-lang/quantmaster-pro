// @responsibility Compare frozen individual feature groups with exact-date cost-adjusted outcomes.
import type { PaperExperiment } from '../../../src/types/paperExperiment.js';
import { PAPER_FEATURES, type PaperFeatureStudy } from '../../../src/types/paperObservationFeatures.js';
import { featureKeys } from './paperObservationFeatures.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';

export function buildPaperFeatureStudy(experiments: PaperExperiment[], asOf: string): PaperFeatureStudy {
  const cutoff = Date.parse(asOf);
  const rows = [...new Map([...experiments].sort((a, b) => b.entryAt.localeCompare(a.entryAt))
    .filter(row => Date.parse(row.entryAt) <= cutoff).map(row => [`${row.symbol}:${row.tradingDate}`, row])).values()];
  const recorded = rows.filter(row => row.entryObservation.features?.version === 'observation-features-v1'
    && Date.parse(row.entryObservation.features.asOf) <= Date.parse(row.entryAt));
  // Calendar validation is shared by all 26 features, not repeated for every bucket.
  const results = new Map(recorded.map(row => [row, ([1, 3, 5] as const).map(horizon => {
    const due = addBusinessDaysFromKstDate(row.tradingDate, horizon);
    return row.outcomes.find(item => item.horizon === horizon && item.tradingDate === due
      && Number.isFinite(item.netReturnPct) && Date.parse(item.availableAt) <= cutoff
      && Date.parse(item.availableAt) >= Date.parse(`${due}T15:30:00+09:00`));
  })]));
  return { totalCount: rows.length, recordedCount: recorded.length, features: featureKeys.map(key => {
    const valid = recorded.filter(row => typeof row.entryObservation.features!.values[key] === 'number'
      && Number.isFinite(row.entryObservation.features!.values[key]));
    const definition = PAPER_FEATURES[key], cuts: readonly number[] = definition.cuts;
    return { key, availableCount: valid.length, missingCount: rows.length - valid.length,
      groups: Array.from({ length: cuts.length + 1 }, (_, index) => {
        const lower = index === 0 ? -Infinity : cuts[index - 1], upper = cuts[index] ?? Infinity;
        const selected = valid.filter(row => { const value = row.entryObservation.features!.values[key]!; return value >= lower && value < upper; });
        const label = index === 0 ? `${upper}${definition.unit} 미만` : index === cuts.length ? `${lower}${definition.unit} 이상`
          : `${lower} 이상 ~ ${upper}${definition.unit} 미만`;
        return { label, count: selected.length, symbolCount: new Set(selected.map(row => row.symbol)).size,
          entryDateCount: new Set(selected.map(row => row.tradingDate)).size,
          outcomes: ([1, 3, 5] as const).map((horizon, horizonIndex) => {
            const pairs = selected.flatMap(row => {
              const outcome = results.get(row)![horizonIndex];
              return outcome ? [{ row, outcome }] : [];
            });
            return { horizon, count: pairs.length, symbolCount: new Set(pairs.map(pair => pair.row.symbol)).size,
              entryDateCount: new Set(pairs.map(pair => pair.row.tradingDate)).size,
              meanNetReturnPct: pairs.length ? pairs.reduce((sum, pair) => sum + pair.outcome.netReturnPct, 0) / pairs.length : null,
              winRatePct: pairs.length ? pairs.filter(pair => pair.outcome.netReturnPct > 0).length / pairs.length * 100 : null };
          }) };
      }) };
  }) };
}
