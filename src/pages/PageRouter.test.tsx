// @vitest-environment jsdom
// @responsibility Verify navigation isolation and manual recovery from rejected screen imports.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PageRouter } from './PageRouter';
import { useSettingsStore } from '../stores/useSettingsStore';
import { reloadPage } from '../utils/lazyLoadRecovery';

let failure: Error | null;
vi.mock('./PaperDashboardPage', () => ({ PaperDashboardPage: ({ page }: { page: string }) => {
  if (page === 'PAPER_OBSERVATIONS' && failure) throw failure;
  return <div>{page} 정상 화면</div>;
} }));
vi.mock('../utils/lazyLoadRecovery', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/lazyLoadRecovery')>(), reloadPage: vi.fn(),
}));
beforeEach(() => {
  failure = new Error('render failed');
  useSettingsStore.setState({ view: 'PAPER_OBSERVATIONS' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('workspace error recovery', () => {
  it('shows the menu label and clears a failed screen when navigating to another menu', () => {
    render(<PageRouter />);
    expect(screen.getByText('기본 관측 로드 실패')).toBeTruthy();
    act(() => useSettingsStore.getState().setView('PAPER_RESEARCH'));
    expect(screen.getByText('PAPER_RESEARCH 정상 화면')).toBeTruthy();
    expect(screen.queryByText(/로드 실패/)).toBeNull();
  });
  it('reloads the document on manual asset retry instead of reusing a rejected import', () => {
    failure = new TypeError('Failed to fetch dynamically imported module: /assets/old.js');
    render(<PageRouter />);
    fireEvent.click(screen.getByRole('button', { name: '화면 새로고침' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
  it('can retry a recoverable render error without reloading the document', () => {
    render(<PageRouter />);
    failure = null;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(screen.getByText('PAPER_OBSERVATIONS 정상 화면')).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
