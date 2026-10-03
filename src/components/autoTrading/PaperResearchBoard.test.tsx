// @vitest-environment jsdom
// @responsibility Verify current research, unknown data, and recorded changes remain distinct.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PaperAdaptiveCandidate, PaperAdaptiveState, PaperIndicatorInvention } from '../../types/paperAdaptive';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../types/paperIndicatorFormula';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { PaperResearchBoard } from './PaperResearchBoard';

const base: PaperAdaptiveCandidate = {
  rule: { feature: 'rsi14', bucket: 1, horizon: 3 }, active: true, reason: 'ACTIVE',
  training: { sampleCount: 20, dateCount: 5, symbolCount: 4, meanNetReturnPct: 1.5, meanDailyExcessPct: 0.2 },
  validation: { sampleCount: 12, dateCount: 3, symbolCount: 4, meanNetReturnPct: 1.2, meanDailyExcessPct: 0.15 },
};
const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
const invention: PaperIndicatorInvention = {
  id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-09-04T01:00:00Z',
  discoveryCutoffAt: '2026-09-03T15:00:00Z', rule: { bucket: 2, horizon: 3 }, training: base.training,
};
const invented: PaperAdaptiveCandidate = { ...base, rule: { feature: invention.id, ...invention.rule, invention } };
const state: PaperAdaptiveState = {
  policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
  tradingDate: '2026-09-21', evaluatedAt: '2026-09-21T01:00:00Z', cutoffAt: '2026-09-20T15:00:00Z',
  windowStartDate: '2026-08-03', validationStartDate: '2026-09-01', matureSampleCount: 100, matureDateCount: 20,
  candidates: [base, invented], changes: [],
  discovery: { version: 'indicator-discovery-v1', round: 2, roundStartedAt: '2026-09-03T15:00:00Z',
    roundTrainingEndDate: '2026-09-01', attemptedIds: [invention.id], inventions: [invention] },
};
afterEach(() => { cleanup(); useSettingsStore.getState().setView('DASHBOARD'); });

