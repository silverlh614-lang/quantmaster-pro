// @responsibility Measure entry-frozen investor flow associations with subsequent returns.
import type { PaperExperiment, PaperObservation, PaperOutcome } from '../../../src/types/paperExperiment.js';
import type { PaperFlowActor, PaperFlowCorrelation, PaperFlowGroup, PaperFlowIssue, PaperInvestorFlowSnapshot, PaperInvestorFlowStudy } from '../../../src/types/paperInvestorFlow.js';
import { PAPER_FLOW_ISSUE_LABELS } from '../../../src/types/paperInvestorFlow.js';
import { summarizePaperNews } from '../../../src/utils/paperNews.js';
import { pearsonCorrelation } from '../../../src/utils/correlationMatrix.js';
import { previousKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';

const horizons = [1, 3, 5] as const;
const actors: PaperFlowActor[] = ['FOREIGN', 'INSTITUTION', 'COMBINED'];
const flowGroups: PaperFlowGroup[] = ['BOTH_BUY', 'BOTH_SELL', 'DIVERGENT', 'OTHER'];
type Row = { experiment: PaperExperiment; foreign: number; institution: number; combined: number;
  news: ReturnType<typeof summarizePaperNews>['direction']; group: PaperFlowGroup };
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function invalidFlow(experiment: Pick<PaperExperiment, 'symbol' | 'entryAt' | 'tradingDate' | 'entryObservation'>, asOf: number): PaperFlowIssue | null {
  const flow = experiment.entryObservation.investorFlow;
  if (!flow) return 'NOT_RECORDED';
  if (flow.issue !== null) return Object.hasOwn(PAPER_FLOW_ISSUE_LABELS, flow.issue) ? flow.issue : 'UNAVAILABLE';
  const entry = Date.parse(experiment.entryAt);
  if (!(entry <= asOf) || toKstDateKey(new Date(entry)) !== experiment.tradingDate) return 'TIME_INVALID';
  if (flow.source !== 'KIS_API' || flow.unit !== 'SHARES' || flow.symbol !== experiment.symbol) return 'SYMBOL_MISMATCH';
  const date = previousKrxTradingDay(new Date(entry));
  if (flow.tradingDate !== date || flow.requestedTradingDate !== date) return 'DATE_MISMATCH';
  const observed = Date.parse(flow.observedAt ?? '');
  if (!(observed >= Date.parse(`${date}T15:30:00+09:00`) && observed <= entry)) return 'TIME_INVALID';
  if (typeof flow.foreignNetShares !== 'number' || !Number.isSafeInteger(flow.foreignNetShares)
    || typeof flow.institutionalNetShares !== 'number' || !Number.isSafeInteger(flow.institutionalNetShares)) return 'QUANTITY_MISSING';
  if (typeof flow.volume !== 'number' || !Number.isSafeInteger(flow.volume) || flow.volume <= 0) return 'VOLUME_MISSING';
  if (Math.abs(flow.foreignNetShares) > flow.volume || Math.abs(flow.institutionalNetShares) > flow.volume) return 'VOLUME_MISMATCH';
  return null;
}

/** Average ranks preserve ties, including real zero net purchases. */
function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++;
    for (let i = start; i < end; i++) result[sorted[i].index] = (start + end - 1) / 2 + 1;
    start = end;
  }
  return result;
}

function correlate(rows: Array<Pick<PaperExperiment, 'symbol' | 'tradingDate'>>, xs: number[], ys: number[]): PaperFlowCorrelation {
  const counts = { count: rows.length, symbolCount: new Set(rows.map(row => row.symbol)).size,
    entryDateCount: new Set(rows.map(row => row.tradingDate)).size };
  if (rows.length < 3) return { ...counts, pearson: null, spearman: null, status: 'INSUFFICIENT_PAIRS' };
  const pearson = pearsonCorrelation(xs, ys);
  const spearman = pearsonCorrelation(ranks(xs), ranks(ys));
  const bound = (value: number | null) => value !== null && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null;
  return { ...counts, pearson: bound(pearson), spearman: bound(spearman), status: pearson === null ? 'NO_VARIATION' : 'AVAILABLE' };
}

function outcomeAt(row: Row, horizon: 1 | 3 | 5, asOf: number): PaperOutcome | undefined {
  const date = addBusinessDaysFromKstDate(row.experiment.tradingDate, horizon);
  return row.experiment.outcomes.find(outcome => outcome.horizon === horizon && outcome.tradingDate === date
    && Number.isFinite(outcome.netReturnPct) && Date.parse(outcome.availableAt) <= asOf
    && Date.parse(outcome.availableAt) >= Date.parse(`${date}T15:30:00+09:00`));
}

