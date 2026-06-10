// @responsibility shadowLearningSummary 회귀 테스트 — 일일 리포트 라인 빌더.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../learning/rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/rejectionShadowTracker.js');
  return {
    ...actual,
    summarizeRejectionShadow: vi.fn(),
  };
});

vi.mock('../learning/counterfactualTwinPortfolio.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/counterfactualTwinPortfolio.js');
  return {
    ...actual,
    compareTwinsVsReal: vi.fn(),
  };
});

// ADR-0124 (PR-H): BE 표기 wiring 이 영속 파일을 읽지 않도록 격리 — 기존 표기
// 검증은 BE=0 (빈 trades) 기준 그대로. BE>0 케이스는 shadowLearningSummaryBeAdr0124.test.ts.
vi.mock('../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    loadShadowTrades: vi.fn(() => []),
  };
});

import * as rejectionRepo from '../learning/rejectionShadowTracker.js';
import * as twinRepo from '../learning/counterfactualTwinPortfolio.js';
import { buildShadowLearningSummary } from './shadowLearningSummary.js';

const mockedRej = vi.mocked(rejectionRepo.summarizeRejectionShadow);
const mockedComp = vi.mocked(twinRepo.compareTwinsVsReal);

describe('buildShadowLearningSummary', () => {
  beforeEach(() => {
    mockedRej.mockReset();
    mockedComp.mockReset();
  });
  afterEach(() => { vi.clearAllMocks(); });

  function emptyComparison() {
    return {
      perTwin: {
        AGGRESSIVE: { twin: 'AGGRESSIVE' as const, activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
        DISCIPLINED: { twin: 'DISCIPLINED' as const, activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
        EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT' as const, activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
      },
      realCumReturnPct: 0,
      weekWinning: { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
    };
  }

  it('데이터 모두 부재 → 빈 라인', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    mockedComp.mockReturnValue(emptyComparison());
    const result = buildShadowLearningSummary(0);
    expect(result.reportLine).toBe('');
    expect(result.narrativeLine).toBe('');
    expect(result.topTwin).toBeNull();
  });

  it('Rejection 표본 부족 + Twin 부재 → 빈 라인', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    mockedComp.mockReturnValue(emptyComparison());
    const result = buildShadowLearningSummary(0);
    expect(result.reportLine).toBe('');
  });

  it('Rejection reliable → false negative rate 표시', () => {
    mockedRej.mockReturnValue({
      totalCount: 10, closedCount: 8, activeCount: 2,
      avgClosedReturnPct: 2.5, medianClosedReturnPct: 1.0,
      falseNegativeRate: 0.25, quartiles: { q1: -1, q2: 1, q3: 5 },
      reliable: true,
    });
    mockedComp.mockReturnValue(emptyComparison());
    const result = buildShadowLearningSummary(0);
    expect(result.reportLine).toContain('Rejection 8건');
    expect(result.reportLine).toContain('25%');
  });

  it('Rejection 표본 부족 (reliable=false) + 표본 ≥1 → "표본 부족" 표기', () => {
    mockedRej.mockReturnValue({
      totalCount: 3, closedCount: 2, activeCount: 1,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    mockedComp.mockReturnValue(emptyComparison());
    const result = buildShadowLearningSummary(0);
    expect(result.reportLine).toContain('Rejection 3건');
    expect(result.reportLine).toContain('표본 부족');
  });

  it('Twin 우월 — AGGRESSIVE +9.4% vs CURRENT +4.2% → topTwin=AGGRESSIVE', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    const comp = emptyComparison();
    comp.perTwin.AGGRESSIVE.cumReturnPct = 9.4;
    comp.perTwin.AGGRESSIVE.closedCount = 5;
    comp.realCumReturnPct = 4.2;
    mockedComp.mockReturnValue(comp);
    const result = buildShadowLearningSummary(4.2);
    expect(result.topTwin).toBe('AGGRESSIVE');
    expect(result.topTwinDelta).toBeCloseTo(5.2, 2);
    expect(result.reportLine).toContain('AGGR');
    expect(result.reportLine).toContain('+9.40%');
    expect(result.reportLine).toContain('+5.20%p');
  });

  it('CURRENT 가 모든 Twin 보다 우월 → topTwin=null + "Twin 우월 없음"', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    const comp = emptyComparison();
    comp.perTwin.AGGRESSIVE.cumReturnPct = 1;
    comp.perTwin.AGGRESSIVE.closedCount = 5;
    comp.perTwin.DISCIPLINED.cumReturnPct = 2;
    comp.perTwin.DISCIPLINED.closedCount = 5;
    comp.perTwin.EQUAL_WEIGHT.cumReturnPct = 0;
    comp.perTwin.EQUAL_WEIGHT.closedCount = 5;
    comp.realCumReturnPct = 5;
    mockedComp.mockReturnValue(comp);
    const result = buildShadowLearningSummary(5);
    expect(result.topTwin).toBeNull();
    expect(result.reportLine).toContain('Twin 우월 없음');
  });

  it('Twin 표본만 있고 Rejection 부재 → 라인 노출', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    const comp = emptyComparison();
    comp.perTwin.AGGRESSIVE.closedCount = 3;
    comp.perTwin.AGGRESSIVE.cumReturnPct = 5;
    mockedComp.mockReturnValue(comp);
    const result = buildShadowLearningSummary(0);
    expect(result.reportLine).not.toBe('');
    expect(result.reportLine).toContain('데이터 부족');
    expect(result.reportLine).toContain('AGGR');
  });

  it('Top Twin 음수 cumReturn — CURRENT 보다 우월하면 표기', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    const comp = emptyComparison();
    // 명시적 sub-mocking — AGGRESSIVE 가 default cumReturnPct=0 으로 우월 후보 되지 않도록 차단
    comp.perTwin.AGGRESSIVE.cumReturnPct = -10;
    comp.perTwin.AGGRESSIVE.closedCount = 3;
    comp.perTwin.DISCIPLINED.cumReturnPct = -2;
    comp.perTwin.DISCIPLINED.closedCount = 5;
    comp.perTwin.EQUAL_WEIGHT.cumReturnPct = -10;
    comp.perTwin.EQUAL_WEIGHT.closedCount = 3;
    comp.realCumReturnPct = -8;
    mockedComp.mockReturnValue(comp);
    const result = buildShadowLearningSummary(-8);
    expect(result.topTwin).toBe('DISCIPLINED');
    expect(result.topTwinDelta).toBeCloseTo(6, 2);
  });

  it('narrativeLine 도 동일 컨텍스트 표기', () => {
    mockedRej.mockReturnValue({
      totalCount: 10, closedCount: 8, activeCount: 2,
      avgClosedReturnPct: 2.5, medianClosedReturnPct: 1.0,
      falseNegativeRate: 0.3, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: true,
    });
    const comp = emptyComparison();
    comp.perTwin.EQUAL_WEIGHT.cumReturnPct = 3;
    comp.perTwin.EQUAL_WEIGHT.closedCount = 4;
    comp.realCumReturnPct = 1;
    mockedComp.mockReturnValue(comp);
    const result = buildShadowLearningSummary(1);
    expect(result.narrativeLine).toContain('Shadow 학습');
    expect(result.narrativeLine).toContain('Rejection');
    expect(result.narrativeLine).toContain('EQW');
  });

  it('rejectionSummary raw 데이터 — 호출자 진단용 그대로 노출', () => {
    const summary = {
      totalCount: 5, closedCount: 4, activeCount: 1,
      avgClosedReturnPct: 1.5, medianClosedReturnPct: 1.0,
      falseNegativeRate: 0.5, quartiles: { q1: 0, q2: 1, q3: 2 },
      reliable: false,
    };
    mockedRej.mockReturnValue(summary);
    mockedComp.mockReturnValue(emptyComparison());
    const result = buildShadowLearningSummary(0);
    expect(result.rejectionSummary).toEqual(summary);
  });
});
