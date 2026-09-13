// @vitest-environment jsdom
// @responsibility Verify research comparison presentation.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResearchFeatureStudy } from '../../types/paperResearch';
import { PaperResearchFeatures } from './PaperResearchFeatures';
afterEach(cleanup);
const study: ResearchFeatureStudy = { feature: 'volumeRatio20d', label: '거래량 비교', availableCount: 0, missingCount: 100,
  splitDate: null, threshold: null, groups: [], trainingCount: 0, testAvailableCount: 0, selectedGroup: null,
  selectedHorizon: null, selectedTrainingCount: 0, testCount: 0, testDateCount: 0, testSymbolCount: 0,
  testMeanNetReturnPct: null, matchedGroupCount: 0, matchedSelectedMeanPct: null, matchedBaselineMeanPct: null,
  matchedDifferencePct: null, status: 'MISSING_INPUT' };
describe('feature research view', () => {
  it('shows missing inputs without inventing a zero return', () => {
    render(<PaperResearchFeatures studies={[study]} notes={['수급 기록은 별도 확인']} />);
    expect(screen.getByText('입력 자료 없음')).toBeTruthy();
    expect(screen.getByText('0 / 100')).toBeTruthy();
    expect(screen.queryByText('0.00%p')).toBeNull();
  });
  it('distinguishes matched percentage-point difference from an account return', () => {
    render(<PaperResearchFeatures studies={[{ ...study, status: 'EVALUATED', selectedGroup: 'UPPER', selectedHorizon: 3,
      matchedSelectedMeanPct: 1, matchedBaselineMeanPct: 2.5, matchedDifferencePct: -1.5 }]} notes={[]} />);
    expect(screen.getByText('-1.50%p')).toBeTruthy();
    expect(screen.getByText('학습 중앙값 초과 · D3')).toBeTruthy();
    expect(screen.getByText(/탐색 결과는 매매에 자동 적용되지 않습니다/)).toBeTruthy();
  });
});
