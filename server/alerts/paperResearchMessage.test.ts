// @responsibility Verify /paper_research explains why a research comparison is still waiting.
import { describe, expect, it } from 'vitest';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import { formatPaperResearch } from './paperBotMessages.js';

const study = (label: string, status: string, availableCount: number, trainingCount: number) => ({
  label, status, availableCount, trainingCount, matchedDifferencePct: status === 'EVALUATED' ? 0.2 : null,
  testCount: status === 'EVALUATED' ? 5 : 0, testSymbolCount: 1, testDateCount: 1 });

describe('paper research message', () => {
  it('shows the wait reason, benchmark series count and KIS index status', () => {
    const view = { research: { asOf: '2026-10-01T03:00:00Z', symbols: 1, sampleCount: 10, learningSampleCount: 1,
      firstDate: '2026-01-30', lastDate: '2026-09-21', benchmarkSeriesCount: 2,
      inventory: [{ file: 'KIS 지수 일봉(KOSPI·KOSDAQ)', records: 400, status: 'FOUND' }],
      featureStudies: [study('시장 대비 20일 상대강도', 'NO_TRAIN_VARIATION', 120, 0), study('5거래일 가격 모멘텀', 'EVALUATED', 10, 8)] },
    } as unknown as PaperExperimentView;
    const text = formatPaperResearch(view);
    expect(text).toContain('시장 대비 20일 상대강도: 비교 대기(학습 구간 비교군 부족 · 값 있음 120건·학습 0건)');
    expect(text).toContain('5거래일 가격 모멘텀: +0.20%p');
    expect(text).toContain('상대강도 기준 지수 시계열 2개');
    expect(text).toContain('상대강도 기준 KIS 지수 일봉 400건 · 수집 완료');
  });
});
