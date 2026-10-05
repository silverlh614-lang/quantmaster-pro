// @vitest-environment jsdom
// @responsibility Verify invention explanations distinguish research from applied rules.
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PaperAdaptiveState } from '../../types/paperAdaptive';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../types/paperIndicatorFormula';
import { PaperInventionGuide } from './PaperInventionGuide';
import type { PaperIndicatorProgram } from '../../types/paperIndicatorProgram';
afterEach(cleanup);
const stats = { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null };
function state(): PaperAdaptiveState {
  const formula = createPaperIndicatorFormula('DIFFERENCE', 'adx14', 'currentRatio');
  const invention = { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-10-02T01:00:00Z', discoveryCutoffAt: '2026-10-01T15:00:00Z',
    rule: { bucket: 2, horizon: 3 as const }, training: stats };
  return { policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
    tradingDate: '2026-10-02', evaluatedAt: invention.createdAt, cutoffAt: invention.discoveryCutoffAt, windowStartDate: null,
    validationStartDate: null, matureSampleCount: 0, matureDateCount: 0, changes: [],
    discovery: { version: 'indicator-discovery-v1', attemptedIds: [invention.id], round: 1, roundStartedAt: invention.createdAt,
      roundTrainingEndDate: null, inventions: [invention] },
    candidates: [{ rule: { feature: invention.id, ...invention.rule, invention }, training: stats, validation: stats, active: false, reason: 'FORWARD_OBSERVATION' }] };
}
it('shows an unconnected invention with understandable ingredients and exact comparison scope', () => {
  render(<PaperInventionGuide state={state()} />);
  const summary = screen.getByText('연구 중 · 매수 연결 없음').closest('summary')!;
  fireEvent.click(summary);
  expect(summary.parentElement!.hasAttribute('open')).toBe(true);
  expect(screen.getByText('단기 부채에 비해 단기 자산이 얼마나 있는지 봅니다.')).toBeTruthy();
  expect(screen.getByText(/D3은 3거래일 후 결과를 비교/)).toBeTruthy();
  expect(screen.getByText(/평균 순수익률 미집계/)).toBeTruthy();
  expect(screen.queryByText('검증 매수에 연결')).toBeNull();
});
it('uses the actual exploration rule instead of the invention’s initial range', () => {
  const value = state(); value.exploration = { version: 'shadow-exploration-v1', sequence: 1,
    rules: [{ id: 'trial', registeredAt: value.evaluatedAt, candidate: { ...value.candidates[0], rule: { ...value.candidates[0].rule, bucket: 0 } } }] };
  render(<PaperInventionGuide state={value} />);
  expect(screen.getByText('탐색 가상매수 · 검증 전')).toBeTruthy();
  expect(screen.getByText('-1 미만')).toBeTruthy();
  expect(screen.getByText('보관 중인 발명 지표 1개')).toBeTruthy();
});
it('distinguishes active, retired and unavailable states', () => {
  const value = state(); value.candidates[0].active = true; value.candidates[0].reason = 'ACTIVE';
  const { rerender } = render(<PaperInventionGuide state={value} />);
  expect(screen.getByText('검증 매수에 연결')).toBeTruthy();
  value.candidates[0].active = false; value.candidates[0].reason = 'DISCOVERY_RETIRED';
  rerender(<PaperInventionGuide state={value} />); expect(screen.getByText('연구 종료')).toBeTruthy();
  rerender(<PaperInventionGuide />); expect(screen.queryByText('연구 종료')).toBeNull();
  expect(screen.getByText(/적용 상태는 자료를 확인한 뒤/)).toBeTruthy();
});
it('keeps the dashboard compact while making every stored invention accessible', () => {
  const value = state();
  const base = value.discovery!.inventions[0];
  value.discovery!.inventions = ['rsi14', 'pbr', 'return20', 'volumeRatio20'].map(feature => {
    const formula = createPaperIndicatorFormula('MEAN', feature as 'rsi14' | 'pbr' | 'return20' | 'volumeRatio20', 'currentRatio');
    return { ...base, formula, id: paperIndicatorFormulaId(formula) };
  });
  value.candidates = [];
  const { container } = render(<PaperInventionGuide state={value} />);
  expect(container.querySelectorAll('.paper-invention-card')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '발명 지표 4개 모두 보기' }));
  expect(container.querySelectorAll('.paper-invention-card')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: '주요 지표 3개만 보기' }));
  expect(container.querySelectorAll('.paper-invention-card')).toHaveLength(3);
});
it('separates AI authorship, queued calculation checks and prospective performance', () => {
  const value = state();
  const formula: PaperIndicatorProgram = { version: 'feature-program-v1', digest: 'a'.repeat(64), title: '가격 힘과 거래량의 차이',
    hypothesis: '가격 힘보다 거래량이 강할 때를 시험합니다.', interpretation: '거래량 환산값에서 RSI 환산값을 뺍니다.', limitation: '급락 거래량도 포함됩니다.',
    expression: { op: 'subtract', left: { op: 'feature', key: 'volumeRatio20' }, right: { op: 'feature', key: 'rsi14' } } };
  const invention = { ...value.discovery!.inventions[0], formula, id: paperIndicatorFormulaId(formula),
    authorship: { generatedAt: '2026-10-01T08:00:00Z', model: 'test', inputDigest: 'b'.repeat(64) } };
  value.discovery!.inventions = [invention];
  value.candidates[0].rule = { feature: invention.id, ...invention.rule, invention };
  value.programResearch = { state: 'READY', attemptedAt: invention.authorship.generatedAt, completedAt: invention.authorship.generatedAt,
    message: '계산 검사 통과 1개', proposals: [{ id: 'queued', title: '다음 계산 후보', generatedAt: invention.authorship.generatedAt, registered: false, evaluated: false }] };
  const { rerender } = render(<PaperInventionGuide state={value} />);
  expect(screen.getByText('작성 회차 완료 · 수익성 검증과 별개')).toBeTruthy();
  expect(screen.getByText('계산 검사 통과 · 학습 선발 대기')).toBeTruthy();
  expect(screen.getByText(formula.hypothesis)).toBeTruthy(); expect(screen.getByText(formula.limitation)).toBeTruthy();
  expect(screen.getByText(formula.digest)).toBeTruthy();
  expect(screen.getByText(/AI 작성/)).toBeTruthy(); expect(screen.getByText(/연구 등록 .*이 시점 이후 새 관측/)).toBeTruthy();
  expect(screen.queryByText('검증 매수에 연결')).toBeNull();
  value.programResearch.state = 'FAILED';
  value.programResearch.proposals[0].evaluated = true;
  value.discovery!.programReviews = [{ id: 'queued' as typeof invention.id, at: value.evaluatedAt, status: 'NO_TRAINING_EDGE', sampleCount: 12, dateCount: 3, meanDailyExcessPct: -0.2 }];
  rerender(<PaperInventionGuide state={value} />);
  expect(screen.getByText('이번 작성 회차 확인 필요')).toBeTruthy(); expect(screen.getByText('학습 표본 또는 성과 부족')).toBeTruthy();
  expect(screen.getByText('연구 중 · 매수 연결 없음')).toBeTruthy();
});
