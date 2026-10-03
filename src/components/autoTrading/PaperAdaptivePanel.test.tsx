// @vitest-environment jsdom
// @responsibility Verify automatic selection reasons and frozen evidence remain distinguishable.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { paperAdaptiveRuleLabel, type PaperAdaptiveCandidate, type PaperAdaptiveState, type PaperIndicatorInvention } from '../../types/paperAdaptive';
import { createPaperIndicatorFormula, paperIndicatorFormulaId } from '../../types/paperIndicatorFormula';
import { PaperAdaptiveEvidenceDetails, PaperAdaptivePanel } from './PaperAdaptivePanel';

const candidate: PaperAdaptiveCandidate = {
  rule: { feature: 'rsi14', bucket: 1, horizon: 3 }, active: true, reason: 'ACTIVE',
  training: { sampleCount: 20, dateCount: 5, symbolCount: 4, experimentIds: [], meanNetReturnPct: 1.5, meanDailyExcessPct: 0.2 },
  validation: { sampleCount: 12, dateCount: 3, symbolCount: 4, experimentIds: [], meanNetReturnPct: 1.2, meanDailyExcessPct: 0.15 },
};
const state: PaperAdaptiveState = {
  policy: { version: 'adaptive-features-v1', windowEntryDates: 60, trainingFraction: 0.7, minimumSamples: 10,
    minimumEntryDates: 3, activationMarginDailyPct: 0.05, replacementMarginDailyPct: 0.05, maxActiveRules: 3 },
  tradingDate: '2026-09-21', evaluatedAt: '2026-09-21T01:00:00Z', cutoffAt: '2026-09-20T15:00:00Z',
  windowStartDate: '2026-08-03', validationStartDate: '2026-09-01', matureSampleCount: 100, matureDateCount: 20,
  candidates: [candidate], changes: [],
};
const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
const invention: PaperIndicatorInvention = {
  id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-09-04T01:00:00Z',
  discoveryCutoffAt: '2026-09-03T15:00:00Z', rule: { bucket: 2, horizon: 3 }, training: candidate.training,
};
const invented: PaperAdaptiveCandidate = {
  ...candidate, rule: { feature: invention.id, ...invention.rule, invention },
};
function discovery(inventions: PaperIndicatorInvention[]): NonNullable<PaperAdaptiveState['discovery']> {
  return { version: 'indicator-discovery-v1', round: 2, roundStartedAt: '2026-09-03T15:00:00Z',
    roundTrainingEndDate: '2026-09-01', attemptedIds: inventions.map(item => item.id), inventions };
}
afterEach(cleanup);

