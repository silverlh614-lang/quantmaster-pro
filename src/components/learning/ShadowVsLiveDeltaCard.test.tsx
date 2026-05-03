// @vitest-environment jsdom
// @responsibility ADR-0178 ShadowVsLiveDeltaCard 회귀 테스트
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

afterEach(() => cleanup());
import { ShadowVsLiveDeltaCard } from './ShadowVsLiveDeltaCard';
import type { ClientDeltaCategoryResult } from '../../api/learningDashboardClient';

function makeResult(
  overrides: Partial<ClientDeltaCategoryResult> = {},
): ClientDeltaCategoryResult {
  return {
    category: 'SHADOW_BUY_LIVE_BLOCKED',
    sampleSize: 3,
    shadowReturnSum: 15,
    liveReturnSum: 0,
    missedAlpha: 15,
    missedAlphaAvg: 5,
    ...overrides,
  };
}

describe('ShadowVsLiveDeltaCard', () => {
  it('loading 상태 표시', () => {
    render(<ShadowVsLiveDeltaCard results={undefined} loading={true} error={null} />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('error 상태 표시', () => {
    render(
      <ShadowVsLiveDeltaCard
        results={undefined}
        loading={false}
        error={new Error('boom')}
      />,
    );
    expect(screen.getByTestId('error').textContent).toContain('boom');
  });

  it('데이터 0건 — placeholder 표시', () => {
    render(<ShadowVsLiveDeltaCard results={[]} loading={false} error={null} />);
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
  });

  it('totalSampleSize=0 — placeholder 표시', () => {
    const allZero: ClientDeltaCategoryResult[] = [
      makeResult({ category: 'SHADOW_BUY_LIVE_BLOCKED', sampleSize: 0 }),
    ];
    render(<ShadowVsLiveDeltaCard results={allZero} loading={false} error={null} />);
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
  });

  it('정상 응답 — 5 DeltaCategory 모두 row 표시', () => {
    const results: ClientDeltaCategoryResult[] = [makeResult()];
    render(<ShadowVsLiveDeltaCard results={results} loading={false} error={null} />);
    expect(screen.getByTestId('delta-table')).toBeTruthy();
    expect(screen.getByTestId('category-row-SHADOW_BUY_LIVE_BLOCKED')).toBeTruthy();
    expect(screen.getByTestId('category-row-LIVE_BUY_SHADOW_BETTER_SIZE')).toBeTruthy();
    expect(screen.getByTestId('category-row-EXPOSURE_CAP_REDUCED')).toBeTruthy();
    expect(screen.getByTestId('category-row-MACRO_GATE_BLOCKED')).toBeTruthy();
    expect(screen.getByTestId('category-row-LIQUIDITY_GATE_BLOCKED')).toBeTruthy();
  });

  it('missedAlpha > 0 — 기회 손실 tone (rose)', () => {
    const results: ClientDeltaCategoryResult[] = [
      makeResult({ category: 'SHADOW_BUY_LIVE_BLOCKED', missedAlpha: 15, sampleSize: 5 }),
    ];
    const { container } = render(
      <ShadowVsLiveDeltaCard results={results} loading={false} error={null} />,
    );
    const row = container.querySelector('[data-testid="category-row-SHADOW_BUY_LIVE_BLOCKED"]');
    expect(row?.innerHTML).toContain('text-rose-400');
  });

  it('missedAlpha < 0 — 살아남은 효과 tone (emerald)', () => {
    const results: ClientDeltaCategoryResult[] = [
      makeResult({ category: 'MACRO_GATE_BLOCKED', missedAlpha: -10, sampleSize: 5 }),
    ];
    const { container } = render(
      <ShadowVsLiveDeltaCard results={results} loading={false} error={null} />,
    );
    const row = container.querySelector('[data-testid="category-row-MACRO_GATE_BLOCKED"]');
    expect(row?.innerHTML).toContain('text-emerald-400');
  });

  it('sampleSize=0 entry — 값 "—" 표시', () => {
    const results: ClientDeltaCategoryResult[] = [
      makeResult({ category: 'SHADOW_BUY_LIVE_BLOCKED', sampleSize: 5 }),
      makeResult({ category: 'EXPOSURE_CAP_REDUCED', sampleSize: 0, missedAlpha: 0 }),
    ];
    const { container } = render(
      <ShadowVsLiveDeltaCard results={results} loading={false} error={null} />,
    );
    const exposureRow = container.querySelector(
      '[data-testid="category-row-EXPOSURE_CAP_REDUCED"]',
    );
    expect(exposureRow?.textContent).toContain('—');
  });

  it('missedAlpha 부호 표시 (+/-)', () => {
    const results: ClientDeltaCategoryResult[] = [
      makeResult({ missedAlpha: 15.5, missedAlphaAvg: 5.2, sampleSize: 3 }),
    ];
    const { container } = render(
      <ShadowVsLiveDeltaCard results={results} loading={false} error={null} />,
    );
    const row = container.querySelector(
      '[data-testid="category-row-SHADOW_BUY_LIVE_BLOCKED"]',
    );
    expect(row?.textContent).toContain('+15.50');
    expect(row?.textContent).toContain('+5.20');
  });
});
