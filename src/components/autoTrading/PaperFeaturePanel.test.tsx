// @vitest-environment jsdom
// @responsibility Verify feature coverage and missing-history explanations remain visible.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PaperFeaturePanel } from './PaperFeaturePanel';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../types/paperObservationFeatures';
afterEach(cleanup);
describe('observation feature display', () => {
  it('renders the complete condition catalog and handles old ledgers without data', () => {
    render(<PaperFeaturePanel />);
    expect(screen.getByText('동시 관측 조건 비교')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(Object.keys(PAPER_FEATURES).length);
    expect(screen.getByText(/기존 관측은 소급 보충하지 않습니다/)).toBeTruthy();
    expect(screen.getByText(/학습·후반 확인 성과에 따라 매수 연결을 갱신/)).toBeTruthy();
    expect(screen.getByText(/현재 연결된 지표와 해제 사유.*전략 화면/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('동시 관측 연구 항목'), { target: { value: 'operatingMargin' } });
    expect((screen.getByLabelText('동시 관측 연구 항목') as HTMLSelectElement).value).toBe('operatingMargin');
  });
  it('shows current coverage separately from frozen entry research and does not hide zero returns', () => {
    const available = Object.fromEntries((Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).map(key => [key, key === 'rsi14' ? 7 : 0])) as Record<PaperFeatureKey, number>;
    render(<PaperFeaturePanel coverage={{ asOf: '2026-09-19T00:00:00Z', candidateCount: 10, available }} study={{
      totalCount: 100, recordedCount: 1, features: [{ key: 'rsi14', availableCount: 1, missingCount: 99,
        groups: [{ label: '30 미만', count: 1, symbolCount: 1, entryDateCount: 1,
          outcomes: [{ horizon: 1, count: 1, symbolCount: 1, entryDateCount: 1, meanNetReturnPct: 0, winRatePct: 0 }] }] }],
    }} />);
    expect(screen.getByText('7 / 10')).toBeTruthy();
    expect(screen.getByText('0.00%')).toBeTruthy();
    expect(screen.getByText(/신규 기록 1 \/ 전체 100건/)).toBeTruthy();
  });
});
