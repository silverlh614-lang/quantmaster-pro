// @vitest-environment jsdom
// @responsibility ADR-0181 StaleReflectionsCard 회귀 테스트
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StaleReflectionsCard, classifyStaleTone } from './StaleReflectionsCard';
import type {
  ClientReflectionImpactSummary,
  ClientReflectionModuleReport,
  ClientReflectionModuleStatus,
} from '../../api/learningDashboardClient';

afterEach(() => cleanup());

function makeReport(
  module: string,
  status: ClientReflectionModuleStatus,
  impactRate: number,
  overrides: Partial<ClientReflectionModuleReport> = {},
): ClientReflectionModuleReport {
  return {
    module,
    status,
    impactRate,
    runs: 100,
    meaningfulRuns: Math.round(impactRate * 100),
    firstSeenAt: '2026-04-01T00:00:00.000Z',
    ageDays: 32,
    ...overrides,
  };
}

function makeData(
  modules: ClientReflectionModuleReport[],
  windowDays = 180,
): ClientReflectionImpactSummary {
  const summary = {
    total: modules.length,
    normal: modules.filter((m) => m.status === 'normal').length,
    grace: modules.filter((m) => m.status === 'grace').length,
    silent: modules.filter((m) => m.status === 'silent').length,
    deprecated: modules.filter((m) => m.status === 'deprecated').length,
  };
  return { windowDays, modules, summary };
}

describe('classifyStaleTone (ADR-0181 SSOT)', () => {
  it('total=0 → zinc 데이터 없음', () => {
    const r = classifyStaleTone(0, 0, 0);
    expect(r.tone).toBe('text-zinc-400');
    expect(r.label).toContain('데이터 없음');
  });

  it('모든 모듈 grace → zinc 표본 부족', () => {
    const r = classifyStaleTone(0, 13, 13);
    expect(r.tone).toBe('text-zinc-400');
    expect(r.label).toContain('표본 부족');
  });

  it('staleCount ≥3 → rose 자연선택 활발', () => {
    const r = classifyStaleTone(3, 5, 13);
    expect(r.tone).toBe('text-rose-400');
    expect(r.label).toContain('자연선택 활발');
  });

  it('staleCount =1 → amber 경계', () => {
    const r = classifyStaleTone(1, 5, 13);
    expect(r.tone).toBe('text-amber-400');
    expect(r.label).toContain('경계');
  });

  it('staleCount =2 → amber 경계', () => {
    const r = classifyStaleTone(2, 5, 13);
    expect(r.tone).toBe('text-amber-400');
  });

  it('staleCount =0 → emerald 모든 모듈 정상', () => {
    const r = classifyStaleTone(0, 0, 13);
    expect(r.tone).toBe('text-emerald-400');
    expect(r.label).toContain('모든 모듈 정상');
  });

  it('staleCount ≥3 우선순위가 grace= total 보다 우선 (예외 회귀 가드)', () => {
    // grace<total 인 경우는 정상 분기 — staleCount>=3 시 rose 격상
    const r = classifyStaleTone(3, 10, 13);
    expect(r.tone).toBe('text-rose-400');
  });
});