describe('PaperResearchBoard', () => {
  it('keeps an unknown research state distinct from a confirmed empty result', () => {
    const { rerender } = render(<PaperResearchBoard />);
    expect(screen.getByLabelText('기본 지표 26개')).toBeTruthy();
    expect(screen.getByLabelText('검토한 수식 확인 대기')).toBeTruthy();
    expect(screen.getByLabelText('매수에 채택 확인 대기')).toBeTruthy();
    expect(screen.getByText('첫 연구 결과를 기다립니다')).toBeTruthy();
    rerender(<PaperResearchBoard state={{ ...state, candidates: [], discovery: { ...state.discovery!, attemptedIds: [], inventions: [] } }} />);
    expect(screen.getByLabelText('검토한 수식 0개')).toBeTruthy();
    expect(screen.getByLabelText('새 관측으로 검증 0개')).toBeTruthy();
    expect(screen.getByLabelText('매수에 채택 0개')).toBeTruthy();
    expect(screen.getByText('아직 연결된 지표가 없습니다')).toBeTruthy();
  });

  it('reports backend research stages without treating pending inventions as active rules', () => {
    render(<PaperResearchBoard state={{ ...state, candidates: [base, { ...invented, active: false, reason: 'FORWARD_OBSERVATION' }] }} />);
    expect(screen.getByText('탐색 2차')).toBeTruthy();
    expect(screen.getByLabelText('검토한 수식 1개')).toBeTruthy();
    expect(screen.getByLabelText('새 관측으로 검증 1개')).toBeTruthy();
    expect(screen.getByLabelText('매수에 채택 1개')).toBeTruthy();
    const connected = screen.getByRole('list', { name: '현재 채택 지표' });
    expect(within(connected).getAllByRole('listitem')).toHaveLength(1);
    expect(within(connected).getByRole('heading', { name: 'RSI 14' })).toBeTruthy();
    expect(within(connected).queryByText('발명 지표')).toBeNull();
  });

  it('shows the frozen formula and actual validation statistics for an active invention', () => {
    render(<PaperResearchBoard state={{ ...state, candidates: [invented] }} />);
    const rule = within(screen.getByRole('list', { name: '현재 채택 지표' }));
    expect(rule.getByRole('heading', { name: 'RSI 14 × 거래량 비율' })).toBeTruthy();
    expect(rule.getByText('발명 지표')).toBeTruthy();
    expect(rule.getByText('D3')).toBeTruthy();
    expect(rule.getByText('+1.20%')).toBeTruthy();
    expect(rule.getByText('+0.15%p')).toBeTruthy();
    expect(rule.getByText('12건 · 3진입일 · 4종목')).toBeTruthy();
    const details = rule.getByText('수식 보기').closest('details')!;
    expect(details.querySelector('summary')).toBeTruthy();
    expect(details.textContent).toContain('N(RSI 14) = (값 − 50) / 40');
    expect(details.querySelector(`time[datetime="${invention.createdAt}"]`)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('does not present stored active rules as current when research cannot be loaded', () => {
    render(<PaperResearchBoard state={{ ...state, changes: [{ at: state.evaluatedAt, feature: invention.id,
      from: null, to: invented.rule, reason: 'ACTIVE' }] }} unavailable />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('매수에 채택 확인 대기')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '현재 채택 지표' })).toBeNull();
    expect(screen.getByRole('complementary', { name: '저장된 연구 변경 이력' })).toBeTruthy();
    expect(screen.getByText('매수 연결')).toBeTruthy();
  });

  it('keeps the latest five events and distinguishes creation, disconnection, replacement, and retirement', () => {
    const changes: PaperAdaptiveState['changes'] = [
      { at: '2026-09-01T01:00:00Z', feature: 'rsi14', from: null, to: base.rule, reason: 'ACTIVE' },
      { at: '2026-09-02T01:00:00Z', feature: 'rsi14', from: base.rule, to: { ...base.rule, horizon: 5 }, reason: 'ACTIVE' },
      { at: '2026-09-03T01:00:00Z', feature: invention.id, from: invented.rule, to: null, reason: 'DISCOVERY_RETIRED' },
      { at: '2026-09-03T01:00:00Z', feature: invention.id, from: null, to: invented.rule, reason: 'FORWARD_OBSERVATION' },
      { at: '2026-09-04T01:00:00Z', feature: invention.id, from: invented.rule, to: null, reason: 'FORWARD_OBSERVATION' },
      { at: '2026-09-05T01:00:00Z', feature: invention.id, from: null, to: invented.rule, reason: 'ACTIVE' },
    ];
    render(<PaperResearchBoard state={{ ...state, changes }} />);
    const rows = within(screen.getByRole('complementary', { name: '최근 연구 변경 이력' })).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    ['매수 연결', '연결 해제', '지표 생성', '연구 종료', '규칙 교체'].forEach((label, index) => expect(rows[index].textContent).toContain(label));
    expect(rows[1].textContent).not.toContain('지표 생성');
    expect(rows[2].querySelector('time')?.dateTime).toBe(rows[3].querySelector('time')?.dateTime);
    expect(rows.some(row => row.querySelector('time')?.dateTime === '2026-09-01T01:00:00Z')).toBe(false);
  });

  it('opens the existing strategy detail view from an empty research board', () => {
    render(<PaperResearchBoard />);
    fireEvent.click(screen.getByRole('button', { name: '전체 지표와 채택 근거' }));
    expect(useSettingsStore.getState().view).toBe('PAPER_STRATEGY');
  });
  it('separates two exploration slots from the three validated slots and hides both on failed reads', () => {
    const pending = { ...invented, active: false, reason: 'FORWARD_OBSERVATION' as const,
      validation: { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null } };
    const current: PaperAdaptiveState = { ...state, candidates: [base], exploration: { version: 'shadow-exploration-v1', sequence: 1,
      rules: [{ id: 'trial', registeredAt: state.evaluatedAt, candidate: pending }] } };
    const { rerender } = render(<PaperResearchBoard state={current} />);
    expect(screen.getByText('현재 1개 · 최대 3개')).toBeTruthy();
    expect(screen.getByText('1개 · 최대 2개')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: '현재 채택 지표' })).getAllByRole('listitem')).toHaveLength(1);
    const trial = within(screen.getByRole('list', { name: '탐색 가상매수 지표' }));
    expect(trial.getByText('탐색 · 검증 전')).toBeTruthy();
    expect(trial.getByText('0건 · 0진입일 · 0종목')).toBeTruthy();
    expect(trial.queryByText('0.00%')).toBeNull();
    rerender(<PaperResearchBoard state={current} unavailable />);
    expect(screen.queryByRole('list', { name: '탐색 가상매수 지표' })).toBeNull();
    expect(screen.getByText('등록 확인 대기')).toBeTruthy();
  });
});
