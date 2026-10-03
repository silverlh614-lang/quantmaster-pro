// @vitest-environment jsdom
// @responsibility Verify visible empirical Shadow strategy outcomes.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  PaperStrategyDecision, PaperStrategyEvidence, PaperStrategyPolicy,
  PaperStrategyTrade, PaperStrategyView, PaperTradeMeasurementPoint,
} from '../../types/paperStrategy';
import { PaperStrategyPanel } from './PaperStrategyPanel';
import { summarizePaperNews } from '../../utils/paperNews';

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

describe('PaperStrategyPanel', () => {
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
    expect(screen.getByRole('status').textContent).toContain('누적 저장 실패 2회 · 상세 저장 미확인 7개 · 마지막 상세 저장 기록 없음');
    expect(screen.getByRole('status').textContent).toContain('상세 파일 저장 지연');
    expect(screen.getByRole('article', { name: '삼성전자 매수 · BUY 판단' })).toBeTruthy();
    expect(screen.getByText(/가격 측정 대기 · 휴장·장외에는 새 측정 없이/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '가상매수 이후 가격 관측' })).toBeNull();
    rerender(<PaperStrategyPanel view={{ ...data, measurementHistory: { lastRecordedAt: null, failedBatchCount: null,
      unrecordedPointCount: null, error: '상세 관측 기록 상태를 읽을 수 없습니다.' } }} />);
    expect(screen.getByRole('status').textContent).toContain('누적 저장 실패 집계 확인 불가 · 상세 저장 미확인 집계 확인 불가 · 마지막 상세 저장 확인 불가');
    expect(screen.getByRole('status').textContent).not.toContain('0회');
    expect(screen.getByRole('status').textContent).not.toContain('0개');
    expect(screen.getByRole('article', { name: '삼성전자 매수 · BUY 판단' })).toBeTruthy();
    rerender(<PaperStrategyPanel view={{ ...data, measurementHistory: { lastRecordedAt: '2026-09-14T01:01:00Z', failedBatchCount: 0, unrecordedPointCount: 0 } }} />);
    expect(screen.queryByRole('status')).toBeNull();
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
    } })} />);
    expect(screen.getByText('지표 자율 판단 전략')).toBeTruthy();
    expect(screen.getByText('전략 선별력 · 같은 날 후보 대비')).toBeTruthy();
    expect(screen.getByText('후보 30건 중 6건 · 3일')).toBeTruthy();
    expect(screen.getByText('+1.25%p')).toBeTruthy();
    expect(screen.getByText(/기존 보유 2건.*연구 표시이며 매수 조건에 쓰지 않습니다/)).toBeTruthy();
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
