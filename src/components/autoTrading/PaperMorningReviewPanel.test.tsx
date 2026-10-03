// @vitest-environment jsdom
// @responsibility Verify recommendation follow-up states remain distinguishable.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaperMorningReview } from '../../types/paperMorning';
import { PaperMorningReviewPanel, PaperMorningReviewResults } from './PaperMorningReviewPanel';
import { paperExperimentApi } from '../../api/paperExperimentClient';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function review(): PaperMorningReview {
  const stats = { sampleCount: 20, dateCount: 5, symbolCount: 4, meanNetReturnPct: 1, meanDailyExcessPct: 0.2 };
  return { asOf: '2026-10-02T07:10:00Z', report: { version: 'morning-recommendation-v1', id: 'morning', tradingDate: '2026-10-02',
    scheduledAt: '2026-10-01T23:30:00Z', createdAt: '2026-10-01T23:30:00Z', status: 'READY', reason: '검증 규칙 추천',
    sourceSnapshotId: 'source', sourceAsOf: '2026-10-01T23:00:00Z', adaptiveEvaluatedAt: null, adaptiveCutoffAt: null,
    consideredCount: 100, matchedCount: 1, heldCount: 0, message: '<b>당시 추천 내용</b>', delivery: { sentAt: '2026-10-01T23:30:05Z', messageId: 1 },
    picks: [{ rank: 1, symbol: '005930', name: '삼성전자', purpose: 'VALIDATED', ruleValue: 20,
      referenceClose: { tradingDate: '2026-10-01', close: 9900, availableAt: '2026-10-01T06:30:00Z' },
      observation: { symbol: '005930', name: '삼성전자', price: 9900, observedAt: '2026-10-01T06:30:00Z', source: 'KIS',
        return1dPct: null, return5dPct: null, aboveMa20: null, news: [], dailyCloses: [] },
      candidate: { rule: { feature: 'rsi14', bucket: 0, horizon: 3 }, training: stats, validation: stats, active: true, reason: 'ACTIVE' } }] },
    results: [{ rank: 1, symbol: '005930', name: '삼성전자', tradeId: null, status: 'NOT_ENTERED', entryAt: null, entryPrice: null,
      entryReason: null, exitAt: null, exitPrice: null, exitReason: null, netReturnPct: null, matchesEntryRule: null,
      measurement: null, lastDecision: { symbol: '005930', action: 'WAIT', reason: '진입 규칙 불일치', decisionAt: '2026-10-02T05:00:00Z' } }] };
}
it('shows saved non-entry reasons without fabricating returns', () => {
  render(<PaperMorningReviewResults review={review()} />);
  expect(screen.getByText('가상 미진입')).toBeTruthy();
  expect(screen.getByText(/마지막 장중 판단.*진입 규칙 불일치/)).toBeTruthy();
  expect(screen.queryByText(/확정 순수익률/)).toBeNull();
});
it('separates realized results from the reference price and retains original recommendations', () => {
  const value = review(); Object.assign(value.results[0], { status: 'CLOSED', tradeId: 'trade', entryAt: '2026-10-02T01:00:00Z',
    entryPrice: 10000, entryReason: '새 장중 가격으로 판단', exitAt: '2026-10-02T04:00:00Z', exitPrice: 11000,
    exitReason: '수익 반납', netReturnPct: 9.7, matchesEntryRule: false });
  render(<PaperMorningReviewResults review={value} />);
  expect(screen.getByText(/참고 종가 9,900원/)).toBeTruthy();
  expect(screen.getByText(/가상 매수 10,000원/)).toBeTruthy();
  expect(screen.getByText('확정 순수익률 +9.70%')).toBeTruthy();
  expect(screen.getByText('추천과 다른 규칙으로 진입')).toBeTruthy();
  expect(screen.getByText('당시 추천 내용')).toBeTruthy();
});
it('shows tracking failures without inventing non-entry outcomes', () => {
  const value = review(); value.results = []; value.trackingError = '거래 조회 실패';
  render(<PaperMorningReviewResults review={value} />);
  expect(screen.getByRole('alert').textContent).toContain('거래 조회 실패');
  expect(screen.queryByText('가상 미진입')).toBeNull();
});
it('loads a selected recommendation date independently from today', async () => {
  const read = vi.spyOn(paperExperimentApi, 'getMorningReview').mockResolvedValue(review());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PaperMorningReviewPanel /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('추천일'), { target: { value: '2026-09-18' } });
  await waitFor(() => expect(read).toHaveBeenCalledWith('2026-09-18'));
  await screen.findByText('가상 미진입'); client.clear();
});
