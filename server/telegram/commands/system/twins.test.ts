// @responsibility twins.cmd 회귀 테스트 — formatTwinsMessage + cmd execute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
import type { TwinComparisonResult, TwinEntry, TwinKey } from '../../../learning/counterfactualTwinPortfolio.js';

vi.mock('../../../learning/counterfactualTwinPortfolio.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../learning/counterfactualTwinPortfolio.js',
  );
  return {
    ...actual,
    compareTwinsVsReal: vi.fn(),
    getAllTwinEntries: vi.fn(),
  };
});

vi.mock('../../../learning/recommendationTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../learning/recommendationTracker.js',
  );
  return {
    ...actual,
    getMonthlyStats: vi.fn(),
  };
});

import * as twin from '../../../learning/counterfactualTwinPortfolio.js';
import * as recommendation from '../../../learning/recommendationTracker.js';
import { formatTwinsMessage } from './twins.cmd.js';
import './twins.cmd.js';

const mockedCompare = vi.mocked(twin.compareTwinsVsReal);
const mockedAll = vi.mocked(twin.getAllTwinEntries);
const mockedMonthly = vi.mocked(recommendation.getMonthlyStats);

function makeTwin(overrides: Partial<TwinEntry> = {}): TwinEntry {
  return {
    id: `t_${Math.random().toString(36).slice(2)}`,
    twin: 'AGGRESSIVE',
    stockCode: '005930',
    stockName: '삼성전자',
    signalDate: '2026-04-15',
    signalGateScore: 18,
    entryPrice: 70000,
    positionWeight: 0.2,
    trackUntil: '2026-05-15',
    currentReturnPct: 5,
    status: 'CLOSED',
    ...overrides,
  };
}

function makeResult(overrides: Partial<Record<TwinKey, { cumReturnPct: number; activeCount?: number; closedCount?: number; sharpe?: number }>> = {}): TwinComparisonResult {
  const defaults = {
    AGGRESSIVE: { cumReturnPct: 9.4, activeCount: 2, closedCount: 5, sharpe: 0.4 },
    DISCIPLINED: { cumReturnPct: 5.8, activeCount: 1, closedCount: 3, sharpe: 0.3 },
    EQUAL_WEIGHT: { cumReturnPct: 3.9, activeCount: 0, closedCount: 4, sharpe: 0.2 },
  };
  const merged = { ...defaults, ...overrides };
  return {
    perTwin: {
      AGGRESSIVE: { twin: 'AGGRESSIVE', activeCount: merged.AGGRESSIVE.activeCount ?? 0, closedCount: merged.AGGRESSIVE.closedCount ?? 0, avgReturnPct: 0, cumReturnPct: merged.AGGRESSIVE.cumReturnPct, weeklySharpeProxy: merged.AGGRESSIVE.sharpe ?? 0 },
      DISCIPLINED: { twin: 'DISCIPLINED', activeCount: merged.DISCIPLINED.activeCount ?? 0, closedCount: merged.DISCIPLINED.closedCount ?? 0, avgReturnPct: 0, cumReturnPct: merged.DISCIPLINED.cumReturnPct, weeklySharpeProxy: merged.DISCIPLINED.sharpe ?? 0 },
      EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT', activeCount: merged.EQUAL_WEIGHT.activeCount ?? 0, closedCount: merged.EQUAL_WEIGHT.closedCount ?? 0, avgReturnPct: 0, cumReturnPct: merged.EQUAL_WEIGHT.cumReturnPct, weeklySharpeProxy: merged.EQUAL_WEIGHT.sharpe ?? 0 },
    },
    realCumReturnPct: 4.2,
    weekWinning: {
      AGGRESSIVE: merged.AGGRESSIVE.cumReturnPct > 4.2,
      DISCIPLINED: merged.DISCIPLINED.cumReturnPct > 4.2,
      EQUAL_WEIGHT: merged.EQUAL_WEIGHT.cumReturnPct > 4.2,
    },
  };
}

