// @vitest-environment jsdom
// @responsibility Verify lightweight workspace navigation.
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { useSettingsStore } from './stores/useSettingsStore';
import { apiFetch } from './api/client';
vi.mock('./api/client', () => ({ apiFetch: vi.fn() }));
const baseline = { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', lastRun: null, totalCount: 0, openCount: 0, completedCount: 0, outcomes: [], groups: [], experiments: [] };
let client: QueryClient;
beforeEach(() => {
  useSettingsStore.setState({ view: 'DASHBOARD', sidebarDrawerOpen: false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiFetch).mockImplementation(async (url, options) => {
    if (url.endsWith('/engine/status')) return { mode: 'SHADOW' };
    if (url.endsWith('/engine/guards')) return { autoTradingPaused: false };
    if (options?.query?.section === 'strategy' || options?.query?.section === 'research') return null;
    return baseline;
  });
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });
describe('App workspace', () => {
  it('starts with only three read requests and loads detailed data on navigation', async () => {
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await screen.findByText('첫 관측을 기다리고 있습니다');
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(apiFetch).toHaveBeenCalledWith('/api/shadow/experiments', { query: { section: 'overview' } });
    expect(screen.queryByText('마켓 게이트')).toBeNull();
    expect(screen.queryByText('후보 발굴')).toBeNull();
    const cases = [['기본 관측', 'PAPER_OBSERVATIONS'], ['전략 판단', 'PAPER_STRATEGY'], ['저장 자료 연구', 'PAPER_RESEARCH'], ['운영 설정', 'OPERATIONS'], ['운영 현황', 'DASHBOARD']] as const;
    for (const [label, view] of cases) {
      fireEvent.click(screen.getByLabelText(label));
      expect(useSettingsStore.getState().view).toBe(view);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(label));
    }
    expect(apiFetch).toHaveBeenCalledWith('/api/shadow/experiments', { query: { section: 'research' } });
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });
  it('redirects retired history without loading retired page effects', async () => {
    useSettingsStore.setState({ view: 'PUBLIC_REPORT' });
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await waitFor(() => expect(useSettingsStore.getState().view).toBe('DASHBOARD'));
    expect(screen.queryByText('공개 리포트')).toBeNull();
    expect(vi.mocked(apiFetch).mock.calls.every(([url]) => ['/api/auto-trade/engine/status', '/api/auto-trade/engine/guards', '/api/shadow/experiments'].includes(url))).toBe(true);
  });
  it('keeps the scan unavailable until the server mode is known', async () => {
    vi.mocked(apiFetch).mockImplementation(async url => {
      if (url.endsWith('/engine/status')) return new Promise(() => {});
      if (url.endsWith('/engine/guards')) return { autoTradingPaused: false };
      return baseline;
    });
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    await screen.findByText('운영 상태 확인 중');
    const scan = screen.getByRole('button', { name: '지금 스캔' }) as HTMLButtonElement;
    expect(scan.disabled).toBe(true);
    fireEvent.click(scan);
    expect(vi.mocked(apiFetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
});
