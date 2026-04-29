// @responsibility shadowAdvisory.cmd 회귀 — formatShadowAdvisoryMessage 3축 분기 + cmd 메타데이터.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../learning/rejectionShadowTracker.js', () => ({
  summarizeRejectionShadow: vi.fn(() => ({
    totalCount: 0,
    closedCount: 0,
    activeCount: 0,
    reliable: false,
    falseNegativeRate: 0,
    avgClosedReturnPct: 0,
    medianClosedReturnPct: 0,
    quartiles: { q1: 0, q2: 0, q3: 0 },
  })),
  getAllRejectionShadow: vi.fn(() => []),
}));

vi.mock('../../../learning/counterfactualTwinPortfolio.js', () => ({
  ALL_TWIN_KEYS: ['AGGRESSIVE', 'DISCIPLINED', 'EQUAL_WEIGHT'] as const,
  compareTwinsVsReal: vi.fn((real: number) => ({
    perTwin: {
      AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 5, avgReturnPct: real-1, cumReturnPct: real - 1, weeklySharpeProxy: 0.5 },
      DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 0, closedCount: 5, avgReturnPct: real+0.5, cumReturnPct: real + 0.5, weeklySharpeProxy: 0.7 },
      EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 5, avgReturnPct: real-2, cumReturnPct: real - 2, weeklySharpeProxy: 0.3 },
    },
    realCumReturnPct: real,
    weekWinning: { AGGRESSIVE: false, DISCIPLINED: real >= 0 ? false : true, EQUAL_WEIGHT: false },
  })),
}));

vi.mock('../../../learning/conditionAttributionShadow.js', () => ({
  analyzeShadowAttribution: vi.fn(() => ({
    totalConditions: 27,
    status: 'NO_DATA',
    closedSampleSize: 0,
    conditions: [],
    summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 27, normal: 0 },
  })),
}));

vi.mock('../../../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn(() => []),
  aggregateFillStats: vi.fn(() => ({
    fillCount: 0,
    winFills: 0,
    lossFills: 0,
    weightedReturnPct: 0,
    realizedKrw: 0,
    partialOnly: 0,
  })),
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: {
    register: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => []),
    keys: vi.fn(() => []),
  },
}));

import shadowAdvisory, { formatShadowAdvisoryMessage, type ShadowAdvisoryFormatInput } from './shadowAdvisory.cmd.js';

