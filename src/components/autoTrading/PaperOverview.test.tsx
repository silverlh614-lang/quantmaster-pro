// @vitest-environment jsdom
// @responsibility Verify honest dashboard operating states.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PaperOverview } from './PaperOverview';
import type { PaperOverviewView } from '../../types/paperExperiment';
import type { PaperAdaptiveState, PaperAdaptiveStats } from '../../types/paperAdaptive';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../types/paperObservationFeatures';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../types/paperIndicatorFormula';
import { useSettingsStore, type View } from '../../stores/useSettingsStore';
afterEach(() => { cleanup(); useSettingsStore.setState({ view: 'DASHBOARD' }); });
const view: PaperOverviewView = { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', lastRun: null, totalCount: 0, openCount: 0, completedCount: 0, outcomes: [{ horizon: 1, label: 'D1', count: 2, meanNetReturnPct: 0, winRatePct: 0 }] };
function researchState(): PaperAdaptiveState {
  const empty: PaperAdaptiveStats = { sampleCount: 0, dateCount: 0, symbolCount: 0, experimentIds: [], meanNetReturnPct: null, meanDailyExcessPct: null };
  const measured: PaperAdaptiveStats = { sampleCount: 12, dateCount: 3, symbolCount: 4,
    experimentIds: Array.from({ length: 12 }, (_, index) => `sample-${index}`), meanNetReturnPct: 7.25, meanDailyExcessPct: 0.75 };
  const validation = { ...measured, experimentIds: measured.experimentIds!.map(id => `forward-${id}`) };
  const rule = { feature: 'rsi14' as const, bucket: 0, horizon: 3 as const };
  const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
  const definition = { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-10-01T01:00:00Z',
    discoveryCutoffAt: '2026-09-30T15:00:00.000Z', rule: { bucket: 2, horizon: 3 as const }, training: measured };
  return { policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
    tradingDate: '2026-10-02', evaluatedAt: '2026-10-02T01:00:00Z', cutoffAt: '2026-10-01T15:00:00.000Z',
    windowStartDate: '2026-08-01', validationStartDate: '2026-09-01', matureSampleCount: 120, matureDateCount: 30,
    candidates: [...(Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).map(feature => ({ rule: { ...rule, feature },
      training: feature === 'rsi14' ? measured : empty, validation: feature === 'rsi14' ? validation : empty,
      active: feature === 'rsi14', reason: feature === 'rsi14' ? 'ACTIVE' as const : 'MISSING_INPUT' as const })),
      { rule: { feature: definition.id, ...definition.rule, invention: definition }, training: measured, validation: empty,
        active: false, reason: 'FORWARD_OBSERVATION' }],
    discovery: { version: 'indicator-discovery-v1', round: 2, roundStartedAt: '2026-10-01T01:00:00Z',
      roundTrainingEndDate: '2026-09-01', attemptedIds: [definition.id], inventions: [definition] },
    changes: [{ at: '2026-10-02T01:00:00Z', feature: 'rsi14', from: null, to: rule, reason: 'ACTIVE' }] };
}
function currentView(): PaperOverviewView {
  const now = new Date().toISOString();
  return { ...view, totalCount: 120, lastRun: { snapshotId: 's', asOf: now, candidateCount: 20, observedCount: 18,
    openedCount: 2, completedCount: 0, missingPriceCount: 2, marketOpen: true, issues: [] },
    strategy: { mode: 'SHADOW', strategyVersion: 'adaptive-features-v1', totalCount: 30, openCount: 3,
      policy: { version: 'adaptive-features-v1', newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3,
        horizonSelection: 'FORWARD_VALIDATED_FEATURE', exitModel: 'SCHEDULED_CLOSE' },
      adaptive: researchState(), performance: { closedCount: 27, meanNetReturnPct: 91, winRatePct: 90, totalNetPnl: 99999 },
      performanceByVersion: { 'adaptive-features-v1': { closedCount: 4, meanNetReturnPct: 2.75, winRatePct: 50, totalNetPnl: 1100 } },
      lastRun: { snapshotId: 's', asOf: now, openedCount: 7, closedCount: 0, waitingCount: 2, holdingCount: 1 },
      decisionCounts: { BUY: 7, WAIT: 2, HOLD: 1, EXIT: 0 }, waitingReasons: [{ code: 'ADAPTIVE_RULE_NOT_MATCHED', label: '연결 지표의 진입 구간 밖', count: 2 }] } };
}
const returnMetric = () => within(screen.getByText('자율 전략 평균 순수익').closest('div')!);

describe('PaperOverview', () => {
  it('distinguishes zero results from pending data and unknown operating status', () => {
    render(<PaperOverview view={view} />);
    expect(screen.getByText('운영 상태 확인 중')).toBeTruthy();
    expect(screen.getByText('0.00%')).toBeTruthy();
    expect(screen.getAllByText('집계 대기').length).toBeGreaterThan(1);
  });
  it('shows paused operation even when the last recorded scan was during market hours', () => {
    render(<PaperOverview view={{ ...view, lastRun: { snapshotId: 's', asOf: new Date().toISOString(), candidateCount: 185, observedCount: 180, openedCount: 0, completedCount: 0, missingPriceCount: 5, marketOpen: true, issues: [] } }} mode="SHADOW" paused />);
    expect(screen.getByText('자동 관측 일시정지')).toBeTruthy();
    expect(screen.getByText('185')).toBeTruthy();
    expect(screen.queryByText('장중 관측 기록을 쌓고 있습니다')).toBeNull();
  });
  it('does not present an old scan as current running observation', () => {
    render(<PaperOverview view={{ ...view, lastRun: { snapshotId: 's', asOf: '2020-01-01T00:00:00Z', candidateCount: 5, observedCount: 5, openedCount: 0, completedCount: 0, missingPriceCount: 0, marketOpen: true, issues: [] } }} mode="SHADOW" paused={false} />);
    expect(screen.getByText('최근 관측 갱신 확인 필요')).toBeTruthy();
  });
  it('shows actual collection progress while the previous pre-open scan is still displayed', () => {
    const now = new Date().toISOString();
    render(<PaperOverview view={{ ...view, collection: { startedAt: now, lastProgressAt: now, completed: 200, total: 553 },
      lastRun: { snapshotId: 's', asOf: now, durationMs: 80000, candidateCount: 553, observedCount: 539, openedCount: 0, completedCount: 0, missingPriceCount: 14, marketOpen: false,
        issues: ['005930:CURRENT_QUOTE_INVALID_PRICE', '000660:CURRENT_QUOTE_UNAVAILABLE'] } }} mode="SHADOW" paused={false} />);
    expect(screen.getByText('관측 자료 수집 중')).toBeTruthy();
    expect(screen.getByText('200/553종목')).toBeTruthy();
    expect(screen.getByText('80초')).toBeTruthy();
    expect(screen.getByText('005930: 응답에 유효한 현재가 없음')).toBeTruthy();
    expect(screen.getByText('000660: 현재가 응답 없음')).toBeTruthy();
  });
  it('does not hide a stalled collector behind a running label', () => {
    render(<PaperOverview view={{ ...view, collection: { startedAt: '2020-01-01T00:00:00Z', lastProgressAt: '2020-01-01T00:00:00Z', completed: 1, total: 553 } }} mode="SHADOW" paused={false} />);
    expect(screen.queryByText('관측 자료 수집 중')).toBeNull();
    expect(screen.getByText('수집 지연 확인 필요')).toBeTruthy();
  });

  it('separates current strategy realized performance from combined legacy results and rule validation', () => {
    render(<PaperOverview view={currentView()} mode="SHADOW" paused={false} />);
    expect(returnMetric().getByText('+2.75%')).toBeTruthy();
    const results = within(screen.getByRole('region', { name: '성과 기록' }));
    expect(results.getByText('+2.75%')).toBeTruthy();
    expect(results.getByText('4건')).toBeTruthy();
    expect(results.getByText('50.0%')).toBeTruthy();
    expect(screen.queryByText('+91.00%')).toBeNull();
    expect(within(screen.getByRole('list', { name: '현재 채택 지표' })).getByText('+7.25%')).toBeTruthy();
    expect(screen.getByText('전체 Shadow 보유')).toBeTruthy();
    expect(screen.getByLabelText('새 관측으로 검증 1개')).toBeTruthy();
  });

  it.each(['version', 'all'] as const)('keeps current performance pending when %s performance is missing', missing => {
    const data = currentView();
    if (missing === 'version') delete data.strategy!.performanceByVersion!['adaptive-features-v1'];
    else delete data.strategy!.performanceByVersion;
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(returnMetric().getByText('집계 대기')).toBeTruthy();
    const results = within(screen.getByRole('region', { name: '성과 기록' }));
    expect(results.getByText('확인 대기')).toBeTruthy();
    expect(screen.queryByText('+91.00%')).toBeNull();
    expect(screen.queryByText('+2.75%')).toBeNull();
  });

  it('preserves measured zero returns and win rates while missing horizons remain pending', () => {
    const data = currentView();
    data.strategy!.performanceByVersion!['adaptive-features-v1'] = { closedCount: 4, meanNetReturnPct: 0, winRatePct: 0, totalNetPnl: 0 };
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(returnMetric().getByText('0.00%')).toBeTruthy();
    const results = within(screen.getByRole('region', { name: '성과 기록' }));
    expect(results.getByText('0.0%')).toBeTruthy();
    expect(results.getByText('4건')).toBeTruthy();
    expect(results.getAllByText('0.00%')).toHaveLength(2);
    expect(results.getAllByText('집계 대기')).toHaveLength(2);
    expect(results.getAllByText('표본 확인 대기')).toHaveLength(2);
  });

  it.each(['view', 'lastRun', 'refresh'] as const)('does not present cached choices or realized performance as current after a %s failure', source => {
    const data = currentView();
    data.collection = { startedAt: data.lastRun!.asOf, lastProgressAt: data.lastRun!.asOf, completed: 4, total: 20 };
    if (source === 'view') data.strategy!.error = '전략 원장 조회 실패';
    if (source === 'lastRun') data.strategy!.lastRun!.error = '전략 평가 실패';
    render(<PaperOverview view={data} mode="SHADOW" paused={false} refreshFailed={source === 'refresh'} />);
    expect(returnMetric().getByText('확인 불가')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '현재 채택 지표' })).toBeNull();
    expect(screen.getByLabelText('매수에 채택 확인 대기')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: '저장된 연구 변경 이력' })).toBeTruthy();
    expect(screen.queryByText('+2.75%')).toBeNull();
    expect(screen.queryByText('+7.25%')).toBeNull();
    const decisions = within(screen.getByRole('region', { name: '최근 전략 판단' }));
    expect(decisions.getByRole('alert')).toBeTruthy();
    expect(decisions.queryByText('7')).toBeNull();
    if (source === 'refresh') {
      expect(screen.getByText('최근 자료 조회 실패')).toBeTruthy();
      expect(screen.queryByText('관측 자료 수집 중')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
    }
  });

  it('flags future scan and collection timestamps instead of displaying current observation', () => {
    const data = currentView(), future = new Date(Date.now() + 600_000).toISOString();
    data.lastRun!.asOf = future;
    data.collection = { startedAt: future, lastProgressAt: future, completed: 1, total: 20 };
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(screen.getByText('최근 관측 갱신 확인 필요')).toBeTruthy();
    expect(screen.getByText('수집 지연 확인 필요')).toBeTruthy();
    expect(screen.queryByText('장중 관측 기록을 쌓고 있습니다')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('opens the matching detail page from each dashboard action', () => {
    render(<PaperOverview view={currentView()} mode="SHADOW" paused={false} />);
    const routes: Array<[string, View]> = [['전체 지표와 채택 근거', 'PAPER_STRATEGY'],
      ['종목별 판단과 진입 근거', 'PAPER_STRATEGY'], ['관측 기록', 'PAPER_OBSERVATIONS'],
      ['운영 상태', 'OPERATIONS'], ['연구 전체 보기', 'PAPER_RESEARCH']];
    for (const [name, target] of routes) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(useSettingsStore.getState().view).toBe(target);
    }
  });
});
