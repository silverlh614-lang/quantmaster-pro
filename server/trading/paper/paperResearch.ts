// @responsibility Reconstruct historical research with chronological validation.
import type { PaperCostModel } from '../../../src/types/paperExperiment.js';
import type { HistoricalPaperSample, PaperResearchView, ResearchArchive, ResearchGroupResult } from '../../../src/types/paperResearch.js';
import type { PaperStrategyHorizon } from '../../../src/types/paperStrategy.js';
import { isKrxTradingDay, previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate, getStaticKrxHolidays } from '../krxHolidays.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { createResearchFeatureReader } from './paperResearchFeatures.js';
import { compareResearchFeatures } from './paperResearchComparison.js';

const horizons = [1, 3, 5] as const;
const closeAt = (date: string) => `${date}T15:30:00+09:00`;
const calendarYears = new Set([...getStaticKrxHolidays()].map((date) => date.slice(0, 4)));
const groupOf = (sample: HistoricalPaperSample) => sample.cohort ?? `NEWS_UNKNOWN_${sample.aboveMa20 ? 'ABOVE' : 'BELOW'}_MA20`;

export function historicalSampleUsable(sample: HistoricalPaperSample, cutoff: string): boolean {
  if (sample.model !== 'HISTORICAL_CLOSE_TO_CLOSE' || !/^\d{6}$/.test(sample.symbol)
    || sample.id !== `historical-close:${sample.tradingDate}:${sample.symbol}`
    || !calendarYears.has(sample.tradingDate.slice(0, 4)) || !isKrxTradingDay(sample.tradingDate) || !(sample.entryPrice > 0) || !Number.isFinite(sample.entryPrice)
    || Date.parse(sample.entryAt) !== Date.parse(closeAt(sample.tradingDate))
    || !(Date.parse(sample.reconstructedAt) < Date.parse(cutoff))
    || ![sample.costModel.buyFeeRate, sample.costModel.sellFeeRate, sample.costModel.sellTaxRate, sample.costModel.slippageRate]
      .every((rate) => Number.isFinite(rate) && rate >= 0)) return false;
  return horizons.every((horizon) => {
    const outcomes = sample.outcomes.filter((item) => item.horizon === horizon);
    const item = outcomes[0];
    return outcomes.length === 1 && item.tradingDate === addBusinessDaysFromKstDate(sample.tradingDate, horizon)
      && Number.isFinite(item.exitPrice) && item.exitPrice > 0 && Number.isFinite(item.netReturnPct)
      && Date.parse(item.availableAt) >= Date.parse(closeAt(item.tradingDate))
      && Date.parse(item.availableAt) <= Date.parse(sample.reconstructedAt)
      && Date.parse(item.availableAt) < Date.parse(cutoff);
  });
}

function summarize(group: string, samples: HistoricalPaperSample[]): ResearchGroupResult {
  return { group, count: samples.length, entryDates: new Set(samples.map((item) => item.tradingDate)).size,
    horizons: horizons.map((horizon) => {
      const values = samples.map((item) => item.outcomes.find((outcome) => outcome.horizon === horizon)!.netReturnPct);
      return { horizon, meanNetReturnPct: values.reduce((sum, value) => sum + value, 0) / values.length,
        winRatePct: values.filter((value) => value > 0).length / values.length * 100 };
    }) };
}

