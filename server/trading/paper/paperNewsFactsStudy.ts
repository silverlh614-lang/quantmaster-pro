// @responsibility Compare frozen news events with observed subsequent performance.
import type { PaperExperiment } from '../../../src/types/paperExperiment.js';
import { PAPER_NEWS_EVENT_LABELS, type PaperNewsFactsStudy } from '../../../src/types/paperNewsFacts.js';
import { readPaperNewsFacts } from '../../../src/utils/paperNewsFacts.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { invalidFlow } from './paperInvestorFlowStudy.js';
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function buildPaperNewsFactsStudy(experiments: PaperExperiment[], asOf: string): PaperNewsFactsStudy {
  const cutoff = Date.parse(asOf);
  const rows = experiments.map(experiment => {
    const entry = Date.parse(experiment.entryAt);
    const keys = new Set<string>();
    if (entry <= cutoff) for (const news of experiment.entryObservation.news) {
      if (!news || !(Date.parse(news.observedAt) >= entry - 72 * 3_600_000 && Date.parse(news.observedAt) <= entry)) continue;
      const facts = readPaperNewsFacts(news, experiment.entryAt);
      if (facts) keys.add(facts.relationship !== 'DIRECT' ? facts.relationship
        : facts.filingStatus === 'FILED' ? facts.event : facts.filingStatus);
    }
    return { experiment, keys };
  });
  const groups = { ...PAPER_NEWS_EVENT_LABELS, AMENDED: '정정·변경 공시', WITHDRAWN: '철회·취하 공시',
    INDIRECT: '간접·업종 자료', UNVERIFIED: '기업 연결 미확인' };
  const recordedCount = rows.filter(row => row.keys.size).length;
  return { recordedCount, unrecordedCount: rows.length - recordedCount, groups: Object.entries(groups).map(([key, label]) => {
    const selected = rows.filter(row => row.keys.has(key)).map(row => row.experiment);
    const flows = selected.flatMap(row => {
      const flow = row.entryObservation.investorFlow;
      return flow && !invalidFlow(row, cutoff)
        ? [{ foreign: flow.foreignNetShares! / flow.volume! * 100, institution: flow.institutionalNetShares! / flow.volume! * 100 }] : [];
    });
    return { key, label, observationCount: selected.length, entryDateCount: new Set(selected.map(row => row.tradingDate)).size,
      flowCount: flows.length, meanForeignPctVolume: mean(flows.map(row => row.foreign)), meanInstitutionPctVolume: mean(flows.map(row => row.institution)),
      outcomes: ([1, 3, 5] as const).map(horizon => {
        const values = selected.flatMap(row => {
          const date = addBusinessDaysFromKstDate(row.tradingDate, horizon);
          const outcome = row.outcomes.find(item => item.horizon === horizon && item.tradingDate === date
            && Number.isFinite(item.netReturnPct) && Date.parse(item.availableAt) >= Date.parse(`${date}T15:30:00+09:00`)
            && Date.parse(item.availableAt) <= cutoff);
          return outcome ? [outcome.netReturnPct] : [];
        });
        return { label: `D${horizon}`, horizon, count: values.length, meanNetReturnPct: mean(values),
          winRatePct: values.length ? values.filter(value => value > 0).length / values.length * 100 : null };
      }) };
  }) };
}
