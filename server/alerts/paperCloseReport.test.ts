// @responsibility Verify close summaries preserve daily attribution without hindsight.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView, PaperOutcome } from '../../src/types/paperExperiment.js';
import { createPaperExperiment } from '../trading/paper/paperExperimentPolicy.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from '../trading/paper/paperStrategyPolicy.js';
import { emptyStrategyLedger, strategyTestCost, strategyTestSnapshot } from '../trading/paper/paperStrategyFixtures.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { recordPaperNewsFacts, assessPaperNews } from '../trading/paper/paperNewsAssessment.js';
import { summarizePaperNews } from '../../src/utils/paperNews.js';
import { formatPaperCloseReport } from './paperCloseReport.js';
import { formatPaperAdaptiveSummary } from './paperResearchMessages.js';

const date = '2026-09-21';
const now = new Date(`${date}T16:10:00+09:00`);
function experiment(day: string, symbol: string, outcomes: PaperOutcome[] = []) {
  const snapshot = strategyTestSnapshot(); snapshot.asOf = `${day}T01:00:00Z`; snapshot.tradingDate = day;
  snapshot.observations[0] = { ...snapshot.observations[0], symbol, observedAt: snapshot.asOf };
  return { ...createPaperExperiment(snapshot, snapshot.observations[0], strategyTestCost())!, outcomes };
}
const outcome = (day: string, value: number, availableAt = `${day}T07:00:00Z`): PaperOutcome => ({
  horizon: 1, tradingDate: day, availableAt, netReturnPct: value, grossReturnPct: value, exitPrice: 10000 * (1 + value / 100), netPnl: value * 100,
});
function viewFixture(): PaperExperimentView {
  return { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', totalCount: 3, openCount: 3, completedCount: 0,
    groups: [], outcomes: [], experiments: [experiment('2026-09-18', '005930', [outcome(date, 0)]),
      experiment('2026-09-17', '000660', [outcome('2026-09-18', 5, `${date}T07:00:00Z`)]), experiment(date, '035420')],
    lastRun: { snapshotId: 'close', asOf: now.toISOString(), candidateCount: 3, observedCount: 2, missingPriceCount: 1,
      openedCount: 0, completedCount: 0, marketOpen: false, issues: [] },
    strategy: buildPaperStrategyView(emptyStrategyLedger()) };
}
function report(view = viewFixture()) { return formatPaperCloseReport(view, date, now); }

