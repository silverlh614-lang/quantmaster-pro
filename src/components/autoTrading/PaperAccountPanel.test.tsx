// @vitest-environment jsdom
// @responsibility Verify virtual account setup with explicit evidence gaps.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperAccountPanel, PaperAccountRecords } from './PaperAccountPanel';
import type { PaperAccountView } from '../../types/paperAccount';

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
