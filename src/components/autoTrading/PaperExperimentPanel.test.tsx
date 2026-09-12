// @vitest-environment jsdom
// @responsibility Verify independent Shadow results reach the visible screen.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaperExperimentView, PaperScanResult } from '../../types/paperExperiment';
import { paperExperimentApi } from '../../api/paperExperimentClient';
import { PaperExperimentPanel, PaperExperimentResults } from './PaperExperimentPanel';

vi.mock('../../api/paperExperimentClient', () => ({
  PAPER_EXPERIMENT_QUERY_KEY: ['paper-experiments'],
  paperExperimentApi: { getView: vi.fn(), scan: vi.fn() },
}));

const emptyView: PaperExperimentView = {
  mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', lastRun: null,
  totalCount: 0, openCount: 0, completedCount: 0,
  outcomes: [1, 3, 5].map(horizon => ({
    horizon: horizon as 1 | 3 | 5, label: `D${horizon}`, count: 0,
    meanNetReturnPct: null, winRatePct: null,
  })),
  groups: [{ label: 'NEWS_ABSENT', count: 0, meanNetReturnPct: null, winRatePct: null }],
  experiments: [],
};

const scanResult: PaperScanResult = {
  snapshotId: 'test-snapshot', asOf: '2026-09-11T01:00:00.000Z',
  candidateCount: 4, observedCount: 3, openedCount: 0, completedCount: 0,
  missingPriceCount: 1, marketOpen: true, issues: ['005930:CURRENT_QUOTE_UNAVAILABLE'],
};

const clients: QueryClient[] = [];
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><PaperExperimentPanel /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; });

describe('PaperExperimentPanel', () => {
  it('keeps unavailable outcomes separate from an observed zero return', () => {
    render(<PaperExperimentResults view={{
      ...emptyView,
      outcomes: emptyView.outcomes.map(item => item.horizon === 1
        ? { ...item, count: 2, meanNetReturnPct: 0, winRatePct: 0 }
        : item),
    }} />);
    expect(screen.getByText('0.00%')).toBeTruthy();
    expect(screen.getAllByText('집계 대기').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('미실행')).toBeTruthy();
    expect(screen.getByText('관측 뉴스 없음')).toBeTruthy();
    expect(screen.getByText(/계좌 수익률을 뜻하지 않습니다/)).toBeTruthy();
    expect(screen.queryByText('뉴스·추세 매매 전략')).toBeNull();
  });

  it('renders the optional strategy independently while baseline outcomes remain available on strategy failure', () => {
    render(<PaperExperimentResults view={{ ...emptyView, strategy: {
      strategyVersion: 'news-trend-v1', mode: 'SHADOW',
      policy: { version: 'news-trend-v1', newsLookbackHours: 72, minimumSamples: 10, minimumEntryDates: 3, horizonSelection: 'MEAN_NET_RETURN_PER_DAY', exitModel: 'SCHEDULED_CLOSE' },
      totalCount: 0, openCount: 0,
      performance: { closedCount: 0, meanNetReturnPct: null, winRatePct: null, totalNetPnl: null },
      lastRun: null, latestDecisions: [], trades: [], error: 'strategy ledger unavailable',
    } }} />);
    expect(screen.getByText('뉴스·추세 매매 전략')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('전략 기록 확인 불가');
    expect(screen.getByText('D1 평균 순수익률')).toBeTruthy();
    expect(screen.getByText('누적 실험')).toBeTruthy();
  });

  it('renders stored experiment evidence and D1 net outcome without inventing D3/D5', () => {
    render(<PaperExperimentResults view={{
      ...emptyView, totalCount: 1, openCount: 1, lastRun: scanResult,
      experiments: [{
        id: 'experiment-1', strategyVersion: 'shadow-baseline-v1', snapshotId: 'entry-snapshot',
        symbol: '005930', name: '삼성전자', entryAt: '2026-09-10T01:00:00Z', tradingDate: '2026-09-10',
        entryPrice: 70_000, quantity: 1, status: 'OPEN',
        entryObservation: { symbol: '005930', name: '삼성전자', price: 70_000, observedAt: '2026-09-10T01:00:00Z', source: 'KIS', return1dPct: null, return5dPct: null, aboveMa20: null, news: [], dailyCloses: [] },
        costModel: { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
        outcomes: [{ horizon: 1, tradingDate: '2026-09-11', availableAt: '2026-09-11T07:00:00Z', exitPrice: 71_000, grossReturnPct: 1.43, netReturnPct: 1.2, netPnl: 840 }],
      }],
    }} />);
    expect(screen.getByText('삼성전자')).toBeTruthy();
    expect(screen.getByText('70,000원')).toBeTruthy();
    expect(screen.getByText('+1.20%')).toBeTruthy();
    expect(screen.getByText('추세 미확인')).toBeTruthy();
    expect(screen.getByText('005930:현재가를 확인하지 못했습니다')).toBeTruthy();
  });

  it('runs the paper scan and fetches the persisted view again', async () => {
    vi.mocked(paperExperimentApi.getView).mockResolvedValueOnce(emptyView).mockResolvedValue({ ...emptyView, lastRun: scanResult });
    vi.mocked(paperExperimentApi.scan).mockResolvedValue(scanResult);
    renderPanel();
    await screen.findByText('미실행');
    fireEvent.click(screen.getByRole('button', { name: '지금 스캔' }));
    await screen.findByText('4종목');
    expect(paperExperimentApi.scan).toHaveBeenCalledTimes(1);
    expect(paperExperimentApi.getView).toHaveBeenCalledTimes(2);
  });

  it('shows a fetch failure rather than an empty successful ledger', async () => {
    vi.mocked(paperExperimentApi.getView).mockRejectedValue(new Error('ledger unavailable'));
    renderPanel();
    await screen.findByRole('alert');
    expect(screen.queryByText('누적 실험')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('shows a scan error without replacing the last successful observation', async () => {
    vi.mocked(paperExperimentApi.getView).mockResolvedValue({ ...emptyView, lastRun: scanResult });
    vi.mocked(paperExperimentApi.scan).mockRejectedValue(new Error('수집 실패'));
    renderPanel();
    await screen.findByText('4종목');
    fireEvent.click(screen.getByRole('button', { name: '지금 스캔' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('수집 실패'));
    expect(screen.getByText('4종목')).toBeTruthy();
    expect(paperExperimentApi.getView).toHaveBeenCalledTimes(1);
  });
});
