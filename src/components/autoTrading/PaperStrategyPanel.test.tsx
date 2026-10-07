// @vitest-environment jsdom
// @responsibility Verify visible empirical Shadow strategy outcomes.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  PaperStrategyDecision, PaperStrategyEvidence, PaperStrategyPolicy, PaperStrategyScreenView,
  PaperStrategyTrade, PaperStrategyTradeSummary, PaperStrategyView, PaperTradeMeasurementPoint,
} from '../../types/paperStrategy';
const api = vi.hoisted(() => ({ trades: vi.fn() }));
vi.mock('../../api/paperExperimentClient', () => ({ PAPER_EXPERIMENT_QUERY_KEY: ['paper-experiments'],
  paperExperimentApi: { getStrategyTrades: api.trades } }));
import { PaperStrategyPanel } from './PaperStrategyPanel';
import { summarizePaperNews } from '../../utils/paperNews';
import { buildSignalReview, buildTradeReview, summarizeTradeRecords, tradeRuleIdentity, tradeSignalIdentity, signalRuleKey } from '../../utils/paperTradeReview';
import type { PaperAdaptiveRule, PaperAdaptiveState } from '../../types/paperAdaptive';
import { PaperSignalReview } from './PaperSignalReview';
import { PaperTradeReview } from './PaperTradeReview';

