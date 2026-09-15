// @responsibility Verify news classification without hindsight or trading restrictions.
import { describe, expect, it } from 'vitest';
import type { PaperNewsObservation } from '../../../src/types/paperExperiment.js';
import { assessPaperNews } from './paperNewsAssessment.js';
import { summarizePaperNews } from '../../../src/utils/paperNews.js';
import { buildPaperExperimentView, createPaperExperiment } from './paperExperimentPolicy.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';

const at = '2026-09-18T01:00:00Z';
function news(headline: string, source = 'DART'): PaperNewsObservation {
  const item = { id: headline, headline, source, observedAt: '2026-09-18T00:00:00Z' };
  return { ...item, assessment: assessPaperNews(item, at) };
}

describe('conservative disclosure title assessment', () => {
  it.each([
    ['대규모 수주', 'POSITIVE'], ['단일판매ㆍ공급계약체결', 'POSITIVE'], ['흑자 전환', 'POSITIVE'],
    ['영업이익 증가', 'POSITIVE'], ['적자 폭 축소', 'POSITIVE'], ['자기주식취득결정', 'POSITIVE'],
    ['상장폐지', 'NEGATIVE'], ['영업이익 감소', 'NEGATIVE'], ['적자 전환', 'NEGATIVE'],
    ['단일판매ㆍ공급계약해지', 'NEGATIVE'], ['횡령ㆍ배임 혐의 발생', 'NEGATIVE'],
    ['대규모 수주, 영업이익 감소', 'MIXED'], ['정기주주총회결과', 'NEUTRAL'],
    ['[기재정정]단일판매ㆍ공급계약체결', 'UNKNOWN'], ['횡령 사실무근', 'UNKNOWN'],
    ['유상증자 철회', 'UNKNOWN'], ['공급계약 체결 예정', 'UNKNOWN'], ['수주 계약 체결하지 않음', 'UNKNOWN'],
    ['상장폐지 사유 해소', 'UNKNOWN'], ['상장폐지 결정 취소', 'UNKNOWN'],
    ['자기주식취득 신탁계약 해지 결정', 'UNKNOWN'], ['영업이익 증가율 감소', 'UNKNOWN'],
    ['영업(잠정)실적(공정공시)', 'UNKNOWN'], ['유상증자결정', 'UNKNOWN'],
    ['전환사채권발행결정', 'UNKNOWN'], ['기업설명회 개최', 'UNKNOWN'], ['', 'UNKNOWN'],
  ])('%s → %s', (title, direction) => {
    expect(news(title).assessment).toMatchObject({ direction, method: 'DISCLOSURE_TITLE_RULES', version: 'headline-rules-v1', assessedAt: at });
  });

  it.each(['SUPPLY_CHAIN', 'EWY_FOREIGN', 'SECTOR_FLOW', 'UNKNOWN'])('does not transfer %s headlines to issuer sentiment', source => {
    expect(news('대규모 수주', source).assessment?.direction).toBe('UNKNOWN');
  });
});