export function buildPaperResearch(
  archive: ResearchArchive, asOf: string, costForSymbol: (symbol: string) => PaperCostModel,
): { samples: HistoricalPaperSample[]; view: PaperResearchView } {
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const selected = new Map<string, HistoricalPaperSample>();
  const calendars = new Map<string, { prior: string[]; targets: string[] }>();
  const costs = new Map<string, PaperCostModel>();
  const readFeatures = createResearchFeatureReader(archive, asOf);
  // Prefer KIS where a complete KIS series is available. Never splice differing price bases.
  const richness = (item: typeof archive.series[number]) => item.closes.filter((bar) => bar.volume !== undefined || bar.high !== undefined).length;
  const series = archive.series.filter((item) => !['^KS11', '^KQ11'].includes(item.symbol)).sort((a, b) =>
    Number(b.source === 'KIS_SNAPSHOT') - Number(a.source === 'KIS_SNAPSHOT')
    || b.retrievedAt.localeCompare(a.retrievedAt) || richness(b) - richness(a)
    || b.closes.length - a.closes.length || a.id.localeCompare(b.id));
  const news = new Map<string, typeof archive.news>();
  for (const item of archive.news) {
    if (!Number.isFinite(Date.parse(item.observedAt)) || Date.parse(item.observedAt) > Date.parse(asOf)) continue;
    news.set(item.symbol, [...(news.get(item.symbol) ?? []), item]);
  }
  for (const item of series) {
    if (!/^\d{6}$/.test(item.symbol) || !Number.isFinite(Date.parse(item.retrievedAt))
      || Date.parse(item.retrievedAt) > Date.parse(asOf)) { skip('INVALID_SERIES'); continue; }
    const prices = new Map<string, number>();
    const conflicts = new Set<string>();
    for (const bar of item.closes) {
      if (!isKrxTradingDay(bar.date) || !Number.isFinite(bar.close) || bar.close <= 0
        || Date.parse(closeAt(bar.date)) > Math.min(Date.parse(asOf), Date.parse(item.retrievedAt))) continue;
      if (prices.has(bar.date) && prices.get(bar.date) !== bar.close) conflicts.add(bar.date);
      prices.set(bar.date, bar.close);
    }
    for (const date of conflicts) prices.delete(date);
    for (const [date, price] of prices) {
      const key = `${date}:${item.symbol}`;
      if (selected.has(key)) continue;
      if (!calendarYears.has(date.slice(0, 4))) { skip('UNSUPPORTED_CALENDAR_YEAR'); continue; }
      let calendar = calendars.get(date);
      if (!calendar) {
        let cursor = date;
        const prior = Array.from({ length: 20 }, () => {
          cursor = previousKrxTradingDay(new Date(`${cursor}T12:00:00+09:00`));
          return cursor;
        });
        calendar = { prior, targets: horizons.map((horizon) => addBusinessDaysFromKstDate(date, horizon)) };
        calendars.set(date, calendar);
      }
      const prior = calendar.prior.map((previous) => calendarYears.has(previous.slice(0, 4)) ? prices.get(previous) : undefined);
      if (prior.some((value) => value === undefined)) { skip('MISSING_PRIOR_20_CLOSES'); continue; }
      const targetDates = calendar.targets;
      if (targetDates.some((target) => !calendarYears.has(target.slice(0, 4)) || !prices.has(target))) { skip('MISSING_EXACT_D1_D3_D5'); continue; }
      const aboveMa20 = price > prior.reduce<number>((sum, value) => sum + value!, 0) / 20;
      const entryAt = new Date(closeAt(date)).toISOString();
      const recent = (news.get(item.symbol) ?? []).filter((event) =>
        Date.parse(event.observedAt) <= Date.parse(entryAt) && Date.parse(event.observedAt) >= Date.parse(entryAt) - 72 * 3_600_000);
      if (!costs.has(item.symbol)) costs.set(item.symbol, costForSymbol(item.symbol));
      const costModel = costs.get(item.symbol)!;
      if (![costModel.buyFeeRate, costModel.sellFeeRate, costModel.sellTaxRate, costModel.slippageRate]
        .every((rate) => Number.isFinite(rate) && rate >= 0)) { skip('INVALID_COST_MODEL'); continue; }
      const outcomes = horizons.map((horizon, index) => {
        const tradingDate = targetDates[index];
        const exitPrice = prices.get(tradingDate)!;
        return { horizon, tradingDate, availableAt: item.retrievedAt, exitPrice,
          ...calculatePaperReturn(price, exitPrice, costModel) };
      });
      selected.set(key, { id: `historical-close:${key}`, model: 'HISTORICAL_CLOSE_TO_CLOSE', symbol: item.symbol,
        tradingDate: date, entryAt, entryPrice: price, aboveMa20,
        cohort: recent.length ? `NEWS_RECENT_${aboveMa20 ? 'ABOVE' : 'BELOW'}_MA20` : null,
        newsIds: recent.map((event) => event.id), seriesId: item.id, source: item.source,
        reconstructedAt: asOf, costModel: { ...costModel }, outcomes,
        features: readFeatures(item, date, calendar.prior) });
    }
  }
  const samples = [...selected.values()].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate) || a.symbol.localeCompare(b.symbol));
  const groups = [...new Set(samples.map(groupOf))].map((group) => summarize(group, samples.filter((item) => groupOf(item) === group)));
  const dates = [...new Set(samples.map((item) => item.tradingDate))];
  const splitDate = dates.length >= 2 ? dates[Math.floor(dates.length * 0.7)] : null;
  const validation: PaperResearchView['validation'] = [];
  if (splitDate) for (const group of groups) {
    // Purge training labels reaching the test period, even if their entry date is earlier.
    const train = samples.filter((item) => groupOf(item) === group.group && item.tradingDate < splitDate
      && item.outcomes.every((outcome) => outcome.tradingDate < splitDate));
    const test = samples.filter((item) => groupOf(item) === group.group && item.tradingDate >= splitDate);
    if (!train.length) continue;
    const ranked = summarize(group.group, train).horizons.sort((a, b) =>
      b.meanNetReturnPct / b.horizon - a.meanNetReturnPct / a.horizon || a.horizon - b.horizon);
    const selectedHorizon: PaperStrategyHorizon = ranked[0].horizon;
    const values = test.map((item) => item.outcomes.find((outcome) => outcome.horizon === selectedHorizon)!.netReturnPct);
    validation.push({ group: group.group, splitDate, trainingCount: train.length, testCount: test.length, selectedHorizon,
      testMeanNetReturnPct: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      testWinRatePct: values.length ? values.filter((value) => value > 0).length / values.length * 100 : null });
  }
  return { samples, view: { asOf, symbols: new Set(samples.map((item) => item.symbol)).size,
    seriesCount: archive.series.length, newsCount: archive.news.length, sampleCount: samples.length,
    learningSampleCount: samples.filter((item) => item.cohort !== null).length,
    firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, skipped, inventory: archive.inventory, groups, validation,
    benchmarkSeriesCount: archive.series.filter((item) => ['^KS11', '^KQ11'].includes(item.symbol)).length,
    featureStudies: compareResearchFeatures(samples, splitDate),
    featureNotes: [
      '7개 조건을 각각 비교합니다. 총점·중복 가감점·조건 일괄 통과·레짐 제한을 적용하지 않으며 매매 정책에 자동 반영하지 않습니다.',
      '숫자 조건은 앞선 학습 기간의 중앙값으로 둘로 나눕니다. 구간과 보유기간은 학습 자료에서만 선택하고 후반 자료에서 확인합니다.',
      '비교 차이는 후반의 동일 진입일·뉴스/20일선 그룹·보유기간을 맞춰 계산합니다. 각 날짜/그룹을 동일 가중하며 대조군에는 선택 종목도 포함됩니다.',
      '조건 결손 표본은 해당 조건의 양쪽 비교에서 제외합니다. 서로 다른 조건의 표본 수와 종목·기간 구성은 다를 수 있습니다.',
      '가격 위치는 기존 Gate 3 계산을 재사용합니다. 거래량은 진입일 확정 일봉, 고점·평균·변동폭은 진입일 이전 봉만 사용합니다.',
      '상대강도는 해당 시장의 보관 지수와 정확한 20거래일을 맞춥니다. 코스닥 지수가 부족할 때 코스피로 대체하지 않습니다.',
      '기존 수급 건강도·통과 점수·섹터 이름만으로 당시 수급량이나 업종 강도를 만들지 않습니다. 이번 확장 연구는 가격·거래량·보관 지수 범위입니다.',
      '여러 가설을 비교하는 탐색 연구입니다. 겹치는 보유기간·종목 상관·사후 수정주가·표본 편중이 남으며 우위의 인과관계나 통계적 유의성을 증명하지 않습니다.',
    ],
    notes: [
      '과거 종가→종가 재현 연구입니다. 실제 장중 체결·새 전략의 실시간 거래 성과와 구분합니다.',
      '현재 보관된 과거 차트로 계산한 회고 검증입니다. 당시 저장본 전체를 복원한 실시간 검증은 아닙니다.',
      '기록이 남지 않은 뉴스는 미확인으로 분류해 추세 연구에 사용합니다. 뉴스가 확인되는 표본만 뉴스 전략 초기 학습에 연결합니다.',
      '동일 종목·진입일은 한 번만 계산합니다. 과거 선정 종목과 보관된 차트에 따른 표본 편중이 남습니다.',
      '비용은 재현 시점 설정을 적용한 가정이며, 당시의 실제 비용이나 체결 가능성을 증명하지 않습니다.',
      '후반 검증은 날짜순 70/30 분리이며, 검증 기간까지 결과가 이어지는 학습 표본은 제외합니다. 상관된 종목·기간의 반복 표본을 포함합니다.',
      '기존 Shadow·미진입 원장은 보유 현황을 확인하되, 옛 손절·익절 손익을 새 기간별 수익률로 복사하지 않습니다.',
    ] } };
}
