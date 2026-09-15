// @responsibility Verify factual news provenance across entry-frozen research.
import { describe, expect, it } from 'vitest';
import type { PaperNewsObservation } from '../../../src/types/paperExperiment.js';
import { readPaperNewsFacts } from '../../../src/utils/paperNewsFacts.js';
import { summarizePaperNews } from '../../../src/utils/paperNews.js';
import { recordPaperNewsFacts } from './paperNewsAssessment.js';
import { buildPaperNewsFactsStudy } from './paperNewsFactsStudy.js';
import { createPaperExperiment } from './paperExperimentPolicy.js';
import { evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { assertPaperStrategyLedger } from './paperStrategyValidation.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { emptyStrategyLedger, matureStrategySamples, strategyTestCost, strategyTestSnapshot } from './paperStrategyFixtures.js';

const at = '2026-09-18T01:00:00Z';
function news(title = '단일판매ㆍ공급계약체결', time = at): PaperNewsObservation {
  const receiptNo = `${time.slice(0, 10).replace(/-/g, '')}000001`;
  const item = { id: `dart:${receiptNo}`, headline: title, source: 'DART', observedAt: time };
  return { ...item, facts: recordPaperNewsFacts(item, time, { receiptNo, filedDate: time.slice(0, 10), firstSeenAt: time, linkMethod: 'DART_STOCK_CODE' }) };
}
describe('factual disclosure provenance', () => {
  it.each([
    ['단일판매ㆍ공급계약체결', 'CONTRACT', 'FILED'], ['[기재정정]단일판매ㆍ공급계약체결', 'CONTRACT', 'AMENDED'],
    ['유상증자 철회', 'FINANCING', 'WITHDRAWN'], ['[첨부추가]사업보고서', 'EARNINGS', 'AMENDED'],
    ['자기주식취득결정', 'TREASURY', 'FILED'], ['주식등의대량보유상황보고서', 'OWNERSHIP', 'FILED'],
    ['횡령ㆍ배임 혐의 발생', 'LEGAL', 'FILED'], ['상장폐지', 'LISTING', 'FILED'],
  ])('records %s as a filed subject without inventing an impact', (title, event, filingStatus) => {
    const item = news(title);
    expect(readPaperNewsFacts(item, at)).toMatchObject({ event, filingStatus, relationship: 'DIRECT', filedDate: '2026-09-18', firstSeenAt: at });
    expect(item.assessment).toBeUndefined();
  });
  it('distinguishes indirect sector news and old records without a verified filing', () => {
    const item = { ...news(), source: 'SUPPLY_CHAIN' };
    expect(recordPaperNewsFacts(item, at)).toMatchObject({ relationship: 'INDIRECT', event: 'OTHER', sourceUrl: null });
    expect(recordPaperNewsFacts(news(), at).relationship).toBe('UNVERIFIED');
    expect(readPaperNewsFacts({ ...news(), facts: undefined }, at)).toBeUndefined();
  });
  it('excludes future, impossible or mismatched provenance and unsafe original links', () => {
    for (const change of [
      { recordedAt: '2026-09-18T02:00:00Z' }, { firstSeenAt: '2026-09-18T02:00:00Z' },
      { filedDate: '2026-02-30' }, { filedDate: '2026-09-19' }, { sourceUrl: 'https://unrelated.example' }, { receiptNo: '20260918000002' },
    ]) {
      const item = news(); Object.assign(item.facts!, change);
      expect(readPaperNewsFacts(item, at)).toBeUndefined();
    }
    expect(readPaperNewsFacts({ ...news(), source: 'SUPPLY_CHAIN' }, at)).toBeUndefined();
  });
  it('exposes multiple direct events even when all headline directions are unknown', () => {
    const first = news('사업보고서'), second = news('유상증자결정');
    second.id = 'dart:20260918000002'; second.facts!.receiptNo = '20260918000002';
    second.facts!.sourceUrl = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260918000002';
    expect(summarizePaperNews([first, second], at).evidence).toHaveLength(2);
  });
  it('freezes facts for baseline and strategy entries without changing BUY eligibility', () => {
    const snapshot = strategyTestSnapshot(); snapshot.observations[0].news = [news()];
    const baseline = createPaperExperiment(snapshot, snapshot.observations[0], strategyTestCost())!;
    const strategy = evaluatePaperStrategyScan(emptyStrategyLedger(), matureStrategySamples([1, 9, 10], true), snapshot, strategyTestCost);
    expect(strategy.trades).toHaveLength(1);
    snapshot.observations[0].news[0].facts!.filingStatus = 'WITHDRAWN';
    expect(baseline.entryObservation.news[0].facts!.filingStatus).toBe('FILED');
    expect(strategy.trades[0].entryObservation.news[0].facts!.filingStatus).toBe('FILED');
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(strategy)))).not.toThrow();
    delete strategy.trades[0].entryObservation.news[0].facts;
    expect(() => assertPaperStrategyLedger(JSON.parse(JSON.stringify(strategy)))).not.toThrow();
  });
});
describe('event cohorts from entry-frozen records', () => {
  it('counts each experiment once per type, separates amendments and pairs only dated valid flows', () => {
    const rows = matureStrategySamples().slice(0, 4);
    rows.forEach((row, index) => {
      row.entryObservation.news = [news(index === 1 ? '[정정]단일판매ㆍ공급계약체결' : '단일판매ㆍ공급계약체결', row.entryAt)];
      const date = previousKrxTradingDay(new Date(row.entryAt));
      row.entryObservation.investorFlow = { source: 'KIS_API', unit: 'SHARES', symbol: row.symbol, requestedTradingDate: date,
        tradingDate: date, observedAt: row.entryAt, foreignNetShares: 100, institutionalNetShares: -50, volume: 1000, issue: null };
    });
    rows[0].entryObservation.news.push(structuredClone(rows[0].entryObservation.news[0]));
    rows[2].entryObservation.investorFlow!.tradingDate = '2026-08-27';
    delete rows[3].entryObservation.news[0].facts;
    const result = buildPaperNewsFactsStudy(rows, at);
    expect(result).toMatchObject({ recordedCount: 3, unrecordedCount: 1 });
    expect(result.groups.find(row => row.key === 'CONTRACT')).toMatchObject({ observationCount: 2, entryDateCount: 1,
      flowCount: 1, meanForeignPctVolume: 10, meanInstitutionPctVolume: -5,
      outcomes: [{ horizon: 1, count: 2, meanNetReturnPct: 1 }, { horizon: 3, count: 2 }, { horizon: 5, count: 2 }] });
    expect(result.groups.find(row => row.key === 'AMENDED')?.observationCount).toBe(1);
    const before = buildPaperNewsFactsStudy(rows, rows[0].entryAt);
    expect(before.groups.find(row => row.key === 'CONTRACT')!.outcomes.every(row => row.count === 0)).toBe(true);
    rows[0].entryObservation.news.forEach(item => { item.facts!.recordedAt = at; });
    expect(buildPaperNewsFactsStudy(rows, at).recordedCount).toBe(2);
  });
});