describe('PaperAdaptivePanel', () => {
  it('distinguishes missing inputs from failed validation and shows all candidate samples', () => {
    render(<PaperAdaptivePanel state={{ ...state, candidates: [candidate,
      { ...candidate, rule: { ...candidate.rule, feature: 'per' }, active: false, reason: 'MISSING_INPUT',
        training: { ...candidate.training, sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null } },
      { ...candidate, rule: { ...candidate.rule, feature: 'ma20Gap' }, active: false, reason: 'NO_VALIDATION_EDGE',
        validation: { ...candidate.validation, meanDailyExcessPct: 0 } },
    ] }} />);
    expect(screen.getByText('지표 자동 연결 · 1개 사용 중')).toBeTruthy();
    expect(screen.getByText(/성숙 기본 관측 100건 · 20개 진입일/)).toBeTruthy();
    const rows = within(screen.getByRole('table', { hidden: true }));
    expect(rows.getByText('당시 지표 자료 없음')).toBeTruthy();
    expect(rows.getByText('후반 확인 성과 부족')).toBeTruthy();
    expect(rows.getByText('0.00%p')).toBeTruthy();
    expect(rows.getAllByText('12건 · 3진입일 · 4종목')).toHaveLength(3);
    expect(rows.getByText('집계 대기')).toBeTruthy();
  });
  it('keeps baseline observation running while no rules are connected and bounds the change log', () => {
    render(<PaperAdaptivePanel state={{ ...state, candidates: [], changes: Array.from({ length: 12 }, (_, index) => ({
      at: `2026-09-${String(index + 1).padStart(2, '0')}T01:00:00Z`, feature: 'rsi14',
      from: candidate.rule, to: null, reason: 'NO_VALIDATION_EDGE',
    })) }} />);
    expect(screen.getByText(/기본 관측과 성과 누적은 계속됩니다/)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('해제');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders the entry evidence independently of current connection state', () => {
    render(<PaperAdaptiveEvidenceDetails evidence={{ candidate, policy: state.policy, cutoffAt: state.cutoffAt,
      evaluatedAt: state.evaluatedAt, validationStartDate: state.validationStartDate! }} />);
    expect(screen.getByText(/진입 시 고정한 지표 근거 · RSI 14 · 30 이상 50 미만 · D3/)).toBeTruthy();
    expect(screen.getByText(/후반 확인 12건 · 3진입일 · 4종목.*\+0.15%p/)).toBeTruthy();
    expect(screen.getByText(/지표 연결이 해제돼도 이 근거와 보유기간은 유지/)).toBeTruthy();
  });
  it('separates invention observation from adoption and research retirement', () => {
    const pendingFormula = createPaperIndicatorFormula('DIFFERENCE', 'ma20Gap', 'return20');
    const pendingInvention = { ...invention, id: paperIndicatorFormulaId(pendingFormula), formula: pendingFormula };
    const pending: PaperAdaptiveCandidate = { ...invented, rule: { ...invented.rule,
      feature: pendingInvention.id, invention: pendingInvention }, active: false, reason: 'FORWARD_OBSERVATION',
      validation: { sampleCount: 0, dateCount: 0, symbolCount: 0, meanNetReturnPct: null, meanDailyExcessPct: null } };
    const retiredFormula = createPaperIndicatorFormula('MEAN', 'rsi14', 'volumeRatio20');
    const retiredInvention = { ...invention, id: paperIndicatorFormulaId(retiredFormula), formula: retiredFormula };
    const retiredRule = { ...invented.rule, feature: retiredInvention.id, invention: retiredInvention };
    render(<PaperAdaptivePanel state={{ ...state, candidates: [candidate, invented, pending],
      discovery: { ...discovery([invention, pendingInvention]), attemptedIds: [invention.id, pendingInvention.id, retiredInvention.id] },
      changes: [
        { at: state.evaluatedAt, feature: retiredInvention.id, from: retiredRule, to: null, reason: 'DISCOVERY_RETIRED' },
        { at: state.evaluatedAt, feature: pendingInvention.id, from: null, to: pending.rule, reason: 'FORWARD_OBSERVATION' },
      ],
    }} />);
    expect(screen.getByText('지표 자동 연결 · 2개 사용 중')).toBeTruthy();
    expect(screen.getByText('탐색 2차 · 이번 회차 기록 3개 · 보관 중 2개 · 생성 후 관측 중 1개 · 채택 1개')).toBeTruthy();
    expect(screen.getByText(/새 학습 진입일이 20일 쌓이면 다음 탐색/)).toBeTruthy();
    expect(screen.getByText(/최대 3개를 매수 판단에 연결/)).toBeTruthy();
    const rows = within(screen.getByRole('table', { hidden: true }));
    expect(rows.getByText(/발명 · N\(완료 종가 \/ 20일선 이격\) − N\(20일 수익률\)/)).toBeTruthy();
    expect(rows.getByText('발명 이후 성과 관측 중')).toBeTruthy();
    expect(rows.getByText(/N\(RSI 14\) = \(값 − 50\) \/ 40/)).toBeTruthy();
    const created = screen.getByText(/새 지표 생성/);
    expect(screen.getAllByRole('list')[1].firstElementChild).toBe(created);
    expect(created.textContent).not.toContain('미연결 →');
    expect(created.textContent).not.toContain(' · 연결 · ');
    expect(screen.getByText(/연구 후보 종료/).textContent).not.toContain(' · 해제 · ');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('keeps the original invention formula and timestamp in frozen entry evidence after replacement', () => {
    const nextFormula = createPaperIndicatorFormula('MEAN', 'ma20Gap', 'return20');
    const nextInvention = { ...invention, id: paperIndicatorFormulaId(nextFormula), formula: nextFormula,
      createdAt: '2026-09-21T01:00:00Z' };
    render(<><PaperAdaptivePanel state={{ ...state,
      discovery: discovery([nextInvention]), candidates: [{ ...invented,
        rule: { ...invented.rule, feature: nextInvention.id, invention: nextInvention } }],
    }} /><PaperAdaptiveEvidenceDetails evidence={{ candidate: invented, policy: state.policy,
      cutoffAt: state.cutoffAt, evaluatedAt: state.evaluatedAt, validationStartDate: '2026-09-07' }} /></>);
    const frozen = screen.getByText(`진입 시 고정한 지표 근거 · ${paperAdaptiveRuleLabel(invented.rule)}`).closest('details')!;
    expect(frozen.querySelector(`time[datetime="${invention.createdAt}"]`)).toBeTruthy();
    expect(frozen.querySelector(`time[datetime="${nextInvention.createdAt}"]`)).toBeNull();
    expect(frozen.textContent).toContain('N(RSI 14) × N(완료일 거래량 / 이전 20일 평균)');
    expect(frozen.textContent).not.toContain('N(완료 종가 / 20일선 이격)');
    expect(within(frozen).getByText(/생성 후 검증 12건 · 3진입일 · 4종목.*\+0.15%p/)).toBeTruthy();
    expect(within(frozen).getByText(/수식과 생성 시각은 이 거래의 진입 당시 원본/)).toBeTruthy();
  });
  it('shows disconnection when an active invention needs more forward observations', () => {
    render(<PaperAdaptivePanel state={{ ...state, discovery: discovery([invention]),
      candidates: [{ ...invented, active: false, reason: 'FORWARD_OBSERVATION' }],
      changes: [{ at: state.evaluatedAt, feature: invention.id, from: invented.rule, to: null,
        reason: 'FORWARD_OBSERVATION' }],
    }} />);
    const change = screen.getByRole('listitem');
    expect(change.textContent).toContain(' · 해제 · ');
    expect(change.textContent).toContain('→ 미연결 · 발명 이후 성과 관측 중');
    expect(change.textContent).not.toContain('새 지표 생성');
    expect(screen.getByText('지표 자동 연결 · 0개 사용 중')).toBeTruthy();
  });
});
