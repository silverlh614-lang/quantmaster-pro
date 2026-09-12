// @vitest-environment jsdom
// @responsibility Verify visible empirical Shadow strategy outcomes.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  PaperStrategyDecision, PaperStrategyEvidence, PaperStrategyPolicy,
  PaperStrategyTrade, PaperStrategyView,
} from '../../types/paperStrategy';
import { PaperStrategyPanel } from './PaperStrategyPanel';

const policy: PaperStrategyPolicy = {
  version: 'news-trend-v1', newsLookbackHours: 72, minimumSamples: 10,
  minimumEntryDates: 3, horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE',
};
const evidence: PaperStrategyEvidence = {
  cutoffAt: '2026-09-10T01:00:00Z', cohort: 'NEWS_RECENT_ABOVE_MA20',
  sampleCount: 12, entryDateCount: 4, experimentIds: ['prior-1'], selectedHorizon: 3,
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

function view(overrides: Partial<PaperStrategyView> = {}): PaperStrategyView {
  return {
    strategyVersion: 'news-trend-v1', mode: 'SHADOW', policy, totalCount: 0, openCount: 0,
    performance: { closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
    lastRun: null, latestDecisions: [], trades: [], ...overrides,
  };
}

afterEach(cleanup);

describe('PaperStrategyPanel', () => {
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
    expect(screen.queryByRole('table')).toBeNull();
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
    expect(screen.getAllByText('집계 대기')).toHaveLength(3);
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
    expect(screen.getByText('+0.72%')).toBeTruthy();
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