const baseInput: ShadowAdvisoryFormatInput = {
  rejectionSummary: {
    totalCount: 0,
    closedCount: 0,
    activeCount: 0,
    reliable: false,
    falseNegativeRate: 0,
    avgClosedReturnPct: 0,
    medianClosedReturnPct: 0,
    quartiles: { q1: 0, q2: 0, q3: 0 },
  },
  twinComparison: {
    perTwin: {
      AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
      DISCIPLINED: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
      EQUAL_WEIGHT: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
    },
    realCumReturnPct: 0,
    weekWinning: { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
  },
  attribution: {
    totalConditions: 27,
    status: 'NO_DATA' as const,
    closedSampleSize: 0,
    conditions: [],
    summary: { overStrictCandidates: 0, goodDefenseCandidates: 0, insufficient: 27, normal: 0 },
  },
  realCumReturnPct: 0,
  limit: 5,
};

describe('formatShadowAdvisoryMessage — 3축 통합', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('헤더 + 4 섹션 + 의사결정 안내 포함', () => {
    const msg = formatShadowAdvisoryMessage(baseInput);
    expect(msg).toContain('Shadow Advisory');
    expect(msg).toContain('1) Rejection alpha 누락 (과엄격 의심)');
    expect(msg).toContain('2) Over-Strict 조건 후보');
    expect(msg).toContain('3) Good Defense 조건');
    expect(msg).toContain('4) Twin 우월');
    expect(msg).toContain('자동 임계 조정');
    expect(msg).toContain('금지');
  });

  it('Rejection 데이터 부족 → "데이터 부족" + ❌ 표시 안 함', () => {
    const msg = formatShadowAdvisoryMessage(baseInput);
    expect(msg).toContain('데이터 부족');
    expect(msg).not.toContain('alpha 누락 0%');
  });

  it('Rejection reliable + 30%+ 누락 → 🔴 + 비율 표시', () => {
    const msg = formatShadowAdvisoryMessage({
      ...baseInput,
      rejectionSummary: {
        totalCount: 10,
        closedCount: 8,
        activeCount: 2,
        reliable: true,
        falseNegativeRate: 0.35,
        avgClosedReturnPct: 5.2,
        medianClosedReturnPct: 4.8,
        quartiles: { q1: 1, q2: 4, q3: 8 },
      },
    });
    expect(msg).toContain('🔴');
    expect(msg).toContain('alpha 누락 35%');
    expect(msg).toContain('8건');
  });

  it('Twin 우월 시 🥇 + Δ%p 표시', () => {
    const msg = formatShadowAdvisoryMessage({
      ...baseInput,
      twinComparison: {
        perTwin: {
          AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 5, avgReturnPct: 12.5, cumReturnPct: 12.5, weeklySharpeProxy: 0.8 },
          DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 0, closedCount: 5, avgReturnPct: 8.0, cumReturnPct: 8.0, weeklySharpeProxy: 0.6 },
          EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 5, avgReturnPct: 5.0, cumReturnPct: 5.0, weeklySharpeProxy: 0.4 },
        },
        realCumReturnPct: 7.0,
        weekWinning: { AGGRESSIVE: true, DISCIPLINED: true, EQUAL_WEIGHT: false },
      },
      realCumReturnPct: 7.0,
    });
    expect(msg).toContain('🥇');
    expect(msg).toContain('AGGR');
    expect(msg).toContain('+12.50%');
    expect(msg).toContain('Δ+5.50%p');
  });

  it('Twin 모두 CURRENT 보다 못함 → "현 정책 유지" 안내', () => {
    const msg = formatShadowAdvisoryMessage({
      ...baseInput,
      twinComparison: {
        perTwin: {
          AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: 0, closedCount: 5, avgReturnPct: 3.0, cumReturnPct: 3.0, weeklySharpeProxy: 0.2 },
          DISCIPLINED: { twin: 'DISCIPLINED', activeCount: 0, closedCount: 5, avgReturnPct: 2.0, cumReturnPct: 2.0, weeklySharpeProxy: 0.1 },
          EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: 0, closedCount: 5, avgReturnPct: 1.0, cumReturnPct: 1.0, weeklySharpeProxy: 0.05 },
        },
        realCumReturnPct: 5.0,
        weekWinning: { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
      },
      realCumReturnPct: 5.0,
    });
    expect(msg).toContain('CURRENT 가 모든 Twin 보다 우월');
  });

  it('attribution.status DISABLED → "ENV 비활성"', () => {
    const msg = formatShadowAdvisoryMessage({
      ...baseInput,
      attribution: { ...baseInput.attribution, status: 'DISABLED' },
    });
    expect(msg).toContain('ENV 비활성');
  });

  it('Over-Strict 후보 있음 → ⚠️ + 조건명 + ratio', () => {
    const msg = formatShadowAdvisoryMessage({
      ...baseInput,
      attribution: {
        ...baseInput.attribution,
        status: 'OK',
        conditions: [
          {
            conditionId: 1,
            conditionName: '주도주 사이클',
            overStrictCount: 6,
            goodDefenseCount: 1,
            overStrictAvgReturn: 8.5,
            goodDefenseAvgReturn: -2.0,
            ratio: 0.86,
            classification: 'over_strict_candidate',
          },
        ],
      },
    });
    expect(msg).toContain('⚠️');
    expect(msg).toContain('주도주 사이클');
    expect(msg).toContain('over=6');
    expect(msg).toContain('86%');
  });
});

describe('shadowAdvisory cmd 메타데이터', () => {
  it('name + aliases + category + riskLevel 정합', () => {
    expect(shadowAdvisory.name).toBe('/shadow_advisory');
    expect(shadowAdvisory.aliases).toEqual(['/sa_advisory', '/sad']);
    expect(shadowAdvisory.category).toBe('LRN');
    expect(shadowAdvisory.riskLevel).toBe(0);
    expect(shadowAdvisory.visibility).toBe('ADMIN');
  });

  it('execute 정상 실행 + reply 호출', async () => {
    const reply = vi.fn((_msg: string) => Promise.resolve());
    await shadowAdvisory.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0] as [string])[0];
    expect(msg).toContain('Shadow Advisory');
  });

  it('execute throw 시 ❌ 메시지 reply', async () => {
    const reply = vi.fn((_msg: string) => Promise.resolve());
    const { loadShadowTrades } = await import('../../../persistence/shadowTradeRepo.js');
    vi.mocked(loadShadowTrades).mockImplementationOnce(() => {
      throw new Error('disk failure');
    });
    await shadowAdvisory.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0] as [string])[0]).toContain('❌');
  });
});
