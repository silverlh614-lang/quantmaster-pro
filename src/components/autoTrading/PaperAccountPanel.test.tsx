// @vitest-environment jsdom
// @responsibility Verify virtual account setup with explicit evidence gaps.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperAccountPanel, PaperAccountRecords } from './PaperAccountPanel';
import type { PaperAccountView, PaperAccountOrder } from '../../types/paperAccount';

const mocks = vi.hoisted(() => ({ get: vi.fn(), start: vi.fn(), pause: vi.fn() }));
vi.mock('../../api/paperExperimentClient', () => ({ PAPER_EXPERIMENT_QUERY_KEY: ['paper-experiments'],
  paperExperimentApi: { getAccount: mocks.get, startAccount: mocks.start, pauseAccountBuys: mocks.pause } }));
const empty: PaperAccountView = { account: null, asOf: '2026-09-18T01:00:00Z', cash: null, equity: null, realizedPnl: null,
  unrealizedPnl: null, returnPct: null, positions: [] };
const started = (): PaperAccountView => ({ ...empty, cash: 10000000, equity: 10000000, realizedPnl: 0, unrealizedPnl: 0, returnPct: 0,
  account: { version: 'virtual-account-v1', id: 'account', startedAt: empty.asOf, config: { initialCash: 10000000, maxPositionPct: 20, includeExploration: false },
    buyPaused: false, controls: [], lastSnapshotAt: null, orders: [], marks: {} } });
