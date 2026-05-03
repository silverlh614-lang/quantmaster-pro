// @vitest-environment jsdom
// @responsibility ADR-0179 MissedLearningQueueStatsCard 회귀 테스트
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MissedLearningQueueStatsCard } from './MissedLearningQueueStatsCard';
import type { ClientMissedLearningQueueStats } from '../../api/learningDashboardClient';

afterEach(() => cleanup());

function makeStats(
  overrides: Partial<ClientMissedLearningQueueStats> = {},
): ClientMissedLearningQueueStats {
  return {
    pending: 0,
    replayed: 0,
    failed: 0,
    dropped: 0,
    total: 0,
    ...overrides,
  };
}

describe('MissedLearningQueueStatsCard', () => {
  it('loading 상태 표시', () => {
    render(
      <MissedLearningQueueStatsCard stats={undefined} loading={true} error={null} />,
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('error 상태 표시', () => {
    render(
      <MissedLearningQueueStatsCard
        stats={undefined}
        loading={false}
        error={new Error('boom')}
      />,
    );
    expect(screen.getByTestId('error').textContent).toContain('boom');
  });

  it('total=0 — placeholder 표시', () => {
    render(
      <MissedLearningQueueStatsCard stats={makeStats()} loading={false} error={null} />,
    );
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
  });

  it('정상 응답 — 4 status grid + total', () => {
    render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ pending: 2, replayed: 5, failed: 1, dropped: 0, total: 8 })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('stats-grid')).toBeTruthy();
    expect(screen.getByTestId('stat-pending').textContent).toContain('2');
    expect(screen.getByTestId('stat-replayed').textContent).toContain('5');
    expect(screen.getByTestId('stat-failed').textContent).toContain('1');
    expect(screen.getByTestId('stat-dropped').textContent).toContain('0');
  });

  it('pending > 0 — amber tone (replay 대기 alert)', () => {
    const { container } = render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ pending: 3, total: 3 })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-pending"]');
    expect(cell?.innerHTML).toContain('text-amber-400');
  });

  it('failed > 0 — rose tone (재시도 한계 초과 alert)', () => {
    const { container } = render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ failed: 2, total: 2 })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-failed"]');
    expect(cell?.innerHTML).toContain('text-rose-400');
  });

  it('replayed — 항상 emerald tone', () => {
    const { container } = render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ replayed: 10, total: 10 })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-replayed"]');
    expect(cell?.innerHTML).toContain('text-emerald-400');
  });

  it('lastEnqueuedAt KST 시각 표시', () => {
    render(
      <MissedLearningQueueStatsCard
        stats={makeStats({
          pending: 1,
          total: 1,
          lastEnqueuedAt: '2026-05-02T03:00:00.000Z',
        })}
        loading={false}
        error={null}
      />,
    );
    const lastEl = screen.getByTestId('last-enqueued-at');
    // KST = UTC+9, 03:00 UTC → 12:00 KST
    expect(lastEl.textContent).toContain('최종 enqueue:');
    expect(lastEl.textContent).not.toContain('—');
  });

  it('lastEnqueuedAt undefined — "—" 표시', () => {
    render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ pending: 1, total: 1 })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('last-enqueued-at').textContent).toContain('—');
  });

  it('lastEnqueuedAt 잘못된 ISO — "—" 표시', () => {
    render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ pending: 1, total: 1, lastEnqueuedAt: 'not-a-date' })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('last-enqueued-at').textContent).toContain('—');
  });

  it('total === 1 + pending === 0 — placeholder 미표시 (다른 status 표시)', () => {
    render(
      <MissedLearningQueueStatsCard
        stats={makeStats({ replayed: 1, total: 1 })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.queryByTestId('empty-placeholder')).toBeNull();
    expect(screen.getByTestId('stats-grid')).toBeTruthy();
  });
});