describe('StaleReflectionsCard', () => {
  it('loading 상태 표시', () => {
    render(<StaleReflectionsCard data={undefined} loading={true} error={null} />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('error 상태 표시 + 메시지', () => {
    render(
      <StaleReflectionsCard
        data={undefined}
        loading={false}
        error={new Error('boom')}
      />,
    );
    expect(screen.getByTestId('error').textContent).toContain('boom');
  });

  it('total=0 — placeholder 표시', () => {
    render(
      <StaleReflectionsCard
        data={makeData([])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('stats-grid')).toBeNull();
  });

  it('total>0 — stats-grid 표시 + 4 status 카운트 정확', () => {
    render(
      <StaleReflectionsCard
        data={makeData([
          makeReport('a', 'normal', 0.6),
          makeReport('b', 'normal', 0.4),
          makeReport('c', 'grace', 0.0, { ageDays: 10 }),
          makeReport('d', 'silent', 0.03),
          makeReport('e', 'deprecated', 0.005),
        ])}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('stats-grid')).toBeTruthy();
    expect(screen.queryByTestId('empty-placeholder')).toBeNull();
    expect(screen.getByTestId('stat-normal').textContent).toContain('2');
    expect(screen.getByTestId('stat-grace').textContent).toContain('1');
    expect(screen.getByTestId('stat-silent').textContent).toContain('1');
    expect(screen.getByTestId('stat-deprecated').textContent).toContain('1');
  });

  it('silent>0 → stat-silent amber tone', () => {
    const { container } = render(
      <StaleReflectionsCard
        data={makeData([makeReport('a', 'silent', 0.03)])}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-silent"]');
    expect(cell?.innerHTML).toContain('text-amber-400');
  });

  it('deprecated>0 → stat-deprecated rose tone', () => {
    const { container } = render(
      <StaleReflectionsCard
        data={makeData([makeReport('a', 'deprecated', 0.005)])}
        loading={false}
        error={null}
      />,
    );
    const cell = container.querySelector('[data-testid="stat-deprecated"]');
    expect(cell?.innerHTML).toContain('text-rose-400');
  });

  it('silent+deprecated=0 → silent/deprecated 카운트 zinc', () => {
    const { container } = render(
      <StaleReflectionsCard
        data={makeData([makeReport('a', 'normal', 0.5)])}
        loading={false}
        error={null}
      />,
    );
    const silentCell = container.querySelector('[data-testid="stat-silent"]');
    const deprecatedCell = container.querySelector('[data-testid="stat-deprecated"]');
    expect(silentCell?.innerHTML).toContain('text-zinc-500');
    expect(deprecatedCell?.innerHTML).toContain('text-zinc-500');
  });

  it('Top 5 모듈 — silent/deprecated 우선 노출 + deprecated 먼저', () => {
    render(
      <StaleReflectionsCard
        data={makeData([
          makeReport('high', 'normal', 0.8),
          makeReport('low', 'silent', 0.04),
          makeReport('mid', 'normal', 0.5),
          makeReport('dead', 'deprecated', 0.001),
          makeReport('graced', 'grace', 0.0),
        ])}
        loading={false}
        error={null}
      />,
    );
    const top = screen.getByTestId('top-modules');
    // dead (deprecated) 가 가장 먼저 노출
    const html = top.innerHTML;
    const deadIdx = html.indexOf('module-dead');
    const lowIdx = html.indexOf('module-low');
    expect(deadIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThanOrEqual(0);
    expect(deadIdx).toBeLessThan(lowIdx);
  });

  it('Top 5 절삭 (6+ 모듈 입력 시)', () => {
    const modules = Array.from({ length: 8 }, (_, i) =>
      makeReport(`m${i}`, 'normal', i * 0.1),
    );
    render(
      <StaleReflectionsCard
        data={makeData(modules)}
        loading={false}
        error={null}
      />,
    );
    const top = screen.getByTestId('top-modules');
    const moduleEls = top.querySelectorAll('[data-testid^="module-"]');
    expect(moduleEls.length).toBe(5);
  });

  it('verdict-label — 자연선택 활발 (silent+deprecated ≥3)', () => {
    render(
      <StaleReflectionsCard
        data={makeData([
          makeReport('a', 'silent', 0.03),
          makeReport('b', 'silent', 0.04),
          makeReport('c', 'deprecated', 0.005),
          makeReport('d', 'normal', 0.5),
        ])}
        loading={false}
        error={null}
      />,
    );
    const verdict = screen.getByTestId('verdict-label');
    expect(verdict.textContent).toContain('자연선택 활발');
    expect(verdict.className).toContain('text-rose-400');
  });

  it('verdict-label — 모든 모듈 정상 (silent+deprecated=0, grace<total)', () => {
    render(
      <StaleReflectionsCard
        data={makeData([
          makeReport('a', 'normal', 0.6),
          makeReport('b', 'normal', 0.4),
          makeReport('c', 'grace', 0.0),
        ])}
        loading={false}
        error={null}
      />,
    );
    const verdict = screen.getByTestId('verdict-label');
    expect(verdict.textContent).toContain('모든 모듈 정상');
    expect(verdict.className).toContain('text-emerald-400');
  });

  it('verdict-label — 윈도우 N일 표시', () => {
    render(
      <StaleReflectionsCard
        data={makeData([makeReport('a', 'normal', 0.5)], 90)}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('verdict-label').textContent).toContain('윈도우 90일');
  });

  it('module impactRate % 표시 + runs 표시', () => {
    render(
      <StaleReflectionsCard
        data={makeData([makeReport('test-module', 'silent', 0.025, { runs: 200 })])}
        loading={false}
        error={null}
      />,
    );
    const moduleEl = screen.getByTestId('module-test-module');
    expect(moduleEl.textContent).toContain('test-module');
    expect(moduleEl.textContent).toContain('2.5%');
    expect(moduleEl.textContent).toContain('200회');
  });
});
