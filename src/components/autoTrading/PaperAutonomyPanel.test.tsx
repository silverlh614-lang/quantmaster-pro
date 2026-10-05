// @vitest-environment jsdom
// @responsibility Verify autonomous allocation explanations distinguish evidence, unfinished samples, fallback behavior.
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PaperAdaptiveState } from '../../types/paperAdaptive';
import { paperAutonomyRuleKey, type PaperAutonomyAllocation } from '../../types/paperAutonomy';
import { PaperAutonomyAllocationDetails, PaperAutonomyPanel } from './PaperAutonomyPanel';
afterEach(cleanup);

function state(): PaperAdaptiveState {
  const empty = { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null };
  const candidate = { rule: { feature: 'rsi14' as const, bucket: 1, horizon: 1 as const }, training: empty,
    validation: empty, active: false, reason: 'INSUFFICIENT_VALIDATION' as const };
  const ruleKey = paperAutonomyRuleKey(candidate.rule);
  return { policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
    tradingDate: '2026-10-05', evaluatedAt: '2026-10-05T00:00:00Z', cutoffAt: '2026-10-04T15:00:00Z', windowStartDate: null,
    validationStartDate: null, matureSampleCount: 0, matureDateCount: 0, changes: [], candidates: [candidate],
    exploration: { version: 'shadow-exploration-v1', sequence: 1,
      rules: [{ id: 'trial', registeredAt: '2026-10-05T00:00:00Z', candidate }],
      autonomy: { version: 'shadow-autonomy-v1', evaluatedAt: '2026-10-05T00:00:00Z', cutoffAt: '2026-10-04T15:00:00Z',
        status: 'READY', selectedRuleKeys: [ruleKey], entries: [{ ruleKey, lastSelectedAt: null, reason: 'EXPLORE', weight: 2,
          stats: { totalCount: 7, closedCount: 5, pendingCount: 2, sampleCount: 3, dateCount: 1,
            meanNetReturnPct: 1.5, meanDateNetReturnPct: 1.5, standardErrorPct: null, tradeIdsDigest: 'a'.repeat(64) } }] } } };
}

