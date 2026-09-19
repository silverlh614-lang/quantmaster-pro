// @responsibility Calculate contemporaneous research features without changing entry eligibility.
import type { PaperDailyClose, PaperObservation } from '../../../src/types/paperExperiment.js';
import { PAPER_FEATURES, type PaperFeatureKey, type PaperFeatureValues, type PaperFinancialFacts, type PaperObservationFeatures, type PaperFeatureCoverage } from '../../../src/types/paperObservationFeatures.js';
import { isKrxTradingDay, previousKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

export const featureKeys = Object.keys(PAPER_FEATURES) as PaperFeatureKey[];
const mean = (xs: number[]) => xs.reduce((sum, value) => sum + value, 0) / xs.length;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const range = (bar: PaperDailyClose) => positive(bar.high) && positive(bar.low) && bar.high >= bar.low
  && bar.close >= bar.low && bar.close <= bar.high && (!positive(bar.open) || bar.open >= bar.low && bar.open <= bar.high);

function ema(xs: number[], period: number): number[] {
  if (xs.length < period) return [];
  const result = [mean(xs.slice(0, period))];
  for (const x of xs.slice(period)) result.push(result[result.length - 1] + 2 / (period + 1) * (x - result[result.length - 1]));
  return result;
}
function wilder(xs: number[], period: number): number[] {
  if (xs.length < period) return [];
  const result = [mean(xs.slice(0, period))];
  for (const x of xs.slice(period)) result.push((result[result.length - 1] * (period - 1) + x) / period);
  return result;
}

export function calculatePaperFeatures(observation: Pick<PaperObservation, 'symbol' | 'dailyCloses' | 'price'>,
  asOf: string, financials: PaperFinancialFacts | null = null, per: number | null = null): PaperObservationFeatures {
  const values = Object.fromEntries(featureKeys.map(key => [key, null])) as PaperFeatureValues;
  const cutoff = Date.parse(asOf);
  const date = toKstDateKey(new Date(asOf));
  let expected = isKrxTradingDay(date) && cutoff >= Date.parse(`${date}T15:30:00+09:00`) ? date : previousKrxTradingDay(new Date(asOf));
  const byDate = new Map<string, PaperDailyClose>();
  const duplicates = new Set<string>();
  for (const bar of observation.dailyCloses) {
    if (!positive(bar.close) || !(Date.parse(bar.availableAt) <= cutoff)
      || !(Date.parse(`${bar.tradingDate}T15:30:00+09:00`) <= cutoff)) continue;
    if (byDate.has(bar.tradingDate)) duplicates.add(bar.tradingDate);
    byDate.set(bar.tradingDate, bar);
  }
  const newest: PaperDailyClose[] = [];
  // Missing sessions break the series; never silently call 14 available rows 14 trading days.
  while (byDate.has(expected) && !duplicates.has(expected) && newest.length < 100) {
    newest.push(byDate.get(expected)!);
    expected = previousKrxTradingDay(new Date(`${expected}T12:00:00+09:00`));
  }
  const bars = [...newest].reverse(), closes = bars.map(bar => bar.close), n = bars.length;
  const last = newest[0], close = last?.close;
  if (last && positive(close)) {
    if (n >= 15) {
      const changes = closes.slice(1).map((value, i) => value - closes[i]);
      const up = wilder(changes.map(value => Math.max(0, value)), 14);
      const down = wilder(changes.map(value => Math.max(0, -value)), 14);
      const rsi = up.map((value, i) => value + down[i] === 0 ? 50 : 100 * value / (value + down[i]));
      values.rsi14 = rsi.at(-1)!;
      if (rsi.length >= 6) values.rsiChange5 = rsi.at(-1)! - rsi.at(-6)!;
    }
    if (n >= 20) {
      const recent = closes.slice(-20), average = mean(recent);
      values.ma20Gap = (close / average - 1) * 100;
      const sd = Math.sqrt(mean(recent.map(value => (value - average) ** 2)));
      if (sd > 0) values.bollingerB = (close - (average - 2 * sd)) / (4 * sd) * 100;
      const volumes = newest.slice(0, 20);
      if (volumes.every(bar => finite(bar.volume) && bar.volume >= 0)) values.turnover20 = mean(volumes.map(bar => bar.close * bar.volume!)) / 1e8;
    }
    if (n >= 21) {
      values.return20 = (close / newest[20].close - 1) * 100;
      const prior = newest.slice(1, 21);
      if (finite(last.volume) && last.volume >= 0 && prior.every(bar => finite(bar.volume) && bar.volume >= 0)) {
        const volume = mean(prior.map(bar => bar.volume!));
        if (volume > 0) values.volumeRatio20 = last.volume / volume;
      }
      if (prior.every(range)) values.high20Gap = (close / Math.max(...prior.map(bar => bar.high!)) - 1) * 100;
    }
    if (n >= 25) values.ma20Slope5 = (mean(newest.slice(0, 20).map(bar => bar.close)) / mean(newest.slice(5, 25).map(bar => bar.close)) - 1) * 100;
    if (n >= 60) values.ma60Gap = (close / mean(newest.slice(0, 60).map(bar => bar.close)) - 1) * 100;
    if (n >= 2 && positive(last.open) && range(last)) values.gapPct = (last.open / newest[1].close - 1) * 100;
    if (n >= 14 && newest.slice(0, 14).every(range)) {
      const high = Math.max(...newest.slice(0, 14).map(bar => bar.high!)), low = Math.min(...newest.slice(0, 14).map(bar => bar.low!));
      if (high > low) values.stochasticK14 = (close - low) / (high - low) * 100;
    }
    if (n >= 15 && bars.every(range)) {
      const tr = bars.slice(1).map((bar, i) => Math.max(bar.high! - bar.low!, Math.abs(bar.high! - bars[i].close), Math.abs(bar.low! - bars[i].close)));
      const atr = wilder(tr, 14);
      values.atr14Pct = atr.at(-1)! / close * 100;
      const plus = wilder(bars.slice(1).map((bar, i) => {
        const up = bar.high! - bars[i].high!, down = bars[i].low! - bar.low!;
        return up > 0 && up > down ? up : 0;
      }), 14);
      const minus = wilder(bars.slice(1).map((bar, i) => {
        const up = bar.high! - bars[i].high!, down = bars[i].low! - bar.low!;
        return down > 0 && down > up ? down : 0;
      }), 14);
      const dx = plus.map((p, i) => p + minus[i] === 0 ? 0 : 100 * Math.abs(p - minus[i]) / (p + minus[i]));
      values.adx14 = wilder(dx, 14).at(-1) ?? null;
    }
    if (n >= 34) {
      const fast = ema(closes, 12), slow = ema(closes, 26);
      const macd = slow.map((value, i) => fast[i + 14] - value), signal = ema(macd, 9);
      values.macdHistogramPct = (macd.at(-1)! - signal.at(-1)!) / close * 100;
    }
  }
  const age = cutoff - Date.parse(financials?.observedAt ?? '');
  const facts = financials?.symbol === observation.symbol && age >= 0 && age <= 2 * 86_400_000 ? structuredClone(financials) : null;
  if (facts?.kis) {
    for (const key of ['roe', 'operatingMargin', 'netMargin', 'revenueGrowth', 'debtRatio', 'currentRatio'] as const) values[key] = facts.kis[key];
    if (positive(observation.price) && positive(facts.kis.bps)) values.pbr = observation.price / facts.kis.bps;
  }
  if (facts?.dart?.period) {
    values.operatingCashFlowSign = facts.dart.operatingCashFlowSign;
    values.equityRatio = facts.dart.equityRatio;
  }
  if (positive(observation.price) && positive(per)) values.per = per;
  for (const key of featureKeys) if (!finite(values[key])) values[key] = null;
  return { version: 'observation-features-v1', asOf, technicalDate: last?.tradingDate ?? null, financials: facts, values };
}

/** This is a contemporaneous observed-universe comparison, NOT an exchange index return. */
export function addPaperPeerComparison(observations: PaperObservation[]): void {
  for (const market of ['KOSPI', 'KOSDAQ'] as const) {
    const rows = observations.filter(row => row.market === market && finite(row.features?.values.return20));
    const dates = new Set(rows.map(row => row.features!.technicalDate));
    if (rows.length < 20 || dates.size !== 1) continue;
    const sorted = rows.map(row => row.features!.values.return20!).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    for (const row of rows) row.features!.values.peerRelative20 = row.features!.values.return20! - median;
  }
}
export function summarizePaperFeatureCoverage(observations: PaperObservation[], asOf: string): PaperFeatureCoverage {
  return { asOf, candidateCount: observations.length,
    available: Object.fromEntries(featureKeys.map(key => [key, observations.filter(row => finite(row.features?.values[key])).length])) as Record<PaperFeatureKey, number> };
}
