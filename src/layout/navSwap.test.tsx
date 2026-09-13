// @vitest-environment jsdom
/**
 * @responsibility AnimatePresence mode="wait" 페이지 스왑이 view 변경에 막히지 않는지 회귀
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { AnimatePresence, motion } from 'motion/react';
import { BottomNav } from './BottomNav';
import { useSettingsStore } from '../stores/useSettingsStore';

function SwapRouter() {
  const view = useSettingsStore((s) => s.view);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div data-testid="page">{view}</div>
      </motion.div>
    </AnimatePresence>
  );
}

beforeEach(() => {
  useSettingsStore.getState().setView('DASHBOARD');
});

afterEach(() => cleanup());

describe('AnimatePresence mode="wait" 페이지 스왑', () => {
  it('전략 판단 → 저장 자료 연구 연속 전환 시 마지막 view 가 렌더된다 (스왑 멈춤 없음)', async () => {
    const { getByLabelText, getByTestId } = render(
      <>
        <SwapRouter />
        <BottomNav />
      </>,
    );
    expect(getByTestId('page').textContent).toBe('DASHBOARD');

    await act(async () => {
      fireEvent.click(getByLabelText('전략 판단'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(getByTestId('page').textContent).toBe('PAPER_STRATEGY');

    await act(async () => {
      fireEvent.click(getByLabelText('저장 자료 연구'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(getByTestId('page').textContent).toBe('PAPER_RESEARCH');
  });
});
