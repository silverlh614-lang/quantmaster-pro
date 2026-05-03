// @vitest-environment jsdom
// @responsibility ADR-0178 SafetyGateAttributionCard 회귀 테스트
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

afterEach(() => cleanup());
import { SafetyGateAttributionCard } from './SafetyGateAttributionCard';
import type { ClientGateAttributionResult } from '../../api/learningDashboardClient';

function makeResult(
  overrides: Partial<ClientGateAttributionResult> = {},
): ClientGateAttributionResult {
  return {
    gate: 'FOMC',
    avoidedLoss: 100,
    missedGain: 50,
    netGateImpact: 50,
    blockedWinnerCount: 1,
    blockedLoserCount: 2,
    gatePrecision: 0.667,
    sampleSize: 3,
    ...overrides,
  };
}

describe('SafetyGateAttributionCard', () => {
  it('loading 상태 표시', () => {
    render(<SafetyGateAttributionCard results={undefined} loading={true} error={null} />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('error 상태 표시', () => {
    render(
      <SafetyGateAttributionCard
        results={undefined}
        loading={false}
        error={new Error('boom')}
      />,
    );
    expect(screen.getByTestId('error').textContent).toContain('boom');
  });

  it('데이터 0건 — placeholder 표시', () => {
    render(<SafetyGateAttributionCard results={[]} loading={false} error={null} />);
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
  });

  it('totalSampleSize=0 — placeholder 표시 (모든 entry sampleSize=0)', () => {
    const allZero: ClientGateAttributionResult[] = [
      makeResult({ gate: 'FOMC', sampleSize: 0 }),
      makeResult({ gate: 'VIX', sampleSize: 0 }),
    ];
    render(<SafetyGateAttributionCard results={allZero} loading={false} error={null} />);
    expect(screen.getByTestId('empty-placeholder')).toBeTruthy();
  });

  it('정상 응답 — 7 GateName 모두 row 표시', () => {
    const results: ClientGateAttributionResult[] = [makeResult({ gate: 'FOMC' })];
    render(<SafetyGateAttributionCard results={results} loading={false} error={null} />);
    expect(screen.getByTestId('safety-gate-table')).toBeTruthy();
    expect(screen.getByTestId('gate-row-FOMC')).toBeTruthy();
    expect(screen.getByTestId('gate-row-VIX')).toBeTruthy();
    expect(screen.getByTestId('gate-row-R0_R1_REGIME')).toBeTruthy();
    expect(screen.getByTestId('gate-row-LIQUIDITY')).toBeTruthy();
    expect(screen.getByTestId('gate-row-DATA_SANITY')).toBeTruthy();
    expect(screen.getByTestId('gate-row-EXPOSURE_BUDGET')).toBeTruthy();
    expect(screen.getByTestId('gate-row-ENEMY_CHECKLIST')).toBeTruthy();
  });

  it('netGateImpact > 0 — 손실 방지 tone (emerald)', () => {
    const results: ClientGateAttributionResult[] = [
      makeResult({ gate: 'FOMC', netGateImpact: 50, sampleSize: 5 }),
    ];
    const { container } = render(
      <SafetyGateAttributionCard results={results} loading={false} error={null} />,
    );
    const row = container.querySelector('[data-testid="gate-row-FOMC"]');
    expect(row?.innerHTML).toContain('text-emerald-400');
  });

  it('netGateImpact < 0 — 과보호 tone (rose)', () => {
    const results: ClientGateAttributionResult[] = [
      makeResult({ gate: 'FOMC', netGateImpact: -50, sampleSize: 5 }),
    ];
    const { container } = render(
      <SafetyGateAttributionCard results={results} loading={false} error={null} />,
    );
    const row = container.querySelector('[data-testid="gate-row-FOMC"]');
    expect(row?.innerHTML).toContain('text-rose-400');
  });

  it('sampleSize=0 entry — 값 "—" 표시 (다른 entry 가 sample 보유 시)', () => {
    const results: ClientGateAttributionResult[] = [
      makeResult({ gate: 'FOMC', sampleSize: 5 }),
      makeResult({ gate: 'VIX', sampleSize: 0, netGateImpact: 0 }),
    ];
    const { container } = render(
      <SafetyGateAttributionCard results={results} loading={false} error={null} />,
    );
    const vixRow = container.querySelector('[data-testid="gate-row-VIX"]');
    expect(vixRow?.textContent).toContain('—');
  });

  it('gatePrecision % 표시', () => {
    const results: ClientGateAttributionResult[] = [
      makeResult({ gate: 'FOMC', gatePrecision: 0.75, sampleSize: 5 }),
    ];
    const { container } = render(
      <SafetyGateAttributionCard results={results} loading={false} error={null} />,
    );
    const row = container.querySelector('[data-testid="gate-row-FOMC"]');
    expect(row?.textContent).toContain('75.0%');
  });
});
