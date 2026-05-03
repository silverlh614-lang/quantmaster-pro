// @vitest-environment jsdom
// @responsibility ADR-0180 RejectedWinnersCard 회귀 테스트
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RejectedWinnersCard } from './RejectedWinnersCard';
import type { ClientRejectionShadowSummary } from '../../api/learningDashboardClient';

afterEach(() => cleanup());

function makeSummary(
  overrides: Partial<ClientRejectionShadowSummary> = {},
): ClientRejectionShadowSummary {
  return {
    totalCount: 0,
    closedCount: 0,
    activeCount: 0,
    avgClosedReturnPct: 0,
    medianClosedReturnPct: 0,
    falseNegativeRate: 0,
    quartiles: { q1: 0, q2: 0, q3: 0 },
    reliable: false,
    ...overrides,
  };
}

describe('RejectedWinnersCard', () => {
  it('loading 상태 표시', () => {
    render(<RejectedWinnersCard summary={undefined} loading={true} error={null} />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('error 상태 표시 + 메시지', () => {
    render(
      <RejectedWinnersCard
        summary={undefined}
        loading={false}
        error={new Error('boom')}
      />,
    );
    expect(screen.getByTestId('error').textContent).toContain('boom');
  });

  it('closedCount=0 — placeholder 표시 (recordRejection 활성화 안내)', () => {
    render(
      <RejectedWinnersCard summary={makeSummary()} loading={false} error={null} />,
    );
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
    expect(screen.getByTestId('empty-placeholder').textContent).toContain('recordRejection');
  });

  it('closedCount > 0 — stats-grid 표시 + placeholder 미표시', () => {
    render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 12,
          closedCount: 8,
          activeCount: 4,
          falseNegativeRate: 0.375,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('stats-grid')).toBeTruthy();
    expect(screen.queryByTestId('empty-placeholder')).toBeNull();
    expect(screen.getByTestId('stat-closed-count').textContent).toContain('8');
    expect(screen.getByTestId('stat-winner-count').textContent).toContain('3');
    expect(screen.getByTestId('stat-false-negative-rate').textContent).toContain('37.5%');
  });

  it('falseNegativeRate ≥ 0.3 + reliable=true → rose tone (게이트 완화 후보)', () => {
    const { container } = render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 10,
          closedCount: 8,
          falseNegativeRate: 0.375,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-false-negative-rate"]');
    expect(cell?.innerHTML).toContain('text-rose-400');
    expect(screen.getByTestId('verdict-label').textContent).toContain('게이트 완화 후보');
  });

  it('falseNegativeRate < 0.1 + reliable=true → emerald tone (게이트 정합)', () => {
    const { container } = render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 20,
          closedCount: 15,
          falseNegativeRate: 0.0667,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-false-negative-rate"]');
    expect(cell?.innerHTML).toContain('text-emerald-400');
    expect(screen.getByTestId('verdict-label').textContent).toContain('게이트 정합');
  });

  it('reliable=false → zinc tone + 표본 부족 verdict', () => {
    const { container } = render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 5,
          closedCount: 3,
          falseNegativeRate: 0.5,
          reliable: false,
        })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-false-negative-rate"]');
    expect(cell?.innerHTML).toContain('text-zinc-400');
    expect(screen.getByTestId('verdict-label').textContent).toContain('표본 부족');
  });

  it('falseNegativeRate 경계 (0.1 ~ 0.3) + reliable=true → amber 경계', () => {
    const { container } = render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 10,
          closedCount: 8,
          falseNegativeRate: 0.2,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-false-negative-rate"]');
    expect(cell?.innerHTML).toContain('text-amber-400');
    expect(screen.getByTestId('verdict-label').textContent).toContain('경계');
  });

  it('reliable ✓ / ✗ 표시', () => {
    const { rerender } = render(
      <RejectedWinnersCard
        summary={makeSummary({ totalCount: 5, closedCount: 5, reliable: true })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('stat-reliable').textContent).toContain('✓');
    rerender(
      <RejectedWinnersCard
        summary={makeSummary({ totalCount: 5, closedCount: 3, reliable: false })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('stat-reliable').textContent).toContain('✗');
  });

  it('activeCount > 0 — 추적 중 라벨 표시', () => {
    render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 10,
          closedCount: 6,
          activeCount: 4,
          falseNegativeRate: 0.2,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('verdict-label').textContent).toContain('추적 중 4건');
  });

  it('activeCount = 0 — 추적 중 라벨 미표시', () => {
    render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 6,
          closedCount: 6,
          activeCount: 0,
          falseNegativeRate: 0.2,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('verdict-label').textContent).not.toContain('추적 중');
  });

  it('winnerCount = round(falseNegativeRate × closedCount)', () => {
    render(
      <RejectedWinnersCard
        summary={makeSummary({
          totalCount: 12,
          closedCount: 10,
          falseNegativeRate: 0.27,
          reliable: true,
        })}
        loading={false}
        error={null}
      />,
    );
    // 0.27 × 10 = 2.7 → round = 3
    expect(screen.getByTestId('stat-winner-count').textContent).toContain('3');
  });
});
