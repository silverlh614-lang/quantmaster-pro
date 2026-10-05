// @vitest-environment jsdom
// @responsibility Verify manual navigation, indicator demonstrations, searchable explanations.
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PaperManualPage } from './PaperManualPage';
import { PAPER_MANUAL, paperManualText } from '../content/paperManual';
import { PAPER_FEATURES } from '../types/paperObservationFeatures';
import { useSettingsStore } from '../stores/useSettingsStore';
import { MobileTopBar } from '../layout/MobileTopBar';

afterEach(cleanup);
const category = (name: string) => within(screen.getByRole('navigation', { name: '설명서 카테고리' })).getByRole('button', { name: new RegExp(name) });
it('lets a mobile reader enter the manual and follow its link to actual recorded decisions', () => {
  render(<><MobileTopBar /><PaperManualPage /></>);
  fireEvent.click(screen.getByRole('button', { name: '사용 설명서' }));
  expect(useSettingsStore.getState().view).toBe('MANUAL');
  fireEvent.click(category('추천과 가상 매수'));
  expect(screen.getByText(/최대 보유 종목 수가 아닙니다/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '추천 후속 결과와 전략 판단 보기' }));
  expect(useSettingsStore.getState().view).toBe('PAPER_STRATEGY');
});
it('searches across categories, exposes the matching indicator explanation, and handles empty results', () => {
  render(<PaperManualPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '설명서 검색' }), { target: { value: '부채비율' } });
  expect(screen.getByText(/부채 200, 자기자본 100이면 200%/)).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '찾을수없는내용xyz' } });
  expect(screen.getByRole('heading', { name: '일치하는 설명이 없습니다.' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '검색 지우기' }));
  expect(screen.getByRole('heading', { name: '전체 흐름' })).toBeTruthy();
});
it('explains all current indicators in the on-screen dictionary and complete offline text', () => {
  const section = PAPER_MANUAL.find(item => item.id === 'glossary')!;
  expect(section.blocks).toHaveLength(Object.keys(PAPER_FEATURES).length);
  for (const block of section.blocks) {
    expect(block.paragraphs).toHaveLength(4);
    expect(paperManualText()).toContain(block.paragraphs[3]);
  }
  render(<PaperManualPage />);
  fireEvent.click(category('지표 사전'));
  fireEvent.click(screen.getByText('ADX 14 추세 강도', { exact: true }));
  expect(screen.getByText(/가격은 내려가는데 ADX는 20에서 35/)).toBeTruthy();
  expect(paperManualText()).toContain('실주문 연결은 미구현');
});
it('changes the teaching inputs without invoking a trading action', () => {
  render(<PaperManualPage />);
  fireEvent.click(category('지표 움직임 체험'));
  fireEvent.change(screen.getByLabelText(/예시 완료 종가/), { target: { value: '9000' } });
  expect(screen.getByLabelText('20일선 이격 계산 결과').textContent).toContain('-10%');
  fireEvent.change(screen.getByLabelText(/예시 완료일 거래량/), { target: { value: '5' } });
  expect(screen.getByLabelText('거래량 비율 계산 결과').textContent).toContain('0.5배');
  expect(screen.getByText(/실제 종목 자료가 아니며 매매·설정에 반영되지 않습니다/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '지금 관측' })).toBeNull();
});
it('demonstrates negative products, operand order and the actual normalization clamp', () => {
  render(<PaperManualPage />);
  fireEvent.click(category('지표 움직임 체험'));
  fireEvent.change(screen.getByLabelText(/예시 ADX/), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/예시 RSI 5일 변화/), { target: { value: '-10' } });
  fireEvent.change(screen.getByLabelText('조합 방식'), { target: { value: 'PRODUCT' } });
  expect(screen.getByLabelText('발명 지표 계산 결과').textContent).toBe('-1 × -1 = 1');
  expect(screen.getByText('예시 시험 조건: 조합값 1 이상 → 해당')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('조합 방식'), { target: { value: 'DIFFERENCE' } });
  expect(screen.getByLabelText('발명 지표 계산 결과').textContent).toBe('-1 − -1 = 0');
  fireEvent.change(screen.getByLabelText(/예시 RSI 5일 변화/), { target: { value: '40' } });
  expect(screen.getByLabelText('발명 지표 계산 결과').textContent).toBe('-1 − 3 = -4');
  expect(screen.getByText('예시 시험 조건: 조합값 1 이상 → 해당하지 않음')).toBeTruthy();
});
