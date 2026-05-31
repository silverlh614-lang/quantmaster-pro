// @vitest-environment jsdom
/**
 * @responsibility BottomNav 섹션 전환 회귀 — 탭 클릭 → view 갱신 → 구독자 재렌더
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import { useSettingsStore } from '../stores/useSettingsStore';

function ViewProbe() {
  const view = useSettingsStore((s) => s.view);
  return <div data-testid="current-view">{view}</div>;
}

beforeEach(() => {
  useSettingsStore.getState().setView('DISCOVER');
});

afterEach(() => cleanup());

describe('BottomNav — 섹션 전환', () => {
  it('Trade 탭 클릭 → view=AUTO_TRADE 로 전환 + 구독자 재렌더', () => {
    const { getByLabelText, getByTestId } = render(
      <>
        <ViewProbe />
        <BottomNav />
      </>,
    );
    expect(getByTestId('current-view').textContent).toBe('DISCOVER');
    fireEvent.click(getByLabelText('매매'));
    expect(useSettingsStore.getState().view).toBe('AUTO_TRADE');
    expect(getByTestId('current-view').textContent).toBe('AUTO_TRADE');
  });

  it('주요 탭 4개 모두 올바른 view 로 전환', () => {
    const cases: Array<[string, string]> = [
      ['매매', 'AUTO_TRADE'],
      ['관심종목', 'WATCHLIST'],
      ['리포트', 'PUBLIC_REPORT'],
      ['후보', 'DISCOVER'],
    ];
    const { getByLabelText } = render(<BottomNav />);
    for (const [label, expected] of cases) {
      fireEvent.click(getByLabelText(label));
      expect(useSettingsStore.getState().view).toBe(expected);
    }
  });
});
