// @vitest-environment jsdom
// @responsibility ADR-0182 UnresolvedCounterfactualsCard 회귀 테스트
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  UnresolvedCounterfactualsCard,
  classifyUnresolvedTone,
  computeHorizonProgress,
} from './UnresolvedCounterfactualsCard';
import type { ClientCounterfactualUnresolvedStats } from '../../api/learningDashboardClient';

afterEach(() => cleanup());

function makeStats(
  overrides: Partial<ClientCounterfactualUnresolvedStats> = {},
): ClientCounterfactualUnresolvedStats {
  return {
    totalCount: 0,
    resolved30dCount: 0,
    resolved60dCount: 0,
    resolved90dCount: 0,
    pending30dCount: 0,
    pending60dCount: 0,
    pending90dCount: 0,
    awaitingHorizonCount: 0,
    ...overrides,
  };
}

describe('classifyUnresolvedTone (ADR-0182 SSOT)', () => {
  it('totalCount=0 → zinc 데이터 없음', () => {
    const r = classifyUnresolvedTone(0, 0);
    expect(r.tone).toBe('text-zinc-400');
    expect(r.label).toContain('데이터 없음');
  });

  it('pending30dCount ≥5 → rose cron 미실행 의심', () => {
    const r = classifyUnresolvedTone(5, 10);
    expect(r.tone).toBe('text-rose-400');
    expect(r.label).toContain('cron 미실행');
  });

  it('pending30dCount =1 → amber 경계', () => {
    const r = classifyUnresolvedTone(1, 10);
    expect(r.tone).toBe('text-amber-400');
    expect(r.label).toContain('경계');
  });

  it('pending30dCount =4 → amber 경계', () => {
    const r = classifyUnresolvedTone(4, 10);
    expect(r.tone).toBe('text-amber-400');
  });

  it('pending30dCount =0 + totalCount ≥5 → emerald cron 정상', () => {
    const r = classifyUnresolvedTone(0, 6);
    expect(r.tone).toBe('text-emerald-400');
    expect(r.label).toContain('cron 정상');
  });

  it('pending30dCount =0 + totalCount <5 → zinc 표본 부족', () => {
    const r = classifyUnresolvedTone(0, 3);
    expect(r.tone).toBe('text-zinc-400');
    expect(r.label).toContain('표본 부족');
  });

  it('pending30dCount =5 boundary → rose', () => {
    const r = classifyUnresolvedTone(5, 100);
    expect(r.tone).toBe('text-rose-400');
  });
});

describe('computeHorizonProgress (ADR-0182)', () => {
  it('정상 비율', () => {
    expect(computeHorizonProgress(3, 7)).toBeCloseTo(0.3);
    expect(computeHorizonProgress(8, 2)).toBeCloseTo(0.8);
  });

  it('전체 0 → null', () => {
    expect(computeHorizonProgress(0, 0)).toBeNull();
  });

  it('pending=0 + resolved>0 → 1.0', () => {
    expect(computeHorizonProgress(5, 0)).toBe(1.0);
  });

  it('resolved=0 + pending>0 → 0.0', () => {
    expect(computeHorizonProgress(0, 5)).toBe(0.0);
  });
});

