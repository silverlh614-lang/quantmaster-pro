// @vitest-environment jsdom
/**
 * @responsibility 전체 App 트리에서 하단 탭 클릭 → 섹션(view) 전환 회귀
 *
 * 검증: App 이 크래시 없이 마운트되고, BottomNav 의 4개 주요 탭 클릭이
 *       useSettingsStore.view 를 올바른 섹션으로 전환한다 (섹션 전환 연결 회귀).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  class Obs { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  vi.stubGlobal('IntersectionObserver', Obs as unknown as typeof IntersectionObserver);
  vi.stubGlobal('ResizeObserver', Obs as unknown as typeof ResizeObserver);
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({}), text: async () => '{}',
    headers: new Map(), clone() { return this; },
  })) as unknown as typeof fetch);
  if (!('vibrate' in navigator)) {
    Object.defineProperty(navigator, 'vibrate', { value: () => true, writable: true });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App — 하단 탭 섹션 전환 (연결 회귀)', () => {
  it('App 마운트 + 4개 주요 탭이 올바른 view 로 전환된다', async () => {
    const { useSettingsStore } = await import('./stores/useSettingsStore');
    useSettingsStore.getState().setView('DISCOVER');

    const { default: App } = await import('./App');
    const { QueryProvider } = await import('./components/common/QueryProvider');

    render(
      <QueryProvider>
        <App />
      </QueryProvider>,
    );

    // BottomNav 가 렌더되어야 함 (마운트 성공 증거)
    expect(screen.queryByLabelText('Candidates'), 'BottomNav 가 렌더되어야 함').not.toBeNull();

    const cases: Array<[string, string]> = [
      ['Trade', 'AUTO_TRADE'],
      ['Watchlist', 'WATCHLIST'],
      ['Report', 'PUBLIC_REPORT'],
      ['Candidates', 'DISCOVER'],
    ];
    for (const [label, expected] of cases) {
      fireEvent.click(screen.getByLabelText(label));
      expect(useSettingsStore.getState().view, `${label} 탭 → ${expected}`).toBe(expected);
    }
  }, 20000);
});