describe('formatTwinsMessage', () => {
  it('빈 entries → 📭 placeholder', () => {
    const msg = formatTwinsMessage({
      result: makeResult(),
      entries: [],
      realCumReturnPct: 4.2,
    });
    expect(msg).toContain('📭');
    expect(msg).toContain('AGGRESSIVE');
    expect(msg).toContain('DISCIPLINED');
    expect(msg).toContain('EQUAL_WEIGHT');
  });

  it('정상 — 4 전략 cumReturnPct 내림차순 정렬', () => {
    const entries = [
      makeTwin({ twin: 'AGGRESSIVE', status: 'CLOSED' }),
      makeTwin({ twin: 'DISCIPLINED', status: 'CLOSED' }),
      makeTwin({ twin: 'EQUAL_WEIGHT', status: 'CLOSED' }),
    ];
    const msg = formatTwinsMessage({
      result: makeResult({
        AGGRESSIVE: { cumReturnPct: 9.4, activeCount: 0, closedCount: 1, sharpe: 0.4 },
      }),
      entries,
      realCumReturnPct: 4.2,
    });
    // 정렬 (내림차순): AGGRESSIVE 9.4 > DISCIPLINED 5.8 > CURRENT 4.2 > EQUAL_WEIGHT 3.9
    // 'CURRENT' 는 헤더에도 등장 — ranking 라인은 'CURRENT (LIVE)' 라벨로 정확 매칭
    const idxAggr = msg.indexOf('AGGRESSIVE');
    const idxDis = msg.indexOf('DISCIPLINED');
    const idxCur = msg.indexOf('CURRENT (LIVE)');
    expect(idxAggr).toBeLessThan(idxDis);
    expect(idxDis).toBeLessThan(idxCur);
  });

  it('weekWinning 표기 ✅ — Twin 이 CURRENT 보다 우월', () => {
    const entries = [makeTwin()];
    const msg = formatTwinsMessage({
      result: makeResult({
        AGGRESSIVE: { cumReturnPct: 10, activeCount: 0, closedCount: 1 },
      }),
      entries,
      realCumReturnPct: 4.2,
    });
    expect(msg).toContain('AGGRESSIVE');
    expect(msg).toContain('✅');
  });

  it('CURRENT 가 최상위인 경우 ✅ 미표기', () => {
    const entries = [makeTwin()];
    const msg = formatTwinsMessage({
      result: makeResult({
        AGGRESSIVE: { cumReturnPct: 1, activeCount: 0, closedCount: 1 },
        DISCIPLINED: { cumReturnPct: 2, activeCount: 0, closedCount: 1 },
        EQUAL_WEIGHT: { cumReturnPct: 0, activeCount: 0, closedCount: 1 },
      }),
      entries,
      realCumReturnPct: 5,
    });
    // CURRENT 가 1위 (5%) — Twin 모두 underperform
    expect(msg).toContain('CURRENT');
    // ✅ 는 안내 라인 ("✅ = 해당 Twin 이 CURRENT 보다") 에서만 등장 가능 — 순위 라인에 ✅ 0건
    const rankingSection = msg.split('💡')[0];
    expect(rankingSection).not.toContain(' ✅');
  });

  it('promotion 안내 라인 — 4주 연속 우월 검토', () => {
    const entries = [makeTwin()];
    const msg = formatTwinsMessage({
      result: makeResult(),
      entries,
      realCumReturnPct: 4.2,
    });
    expect(msg).toContain('promotion');
    expect(msg).toContain('자동 임계 조정 금지');
  });

  it('총 entries 카운트 표시 — 활성 + 종결', () => {
    const entries = [
      makeTwin({ status: 'OPEN' }),
      makeTwin({ status: 'OPEN' }),
      makeTwin({ status: 'CLOSED' }),
    ];
    const msg = formatTwinsMessage({
      result: makeResult(),
      entries,
      realCumReturnPct: 4.2,
    });
    expect(msg).toContain('3건');
    expect(msg).toContain('활성 2');
    expect(msg).toContain('종결 1');
  });
});

describe('twins.cmd execute', () => {
  let replies: string[];

  beforeEach(() => {
    replies = [];
    mockedCompare.mockReset();
    mockedAll.mockReset();
    mockedMonthly.mockReset();
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('정상 응답 — getMonthlyStats + compareTwinsVsReal + reply', async () => {
    mockedMonthly.mockReturnValue({
      month: '2026-04', total: 10, wins: 6, losses: 3, expired: 1,
      winRate: 0.6, avgReturn: 1.2, strongBuyWinRate: 0.7,
      sampleSufficient: true, compoundReturn: 4.2, profitFactor: 2.1,
    });
    mockedCompare.mockReturnValue(makeResult());
    mockedAll.mockReturnValue([]);
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/twins');
    expect(cmd).toBeDefined();
    await cmd!.execute({ args: [], reply });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Twin Strategy Leaderboard');
    expect(mockedCompare).toHaveBeenCalledWith(4.2);
  });

  it('alias /twin_leaderboard 도 동일 instance', () => {
    const cmd1 = commandRegistry.resolve('/twins');
    const cmd2 = commandRegistry.resolve('/twin_leaderboard');
    expect(cmd1).toBe(cmd2);
  });

  it('compareTwinsVsReal throw 시 graceful', async () => {
    mockedMonthly.mockReturnValue({
      month: '2026-04', total: 0, wins: 0, losses: 0, expired: 0,
      winRate: 0, avgReturn: 0, strongBuyWinRate: 0,
      sampleSufficient: false, compoundReturn: 0, profitFactor: null,
    });
    mockedCompare.mockImplementation(() => { throw new Error('boom'); });
    const reply = async (m: string) => { replies.push(m); };
    const cmd = commandRegistry.resolve('/twins');
    await cmd!.execute({ args: [], reply });
    expect(replies[0]).toContain('❌');
  });

  it('메타데이터', () => {
    const cmd = commandRegistry.resolve('/twins');
    expect(cmd!.name).toBe('/twins');
    expect(cmd!.aliases).toContain('/twin_leaderboard');
    expect(cmd!.category).toBe('LRN');
    expect(cmd!.riskLevel).toBe(0);
  });
});