describe('Shadow closing summary', () => {
  it('separates today, cumulative and delayed outcomes, preserving real zero returns', () => {
    const text = report();
    expect(text).toContain('마감 후 관측 확인');
    expect(text).toContain('관측 3거래일 · 오늘 신규 1건 · 누적 3건');
    expect(text).toContain('D1 오늘 평가 1건 0.00% · 누적 2건 +2.50%');
    expect(text).toContain('과거 평가일 결과를 오늘 추가 확인: 1건');
    expect(text).toContain('다음 평가 2026-09-22 종가 · D1 1건 / D3 1건');
    expect(text).toContain('D5 오늘 평가 0건 집계 대기');
  });
  it.each(['future', 'wrong-date', 'early-close'] as const)('excludes %s observations from known outcomes', type => {
    const view = viewFixture(); const item = view.experiments[0].outcomes[0];
    if (type === 'future') item.availableAt = '2026-09-22T07:00:00Z';
    if (type === 'wrong-date') item.tradingDate = '2026-09-22';
    if (type === 'early-close') item.availableAt = `${date}T06:29:00Z`;
    const text = report(view);
    expect(text).toContain('D1 오늘 평가 0건 집계 대기 · 누적 1건 +5.00%');
    expect(text).toContain('평가일 도래 후 미확정 1건');
  });
  it('shows stale, missing and pre-close sources explicitly without claiming completed collection', () => {
    const view = viewFixture(); view.lastRun!.asOf = '2026-09-18T07:00:00Z';
    expect(report(view)).toContain('마감 후 관측 미확인');
    expect(report(view)).toContain('10분 이상 갱신 지연');
    view.lastRun = null;
    expect(report(view)).toContain('마지막 관측 미확인');
    expect(report(view)).toContain('공시 수집 상태 미확인');
    expect(formatPaperCloseReport(view, date, new Date(`${date}T10:00:00+09:00`))).toContain('마감 전 미리보기');
    expect(report(view)).not.toContain('뉴스 기록 없음');
  });
  it('does not claim full daily counts from a truncated API view', () => {
    const view = viewFixture(); view.totalCount = 1000;
    const text = report(view);
    expect(text).toContain('전체 원장 미조회');
    expect(text).not.toContain('오늘 신규 1건');
  });
  it('uses the shared holiday calendar for the next result date', () => {
    const view = viewFixture(); view.totalCount = 1; view.experiments = [experiment('2026-09-23', '005930')];
    const text = formatPaperCloseReport(view, '2026-09-23', new Date('2026-09-23T16:10:00+09:00'));
    expect(text).toContain('다음 평가 2026-09-28 종가 · D1 1건');
  });
  it('reports saved intraday reasons without converting market closure into insufficient samples', () => {
    const view = viewFixture();
    view.strategy!.lastMarketSession = { tradingDate: date, asOf: `${date}T06:20:00Z`, snapshotId: 'intraday', decisionCount: 607,
      reasonCounts: { INSUFFICIENT_MATURE_SAMPLES: 500, NON_POSITIVE_EXPECTANCY: 100, CURRENT_PRICE_UNAVAILABLE: 7 } };
    let text = report(view);
    expect(text).toContain('장중 마지막 판단');
    expect(text).toContain('완료 표본 부족 500 · 비용 차감 후 양수 성과 없음 100 · 현재가 미확인 7');
    view.strategy!.lastMarketSession!.tradingDate = '2026-09-18'; text = report(view);
    expect(text).toContain('오늘 장중 대기 사유 미기록');
    expect(text).not.toContain('완료 표본 부족 500');
  });
  it('keeps disconnected, missing-feature and unmatched-rule waits separate', () => {
    const view = viewFixture();
    view.strategy!.lastMarketSession = { tradingDate: date, asOf: `${date}T06:20:00Z`, snapshotId: 'adaptive', decisionCount: 15,
      reasonCounts: { ADAPTIVE_NO_ACTIVE_RULE: 7, ADAPTIVE_FEATURE_UNAVAILABLE: 5, ADAPTIVE_RULE_NOT_MATCHED: 3 } };
    const text = report(view);
    expect(text).toContain('연결된 지표 없음 7 · 연결 지표 자료 미확인 5 · 연결 규칙 불일치 3');
    expect(text).not.toContain('장중 마지막 판단에서 신규 진입 대기 없음');
  });
  it('includes only selection changes known on the reporting date', () => {
    const view = viewFixture();
    view.strategy!.adaptive = {
      policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
        minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
      tradingDate: date, evaluatedAt: `${date}T01:00:00Z`, cutoffAt: '2026-09-20T15:00:00Z',
      matureSampleCount: 40, matureDateCount: 8, windowStartDate: '2026-08-01', validationStartDate: '2026-09-01', candidates: [],
      changes: [{ at: `${date}T01:00:00Z`, feature: 'rsi14', from: { feature: 'rsi14', bucket: 1, horizon: 3 }, to: null, reason: 'NO_VALIDATION_EDGE' },
        { at: '2026-09-22T01:00:00Z', feature: 'per', from: null, to: { feature: 'per', bucket: 0, horizon: 1 }, reason: 'ACTIVE' }],
    };
    expect(report(view)).toContain('오늘 지표 변경: 연결 0 · 해제 1 · 교체 0');
    expect(report(view)).toContain('성숙 관측 40건/8진입일');
    view.strategy!.adaptive.evaluatedAt = '2026-09-22T01:00:00Z';
    expect(report(view)).not.toContain('오늘 지표 변경');
    expect(report(view)).not.toContain('지표 자동 연결');
  });
  it('separates invented formula creation and retirement from actual buy-rule connections', () => {
    const view = viewFixture(), samples = matureAdaptiveSamples();
    for (const item of samples) {
      const index = Number(item.symbol.slice(-1));
      item.entryObservation.features!.values.rsi14 = index % 4 < 2 ? 20 : 80;
      item.entryObservation.features!.values.volumeRatio20 = [0, 1, 6, 7].includes(index) ? 0.25 : 1.75;
    }
    view.strategy!.adaptive = selectPaperAdaptiveState(undefined, samples, `${date}T01:00:00Z`);
    const state = view.strategy!.adaptive;
    expect(state.discovery!.inventions).toHaveLength(2);
    const original = state.changes[0].to!;
    state.changes.push({ at: `${date}T02:00:00Z`, feature: original.feature,
      from: structuredClone(original), to: null, reason: 'DISCOVERY_RETIRED' });
    const text = report(view);
    expect(text).toContain('오늘 수식 연구: 생성 2 · 연구 종료 1');
    expect(text).not.toContain('오늘 지표 변경: 연결 2');
    expect(text).toContain(formatPaperAdaptiveSummary(view, now).join('\n'));
    expect(text.length).toBeLessThanOrEqual(3500);
  });
  it('separates scheduled exit dates from the later day their prices became available', () => {
    const initial = adaptiveTestSnapshot();
    const ledger = evaluatePaperStrategyScan(emptyStrategyLedger(), initial, strategyTestCost,
      selectPaperAdaptiveState(undefined, matureAdaptiveSamples({ selectedReturns: [0, 0, 0] }), initial.asOf));
    // Positive entry evidence is required; the subsequent closing price can still produce zero.
    const entered = evaluatePaperStrategyScan(emptyStrategyLedger(), initial, strategyTestCost,
      selectPaperAdaptiveState(undefined, matureAdaptiveSamples({ selectedReturns: [10, 1, 1] }), initial.asOf));
    entered.trades[0].policy.exitModel = 'SCHEDULED_CLOSE';
    delete entered.trades[0].exitPolicy; delete entered.trades[0].exitResearch;
    expect(ledger.trades).toHaveLength(0);
    const closed = structuredClone(initial); closed.asOf = now.toISOString(); closed.tradingDate = date; closed.marketOpen = false;
    closed.observations[0].dailyCloses = [{ tradingDate: date, close: 10000, availableAt: now.toISOString() }];
    const result = evaluatePaperStrategyScan(entered, closed, strategyTestCost,
      selectPaperAdaptiveState(entered.adaptive, [], closed.asOf));
    const view = viewFixture(); view.strategy = buildPaperStrategyView(result);
    expect(report(view)).toContain('오늘 진입 0건 · 오늘 평가일 청산 1건 · 보유 0건');
    expect(report(view)).toContain('오늘 청산 평균 0.00% · 누적 1건 0.00%');
    expect(report(view)).toContain('현행 자율 전략 전체(검증+탐색) 가상 청산 1건 · 평균 순수익률 0.00% (구전략 제외)');
    const nextDay = formatPaperCloseReport(view, '2026-09-22', new Date('2026-09-22T16:10:00+09:00'));
    expect(nextDay).toContain('오늘 평가일 청산 0건');
  });
  it('includes dated coverage and escaped direct headlines while staying within one message', () => {
    const view = viewFixture();
    view.lastRun!.disclosures = { state: 'PARTIAL', checkedAt: now.toISOString(), lastSuccessAt: null,
      fromDate: '2026-09-18', toDate: date, pages: 2, fetchedCount: 100, linkedCount: 98, unlinkedCount: 2, issue: '<통신 & 지연>' };
    view.lastRun!.investorFlow = { asOf: now.toISOString(), tradingDate: '2026-09-18', candidateCount: 607, availableCount: 583,
      flowCorrelation: { count: 583, symbolCount: 583, entryDateCount: 1, pearson: null, spearman: null, status: 'NO_VARIATION' },
      groups: [{ group: 'BOTH_BUY', count: 138 }, { group: 'BOTH_SELL', count: 94 }, { group: 'DIVERGENT', count: 281 }, { group: 'OTHER', count: 70 }] };
    const snapshot = adaptiveTestSnapshot();
    const decisions = evaluatePaperStrategyScan(emptyStrategyLedger(), snapshot, strategyTestCost,
      selectPaperAdaptiveState(undefined, [], snapshot.asOf)).latestDecisions;
    const d = decisions[0]; d.decisionAt = now.toISOString(); d.name = '<기업&>';
    d.newsSummary = summarizePaperNews([1, 2].map(n => {
      const item = { id: `dart:2026092100000${n}`, headline: '<b>대규모 수주</b>' + '&'.repeat(100), source: 'DART', observedAt: d.decisionAt };
      return { ...item, assessment: assessPaperNews(item, d.decisionAt), facts: recordPaperNewsFacts(item, d.decisionAt,
        { receiptNo: `2026092100000${n}`, filedDate: date, firstSeenAt: d.decisionAt, linkMethod: 'DART_RAW' }) };
    }), d.decisionAt);
    view.strategy!.latestDecisions = decisions;
    const text = report(view);
    expect(text).toContain('공시 일부 미확인'); expect(text).toContain('&lt;통신 &amp; 지연&gt;');
    expect(text).toContain('직접 공시 연결 1종목');
    expect(text).toContain('&lt;기업&amp;&gt;'); expect(text).not.toContain('<기업&>');
    expect(text).toContain('수급 기준일 2026-09-18 · 확인 583/607종목 · 미확인 24');
    expect(text).toContain('https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260921000001');
    expect(text.length).toBeLessThanOrEqual(3500);
  });
});