describe('UnresolvedCounterfactualsCard', () => {
  it('loading 상태 표시', () => {
    render(
      <UnresolvedCounterfactualsCard stats={undefined} loading={true} error={null} />,
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('error 상태 표시 + 메시지', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={undefined}
        loading={false}
        error={new Error('boom')}
      />,
    );
    expect(screen.getByTestId('error').textContent).toContain('boom');
  });

  it('totalCount=0 — placeholder 표시 + recordCounterfactual 안내', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats()}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
    expect(screen.getByTestId('empty-placeholder').textContent).toContain('recordCounterfactual');
    expect(screen.queryByTestId('stats-grid')).toBeNull();
  });

  it('totalCount > 0 — stats-grid 표시 + 4 metric', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({
          totalCount: 12,
          resolved30dCount: 5,
          pending30dCount: 4,
          awaitingHorizonCount: 3,
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('stats-grid')).toBeTruthy();
    expect(screen.getByTestId('stat-total-count').textContent).toContain('12');
    expect(screen.getByTestId('stat-resolved-30d-count').textContent).toContain('5');
    expect(screen.getByTestId('stat-pending-30d-count').textContent).toContain('4');
    expect(screen.getByTestId('stat-awaiting-horizon-count').textContent).toContain('3');
  });

  it('pending30dCount ≥5 → stat-pending rose tone + verdict cron 미실행', () => {
    const { container } = render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({ totalCount: 10, pending30dCount: 7 })}
        loading={false}
        error={null}
      />,
    );
    const pendingCell = container.querySelector('[data-testid="stat-pending-30d-count"]');
    expect(pendingCell?.innerHTML).toContain('text-rose-400');
    expect(screen.getByTestId('verdict-label').textContent).toContain('cron 미실행');
  });

  it('pending30dCount =1 → amber 경계', () => {
    const { container } = render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({ totalCount: 10, resolved30dCount: 9, pending30dCount: 1 })}
        loading={false}
        error={null}
      />,
    );
    const pendingCell = container.querySelector('[data-testid="stat-pending-30d-count"]');
    expect(pendingCell?.innerHTML).toContain('text-amber-400');
    expect(screen.getByTestId('verdict-label').textContent).toContain('경계');
  });

  it('pending30dCount =0 + totalCount ≥5 → emerald cron 정상', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({
          totalCount: 10,
          resolved30dCount: 8,
          pending30dCount: 0,
          awaitingHorizonCount: 2,
        })}
        loading={false}
        error={null}
      />,
    );
    const verdict = screen.getByTestId('verdict-label');
    expect(verdict.className).toContain('text-emerald-400');
    expect(verdict.textContent).toContain('cron 정상');
  });

  it('horizon-progress 표시 — 30d/60d/90d 진행률', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({
          totalCount: 10,
          resolved30dCount: 6,
          pending30dCount: 4,
          resolved60dCount: 2,
          pending60dCount: 3,
          resolved90dCount: 1,
          pending90dCount: 2,
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('progress-30d').textContent).toContain('60%');
    expect(screen.getByTestId('progress-30d').textContent).toContain('6 / 10');
    expect(screen.getByTestId('progress-60d').textContent).toContain('40%');
    expect(screen.getByTestId('progress-90d').textContent).toContain('33%');
  });

  it('horizon 60d/90d 데이터 없으면 진행률 — fallback', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({
          totalCount: 5,
          resolved30dCount: 2,
          pending30dCount: 0,
          awaitingHorizonCount: 3,
        })}
        loading={false}
        error={null}
      />,
    );
    // 60d/90d resolved+pending=0 → '—' 표시
    expect(screen.getByTestId('progress-60d').textContent).toContain('—');
    expect(screen.getByTestId('progress-90d').textContent).toContain('—');
  });

  it('oldestSignalDate 표시 — KST 일자 그대로', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({
          totalCount: 5,
          pending30dCount: 1,
          oldestSignalDate: '2026-01-15',
        })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('oldest-signal-date').textContent).toContain('2026-01-15');
  });

  it('oldestSignalDate 부재 — oldest-signal-date 노출 안 됨', () => {
    render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({ totalCount: 5, pending30dCount: 1 })}
        loading={false}
        error={null}
      />,
    );
    expect(screen.queryByTestId('oldest-signal-date')).toBeNull();
  });

  it('resolved30dCount=0 — stat-resolved-30d-count zinc tone', () => {
    const { container } = render(
      <UnresolvedCounterfactualsCard
        stats={makeStats({ totalCount: 3, awaitingHorizonCount: 3 })}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-resolved-30d-count"]');
    expect(cell?.innerHTML).toContain('text-zinc-500');
  });
});
