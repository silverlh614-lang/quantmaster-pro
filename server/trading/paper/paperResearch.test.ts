// @responsibility Verify historical reconstruction, temporal separation and honest evidence reuse.
import { describe, expect, it } from 'vitest';
import type { ResearchArchive } from '../../../src/types/paperResearch.js';
import { buildPaperResearch, historicalSampleUsable } from './paperResearch.js';
import { buildPaperStrategyEvidence, PAPER_STRATEGY_POLICY } from './paperStrategyEvidence.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { strategyTestCost, strategyTestSnapshot, emptyStrategyLedger } from './paperStrategyFixtures.js';
import { isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';

export function researchFixture(): ResearchArchive {
  const closes: Array<{ date: string; close: number }> = [];
  for (let day = new Date('2026-01-01T12:00:00Z'); day < new Date('2026-06-01'); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (isKrxTradingDay(date)) closes.push({ date, close: 100 + closes.length });
  }
  return { schemaVersion: 1, inventory: [], series: [{ id: 'chart-series', symbol: '005930', source: 'ARCHIVED_CHART',
    retrievedAt: '2026-06-01T07:00:00Z', closes }], news: closes.map((bar) => ({
    symbol: '005930', id: `news:${bar.date}`, observedAt: `${bar.date}T01:00:00Z`, source: 'DART', headline: '저장 공시',
  })) };
}
const asOf = '2026-09-12T23:00:00Z';

describe('archived paper research', () => {
  it('replays exact paired horizons using only prior MA20 prices and preserves input', () => {
    const archive = researchFixture();
    const before = JSON.stringify(archive);
    const { samples, view } = buildPaperResearch(archive, asOf, strategyTestCost);
    expect(samples.length).toBeGreaterThan(20);
    expect(JSON.stringify(archive)).toBe(before);
    const sample = samples[0];
    expect(sample.aboveMa20).toBe(true);
    expect(sample.cohort).toBe('NEWS_RECENT_ABOVE_MA20');
    expect(sample.outcomes.map((item) => item.horizon)).toEqual([1, 3, 5]);
    expect(sample.outcomes[0].netReturnPct).toBeCloseTo(100 / sample.entryPrice);
    expect(view.learningSampleCount).toBe(samples.length);
  });

  it('does not turn missing retained news into NEWS_ABSENT evidence', () => {
    const archive = researchFixture(); archive.news = [];
    const result = buildPaperResearch(archive, asOf, strategyTestCost);
    expect(result.view.sampleCount).toBeGreaterThan(0);
    expect(result.view.learningSampleCount).toBe(0);
    expect(result.view.groups[0].group).toBe('NEWS_UNKNOWN_ABOVE_MA20');
    const evidence = buildPaperStrategyEvidence([], 'NEWS_ABSENT_ABOVE_MA20', '2026-09-13T00:00:00Z', PAPER_STRATEGY_POLICY, result.samples);
    expect(evidence.sampleCount).toBe(0);
  });

  it('counts symbol/date only once and prefers complete KIS series over archived charts', () => {
    const archive = researchFixture();
    archive.series.push({ ...structuredClone(archive.series[0]), id: 'kis', source: 'KIS_SNAPSHOT' });
    const result = buildPaperResearch(archive, asOf, strategyTestCost);
    expect(new Set(result.samples.map((item) => item.id)).size).toBe(result.samples.length);
    expect(result.samples.every((item) => item.source === 'KIS_SNAPSHOT')).toBe(true);
  });

  it('rejects unavailable dates, incomplete horizons, future news and unsupported calendar years', () => {
    const archive = researchFixture();
    archive.news.forEach((item) => { item.observedAt = '2026-12-01T00:00:00Z'; });
    archive.series[0].closes.push({ date: '2025-12-29', close: 80 });
    archive.series[0].closes.splice(50, 1);
    const result = buildPaperResearch(archive, asOf, strategyTestCost);
    expect(result.view.learningSampleCount).toBe(0);
    expect(result.view.skipped.UNSUPPORTED_CALENDAR_YEAR).toBe(1);
    expect(result.samples.every((item) => item.outcomes.every((outcome) => archive.series[0].closes.some((bar) => bar.date === outcome.tradingDate)))).toBe(true);
    archive.series[0].retrievedAt = '2026-12-01T00:00:00Z';
    expect(buildPaperResearch(archive, asOf, strategyTestCost).samples).toHaveLength(0);
  });

  it('learns a horizon on earlier labels only and evaluates it on later entry dates', () => {
    const result = buildPaperResearch(researchFixture(), asOf, strategyTestCost);
    const validation = result.view.validation[0];
    const train = result.samples.filter((item) => item.outcomes.every((outcome) => outcome.tradingDate < validation.splitDate));
    expect(validation.trainingCount).toBe(train.length);
    expect(validation.testCount).toBe(result.samples.filter((item) => item.tradingDate >= validation.splitDate).length);
    expect(validation.trainingCount + validation.testCount).toBeLessThan(result.samples.length);
  });

  it('connects historical evidence to new strategy trades without copying research returns into trade P&L', () => {
    const { samples } = buildPaperResearch(researchFixture(), asOf, strategyTestCost);
    expect(historicalSampleUsable(samples[0], asOf)).toBe(false);
    const snapshot = strategyTestSnapshot();
    snapshot.observations[0].news = [{ id: 'current-news', headline: '공시', source: 'DART', observedAt: snapshot.asOf }];
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), [], snapshot, strategyTestCost, samples);
    expect(ledger.trades).toHaveLength(1);
    expect(ledger.trades[0].entryDecision.evidence?.historicalSampleCount).toBe(samples.length);
    expect(ledger.trades[0].exit).toBeNull();
    expect(() => assertPaperStrategyLedger(ledger)).not.toThrow();
    const damaged = structuredClone(ledger);
    damaged.trades[0].entryDecision.evidence!.historicalSampleCount = 0;
    expect(() => assertPaperStrategyLedger(damaged)).toThrow();
  });
});