describe('entry-time news summaries', () => {
  it('treats malformed legacy news as unknown without stopping observation views', () => {
    const malformed = [null, { source: 'DART', observedAt: at }, { ...news('대규모 수주'), observedAt: 'invalid' }] as unknown as PaperNewsObservation[];
    expect(summarizePaperNews(malformed, at)).toMatchObject({ direction: 'UNKNOWN', totalCount: 3, counts: { UNKNOWN: 3 } });
    expect(assessPaperNews({ source: 'DART', observedAt: at } as PaperNewsObservation, at).direction).toBe('UNKNOWN');
    const ledger = { schemaVersion: 1 as const, experiments: matureStrategySamples(), lastRun: null };
    ledger.experiments[0].entryObservation.news = malformed;
    expect(() => buildPaperExperimentView(ledger)).not.toThrow();
  });
  it('keeps opposing signs and exposes incomplete coverage', () => {
    expect(summarizePaperNews([news('대규모 수주'), news('계약 해지')], at).direction).toBe('MIXED');
    expect(summarizePaperNews([news('대규모 수주'), news('영업실적')], at)).toMatchObject({
      direction: 'UNKNOWN', counts: { POSITIVE: 1, UNKNOWN: 1 }, totalCount: 2,
    });
  });

  it('distinguishes no observed recent news from unassessed old records', () => {
    const old = news('대규모 수주');
    delete old.assessment;
    expect(summarizePaperNews([old], at).direction).toBe('UNKNOWN');
    expect(summarizePaperNews([], at).direction).toBe('NO_NEWS');
    old.observedAt = '2026-09-14T00:00:00Z';
    expect(summarizePaperNews([old], at).direction).toBe('NO_NEWS');
  });

  it.each(['2026-09-18T01:00:01Z', '2026-09-17T23:59:59Z', 'invalid'])('rejects assessment time %s', assessedAt => {
    const item = news('대규모 수주');
    item.assessment!.assessedAt = assessedAt;
    expect(summarizePaperNews([item], at).direction).toBe('UNKNOWN');
  });

  it('rejects unsupported assessments, deduplicates IDs and excludes future news', () => {
    const item = news('대규모 수주');
    expect(summarizePaperNews([item, structuredClone(item)], at).totalCount).toBe(1);
    const unsupported = { ...item, assessment: { ...item.assessment!, version: 'future-model' } } as unknown as PaperNewsObservation;
    expect(summarizePaperNews([unsupported], at).direction).toBe('UNKNOWN');
    expect(summarizePaperNews([{ ...item, observedAt: '2026-09-18T02:00:00Z' }], at).direction).toBe('NO_NEWS');
    expect(summarizePaperNews([item], 'invalid').direction).toBe('UNKNOWN');
  });
});

describe('independent direction study', () => {
  it('freezes nested assessments without rewriting prior observations', () => {
    const snapshot = strategyTestSnapshot();
    snapshot.observations[0].news = [news('대규모 수주')];
    const experiment = createPaperExperiment(snapshot, snapshot.observations[0], strategyTestCost())!;
    snapshot.observations[0].news[0].assessment!.direction = 'NEGATIVE';
    expect(experiment.entryObservation.news[0].assessment!.direction).toBe('POSITIVE');
  });

  it('groups all records, preserves unknown historical assessments, and never uses later labels', () => {
    const experiments = matureStrategySamples([1, 9, 10], true);
    for (const [index, experiment] of experiments.entries()) {
      const item = experiment.entryObservation.news[0];
      item.headline = index % 2 ? '계약 해지' : '대규모 수주';
      if (index < 6) item.assessment = assessPaperNews(item, experiment.entryAt);
      // These were assessed after entry: no hindsight label even though the headline existed.
      else if (index < 9) item.assessment = assessPaperNews(item, at);
    }
    const before = JSON.stringify(experiments);
    const view = buildPaperExperimentView({ schemaVersion: 1, experiments, lastRun: null });
    const group = (direction: string) => view.newsStudy!.groups.find(item => item.direction === direction)!;
    expect(group('POSITIVE')).toMatchObject({ observationCount: 3, outcomes: [
      { horizon: 1, count: 3, meanNetReturnPct: 1 }, { horizon: 3, count: 3, meanNetReturnPct: 9 }, { horizon: 5, count: 3, meanNetReturnPct: 10 },
    ] });
    expect(group('NEGATIVE').observationCount).toBe(3);
    expect(group('UNKNOWN').observationCount).toBe(6);
    expect(JSON.stringify(experiments)).toBe(before);
  });

  it('records bad news in BUY and WAIT evidence without changing v2 eligibility', () => {
    const snapshot = strategyTestSnapshot();
    snapshot.observations[0].news = [news('계약 해지')];
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples([1, 9, 10], true), snapshot, strategyTestCost);
    expect(ledger.latestDecisions[0]).toMatchObject({ action: 'BUY', newsSummary: { direction: 'NEGATIVE' } });
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(ledger)))).not.toThrow();
    snapshot.marketOpen = false;
    const waiting = evaluatePaperStrategyScan(emptyStrategyLedger(), [], snapshot, strategyTestCost);
    expect(waiting.latestDecisions[0]).toMatchObject({ action: 'WAIT', newsSummary: { direction: 'NEGATIVE' } });
    expect(ledger.trades[0].entryObservation.news[0].assessment?.direction).toBe('NEGATIVE');
  });
});