let client: QueryClient;
beforeEach(() => { vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });
const mount = () => render(<QueryClientProvider client={client}><PaperAccountPanel /></QueryClientProvider>);
describe('virtual account screen', () => {
  it('separates past policy selection returns from subsequent account fills', () => {
    const view = started();
    const stats = { sampleCount: 20, dateCount: 5, symbolCount: 4, experimentIdsDigest: 'a'.repeat(64), meanNetReturnPct: 99, meanDailyExcessPct: 1 };
    view.account!.selections = [{ version: 'validated-net-v1', id: 'choice', tradingDate: '2026-09-18', selectedAt: empty.asOf,
      sourceEvaluatedAt: empty.asOf, cutoffAt: '2026-09-17T15:00:00Z', minimumSamples: 10, minimumEntryDates: 3,
      selectedRuleKey: 'rule', candidates: [{ ruleKey: 'rule', label: '검증된 RSI 기준', rule: { feature: 'rsi14', bucket: 0, horizon: 3 }, training: stats, validation: stats }] }];
    render(<PaperAccountRecords view={view} />);
    expect(screen.getByText(/과거 검증 순수익 99.00%/)).toBeTruthy();
    expect(screen.getByText(/선택 이후 계좌 체결: 청산 0건/).textContent).toContain('평균 순수익률 집계 대기');
    expect(screen.getByText(/계좌 체결 성과: 청산 0건/).textContent).toContain('실현손익 0원');
    expect(screen.getByText(/관측 최대 낙폭 집계 대기/)).toBeTruthy();
    expect(screen.getByText(/매수마다 추정 자산의 20%를 배정하고 최대 5종목까지 보유합니다/)).toBeTruthy();
  });
  it('links frozen daily evidence to buy outcomes and follows the original buy into later sales', () => {
    const view = started();
    const selection = (id: string, date: string) => ({ version: 'validated-net-v1' as const, id, tradingDate: date,
      selectedAt: empty.asOf, sourceEvaluatedAt: empty.asOf, cutoffAt: empty.asOf, minimumSamples: 10, minimumEntryDates: 3,
      selectedRuleKey: null, candidates: [] });
    view.account!.selections = [selection('day1', '2026-09-18'), selection('day2', '2026-09-21')];
    const order = (tradeId: string, side: 'BUY' | 'SELL', status: PaperAccountOrder['status'], selectionId?: string): PaperAccountOrder => ({
      id: `${tradeId}:${side}`, tradeId, symbol: tradeId, name: tradeId, side, status, selectionId,
      signalAt: empty.asOf, submittedAt: empty.asOf, updatedAt: empty.asOf, signalSnapshotId: 'scan',
      signalReason: '신호 근거', signalLabel: '진입 기준', purpose: 'VALIDATED', quantity: status === 'FILLED' ? 1 : 0, budget: 100,
      costModel: { version: 'test', buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0, slippageRate: 0 },
      statusReason: side === 'BUY' ? '동시 보유 한도' : '매도 가격 대기',
      fill: status === 'FILLED' ? { id: `${tradeId}:${side}:fill`, at: empty.asOf, snapshotId: 'scan',
        quote: { price: 100, observedAt: empty.asOf, source: 'KIS', snapshotId: 'scan' },
        quantity: 1, price: 100, grossAmount: 100, fee: 0, tax: 0, cashDelta: side === 'BUY' ? -100 : 100 } : null });
    view.account!.orders = [order('first', 'BUY', 'FILLED', 'day1'), order('first', 'SELL', 'FILLED', 'day2'),
      order('blocked', 'BUY', 'REJECTED', 'day1'),
      order('other', 'BUY', 'EXPIRED', 'day2'), order('legacy', 'BUY', 'REJECTED')];
    view.account!.skippedSignals = { through: empty.asOf, counts: { '2026-09-18': { '다른 규칙': 7 } } };
    const before = JSON.stringify(view);
    render(<PaperAccountRecords view={view} />);
    expect(screen.getByText('선택 근거에 연결된 매수 주문 2건: 체결 1 · 거절 1 · 만료 0 · 대기 0')).toBeTruthy();
    expect(screen.getByText('당일 주문 없이 제외된 신호 7건: 다른 규칙 7건')).toBeTruthy();
    expect(screen.getByText('당일 주문 없이 제외된 신호: 일별 집계 기록 없음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2026-09-18 선택의 주문 보기' }));
    const details = screen.getByLabelText('계좌 주문·체결 원장') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(within(details).getAllByRole('article')).toHaveLength(3);
    expect(within(details).getByText(/매도 · first/)).toBeTruthy();
    expect(within(details).queryByText(/매수 · other/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '선택 근거 미확인 주문 보기' }));
    expect(within(details).getAllByRole('article')).toHaveLength(1);
    expect(within(details).getByText(/매수 · legacy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '전체 주문 보기' }));
    expect(within(details).getAllByRole('article')).toHaveLength(5);
    expect(JSON.stringify(view)).toBe(before);
  });
  it('starts with user settings and offers buy pause after creation', async () => {
    mocks.get.mockResolvedValue(empty); mocks.start.mockResolvedValue(started()); mount();
    const button = await screen.findByRole('button', { name: '가상 계좌 시작' });
    expect((screen.getByLabelText('초기 예수금(원)') as HTMLInputElement).value).toBe('10000000');
    fireEvent.click(button);
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith({ initialCash: 10000000, maxPositionPct: 20, includeExploration: false }, expect.anything()));
    const pause = await screen.findByRole('button', { name: '신규 매수 일시정지' });
    mocks.pause.mockResolvedValue({ ...started(), account: { ...started().account!, buyPaused: true } }); fireEvent.click(pause);
    await screen.findByRole('button', { name: '신규 매수 재개' });
    expect(screen.queryByRole('button', { name: '가상 계좌 시작' })).toBeNull();
    expect(screen.getByText(/보유 평가와 매도 처리는 계속/)).toBeTruthy();
  });
  it('does not present an unreadable ledger as a new empty account', async () => {
    mocks.get.mockRejectedValue(new Error('계좌 기록 확인 불가')); mount();
    expect((await screen.findByRole('alert')).textContent).toContain('계좌 기록 확인 불가');
    expect(screen.queryByRole('button', { name: '가상 계좌 시작' })).toBeNull(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('shows the latest daily count of signals kept out of the account', () => {
    const view = started();
    view.account!.skippedSignals = { through: empty.asOf, counts: { '2026-09-17': { '탐색 신호': 7 },
      '2026-09-18': { '당일 선택한 수익성 우선 규칙과 다른 신호': 3, '탐색 신호': 2 } } };
    render(<PaperAccountRecords view={view} />);
    expect(screen.getByText(/계좌 기준 밖 신호 5건/).textContent)
      .toBe('2026-09-18 계좌 기준 밖 신호 5건은 주문 없이 1주 연구로만 집계합니다: 당일 선택한 수익성 우선 규칙과 다른 신호 3건 · 탐색 신호 2건');
  });
  it('labels a halted holding with its last traded price and when it will be sold', () => {
    const view = started();
    view.positions = [{ tradeId: 'trade', symbol: '005930', name: '삼성전자', quantity: 10, entryCost: 100000,
      mark: { price: 10000, observedAt: empty.asOf, source: 'KIS_REST_REQUEST_OBSERVED', snapshotId: 's' }, stale: true, halted: true,
      liquidationValue: 99000, unrealizedPnl: -1000 }];
    render(<PaperAccountRecords view={view} />);
    expect(screen.getAllByRole('status').map(item => item.textContent))
      .toContain('거래정지 종목은 정지 직전 가격으로 평가하고, 정지 해제 후 첫 유효 가격으로 매도 판단·체결합니다.');
    expect(screen.getByText(/거래정지 · 정지 직전 가격/)).toBeTruthy();
    expect(screen.queryByText(/· 이전 가격/)).toBeNull();
  });
  it('keeps stale and missing values visibly distinct from realized profit', () => {
    const view = started(); view.equity = null; view.unrealizedPnl = null; view.returnPct = null;
    view.positions = [{ tradeId: 'trade', symbol: '005930', name: '삼성전자', quantity: 10, entryCost: 100000,
      mark: null, stale: true, liquidationValue: null, unrealizedPnl: null }];
    render(<PaperAccountRecords view={view} />);
    expect(screen.getByRole('status').textContent).toContain('잠정 평가');
    expect(screen.getByText('실현손익').nextSibling?.textContent).toBe('0원');
    expect(screen.getByText('계좌 수익률').nextSibling?.textContent).toBe('미확인');
  });
});
