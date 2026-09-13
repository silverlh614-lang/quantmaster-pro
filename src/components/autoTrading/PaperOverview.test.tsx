// @vitest-environment jsdom
// @responsibility Verify honest dashboard operating states.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PaperOverview } from './PaperOverview';
import type { PaperOverviewView } from '../../types/paperExperiment';
afterEach(cleanup);
const view: PaperOverviewView = { mode: 'SHADOW', strategyVersion: 'shadow-baseline-v1', lastRun: null, totalCount: 0, openCount: 0, completedCount: 0, outcomes: [{ horizon: 1, label: 'D1', count: 2, meanNetReturnPct: 0, winRatePct: 0 }] };
describe('PaperOverview', () => {
  it('distinguishes zero results from pending data and unknown operating status', () => {
    render(<PaperOverview view={view} />);
    expect(screen.getByText('운영 상태 확인 중')).toBeTruthy();
    expect(screen.getByText('0.00%')).toBeTruthy();
    expect(screen.getAllByText('집계 대기').length).toBeGreaterThan(1);
  });
  it('shows paused operation even when the last recorded scan was during market hours', () => {
    render(<PaperOverview view={{ ...view, lastRun: { snapshotId: 's', asOf: new Date().toISOString(), candidateCount: 185, observedCount: 180, openedCount: 0, completedCount: 0, missingPriceCount: 5, marketOpen: true, issues: [] } }} mode="SHADOW" paused />);
    expect(screen.getByText('자동 관측 일시정지')).toBeTruthy();
    expect(screen.getByText('185')).toBeTruthy();
    expect(screen.queryByText('장중 관측 기록을 쌓고 있습니다')).toBeNull();
  });
  it('does not present an old scan as current running observation', () => {
    render(<PaperOverview view={{ ...view, lastRun: { snapshotId: 's', asOf: '2020-01-01T00:00:00Z', candidateCount: 5, observedCount: 5, openedCount: 0, completedCount: 0, missingPriceCount: 0, marketOpen: true, issues: [] } }} mode="SHADOW" paused={false} />);
    expect(screen.getByText('최근 관측 갱신 확인 필요')).toBeTruthy();
  });
});
