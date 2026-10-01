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
      longHorizon: { horizon: 20, sampleCount: 900, symbolCount: 300, entryDateCount: 120, firstDate: '2026-01-30', lastDate: '2026-08-21',
        meanNetReturnPct: 1.2, winRatePct: 51.5, excessCount: 880, meanExcessReturnPct: -0.4, splitDate: '2026-06-30', features: [
          { feature: 'return5dPct', label: '5거래일 가격 모멘텀', availableCount: 800, trainingCount: 500, selectedGroup: '하위',
            testCount: 120, testDateCount: 30, matchedDifferencePct: 0.85, status: 'EVALUATED' }] },
      featureStudies: [study('시장 대비 20일 상대강도', 'NO_TRAIN_VARIATION', 120, 0), study('5거래일 가격 모멘텀', 'EVALUATED', 10, 8)] },
      relativeStrengthStudy: { experimentCount: 10, measuredCount: 8, indexReady: true, horizons: [
        { horizon: 1, cellCount: 3, upperWinCount: 2, entryDateCount: 2, sampleCount: 6, upperMeanPct: 0.5, lowerMeanPct: -0.25, differencePct: 0.75 },
        { horizon: 3, cellCount: 0, upperWinCount: 0, entryDateCount: 0, sampleCount: 0, upperMeanPct: null, lowerMeanPct: null, differencePct: null },
        { horizon: 5, cellCount: 0, upperWinCount: 0, entryDateCount: 0, sampleCount: 0, upperMeanPct: null, lowerMeanPct: null, differencePct: null }] },
    } as unknown as PaperExperimentView;
    const text = formatPaperResearch(view);
    expect(text).toContain('지수 대비 20일 상대강도 계산 8/10건');
    expect(text).toContain('900건/300종목/120진입일 (2026-01-30~2026-08-21)');
    expect(text).toContain('비용 차감 평균 +1.20% · 승률 51.5% · 같은 기간 지수 대비 -0.40% (880건)');
    expect(text).toContain('• 5거래일 가격 모멘텀: 하위 선택 → +0.85%p · 120건/30진입일');
    expect(text).toContain('독립 구간은 약 6개뿐입니다');
    expect(text).toContain('D1: 상위 +0.50% vs 하위 -0.25% → +0.75%p · 3개 날짜·그룹 중 상위 우세 2 · 2진입일/6건');
    expect(text).toContain('D3: 확정 성과가 있는 같은 날·같은 그룹 비교 대기');
    expect(text).toContain('시장 대비 20일 상대강도: 비교 대기(학습 구간 비교군 부족 · 값 있음 120건·학습 0건)');
    expect(text).toContain('5거래일 가격 모멘텀: +0.20%p');
    expect(text).toContain('상대강도 기준 지수 시계열 2개');
    expect(text).toContain('상대강도 기준 KIS 지수 일봉 400건 · 수집 완료');
  });
});
