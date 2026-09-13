// @vitest-environment jsdom
// @responsibility Verify mobile workspace navigation.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import { useSettingsStore } from '../stores/useSettingsStore';
afterEach(cleanup);
describe('BottomNav', () => {
  it('navigates all five sections with an accessible current-page state', () => {
    useSettingsStore.getState().setView('DASHBOARD');
    render(<BottomNav />);
    const cases = [['기본 관측', 'PAPER_OBSERVATIONS'], ['전략 판단', 'PAPER_STRATEGY'], ['저장 자료 연구', 'PAPER_RESEARCH'], ['운영 설정', 'OPERATIONS'], ['운영 현황', 'DASHBOARD']] as const;
    for (const [label, view] of cases) {
      fireEvent.click(screen.getByLabelText(label));
      expect(useSettingsStore.getState().view).toBe(view);
      expect(screen.getByLabelText(label).getAttribute('aria-current')).toBe('page');
    }
    expect(screen.queryByText('더보기')).toBeNull();
    expect(screen.queryByText('체크리스트')).toBeNull();
  });
});