it('does not claim the controller is active when its stored record is absent', () => {
  const { rerender } = render(<PaperAutonomyPanel />);
  expect(screen.getByText('자율 판단 기록 확인 대기')).toBeTruthy();
  expect(screen.queryByText('자율 배분 적용')).toBeNull();
  const value = state(); delete value.exploration!.autonomy;
  rerender(<PaperAutonomyPanel state={value} />);
  expect(screen.getByText(/저장된 자율 판단 기록이 없습니다/)).toBeTruthy();
});
it('explains small positive samples as exploration and keeps unfinished cohorts separate', () => {
  const value = state();
  const { container } = render(<PaperAutonomyPanel state={value} />);
  expect(screen.getByText('실제 거래 표본을 더 모읍니다')).toBeTruthy();
  expect(screen.getByText(/판단할 표본이 부족합니다/)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 5 }).textContent).toContain('RSI');
  expect(screen.getByText('3건 · 1개 진입일')).toBeTruthy();
  expect(screen.getByText('+1.50%')).toBeTruthy();
  expect(screen.getByText('상대 가중치 2')).toBeTruthy();
  expect(screen.queryByText('2 / 3')).toBeNull();
  expect(container.textContent).not.toContain('a'.repeat(64));
  const details = screen.getByText('집계 범위와 이전 선택 보기'); fireEvent.click(details);
  expect(details.parentElement!.hasAttribute('open')).toBe(true);
  expect(screen.getByText(/거래 7건 · 청산 5건 · 진행 중 2건/)).toBeTruthy();
  expect(screen.getByText(/그 진입일의 청산 결과도 평가에서 제외/)).toBeTruthy();
  expect(screen.getByText(/탐색 매수를 막는 추가 조건이 아닙니다/)).toBeTruthy();
  expect(screen.queryByText('탐색 기회를 늘립니다')).toBeNull();
});
it('shows selected rules first and keeps other reviewed candidates behind compact details', () => {
  const value = state(), autonomy = value.exploration!.autonomy!;
  const candidate = { ...value.candidates[0], rule: { feature: 'adx14' as const, bucket: 2, horizon: 3 as const } };
  const key = paperAutonomyRuleKey(candidate.rule); value.candidates.push(candidate);
  autonomy.entries.push({ ...autonomy.entries[0], ruleKey: key, reason: 'REDUCE', weight: 1 });
  const { container } = render(<PaperAutonomyPanel state={value} />);
  const other = screen.getByText('다른 후보 1개의 판단 보기');
  expect(other.parentElement!.hasAttribute('open')).toBe(false);
  fireEvent.click(other);
  expect(within(other.parentElement!).getByText('탐색 기회를 줄입니다')).toBeTruthy();
  expect(container.querySelector('.paper-autonomy-cards > article')!.textContent).toContain('오늘 탐색에 연결');
  expect(screen.getByText(/투자 신뢰도나 매수 수량이 아닙니다/)).toBeTruthy();
});
it('identifies a failed evaluation as fallback rather than successful autonomous allocation', () => {
  const value = state(), autonomy = value.exploration!.autonomy!;
  autonomy.status = 'FALLBACK'; autonomy.fallbackReason = '표본 집계 오류'; autonomy.selectedRuleKeys = [];
  render(<PaperAutonomyPanel state={value} />);
  expect(screen.getByText('기존 배분으로 복귀')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('표본 집계 오류');
  expect(screen.queryByText('자율 배분 적용')).toBeNull();
  expect(screen.getByText(/기존 방식으로 연결된 탐색 규칙 1개/)).toBeTruthy();
  expect(within(screen.getByRole('status')).getByText(/RSI 14/)).toBeTruthy();
  expect(screen.queryByText(/이번에 연결된 탐색 규칙이 없습니다/)).toBeNull();
  expect(screen.queryByText('다음 선발 후보')).toBeNull();
});
it('labels another eligible rule range even when it is absent from the selected-candidate lookup', () => {
  const value = state(), autonomy = value.exploration!.autonomy!;
  autonomy.entries.push({ ...autonomy.entries[0], ruleKey: 'rsi14:2:D3', reason: 'MAINTAIN' });
  render(<PaperAutonomyPanel state={value} />);
  const other = screen.getByText('다른 후보 1개의 판단 보기'); fireEvent.click(other);
  expect(within(other.parentElement!).getByRole('heading', { level: 5 }).textContent).toBe('RSI 14 · 50 이상 70 미만 · D3');
  expect(screen.queryByText(/이전 연구 규칙/)).toBeNull();
});
it('shows frozen allocation choices without implying profits from an unexecuted comparison', () => {
  const value = state(), rule = value.candidates[0].rule, selected = paperAutonomyRuleKey(rule);
  const allocation: PaperAutonomyAllocation = { version: 'shadow-autonomy-v1', evaluatedAt: value.evaluatedAt,
    cutoffAt: value.cutoffAt, method: 'OUTCOME_WEIGHTED', selectedRuleKey: selected, baselineRuleKey: 'adx14:2:D3',
    choices: [{ ruleKey: selected, purpose: 'EXPLORATION', weight: 3, reason: 'INCREASE' },
      { ruleKey: 'adx14:2:D3', purpose: 'VALIDATED', weight: 2, reason: 'FIXED_VALIDATED' }] };
  const { rerender, container } = render(<PaperAutonomyAllocationDetails allocation={allocation} rule={rule} />);
  expect(screen.getByText(/배분에 따라 선택 규칙이 달라졌습니다/)).toBeTruthy();
  expect(screen.getByText(/예전 연구 방식 전체를 재현한 결과는 아닙니다/)).toBeTruthy();
  expect(screen.getByText(/실행하지 않은 비교 매매의 수익은 계산하지 않습니다/)).toBeTruthy();
  expect(container.textContent).toContain('ADX 14 추세 강도');
  expect(container.textContent).not.toContain('adx14:2:D3');
  allocation.baselineRuleKey = selected;
  rerender(<PaperAutonomyAllocationDetails allocation={allocation} rule={rule} />);
  expect(screen.getByText(/균등 배정과 선택 결과가 같습니다/)).toBeTruthy();
  rerender(<PaperAutonomyAllocationDetails />);
  expect(container.textContent).toBe('');
});