const policy: PaperStrategyPolicy = {
  version: 'news-trend-v1', newsLookbackHours: 72, minimumSamples: 10,
  minimumEntryDates: 3, horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE',
};
const evidence: PaperStrategyEvidence = {
  cutoffAt: '2026-09-10T01:00:00Z', cohort: 'NEWS_RECENT_ABOVE_MA20',
  sampleCount: 12, entryDateCount: 4, experimentIdsDigest: 'a'.repeat(64), selectedHorizon: 3,
  horizons: [
    { horizon: 1, count: 12, meanNetReturnPct: 0.21, meanDailyNetReturnPct: 0.21, winRatePct: 60 },
    { horizon: 3, count: 12, meanNetReturnPct: 1.08, meanDailyNetReturnPct: 0.36, winRatePct: 70 },
    { horizon: 5, count: 12, meanNetReturnPct: 1.55, meanDailyNetReturnPct: 0.31, winRatePct: 75 },
  ],
};
const buy: PaperStrategyDecision = {
  snapshotId: 'snapshot-entry', decisionAt: '2026-09-10T01:00:00Z',
  symbol: '005930', name: '삼성전자', action: 'BUY',
  reasonCode: 'POSITIVE_COHORT_EXPECTANCY', reason: '최근 뉴스·20일선 위 그룹의 D3 일당 순수익률이 가장 높아 가상 매수합니다.',
  cohort: 'NEWS_RECENT_ABOVE_MA20', evidence, tradeId: 'trade-1',
};
const trade: PaperStrategyTrade = {
  id: 'trade-1', strategyVersion: 'news-trend-v1', symbol: '005930', name: '삼성전자',
  status: 'OPEN', entrySnapshotId: 'snapshot-entry', entryAt: buy.decisionAt,
  tradingDate: '2026-09-10', entryPrice: 70_000, quantity: 1,
  entryObservation: {
    symbol: '005930', name: '삼성전자', price: 70_000, observedAt: buy.decisionAt,
    source: 'KIS', return1dPct: 1, return5dPct: 3, aboveMa20: true, news: [], dailyCloses: [],
  },
  entryDecision: buy, policy,
  costModel: { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
  horizon: 3, scheduledExitDate: '2026-09-15', scheduledExitAt: '2026-09-15T06:30:00Z', exit: null,
};
function measuredPoint(overrides: Partial<PaperTradeMeasurementPoint> = {}): PaperTradeMeasurementPoint {
  return { snapshotId: 'price-point', kind: 'QUOTE', effectiveAt: '2026-09-14T01:00:00Z', observedAt: '2026-09-14T01:00:00Z',
    recordedAt: '2026-09-14T01:01:00Z', price: 70000, source: 'KIS', netReturnPct: 0, netPnl: 0,
    action: 'HOLD', reasonCode: 'HORIZON_PENDING', ruleValue: null, ruleMatches: null, ruleConnected: null, featureAsOf: null, ...overrides };
}

function view(overrides: Partial<PaperStrategyView> = {}): PaperStrategyView {
  return {
    strategyVersion: 'news-trend-v1', mode: 'SHADOW', policy, totalCount: 0, openCount: 0,
    performance: { closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
    lastRun: null, latestDecisions: [], trades: [], ...overrides,
  };
}

afterEach(cleanup);

function resultTrade(net: number, date = trade.tradingDate): PaperStrategyTrade {
  return { ...structuredClone(trade), id: `closed-${net}-${date}`, tradingDate: date, status: 'CLOSED',
    exit: { model: 'SCHEDULED_CLOSE', snapshotId: 'exit', effectiveAt: '2026-09-15T06:30:00Z',
      observedAt: '2026-09-15T06:31:00Z', decisionAt: '2026-09-15T06:31:00Z', price: 70000,
      grossReturnPct: net, netReturnPct: net, netPnl: net * 700,
      decision: { ...buy, action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED' } } };
}

describe('compact strategy rows', () => {
  it('reads full trade cards only for the opened page of polled rows', async () => {
    const full = { ...resultTrade(8), strategyVersion: 'adaptive-features-v1' as const };
    const row: PaperStrategyTradeSummary = { id: full.id, strategyVersion: full.strategyVersion, symbol: full.symbol, name: full.name,
      status: full.status, entryAt: full.entryAt, tradingDate: full.tradingDate, horizon: full.horizon, costModel: full.costModel,
      policy: { exitModel: full.policy.exitModel }, entryDecision: { cohort: full.entryDecision.cohort }, exit: { netReturnPct: 8 } };
    const screenView: PaperStrategyScreenView = { ...view({ strategyVersion: 'adaptive-features-v1', totalCount: 1 }), trades: [row] };
    api.trades.mockResolvedValue([full]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PaperStrategyPanel view={screenView} /></QueryClientProvider>);
    expect(screen.getByText(/청산 평균 순수익률 \+8.00%/)).toBeTruthy();
    expect(api.trades).not.toHaveBeenCalled();
    const records = document.getElementById('paper-original-trades') as HTMLDetailsElement;
    records.open = true; fireEvent(records, new Event('toggle'));
    expect(await screen.findByRole('article', { name: '삼성전자 전략 거래' })).toBeTruthy();
    expect(api.trades).toHaveBeenCalledWith([full.id]);
    client.clear();
  });
});

describe('trade record review', () => {
  it('groups an entry signal across cost settings while preserving setting breakdowns and purposes', () => {
    const a = resultTrade(8), b = resultTrade(-6);
    b.costModel.slippageRate = 0.01;
    const rows = buildSignalReview([a, b, trade]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meanNetReturnPct: 1, closedCount: 2, openCount: 1, dateCount: 1 });
    expect(rows[0].settings).toHaveLength(2);
    const rule: PaperAdaptiveRule = { feature: 'rsi14', bucket: 1, horizon: 3 };
    expect(signalRuleKey(rule)).not.toBe(signalRuleKey({ ...rule, bucket: 2 }));
    const formula = { id: 'test', createdAt: '2026-09-01T00:00:00Z', formula: { operator: 'mean' } } as unknown as NonNullable<PaperAdaptiveRule['invention']>;
    expect(signalRuleKey({ ...rule, invention: formula })).not.toBe(signalRuleKey({ ...rule, invention: { ...formula, createdAt: '2026-09-02T00:00:00Z' } }));
  });
  it('matches frozen rules to current connection changes without rewriting entry evidence', () => {
    const rule: PaperAdaptiveRule = { feature: 'rsi14', bucket: 1, horizon: 3 };
    const a = { ...resultTrade(8), strategyVersion: 'adaptive-features-v1',
      entryDecision: { adaptiveEvidence: { candidate: { rule } } } } as unknown as PaperStrategyTrade;
    const b = { ...a, entryAt: '2026-09-09T00:00:00Z' };
    const state = { candidates: [{ rule: { ...rule, bucket: 2 }, active: true }],
      changes: [{ at: '2026-09-10T00:00:00Z', from: rule, to: null, reason: 'NO_VALIDATION_EDGE' }] } as unknown as PaperAdaptiveState;
    const before = JSON.stringify([a, b, state]);
    const [row] = buildSignalReview([a, b], state);
    expect(row.status).toBe('현재 미연결');
    expect(row.afterChange).toMatchObject({ totalCount: 1, closedCount: 1, meanNetReturnPct: 8 });
    expect(buildSignalReview([a])[0].status).toBe('연결 상태 미확인');
    const exploration = { ...a, entryDecision: { explorationEvidence: a.entryDecision.adaptiveEvidence } } as unknown as PaperStrategyTrade;
    expect(tradeSignalIdentity(exploration).key).not.toBe(tradeSignalIdentity(a).key);
    expect(JSON.stringify([a, b, state])).toBe(before);
  });
  it('opens only a selected signal original record and resets the drilldown', () => {
    const a = { ...resultTrade(8), strategyVersion: 'adaptive-features-v1' as const };
    const b = { ...resultTrade(-6), strategyVersion: 'adaptive-features-v1' as const, name: '다른종목', symbol: '000001', horizon: 5 as const };
    render(<PaperStrategyPanel view={view({ strategyVersion: 'adaptive-features-v1', trades: [a, b], totalCount: 2 })} />);
    expect((document.getElementById('paper-original-trades') as HTMLDetailsElement).open).toBe(false);
    const signals = within(screen.getByRole('region', { name: '신호별 수익성' }));
    fireEvent.click(signals.getAllByRole('button', { name: '이 신호의 원본 거래 보기' })[0]);
    expect((document.getElementById('paper-original-trades') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByRole('article', { name: '삼성전자 전략 거래' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: '다른종목 전략 거래' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '거래 필터 초기화' }));
    expect(screen.getByRole('article', { name: '다른종목 전략 거래' })).toBeTruthy();
    fireEvent.change(signals.getByLabelText('신호 성과 매수 목적'), { target: { value: 'EXPLORATION' } });
    expect(signals.getByText('선택한 목적의 진입 신호 기록이 없습니다.')).toBeTruthy();
  });
  it('withholds signal metrics for a partial ledger', () => {
    render(<PaperSignalReview view={view({ trades: [resultTrade(8)], totalCount: 2 })} onSelect={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('전체 원장 미조회');
    expect(screen.queryByText(/8.00%/)).toBeNull();
  });
  it('keeps open and unknown outcomes outside win rates and preserves zero results', () => {
    const broken = { ...structuredClone(trade), status: 'CLOSED' as const };
    const rows = [resultTrade(8), resultTrade(-6), resultTrade(0), trade, broken];
    const before = JSON.stringify(rows), summary = summarizeTradeRecords(rows);
    expect(summary).toMatchObject({ totalCount: 5, closedCount: 3, openCount: 1, unknownCount: 1,
      winCount: 1, lossCount: 1, flatCount: 1, meanWinPct: 8, meanLossPct: -6, complete: false });
    expect(summary.meanNetReturnPct).toBeCloseTo(2 / 3);
    expect(summary.winRatePct).toBeCloseTo(100 / 3);
    expect(summarizeTradeRecords([trade]).meanNetReturnPct).toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('groups by entry date rather than exit date and separates frozen settings', () => {
    const a = resultTrade(8), b = resultTrade(-6, '2026-09-11');
    b.costModel.slippageRate = 0.001;
    const review = buildTradeReview([a, b, trade]);
    expect(review.dates.map(row => [row.date, row.complete])).toEqual([['2026-09-11', true], ['2026-09-10', false]]);
    expect(review.rules).toHaveLength(2);
    const otherVersion = { ...a, strategyVersion: 'news-trend-v2' as const };
    expect(tradeRuleIdentity(a).key).not.toBe(tradeRuleIdentity(otherVersion).key);
  });
  it('compares D5 only on paired trades and exposes missing and partial paths', () => {
    const a = resultTrade(8), b = resultTrade(-6);
    a.exitResearch = { version: 'observed-exit-research-v1', startedAt: a.entryAt, watchUntilDate: '2026-09-17',
      watchUntilAt: '2026-09-17T06:30:00Z', lastObservedAt: null, lastRecordedAt: null, quoteCount: 1,
      peakNetReturnPct: 8, lastFeatureKey: null, lastFeatureAsOf: null, signalFailureCount: 0,
      signalFailureStartedAt: null, outcomes: {}, completedAt: null,
      baseline: { ...a.exit!, reason: 'D5_BENCHMARK', recordedAt: a.exit!.decisionAt, netReturnPct: 10,
        peakNetReturnPct: 10, signalFailureCount: 0, signalFailureStartedAt: null } };
    const point = measuredPoint();
    a.measurement = { version: 'observed-trade-path-v1', startedAt: a.entryAt, fromEntry: false, pointCount: 1,
      latest: point, highest: point, lowest: point };
    expect(summarizeTradeRecords([a, b])).toMatchObject({ d5Count: 1, d5DifferencePct: -2, missingPathCount: 1, partialPathCount: 1 });
  });
  it('refuses partial-ledger totals instead of reporting a misleading complete cohort', () => {
    render(<PaperTradeReview trades={[resultTrade(8)]} totalCount={201} onSelect={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('전체 원장 미조회');
    expect(screen.queryByText('청산 완료')).toBeNull();
  });
  it('links a date summary to the original records and resets filters', () => {
    const other = { ...resultTrade(-6, '2026-09-11'), name: '다른종목', symbol: '000001' };
    render(<PaperStrategyPanel view={view({ totalCount: 2, trades: [trade, other] })} />);
    fireEvent.click(screen.getByRole('button', { name: '2026-09-10 거래 보기' }));
    expect(screen.getByRole('article', { name: '삼성전자 전략 거래' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: '다른종목 전략 거래' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '거래 필터 초기화' }));
    expect(screen.getByRole('article', { name: '다른종목 전략 거래' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('성적표 매수 목적'), { target: { value: 'EXPLORATION' } });
    expect(screen.getByText('선택한 목적의 거래 기록이 없습니다.')).toBeTruthy();
  });
});

describe('PaperStrategyPanel', () => {
  it('labels a new exit policy as unvalidated exploration and keeps D3 as comparison only', () => {
    const observed = structuredClone(trade);
    observed.strategyVersion = 'adaptive-features-v1'; observed.policy.exitModel = 'ADAPTIVE_OBSERVED';
    observed.exitPolicy = { version: 'observed-exit-v1', selectedAt: trade.entryAt, origin: 'EXPLORATION_DEFAULT', evidence: null,
      profile: { id: 'BALANCED', stopLossPct: 5, trailingArmPct: 3, trailingDrawdownPct: 1.5, signalFailureCount: 3, signalFailureMinutes: 20 } };
    render(<PaperStrategyPanel view={view({ strategyVersion: 'adaptive-features-v1', policy: observed.policy, trades: [observed] })} />);
    const history = within(screen.getByRole('article', { name: '삼성전자 전략 거래' }));
    expect(history.getByText('관측 기반 매도 · 성과 비교 D3')).toBeTruthy();
    expect(history.getByText(/초기 탐색 기준 · 검증 전/)).toBeTruthy();
    expect(history.queryByText(/예정 청산일/)).toBeNull();
    expect(screen.getByLabelText('매도 기준 학습')).toBeTruthy();
  });

  it('shows observed zero returns with prices and recording times while identifying incomplete tracking', () => {
    const latest = measuredPoint(), highest = measuredPoint({ price: 72100, netReturnPct: 3, netPnl: 2100 });
    render(<PaperStrategyPanel view={view({ trades: [{ ...trade, measurement: { version: 'observed-trade-path-v1',
      startedAt: '2026-09-11T01:00:00Z', fromEntry: false, pointCount: 3, latest, highest, lowest: latest } }] })} />);
    const path = within(screen.getByRole('group', { name: '가상매수 이후 가격 관측' }));
    expect(path.getByText('가상매수 이후 가격 관측 · 3개 표본')).toBeTruthy();
    expect(path.getByText(/진입 후 중간 추적 · 이전 구간 미기록 · 추적 시작/)).toBeTruthy();
    expect(path.getByText('최근 관측 0.00% · 70,000원')).toBeTruthy();
    expect(path.getByText('관측 최고 순수익 +3.00% · 72,100원')).toBeTruthy();
    expect(path.getByText('관측 최저 순수익 0.00% · 70,000원')).toBeTruthy();
    expect(path.getAllByText(/가격 기준.*(?:10:00:00|10시 0분 0초).*관측.*(?:10:00:00|10시 0분 0초).*기록.*(?:10:01:00|10시 1분 0초)/)).toHaveLength(3);
    expect(path.getByText(/실제 장중 최고·최저나 최적 매도점은 아닙니다/)).toBeTruthy();
    expect(path.queryByText('집계 대기')).toBeNull();
  });

  it('keeps absent measurements pending and detailed-write failures separate from recorded BUY decisions', () => {
    const data = view({ latestDecisions: [buy], trades: [trade], measurementHistory: { lastRecordedAt: null,
      failedBatchCount: 2, unrecordedPointCount: 7, error: '상세 파일 저장 지연' } });
    const { rerender } = render(<PaperStrategyPanel view={data} />);
    expect(screen.getByRole('status', { name: '상세 가격 저장 상태' }).textContent).toContain('누적 저장 실패 2회 · 상세 저장 미확인 7개 · 마지막 상세 저장 기록 없음');
    expect(screen.getByRole('status', { name: '상세 가격 저장 상태' }).textContent).toContain('상세 파일 저장 지연');
    expect(screen.getByRole('article', { name: '삼성전자 매수 · BUY 판단' })).toBeTruthy();
    expect(screen.getByText(/가격 측정 대기 · 휴장·장외에는 새 측정 없이/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '가상매수 이후 가격 관측' })).toBeNull();
    rerender(<PaperStrategyPanel view={{ ...data, measurementHistory: { lastRecordedAt: null, failedBatchCount: null,
      unrecordedPointCount: null, error: '상세 관측 기록 상태를 읽을 수 없습니다.' } }} />);
    expect(screen.getByRole('status', { name: '상세 가격 저장 상태' }).textContent).toContain('누적 저장 실패 집계 확인 불가 · 상세 저장 미확인 집계 확인 불가 · 마지막 상세 저장 확인 불가');
    expect(screen.getByRole('status', { name: '상세 가격 저장 상태' }).textContent).not.toContain('0회');
    expect(screen.getByRole('status', { name: '상세 가격 저장 상태' }).textContent).not.toContain('0개');
    expect(screen.getByRole('article', { name: '삼성전자 매수 · BUY 판단' })).toBeTruthy();
    rerender(<PaperStrategyPanel view={{ ...data, measurementHistory: { lastRecordedAt: '2026-09-14T01:01:00Z', failedBatchCount: 0, unrecordedPointCount: 0 } }} />);
    expect(screen.queryByRole('status', { name: '상세 가격 저장 상태' })).toBeNull();
  });

  it('compares observed peak with the realized exit in percentage points without manufacturing a missing path', () => {
    const exitDecision: PaperStrategyDecision = { ...buy, action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED', decisionAt: '2026-09-15T07:00:00Z' };
    const closed: PaperStrategyTrade = { ...trade, status: 'CLOSED', exit: { model: 'SCHEDULED_CLOSE', snapshotId: 'exit',
      effectiveAt: trade.scheduledExitAt, observedAt: exitDecision.decisionAt, decisionAt: exitDecision.decisionAt,
      price: 69300, grossReturnPct: -1, netReturnPct: -1, netPnl: -700, decision: exitDecision } };
    const latest = measuredPoint({ kind: 'SCHEDULED_CLOSE', effectiveAt: trade.scheduledExitAt,
      observedAt: exitDecision.decisionAt, recordedAt: exitDecision.decisionAt, price: 69300, netReturnPct: -1, netPnl: -700 });
    const { rerender } = render(<PaperStrategyPanel view={view({ trades: [{ ...closed, measurement: { version: 'observed-trade-path-v1',
      startedAt: '2026-09-11T01:00:00Z', fromEntry: false, pointCount: 3, latest,
      highest: measuredPoint({ price: 72100, netReturnPct: 3, netPnl: 2100 }), lowest: latest } }] })} />);
    expect(screen.getByText('관측 최고 순수익 − 청산 순수익 4.00%p · 중간 추적 구간 기준')).toBeTruthy();
    rerender(<PaperStrategyPanel view={view({ trades: [closed] })} />);
    expect(screen.getByText('관측 최고 대비 청산 차이 미집계 · 보유 중 측정 미기록')).toBeTruthy();
    expect(screen.queryByText(/청산 순수익 0.00%p/)).toBeNull();
  });
  it('shows the frozen exploration purpose on both current decisions and existing trades', () => {
    const exploration: PaperStrategyDecision = { ...buy, reasonCode: 'ADAPTIVE_EXPLORATION_SELECTED', reason: '탐색 규칙 일치', cohort: null, evidence: null,
      explorationEvidence: { cutoffAt: '2026-09-09T15:00:00Z', evaluatedAt: '2026-09-10T00:00:00Z', registeredAt: '2026-09-10T00:59:00Z',
        trialId: 'shadow-exploration-v1:2026-09-10:1:rsi14:1:D3', validationStartDate: null,
        policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
          minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
        candidate: { rule: { feature: 'rsi14', bucket: 1, horizon: 3 }, active: false, reason: 'MISSING_INPUT',
          training: { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null },
          validation: { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null } } } };
    render(<PaperStrategyPanel view={view({ strategyVersion: 'adaptive-features-v1', latestDecisions: [exploration],
      trades: [{ ...trade, strategyVersion: 'adaptive-features-v1', entryDecision: exploration }] })} />);
    fireEvent.click(screen.getByText('종목별 최근 판단 펼치기'));
    fireEvent.click(screen.getByText('종목별 원본 거래 펼치기'));
    for (const name of ['삼성전자 매수 · BUY 판단', '삼성전자 전략 거래']) {
      const card = within(screen.getByRole('article', { name }));
      expect(card.getByText(/진입 시 고정한 탐색 근거/)).toBeTruthy();
      expect(card.getByText(/탐색 가상매수 · 검증 전 · 학습에 쓸 지표 표본 없음/)).toBeTruthy();
      expect(card.queryByText(/개별 지표 성과로 선택/)).toBeNull();
      expect(card.queryByText(/근거 표본 12건/)).toBeNull();
    }
  });
  it('shows adaptive evaluation pending without replacing existing trade evidence', () => {
    render(<PaperStrategyPanel view={view({ strategyVersion: 'adaptive-features-v1', trades: [trade], totalCount: 1 })} />);
    fireEvent.click(screen.getByText('종목별 원본 거래 펼치기'));
    expect(screen.getByText('지표 자율 판단 전략')).toBeTruthy();
    expect(screen.getByText(/지표 자동 연결 평가 대기/)).toBeTruthy();
    expect(screen.getByText(/전체 이력에는 기존 뉴스·추세 전략의 거래도 포함/)).toBeTruthy();
    const history = within(screen.getByRole('article', { name: '삼성전자 전략 거래' }));
    expect(history.getByText(/근거 표본 12건/)).toBeTruthy();
    expect(history.queryByText(/진입 시 고정한 지표 근거/)).toBeNull();
  });
  it('separates prospective adaptive performance from combined legacy history', () => {
    render(<PaperStrategyPanel view={view({ strategyVersion: 'adaptive-features-v1',
      performance: { closedCount: 20, meanNetReturnPct: 4, winRatePct: 75, totalNetPnl: 8000 },
      performanceByVersion: { 'adaptive-features-v1': { closedCount: 2, meanNetReturnPct: -0.5, winRatePct: 50, totalNetPnl: -100 } },
    })} />);
    fireEvent.click(screen.getByText('전체·진입일별 성적표와 전략 비교'));
    const own = within(screen.getByRole('region', { name: '자율 판단 전략의 가상 청산 성과' }));
    expect(own.getByText('2건')).toBeTruthy();
    expect(own.getByText('-0.50%')).toBeTruthy();
    expect(own.queryByText('+4.00%')).toBeNull();
    expect(screen.getByText('+4.00%')).toBeTruthy();
    expect(screen.getByText(/지표를 고르는 학습·후반 확인 표본과 별도/)).toBeTruthy();
  });
  it('preserves same-day selection research alongside the adaptive strategy', () => {
    render(<PaperStrategyPanel view={view({ strategyVersion: 'adaptive-features-v1', selection: {
      dateCount: 3, candidateCount: 30, boughtCount: 6, heldCount: 2, notBoughtCount: 22, selectionRatePct: 20,
      cohorts: [{ cohort: 'NEWS_RECENT_ABOVE_MA20', candidateCount: 30, boughtCount: 6 }],
      comparison: { groupCount: 3, strategyTradeCount: 6, unselectedCount: 22,
        strategyMeanPct: 1.5, unselectedMeanPct: 0.25, baselineMeanPct: 0.5, differencePct: 1.25 },
      adaptive: { entry: { dateCount: 4, tradeCount: 7, edgePct: 0.42 }, validatedEntry: { dateCount: 3, tradeCount: 5, edgePct: 0.61 },
        explorationEntry: { dateCount: 2, tradeCount: 2, edgePct: null }, exit: { dateCount: 2, tradeCount: 3, edgePct: -0.35 },
        months: [{ month: '2026-09', entry: { dateCount: 4, tradeCount: 7, edgePct: 0.42 }, exit: { dateCount: 2, tradeCount: 3, edgePct: -0.35 } }] },
    } })} />);
    expect(screen.getByText('지표 자율 판단 전략')).toBeTruthy();
    expect(screen.getByText('전략 선별력 · 같은 날 후보 대비')).toBeTruthy();
    expect(screen.getByText('후보 30건 중 6건 · 3일')).toBeTruthy();
    expect(screen.getByText('+1.25%p')).toBeTruthy();
    expect(screen.getByText(/기존 보유 2건.*연구 표시이며 매수 조건에 쓰지 않습니다/)).toBeTruthy();
    fireEvent.click(screen.getByText('전체·진입일별 성적표와 전략 비교'));
    const observed = within(screen.getByRole('group', { name: '관측 매도 거래 · D5 종가 기준' }));
    expect(observed.getByText('+0.42%p')).toBeTruthy();
    expect(observed.getByText('4일 · 7건 · 산 종목 − 같은 날 안 산 종목')).toBeTruthy();
    expect(observed.getByText('비교 대기')).toBeTruthy();
    expect(observed.getByText('-0.35%p')).toBeTruthy();
    expect(observed.getByText('2026-09 · 선택 +0.42%p · 매도 -0.35%p')).toBeTruthy();
  });
  it('shows adverse news and its reason even while an entry waits', () => {
    const decision: PaperStrategyDecision = { ...buy, action: 'WAIT', evidence: null,
      newsSummary: summarizePaperNews([{ id: 'n1', headline: '계약 해지', source: 'DART', observedAt: buy.decisionAt,
        assessment: { version: 'headline-rules-v1', method: 'DISCLOSURE_TITLE_RULES', assessedAt: buy.decisionAt,
          direction: 'NEGATIVE', reason: '공시 제목 단서: 계약 해지' } }], buy.decisionAt) };
    render(<PaperStrategyPanel view={view({ latestDecisions: [decision] })} />);
    expect(screen.getByText('뉴스 평가 · 악재 추정 · 1건')).toBeTruthy();
    expect(screen.getByText('공시 제목 단서: 계약 해지')).toBeTruthy();
    expect(screen.getByText(/현재 전략의 진입 조건에는 아직 반영하지 않습니다/)).toBeTruthy();
  });
  it('bounds rendered decisions and lets users search beyond the first page', () => {
    const decisions = Array.from({ length: 35 }, (_, index) => ({ ...buy, symbol: String(index), name: `관측종목${index}`, evidence: null }));
    render(<PaperStrategyPanel view={view({ latestDecisions: decisions })} />);
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(screen.queryByText('관측종목30')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다음 판단' }));
    expect(screen.getAllByRole('article')).toHaveLength(12);
    fireEvent.change(screen.getByLabelText('전략 종목 검색'), { target: { value: '관측종목30' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article').textContent).toContain('관측종목30');
    fireEvent.change(screen.getByLabelText('전략 판단 종류'), { target: { value: 'WAIT' } });
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText('검색 조건에 맞는 전략 판단이 없습니다.')).toBeTruthy();
  });
  it('shows the server-selected BUY horizon and all stored horizon scores with evidence requirements', () => {
    render(<PaperStrategyPanel view={view({ latestDecisions: [buy] })} />);
    const decision = within(screen.getByRole('article', { name: '삼성전자 매수 · BUY 판단' }));
    expect(decision.getByText(buy.reason)).toBeTruthy();
    expect(decision.getByText(/근거 표본 12건 \/ 최소 10건 · 진입일 4일 \/ 최소 3일/)).toBeTruthy();
    expect(decision.getByText('D3 · 선택')).toBeTruthy();
    expect(decision.getByText('D1')).toBeTruthy();
    expect(decision.getByText('D5')).toBeTruthy();
    expect(decision.getByText('+0.36%')).toBeTruthy();
    expect(decision.getByText('+1.55%')).toBeTruthy();
    expect(screen.getByText(/최근 72시간/)).toBeTruthy();
    expect(screen.getByText(/계좌 포트폴리오 성과와 별도/)).toBeTruthy();
  });

  it('displays insufficient-sample WAIT and policy values from the view without selecting a horizon', () => {
    const wait: PaperStrategyDecision = {
      ...buy, action: 'WAIT', reasonCode: 'INSUFFICIENT_MATURE_SAMPLES', tradeId: null,
      reason: '완료 표본이 부족해 진입을 기다립니다.',
      evidence: { ...evidence, sampleCount: 2, entryDateCount: 1, selectedHorizon: null },
    };
    render(<PaperStrategyPanel view={view({
      policy: { ...policy, minimumSamples: 15, minimumEntryDates: 5, newsLookbackHours: 96 }, latestDecisions: [wait],
    })} />);
    expect(screen.getByText('대기 · WAIT')).toBeTruthy();
    expect(screen.getByText(wait.reason)).toBeTruthy();
    expect(screen.getByText(/근거 표본 2건 \/ 최소 15건 · 진입일 1일 \/ 최소 5일/)).toBeTruthy();
    expect(screen.getByText(/선택 기간 없음/)).toBeTruthy();
    expect(screen.getByText(/최근 96시간/)).toBeTruthy();
    expect(screen.queryByText('D3 · 선택')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('keeps data-unavailable WAIT distinct from negative performance', () => {
    render(<PaperStrategyPanel view={view({ latestDecisions: [{
      ...buy, action: 'WAIT', reasonCode: 'TREND_UNKNOWN', reason: '20일선 추세를 확인할 수 없어 대기합니다.',
      cohort: null, evidence: null, tradeId: null,
    }] })} />);
    expect(screen.getByText('대기 · WAIT')).toBeTruthy();
    expect(screen.getByText('20일선 추세를 확인할 수 없어 대기합니다.')).toBeTruthy();
    expect(within(screen.getByRole('article', { name: '삼성전자 대기 · WAIT 판단' })).queryByRole('table')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('shows HOLD with the frozen entry horizon and planned exact close while realized results remain pending', () => {
    render(<PaperStrategyPanel view={view({
      totalCount: 1, openCount: 1, trades: [trade], latestDecisions: [{
        ...buy, action: 'HOLD', reasonCode: 'HORIZON_PENDING', reason: '진입 시 정한 D3 청산일까지 보유합니다.',
      }],
    })} />);
    const history = within(screen.getByRole('article', { name: '삼성전자 전략 거래' }));
    expect(history.getByText('보유 · HOLD')).toBeTruthy();
    expect(history.getByText('확정 보유 기간 D3 · 예정 청산일 2026-09-15')).toBeTruthy();
    expect(history.getByText(/예정 종가 시각.*(?:15:30:00|15시 30분 0초)/)).toBeTruthy();
    expect(history.getByText(/청산 순손익은 집계 대기/)).toBeTruthy();
    expect(screen.getAllByText('집계 대기').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('shows EXIT with its own realized net results and separate effective and observed close times', () => {
    const exitDecision: PaperStrategyDecision = {
      ...buy, action: 'EXIT', reasonCode: 'SCHEDULED_CLOSE_REACHED', reason: '예정 청산일의 종가가 확인되어 가상 청산합니다.',
      decisionAt: '2026-09-16T01:00:00Z',
    };
    render(<PaperStrategyPanel view={view({
      totalCount: 1, performance: { closedCount: 1, meanNetReturnPct: 0.72, winRatePct: 100, totalNetPnl: 888.3 },
      latestDecisions: [exitDecision], trades: [{ ...trade, status: 'CLOSED', exit: {
        model: 'SCHEDULED_CLOSE', snapshotId: 'snapshot-exit', effectiveAt: '2026-09-15T06:30:00Z',
        observedAt: '2026-09-15T07:07:00Z', decisionAt: exitDecision.decisionAt, price: 71_000,
        grossReturnPct: 1.42, netReturnPct: 0.72, netPnl: 888.3, decision: exitDecision,
      } }],
    })} />);
    const history = within(screen.getByRole('article', { name: '삼성전자 전략 거래' }));
    expect(history.getByText('청산 · EXIT')).toBeTruthy();
    expect(history.getByText(/예약 종가 가상 청산 · 순수익률 \+0.72% · 순손익 \+888.3원/)).toBeTruthy();
    expect(history.getByText(/평가 종가 시각.*(?:15:30:00|15시 30분 0초).*종가 71,000원/)).toBeTruthy();
    expect(history.getByText(/종가 확인 시각.*(?:16:07:00|16시 7분 0초)/)).toBeTruthy();
    expect(screen.getByText('+888.3원')).toBeTruthy();
    expect(screen.getAllByText('+0.72%').length).toBeGreaterThan(0);
    expect(screen.getByText(/브로커 체결 기록이 아닙니다/)).toBeTruthy();
  });

  it('preserves an observed zero realized result', () => {
    render(<PaperStrategyPanel view={view({
      performance: { closedCount: 1, meanNetReturnPct: 0, winRatePct: 0, totalNetPnl: 0 },
    })} />);
    expect(screen.getByText('0.00%')).toBeTruthy();
    expect(screen.getByText('0원')).toBeTruthy();
  });

  it.each(['view', 'lastRun'] as const)('shows unavailable %s data without fake zero performance or actionable stale decisions', source => {
    render(<PaperStrategyPanel view={view({
      latestDecisions: [buy], trades: [trade],
      ...(source === 'view' ? { error: 'ledger unavailable' } : {
        lastRun: { snapshotId: 'failed', asOf: buy.decisionAt, openedCount: 0, closedCount: 0, waitingCount: 0, holdingCount: 0, error: 'write failed' },
      }),
    })} />);
    expect(screen.getByRole('alert').textContent).toContain('전략 기록 확인 불가');
    expect(screen.queryByText('전략 청산 성과')).toBeNull();
    expect(screen.queryByText('매수 · BUY')).toBeNull();
    expect(screen.queryByText('0건')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
  });
});
