// @vitest-environment jsdom
// @responsibility Verify automatic selection reasons and frozen evidence remain distinguishable.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { PaperAdaptiveCandidate, PaperAdaptiveState } from '../../types/paperAdaptive';
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
});
