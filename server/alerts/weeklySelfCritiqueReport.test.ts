/**
 * @responsibility PR-X5 ADR-0041 주간 자기비판 리포트 회귀 테스트
 *
 * 검증:
 *   - summarizeStopPatterns: regime × exitRule 별 카운트 + 정렬
 *   - buildStopPatternRecommendation: 표본/비율 임계값 + 권고문 분기
 *   - formatWeeklySelfCritique: 정상/빈 거래/누적 편향/손절 0건 fallback
 *   - 잔고 키워드 0건 + 6자리 종목 코드 0건
 *   - dispatchAlert(JOURNAL) wiring
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import {
  summarizeStopPatterns,
  buildStopPatternRecommendation,
  formatWeeklySelfCritique,
  runWeeklySelfCritique,
  type WeeklySelfCritiqueInputs,
} from './weeklySelfCritiqueReport.js';

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: vi.fn().mockResolvedValue(123),
  ChannelSemantic: {
    EXECUTION: 'TRADE',
    SIGNAL: 'ANALYSIS',
    REGIME: 'INFO',
    JOURNAL: 'SYSTEM',
  },
}));

vi.mock('../persistence/shadowTradeRepo.js', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    loadShadowTrades: vi.fn().mockReturnValue([]),
  };
});

vi.mock('../learning/learningHistorySummary.js', () => ({
  getLearningHistory: vi.fn().mockReturnValue({
    days: [],
    totalReflections: 0,
    missingDays: 0,
    budget: { month: '2026-04', tokensUsed: 0, callCount: 0 },
    escalatingBiases: [],
  }),
  getLearningStatus: vi.fn().mockReturnValue({
    lastReflection: null,
    consecutiveMissingDays: 0,
    reflectionBudget: { month: '2026-04', tokensUsed: 0, callCount: 0 },
    biasHeatmapToday: null,
    biasHeatmap7dAvg: [],
    experimentProposalsActive: [],
    experimentProposalsCompletedRecent: [],
    tomorrowPriming: null,
    ghostPortfolioOpenCount: 0,
    suggestAlerts7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regimeCoverage: 0, total: 0 },
    diagnostics: { healthy: true, warnings: [] },
  }),
}));

import { dispatchAlert } from './alertRouter.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { getLearningHistory, getLearningStatus } from '../learning/learningHistorySummary.js';

const NOW = new Date('2026-04-26T10:00:00Z'); // KST 일요일 19:00

function makeTrade(overrides: Partial<ServerShadowTrade> = {}): ServerShadowTrade {
  return {
    id: 'trade-1',
    stockCode: '005930',
    stockName: '삼성전자',
    mode: 'SHADOW',
    signalType: 'BUY',
    signalTime: '2026-04-22T00:00:00Z',
    shadowEntryPrice: 70000,
    quantity: 10,
    stopLoss: 65000,
    targetPrice: 80000,
    rrr: 2.0,
    status: 'HIT_STOP',
    entryRegime: 'R5_CAUTION',
    exitRuleTag: 'HARD_STOP',
    fills: [],
    ...overrides,
  } as ServerShadowTrade;
}

describe('summarizeStopPatterns', () => {
  it('빈 배열 → 빈 결과', () => {
    expect(summarizeStopPatterns([])).toEqual([]);
  });

  it('HIT_STOP 만 카운트, 다른 status 제외', () => {
    const trades: ServerShadowTrade[] = [
      makeTrade({ id: 't1', status: 'HIT_STOP' }),
      makeTrade({ id: 't2', status: 'HIT_TARGET' }),
      makeTrade({ id: 't3', status: 'ACTIVE' }),
    ];
    const result = summarizeStopPatterns(trades);
    expect(result.length).toBe(1);
    expect(result[0].count).toBe(1);
  });

  it('동일 (regime, exitRule) 누적', () => {
    const trades = [
      makeTrade({ id: 't1', entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP' }),
      makeTrade({ id: 't2', entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP' }),
      makeTrade({ id: 't3', entryRegime: 'R2_BULL', exitRuleTag: 'HARD_STOP' }),
    ];
    const result = summarizeStopPatterns(trades);
    expect(result[0]).toEqual({ entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP', count: 2 });
    expect(result[1]).toEqual({ entryRegime: 'R2_BULL', exitRuleTag: 'HARD_STOP', count: 1 });
  });

  it('count 내림차순 + 동률 시 regime 알파벳 정렬', () => {
    const trades = [
      makeTrade({ id: 't1', entryRegime: 'R6_DEFENSE', exitRuleTag: 'CASCADE_FINAL' }),
      makeTrade({ id: 't2', entryRegime: 'R2_BULL', exitRuleTag: 'CASCADE_HALF_SELL' }),
    ];
    const result = summarizeStopPatterns(trades);
    expect(result[0].entryRegime).toBe('R2_BULL'); // R2 < R6 alphabetical
  });

  it('entryRegime/exitRuleTag 누락 시 "미상" fallback', () => {
    const trades = [
      makeTrade({ id: 't1', entryRegime: undefined, exitRuleTag: undefined }),
    ];
    const result = summarizeStopPatterns(trades);
    expect(result[0]).toEqual({ entryRegime: '미상', exitRuleTag: '미상', count: 1 });
  });
});

describe('buildStopPatternRecommendation', () => {
  it('빈 buckets → null', () => {
    expect(buildStopPatternRecommendation([], 0)).toBeNull();
  });

  it('top.count < 3 → null (표본 부족)', () => {
    const result = buildStopPatternRecommendation(
      [{ entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP', count: 2 }],
      2,
    );
    expect(result).toBeNull();
  });

  it('비율 < 40% → null (분산)', () => {
    const result = buildStopPatternRecommendation(
      [
        { entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP', count: 3 },
        { entryRegime: 'R2_BULL', exitRuleTag: 'CASCADE_HALF', count: 4 },
        { entryRegime: 'R3_EARLY', exitRuleTag: 'HARD_STOP_LOSS', count: 3 },
      ],
      10,
    );
    expect(result).toBeNull();
  });

  it('R5_CAUTION 다수 → 임계값 강화 권고', () => {
    const result = buildStopPatternRecommendation(
      [{ entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP', count: 4 }],
      6,
    );
    expect(result).toMatch(/R5_CAUTION/);
    expect(result).toMatch(/임계값.*강화/);
  });

  it('R6_DEFENSE 다수 → 임계값 강화 권고', () => {
    const result = buildStopPatternRecommendation(
      [{ entryRegime: 'R6_DEFENSE', exitRuleTag: 'R6_EMERGENCY_EXIT', count: 5 }],
      8,
    );
    expect(result).toMatch(/R6_DEFENSE/);
  });

  it('HARD_STOP 다수 → 손절폭 검토 권고', () => {
    const result = buildStopPatternRecommendation(
      [{ entryRegime: 'R2_BULL', exitRuleTag: 'HARD_STOP', count: 5 }],
      8,
    );
    expect(result).toMatch(/HARD_STOP/);
    expect(result).toMatch(/손절폭/);
  });

  it('CASCADE 다수 → 진입 모멘텀 검증 권고', () => {
    const result = buildStopPatternRecommendation(
      [{ entryRegime: 'R2_BULL', exitRuleTag: 'CASCADE_FINAL', count: 4 }],
      6,
    );
    expect(result).toMatch(/캐스케이드|진입.*모멘텀/);
  });

  it('일반 패턴 → 모니터링 권고', () => {
    const result = buildStopPatternRecommendation(
      [{ entryRegime: 'R3_EARLY', exitRuleTag: 'TRAILING_STOP', count: 4 }],
      6,
    );
    expect(result).toMatch(/모니터링/);
  });
});

describe('formatWeeklySelfCritique 메시지 포맷', () => {
  function makeInputs(overrides: Partial<WeeklySelfCritiqueInputs> = {}): WeeklySelfCritiqueInputs {
    return {
      weekStart: '2026-04-19',
      weekEnd: '2026-04-26',
      fillStats: {
        fillCount: 12,
        winFills: 7,
        lossFills: 5,
        weightedReturnPct: 2.3,
        totalRealizedKrw: 1_250_000,
        fullClosedCount: 9,
        partialOnlyCount: 3,
        uniqueTradeCount: 12,
      },
      escalatingBiases: [
        { bias: 'LOSS_AVERSION', recentScores: [0.5, 0.6, 0.7] },
      ],
      stopBuckets: [
        { entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP', count: 4 },
      ],
      totalStops: 6,
      recommendation: 'R5_CAUTION 레짐 진입 후 손절 4건 (66%) — 해당 레짐에서 진입 임계값 +1점 강화 권고',
      experimentProposalsActive: 2,
      experimentProposalsCompletedRecent: 1,
      reflectionMissingDays: 0,
      ...overrides,
    };
  }

  it('정상 입력 → 모든 섹션 렌더', () => {
    const msg = formatWeeklySelfCritique(makeInputs(), NOW);
    expect(msg).toMatch(/주간 자기 비판/);
    expect(msg).toMatch(/19:00 KST/);
    expect(msg).toContain('2026-04-19');
    expect(msg).toContain('2026-04-26');
    expect(msg).toContain('실현 fill: 12건');
    expect(msg).toContain('승 7 / 패 5');
    expect(msg).toContain('+2.30%');
    expect(msg).toContain('1,250,000원');
    expect(msg).toContain('부분익절 3건');
    expect(msg).toContain('손실 회피'); // LOSS_AVERSION 한글
    expect(msg).toContain('R5_CAUTION');
    expect(msg).toContain('HARD_STOP');
    expect(msg).toContain('활성 2건 / 최근 완료 1건');
    expect(msg).toMatch(/매주 일요일 19:00 KST 자동 발송/);
  });

  it('실현 0건 → "이번 주 매매 없음" fallback', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({
        fillStats: {
          fillCount: 0,
          winFills: 0,
          lossFills: 0,
          weightedReturnPct: 0,
          totalRealizedKrw: 0,
          fullClosedCount: 0,
          partialOnlyCount: 0,
          uniqueTradeCount: 0,
        },
      }),
      NOW,
    );
    expect(msg).toContain('실현 fill 없음');
    expect(msg).not.toContain('부분익절');
  });

  it('편향 없음 → "자기통제 정상" 표시', () => {
    const msg = formatWeeklySelfCritique(makeInputs({ escalatingBiases: [] }), NOW);
    expect(msg).toContain('3일 연속 ≥ 0.5 인 편향 없음');
    expect(msg).toContain('자기통제 정상');
  });

  it('편향 평균 ≥ 0.7 → 🔴 등급', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({ escalatingBiases: [{ bias: 'OVERCONFIDENCE', recentScores: [0.7, 0.75, 0.8] }] }),
      NOW,
    );
    expect(msg).toContain('🔴');
    expect(msg).toContain('과신');
  });

  it('편향 평균 0.5~0.7 → 🟡 등급', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({ escalatingBiases: [{ bias: 'ENDOWMENT', recentScores: [0.5, 0.55, 0.6] }] }),
      NOW,
    );
    expect(msg).toContain('🟡');
    expect(msg).toContain('보유 효과');
  });

  it('편향 trend ↗ 악화 (last - first ≥ 0.1)', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({ escalatingBiases: [{ bias: 'LOSS_AVERSION', recentScores: [0.5, 0.6, 0.7] }] }),
      NOW,
    );
    expect(msg).toMatch(/↗ 악화/);
  });

  it('편향 trend ↘ 개선 (last < first - 0.1)', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({ escalatingBiases: [{ bias: 'LOSS_AVERSION', recentScores: [0.7, 0.6, 0.55] }] }),
      NOW,
    );
    expect(msg).toMatch(/↘ 개선/);
  });

  it('손절 0건 → "HIT_STOP 0건" fallback', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({ stopBuckets: [], totalStops: 0, recommendation: null }),
      NOW,
    );
    expect(msg).toContain('이번 주 HIT_STOP 0건');
    expect(msg).toContain('통계적 권고 없음');
  });

  it('reflection 누락 ≥ 3일 시 ⚠️ 경고 표시', () => {
    const msg = formatWeeklySelfCritique(makeInputs({ reflectionMissingDays: 5 }), NOW);
    expect(msg).toContain('reflection 연속 누락 5일');
    expect(msg).toMatch(/nightlyReflectionEngine 점검/);
  });

  it('reflection 누락 < 3일 시 경고 없음', () => {
    const msg = formatWeeklySelfCritique(makeInputs({ reflectionMissingDays: 2 }), NOW);
    expect(msg).not.toContain('reflection 연속 누락');
  });

  it('편향 3개 초과 시 상위 3개만 표시', () => {
    const msg = formatWeeklySelfCritique(
      makeInputs({
        escalatingBiases: [
          { bias: 'LOSS_AVERSION', recentScores: [0.7] },
          { bias: 'OVERCONFIDENCE', recentScores: [0.65] },
          { bias: 'CONFIRMATION', recentScores: [0.6] },
          { bias: 'HERDING', recentScores: [0.55] },
        ],
      }),
      NOW,
    );
    expect(msg).toContain('손실 회피');
    expect(msg).toContain('과신');
    expect(msg).toContain('확신 편향');
    expect(msg).not.toContain('군중 추종'); // 4번째는 제외
  });
});

describe('formatWeeklySelfCritique 절대 규칙', () => {
  function baseInputs(): WeeklySelfCritiqueInputs {
    return {
      weekStart: '2026-04-19',
      weekEnd: '2026-04-26',
      fillStats: {
        fillCount: 5, winFills: 3, lossFills: 2, weightedReturnPct: 1.5,
        totalRealizedKrw: 500000, fullClosedCount: 4, partialOnlyCount: 1, uniqueTradeCount: 5,
      },
      escalatingBiases: [{ bias: 'LOSS_AVERSION', recentScores: [0.5, 0.6, 0.7] }],
      stopBuckets: [{ entryRegime: 'R5_CAUTION', exitRuleTag: 'HARD_STOP', count: 3 }],
      totalStops: 5,
      recommendation: 'R5_CAUTION 레짐 진입 후 손절 3건 (60%) — 강화 권고',
      experimentProposalsActive: 1,
      experimentProposalsCompletedRecent: 0,
      reflectionMissingDays: 0,
    };
  }

  it('잔고 키워드 8종 누출 없음', () => {
    const msg = formatWeeklySelfCritique(baseInputs(), NOW);
    const FORBIDDEN = ['총자산', '총 자산', '주문가능현금', '잔여 현금', '잔여현금', '보유자산', '보유 자산', '평가손익'];
    for (const kw of FORBIDDEN) {
      expect(msg).not.toContain(kw);
    }
  });

  it('6자리 종목 코드 누출 없음 (CH4 메타 학습 정체성)', () => {
    const msg = formatWeeklySelfCritique(baseInputs(), NOW);
    expect(msg).not.toMatch(/\b\d{6}\b/);
  });
});

describe('runWeeklySelfCritique — dispatchAlert wiring', () => {
  beforeEach(() => {
    vi.mocked(dispatchAlert).mockClear();
    vi.mocked(loadShadowTrades).mockReturnValue([]);
    vi.mocked(getLearningHistory).mockReturnValue({
      days: [],
      totalReflections: 0,
      missingDays: 0,
      budget: { month: '2026-04', tokensUsed: 0, callCount: 0 },
      escalatingBiases: [],
    });
    vi.mocked(getLearningStatus).mockReturnValue({
      lastReflection: null,
      consecutiveMissingDays: 0,
      reflectionBudget: { month: '2026-04', tokensUsed: 0, callCount: 0 },
      biasHeatmapToday: null,
      biasHeatmap7dAvg: [],
      experimentProposalsActive: [],
      experimentProposalsCompletedRecent: [],
      tomorrowPriming: null,
      ghostPortfolioOpenCount: 0,
      suggestAlerts7d: { counterfactual: 0, ledger: 0, kellySurface: 0, regimeCoverage: 0, total: 0 },
      diagnostics: { healthy: true, warnings: [] },
    });
  });

  it('dispatchAlert(JOURNAL) 호출 + dedupeKey weekly_self_critique:KST일자', async () => {
    await runWeeklySelfCritique(NOW);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const [category, message, options] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(category).toBe('SYSTEM'); // ChannelSemantic.JOURNAL
    expect(message).toMatch(/주간 자기 비판/);
    expect(options?.priority).toBe('NORMAL');
    expect(options?.dedupeKey).toMatch(/^weekly_self_critique:\d{4}-\d{2}-\d{2}$/);
  });

  it('빈 trades + 빈 escalatingBiases 시에도 graceful 발송', async () => {
    await runWeeklySelfCritique(NOW);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const [, message] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(message).toContain('실현 fill 없음');
    expect(message).toContain('자기통제 정상');
  });

  it('dispatchAlert throw 시 catch (cron 차단되지 않음)', async () => {
    vi.mocked(dispatchAlert).mockRejectedValueOnce(new Error('네트워크 실패'));
    await expect(runWeeklySelfCritique(NOW)).resolves.toBeUndefined();
  });
});
