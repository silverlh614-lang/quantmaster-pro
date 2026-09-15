// @vitest-environment jsdom
// @responsibility Verify visible investor-flow coverage with paired outcome statistics.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PaperInvestorFlow, PaperInvestorFlowStudy } from '../../types/paperInvestorFlow';
import { PaperInvestorFlowDetails, PaperInvestorFlowPanel } from './PaperInvestorFlowPanel';

afterEach(cleanup);
const noPairs = { count: 0, symbolCount: 0, entryDateCount: 0, pearson: null, spearman: null, status: 'INSUFFICIENT_PAIRS' as const };
const study: PaperInvestorFlowStudy = { version: 'previous-session-flow-v1', totalCount: 12, availableCount: 8, missing: { NOT_RECORDED: 4 },
  segments: [{ news: 'ALL', observationCount: 8, flowCorrelation: { ...noPairs, count: 8, symbolCount: 4, entryDateCount: 2,
    pearson: -0.4, spearman: -0.5, status: 'AVAILABLE' }, correlations: [
      { ...noPairs, actor: 'FOREIGN', horizon: 1, count: 5, symbolCount: 4, entryDateCount: 2, pearson: 0, spearman: 0, status: 'AVAILABLE' },
      { ...noPairs, actor: 'FOREIGN', horizon: 5 },
    ], groups: [] },
    { news: 'NEGATIVE', observationCount: 3, flowCorrelation: noPairs, correlations: [{ ...noPairs, actor: 'INSTITUTION', horizon: 1 }], groups: [] }],
};

describe('PaperInvestorFlowPanel', () => {
  it('separates current flows from entry-frozen outcome pairs and filters by news direction', () => {
    render(<PaperInvestorFlowPanel study={study} snapshot={{ asOf: '2026-09-18T01:00:00Z', tradingDate: '2026-09-17',
      candidateCount: 608, availableCount: 580, groups: [{ group: 'BOTH_BUY', count: 123 }], flowCorrelation: study.segments[0].flowCorrelation }} />);
    expect(screen.getByText(/580\/608종목 확인/)).toBeTruthy();
    expect(screen.getByText('동반 순매수 123종목')).toBeTruthy();
    const table = screen.getByRole('table', { name: '수급 비율과 이후 순수익률의 상관계수' });
    expect(within(table).getAllByText('0.000')).toHaveLength(2);
    expect(within(table).getAllByText('짝지어진 표본 3건부터 계산')).toHaveLength(2);
    expect(within(table).getByText('5건 / 4종목 / 2일')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '수급 연구 뉴스 방향' }), { target: { value: 'NEGATIVE' } });
    expect(within(table).queryByText('0.000')).toBeNull();
    expect(within(table).getByText('기관')).toBeTruthy();
    expect(screen.getByText('진입 당시 수급 미기록: 4건')).toBeTruthy();
  });

  it('preserves true zero, unknown quantity, source date and exclusion reason', () => {
    const flow: PaperInvestorFlow = { symbol: '005930', source: 'KIS_API', unit: 'SHARES', requestedTradingDate: '2026-09-17',
      tradingDate: '2026-09-17', observedAt: '2026-09-18T01:00:00Z', foreignNetShares: 0, institutionalNetShares: null, volume: null, issue: 'QUANTITY_MISSING' };
    render(<PaperInvestorFlowDetails flow={flow} />);
    expect(screen.getByText('외국인 0주 · 기관 미확인')).toBeTruthy();
    expect(screen.getByText(/같은 날짜의 순매수 수량 미확인 · 상관계산에서 제외/)).toBeTruthy();
    expect(screen.getByText(/직전 거래일 기준 2026-09-17 · KIS 일별 수급/)).toBeTruthy();
    expect(screen.queryByText(/거래량 대비 외국인/)).toBeNull();
  });
});