function flowGroup(foreign: number, institution: number): PaperFlowGroup {
  return foreign > 0 && institution > 0 ? 'BOTH_BUY' : foreign < 0 && institution < 0 ? 'BOTH_SELL'
    : foreign * institution < 0 ? 'DIVERGENT' : 'OTHER';
}

/** Current cross-sectional association is separate from entry-frozen outcome research. */
export function summarizeCurrentInvestorFlow(observations: PaperObservation[], asOf: string): PaperInvestorFlowSnapshot {
  const tradingDate = toKstDateKey(new Date(asOf));
  const unique = [...new Map(observations.map(observation => [observation.symbol, observation])).values()];
  const contexts = unique.map(entryObservation => ({ entryObservation, symbol: entryObservation.symbol, entryAt: asOf, tradingDate }));
  const valid = contexts.filter(context => !invalidFlow(context, Date.parse(asOf)));
  const foreign = valid.map(context => context.entryObservation.investorFlow!.foreignNetShares! / context.entryObservation.investorFlow!.volume! * 100);
  const institution = valid.map(context => context.entryObservation.investorFlow!.institutionalNetShares! / context.entryObservation.investorFlow!.volume! * 100);
  return { asOf, tradingDate: previousKrxTradingDay(new Date(asOf)), candidateCount: unique.length, availableCount: valid.length,
    flowCorrelation: correlate(valid, foreign, institution),
    groups: flowGroups.map(group => ({ group, count: foreign.filter((value, index) => flowGroup(value, institution[index]) === group).length })) };
}

export function buildPaperInvestorFlowStudy(experiments: PaperExperiment[], asOf: string): PaperInvestorFlowStudy {
  const cutoff = Date.parse(asOf);
  const missing: PaperInvestorFlowStudy['missing'] = {};
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const experiment of [...experiments].sort((a, b) => a.entryAt.localeCompare(b.entryAt))) {
    const key = `${experiment.symbol}:${experiment.tradingDate}`;
    const issue = seen.has(key) ? 'DUPLICATE_ENTRY' : invalidFlow(experiment, cutoff);
    seen.add(key);
    if (issue) { missing[issue] = (missing[issue] ?? 0) + 1; continue; }
    const flow = experiment.entryObservation.investorFlow!;
    const foreign = flow.foreignNetShares! / flow.volume! * 100;
    const institution = flow.institutionalNetShares! / flow.volume! * 100;
    const group = flowGroup(foreign, institution);
    rows.push({ experiment, foreign, institution, combined: foreign + institution, group,
      news: summarizePaperNews(experiment.entryObservation.news, experiment.entryAt).direction });
  }
  const newsGroups: Array<PaperInvestorFlowStudy['segments'][number]['news']> = ['ALL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED', 'UNKNOWN', 'NO_NEWS'];
  return { version: 'previous-session-flow-v1', totalCount: experiments.length, availableCount: rows.length, missing,
    segments: newsGroups.map(news => {
      const matching = rows.filter(row => news === 'ALL' || row.news === news);
      return { news, observationCount: matching.length,
        flowCorrelation: correlate(matching.map(row => row.experiment), matching.map(row => row.foreign), matching.map(row => row.institution)),
        correlations: actors.flatMap(actor => horizons.map(horizon => {
          const pairs = matching.flatMap(row => { const outcome = outcomeAt(row, horizon, cutoff); return outcome ? [{ row, outcome }] : []; });
          return { actor, horizon, ...correlate(pairs.map(pair => pair.row.experiment),
            pairs.map(({ row }) => actor === 'FOREIGN' ? row.foreign : actor === 'INSTITUTION' ? row.institution : row.combined),
            pairs.map(pair => pair.outcome.netReturnPct)) };
        })),
        groups: flowGroups.map(group => {
          const selected = matching.filter(row => row.group === group);
          return { group, observationCount: selected.length, meanForeignPctVolume: mean(selected.map(row => row.foreign)),
            meanInstitutionPctVolume: mean(selected.map(row => row.institution)), outcomes: horizons.map(horizon => {
              const values = selected.flatMap(row => { const outcome = outcomeAt(row, horizon, cutoff); return outcome ? [outcome.netReturnPct] : []; });
              return { label: `D${horizon}`, horizon, count: values.length, meanNetReturnPct: mean(values),
                winRatePct: values.length ? values.filter(value => value > 0).length / values.length * 100 : null };
            }) };
        }) };
    }) };
}
