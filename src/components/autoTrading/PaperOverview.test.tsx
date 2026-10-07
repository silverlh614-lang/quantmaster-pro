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
      decisionCounts: { BUY: 7, WAIT: 2, HOLD: 1, EXIT: 0 }, waitingReasons: [{ code: 'ADAPTIVE_RULE_NOT_MATCHED', label: '연결 지표의 진입 구간 밖', count: 2 }],
      holdingReasons: [{ code: 'HORIZON_PENDING', label: '예약 청산 시각 전', count: 1 }] } };
}
const returnMetric = () => within(screen.getByText('자율 전략 평균 순수익').closest('div')!);

describe('PaperOverview', () => {
  it('distinguishes zero results from pending data and unknown operating status', () => {
    render(<PaperOverview view={view} />);
    expect(screen.getByText('운영 상태 확인 중')).toBeTruthy();
    expect(screen.getByText('0.00%')).toBeTruthy();
    expect(screen.getAllByText('집계 대기').length).toBeGreaterThan(1);
    const decisions = within(screen.getByRole('region', { name: '최근 전략 판단' }));
    expect(decisions.getByText('전체 누적 청산 (구전략 포함)').textContent).toContain('확인 대기');
    expect(decisions.getByText('보유 사유 집계 확인 대기')).toBeTruthy();
    expect(decisions.queryByText('0')).toBeNull();
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
  it('shows economical full-scan cadence without flagging normal off-hours waiting as stale', () => {
    const data = currentView(); data.scanIntervalSeconds = 1800;
    data.lastRun!.asOf = new Date(Date.now() - 25 * 60_000).toISOString(); data.lastRun!.marketOpen = false;
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(screen.getByText('30분')).toBeTruthy();
    expect(screen.queryByText('최근 관측 갱신 확인 필요')).toBeNull();
  });
  it.each(['old', 'missing'] as const)('shows intentional holiday waiting with a %s scan', lastScan => {
    const data = currentView(); data.scanIntervalSeconds = null;
    if (lastScan === 'old') data.lastRun!.asOf = '2020-01-01T00:00:00Z';
    else data.lastRun = null;
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(screen.getByText('휴장일 · 자동 가격 스캔 대기')).toBeTruthy();
    expect(screen.getByText('필요할 때 수동 관측')).toBeTruthy();
    expect(screen.getByRole('region', { name: '관측 운영 상태' }).classList.contains('is-current')).toBe(true);
    expect(screen.queryByText('최근 관측 갱신 확인 필요')).toBeNull();
  });
  it('reports halted holdings apart from late quotes in the minute monitor', () => {
    const data = currentView();
    data.priceMonitor = { intervalSeconds: 60, running: false, marketOpen: true, startedAt: null, completedAt: null, durationMs: null,
      checkedCount: 2, validCount: 2, closedCount: 0, heldCount: 3, haltedCount: 1, staleCount: 0, oldestQuoteAt: null };
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(screen.getByText(/보유 3종목 중/).textContent).toContain('미확인 0종목 · 거래정지 1종목(해제 후 매도 판단)');
  });
  it('keeps stalled manual collection visible during a holiday', () => {
    const data = currentView(); data.scanIntervalSeconds = null;
    data.collection = { startedAt: '2020-01-01T00:00:00Z', lastProgressAt: '2020-01-01T00:00:00Z', completed: 1, total: 20 };
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(screen.getByText('최근 관측 갱신 확인 필요')).toBeTruthy();
    expect(screen.getByText('수집 지연 확인 필요')).toBeTruthy();
    expect(screen.getByRole('region', { name: '관측 운영 상태' }).classList.contains('needs-review')).toBe(true);
    expect(screen.queryByText('휴장일 · 자동 가격 스캔 대기')).toBeNull();
  });
  it.each(['strategy', 'refresh', 'timestamp'] as const)('does not hide a holiday %s failure behind normal waiting', failure => {
    const data = currentView(); data.scanIntervalSeconds = null;
    if (failure === 'strategy') data.strategy!.error = '전략 원장 조회 실패';
    if (failure === 'timestamp') data.lastRun!.asOf = new Date(Date.now() + 600_000).toISOString();
    render(<PaperOverview view={data} mode="SHADOW" paused={false} refreshFailed={failure === 'refresh'} />);
    expect(screen.getByRole('heading', { name: failure === 'strategy' ? '전략 기록 확인 필요' : failure === 'refresh' ? '최근 자료 조회 실패' : '최근 관측 갱신 확인 필요' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '관측 운영 상태' }).classList.contains('needs-review')).toBe(true);
    expect(screen.queryByText('휴장일 · 자동 가격 스캔 대기')).toBeNull();
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

  it('shows full-ledger verified and exploratory results separately without inferring missing aggregates', () => {
    const data = currentView();
    data.strategy!.performanceByPurpose = {
      VALIDATED: { openCount: 2, closedCount: 12, meanNetReturnPct: 3.25, winRatePct: 75, totalNetPnl: 3900 },
      EXPLORATION: { openCount: 301, closedCount: 8, meanNetReturnPct: -1.25, winRatePct: 25, totalNetPnl: -1000 },
    };
    const { rerender } = render(<PaperOverview view={data} />);
    const purposes = () => within(screen.getByRole('group', { name: '매수 목적별 성과' }));
    expect(purposes().getByText('검증 매수').parentElement!.textContent).toContain('보유 2 · 청산 12건 · +3.25%');
    expect(purposes().getByText('탐색 매수 · 검증 전').parentElement!.textContent).toContain('보유 301 · 청산 8건 · -1.25%');
    delete data.strategy!.performanceByPurpose;
    rerender(<PaperOverview view={data} />);
    expect(purposes().getAllByText('집계 확인 대기')).toHaveLength(2);
    expect(purposes().queryByText(/보유 0/)).toBeNull();
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

  it('separates this scan zero exits from cumulative closes and explains all held trades', () => {
    const data = currentView(), strategy = data.strategy!;
    strategy.totalCount = 1420;
    strategy.openCount = 785;
    strategy.performance.closedCount = 635;
    strategy.performanceByVersion!['adaptive-features-v1']!.closedCount = 12;
    strategy.lastRun = { snapshotId: 'hold-scan', asOf: '2026-10-02T07:00:00Z', openedCount: 0, closedCount: 0, waitingCount: 0, holdingCount: 785 };
    strategy.decisionCounts = { BUY: 0, WAIT: 0, HOLD: 785, EXIT: 0 };
    strategy.waitingReasons = [];
    strategy.holdingReasons = [{ code: 'HORIZON_PENDING', label: '예약 청산 시각 전', count: 785 }];
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    const decisions = within(screen.getByRole('region', { name: '최근 전략 판단' }));
    expect(decisions.getByText('종목별 최근 판단')).toBeTruthy();
    expect(decisions.getByText(/최근 판단 갱신/).textContent).toContain('16:00');
    expect(decisions.getByText('보유 유지').parentElement!.textContent).toBe('보유 유지785');
    expect(decisions.getByText('매도 판단').parentElement!.textContent).toBe('매도 판단0');
    expect(decisions.getByText('전체 Shadow 보유').textContent).toBe('전체 Shadow 보유 785건');
    expect(decisions.getByText('전체 누적 청산 (구전략 포함)').textContent).toBe('전체 누적 청산 (구전략 포함) 635건');
    const holdings = within(decisions.getByRole('group', { name: '보유 유지 사유' }));
    expect(holdings.getByText('예약 청산 시각 전').parentElement!.textContent).toBe('예약 청산 시각 전785건');
    expect(decisions.getByText('최근 집계에 진입 대기 판단이 없습니다.')).toBeTruthy();
    expect(screen.getByText('자율 전략 누적 청산').parentElement!.textContent).toBe('자율 전략 누적 청산12건');
  });

  it('keeps pending close prices distinct from entry waits', () => {
    const data = currentView();
    data.strategy!.decisionCounts.HOLD = 4;
    data.strategy!.holdingReasons = [{ code: 'HORIZON_PENDING', label: '예약 청산 시각 전', count: 3 },
      { code: 'SCHEDULED_CLOSE_UNAVAILABLE', label: '예정 시각 도래 · 확정 종가 대기', count: 1 }];
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    const holdings = within(screen.getByRole('group', { name: '보유 유지 사유' }));
    expect(holdings.getByText('예약 청산 시각 전').parentElement!.textContent).toBe('예약 청산 시각 전3건');
    expect(holdings.getByText('예정 시각 도래 · 확정 종가 대기').parentElement!.textContent).toBe('예정 시각 도래 · 확정 종가 대기1건');
    expect(holdings.queryByText('연결 지표의 진입 구간 밖')).toBeNull();
    const waits = within(screen.getByRole('group', { name: '진입 대기 사유' }));
    expect(waits.getByText('연결 지표의 진입 구간 밖').parentElement!.textContent).toBe('연결 지표의 진입 구간 밖2종목');
    expect(waits.queryByText('예약 청산 시각 전')).toBeNull();
  });

  it.each(['missing', 'empty'] as const)('keeps holding reasons unknown when a positive hold count has %s detail', detail => {
    const data = currentView();
    if (detail === 'missing') delete data.strategy!.holdingReasons;
    else data.strategy!.holdingReasons = [];
    data.strategy!.waitingReasons = [];
    render(<PaperOverview view={data} mode="SHADOW" paused={false} />);
    expect(screen.getByText('보유 사유 집계 확인 대기')).toBeTruthy();
    expect(screen.getByText('진입 대기 사유 집계 확인 대기')).toBeTruthy();
    expect(screen.queryByText('최근 집계에 보유 유지 판단이 없습니다.')).toBeNull();
    expect(screen.queryByText('최근 집계에 진입 대기 판단이 없습니다.')).toBeNull();
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
    expect(decisions.queryByText('전체 누적 청산 (구전략 포함)')).toBeNull();
    expect(decisions.queryByText('예약 청산 시각 전')).toBeNull();
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
