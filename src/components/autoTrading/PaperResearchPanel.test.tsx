// @vitest-environment jsdom
// @responsibility Verify research coverage, missing data and explicit local research refresh.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaperResearchPanel } from './PaperResearchPanel';
import type { PaperResearchView } from '../../types/paperResearch';
import { apiFetch } from '../../api/client';
vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.clearAllMocks(); });
const view: PaperResearchView = { asOf: '2026-09-13T00:00:00Z', symbols: 0, seriesCount: 0, newsCount: 0,
  sampleCount: 0, learningSampleCount: 0, firstDate: null, lastDate: null, skipped: {},
  inventory: [{ file: 'offhours-snapshot.json', records: 0, status: 'MISSING' }], groups: [], validation: [], notes: [] };
function show(data?: PaperResearchView) {
  const client = new QueryClient(); clients.push(client);
  render(<QueryClientProvider client={client}><PaperResearchPanel view={data} /></QueryClientProvider>);
  return client;
}
describe('historical research panel', () => {
  it('distinguishes empty coverage from profitable or completed learning', () => {
    show(view);
    expect(screen.getByText(/재현할 완전한 가격 자료가 아직 없습니다/)).toBeTruthy();
    expect(screen.getByText(/offhours-snapshot.json: 파일 없음/)).toBeTruthy();
    expect(screen.queryByText('+0.00%')).toBeNull();
  });
  it('explicitly refreshes research without calling the trade scan endpoint', async () => {
    vi.mocked(apiFetch).mockResolvedValue(view);
    const client = show(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: '저장 자료 다시 연구' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/shadow/research', { method: 'POST' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
  it('shows historical coverage separately from news evidence available for decisions', () => {
    show({ ...view, sampleCount: 100, symbols: 5, learningSampleCount: 6, error: '원장 읽기 실패' });
    expect(screen.getByText(/재현 100건 · 5종목 · 뉴스 전략 학습에 사용 가능 6건/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('원장 읽기 실패');
  });
});
