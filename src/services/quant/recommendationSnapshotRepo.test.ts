/**
 * @responsibility recommendationSnapshotRepo 회귀 테스트 (ADR-0019 PR-B)
 */
import { describe, it, expect } from 'vitest';
import {
  buildSnapshotFromRecommendation,
  captureSnapshot,
  captureSnapshots,
  markSnapshotOpen,
  markSnapshotClosed,
  expireStaleSnapshots,
  computeSnapshotStats,
  getRecentSnapshots,
  canTransition,
  SNAPSHOT_EXPIRY_MS,
  SNAPSHOT_MAX_RETAINED,
} from './recommendationSnapshotRepo';
import { CHECKLIST_TO_CONDITION_ID } from './checklistToConditionScores';
import type { RecommendationSnapshot } from '../../types/portfolio';
import type { StockRecommendation } from '../stock/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeStockRecommendation(
  overrides: Partial<StockRecommendation> = {},
): StockRecommendation {
  // 27 필드 모두 0 으로 초기화 후 일부 override
  const checklist = Object.fromEntries(
    Object.keys(CHECKLIST_TO_CONDITION_ID).map(k => [k, 0]),
  ) as StockRecommendation['checklist'];

  return {
    name: '삼성전자',
    code: 'A005930',
    type: 'STRONG_BUY',
    reason: '테스트',
    patterns: [],
    hotness: 80,
    roeType: 'TYPE_3',
    isLeadingSector: true,
    momentumRank: 1,
    supplyQuality: { passive: true, active: true },
    peakPrice: 75000,
    currentPrice: 70000,
    isPreviousLeader: false,
    ichimokuStatus: 'ABOVE_CLOUD',
    relatedSectors: ['반도체'],
    valuation: { per: 12, pbr: 1.5, epsGrowth: 20, debtRatio: 30 },
    technicalSignals: {
      maAlignment: 'BULLISH', rsi: 60, macdStatus: 'GOLDEN_CROSS',
      bollingerStatus: 'NEUTRAL', stochasticStatus: 'NEUTRAL',
      volumeSurge: true, disparity20: 1.05, macdHistogram: 0.3,
      bbWidth: 0.05, stochRsi: 0.6,
    },
    economicMoat: { type: 'SCALE', description: '' },
    scores: { value: 70, momentum: 80 },
    marketSentiment: { iri: 50, vkospi: 18 },
    confidenceScore: 85,
    marketCap: 5000000,
    marketCapCategory: 'LARGE',
    correlationGroup: 'SEMI',
    aiConvictionScore: { totalScore: 85, factors: [], marketPhase: 'BULL', description: '' },
    riskFactors: [],
    targetPrice: 84000,
    stopLoss: 64400,
    checklist,
    visualReport: { financial: 80, technical: 80, supply: 80, summary: '' },
    ...overrides,
  } as StockRecommendation;
}

function makeSnapshot(
  overrides: Partial<RecommendationSnapshot> = {},
): RecommendationSnapshot {
  return {
    id: `rec-snap-${Date.now()}-A005930`,
    recommendedAt: new Date().toISOString(),
    stockCode: 'A005930',
    stockName: '삼성전자',
    recommendation: 'STRONG_BUY',
    entryPrice: 70000,
    targetPrice: 84000,
    stopLossPrice: 64400,
    rrr: 2.5,
    conditionScores: {} as Record<import('../../types/core').ConditionId, number>,
    conditionSources: {} as Record<import('../../types/core').ConditionId, 'COMPUTED' | 'AI'>,
    gate1Score: 10,
    gate2Score: 15,
    gate3Score: 10,
    finalScore: 35,
    status: 'PENDING',
    schemaVersion: 1,
    ...overrides,
  };
}

// ─── State machine ─────────────────────────────────────────────────────────

describe('canTransition — 상태 전이 매트릭스', () => {
  it('PENDING → OPEN/EXPIRED 만 허용', () => {
    expect(canTransition('PENDING', 'OPEN')).toBe(true);
    expect(canTransition('PENDING', 'EXPIRED')).toBe(true);
    expect(canTransition('PENDING', 'CLOSED')).toBe(false);
  });

  it('OPEN → CLOSED 만 허용', () => {
    expect(canTransition('OPEN', 'CLOSED')).toBe(true);
    expect(canTransition('OPEN', 'PENDING')).toBe(false);
    expect(canTransition('OPEN', 'EXPIRED')).toBe(false);
  });

  it('CLOSED / EXPIRED 는 어떤 상태로도 전이 불가 (terminal)', () => {
    expect(canTransition('CLOSED', 'OPEN')).toBe(false);
    expect(canTransition('CLOSED', 'PENDING')).toBe(false);
    expect(canTransition('EXPIRED', 'OPEN')).toBe(false);
    expect(canTransition('EXPIRED', 'CLOSED')).toBe(false);
  });
});

// ─── buildSnapshotFromRecommendation ───────────────────────────────────────

describe('buildSnapshotFromRecommendation', () => {
  it('StockRecommendation 을 PENDING snapshot 으로 변환', () => {
    const stock = makeStockRecommendation();
    const snap = buildSnapshotFromRecommendation(stock, new Date('2026-04-26T00:00:00.000Z'));

    expect(snap.stockCode).toBe('A005930');
    expect(snap.stockName).toBe('삼성전자');
    expect(snap.recommendation).toBe('STRONG_BUY');
    expect(snap.entryPrice).toBe(70000);
    expect(snap.targetPrice).toBe(84000);
    expect(snap.stopLossPrice).toBe(64400);
    expect(snap.rrr).toBeCloseTo((84000 - 70000) / (70000 - 64400), 2);
    expect(snap.status).toBe('PENDING');
    expect(snap.confluence).toBe(85);
    expect(snap.sector).toBe('반도체');
    expect(snap.schemaVersion).toBe(1);
    expect(snap.id).toContain('A005930');
  });

  it('NEUTRAL/STRONG_SELL 등 모든 type 정상 매핑', () => {
    const sell = buildSnapshotFromRecommendation(makeStockRecommendation({ type: 'STRONG_SELL' }));
    expect(sell.recommendation).toBe('STRONG_SELL');
  });

  it('targetPrice/stopLoss 가 0 이거나 부재 시 rrr undefined', () => {
    const stock = makeStockRecommendation({ targetPrice: 0, stopLoss: 0 });
    const snap = buildSnapshotFromRecommendation(stock);
    expect(snap.targetPrice).toBeUndefined();
    expect(snap.stopLossPrice).toBeUndefined();
    expect(snap.rrr).toBeUndefined();
  });
});

// ─── captureSnapshot — 중복 방지 ─────────────────────────────────────────

describe('captureSnapshot — 중복 방지 + FIFO trim', () => {
  it('빈 배열에 추가 → 1건', () => {
    const snap = makeSnapshot();
    const next = captureSnapshot([], snap);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(snap.id);
  });

  it('동일 stockCode PENDING 이미 있으면 무시', () => {
    const a = makeSnapshot({ id: 'a', recommendedAt: '2026-04-26T00:00:00.000Z' });
    const b = makeSnapshot({ id: 'b', recommendedAt: '2026-04-26T01:00:00.000Z' });
    const after = captureSnapshot([a], b);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('a'); // 기존 보존
  });

  it('동일 stockCode OPEN 도 새 capture 차단 (양방향 추적 보호)', () => {
    const open = makeSnapshot({ id: 'open', status: 'OPEN' });
    const newPending = makeSnapshot({ id: 'new' });
    const after = captureSnapshot([open], newPending);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('open');
  });

  it('CLOSED/EXPIRED 만 있으면 새 capture 허용 (재추천 가능)', () => {
    const closed = makeSnapshot({ id: 'closed', status: 'CLOSED' });
    const newPending = makeSnapshot({ id: 'new' });
    const after = captureSnapshot([closed], newPending);
    expect(after).toHaveLength(2);
  });

  it(`1000건 초과 시 FIFO trim`, () => {
    const old: RecommendationSnapshot[] = Array.from({ length: SNAPSHOT_MAX_RETAINED }, (_, i) =>
      makeSnapshot({ id: `old-${i}`, stockCode: `OLD${i}`, status: 'CLOSED' }),
    );
    const newSnap = makeSnapshot({ id: 'new', stockCode: 'NEW' });
    const after = captureSnapshot(old, newSnap);
    expect(after).toHaveLength(SNAPSHOT_MAX_RETAINED);
    expect(after[0].id).toBe('old-1'); // 가장 오래된 1건 trim
    expect(after[after.length - 1].id).toBe('new');
  });
});

// ─── markSnapshotOpen / markSnapshotClosed ────────────────────────────────

describe('markSnapshotOpen', () => {
  it('PENDING → OPEN 전이 + tradeId 연결 + openedAt 기록', () => {
    const pending = makeSnapshot({ id: 's1', status: 'PENDING' });
    const after = markSnapshotOpen([pending], 'A005930', 'trade-123', new Date('2026-04-26T01:00:00.000Z'));
    expect(after[0].status).toBe('OPEN');
    expect(after[0].tradeId).toBe('trade-123');
    expect(after[0].openedAt).toBe('2026-04-26T01:00:00.000Z');
  });

  it('매칭 PENDING 없으면 입력 그대로 반환 (no-op)', () => {
    const closed = makeSnapshot({ status: 'CLOSED' });
    const after = markSnapshotOpen([closed], 'A005930', 'trade-123');
    expect(after).toEqual([closed]);
  });

  it('OPEN 상태 snapshot 은 markOpen 무시 (중복 매수 방지)', () => {
    const open = makeSnapshot({ status: 'OPEN', tradeId: 'old-trade' });
    const after = markSnapshotOpen([open], 'A005930', 'new-trade');
    expect(after[0].tradeId).toBe('old-trade');
  });
});

describe('markSnapshotClosed', () => {
  it('OPEN → CLOSED 전이 + realizedReturnPct + closedAt 기록', () => {
    const open = makeSnapshot({ status: 'OPEN', tradeId: 'trade-123' });
    const after = markSnapshotClosed([open], 'trade-123', 12.34, new Date('2026-04-26T02:00:00.000Z'));
    expect(after[0].status).toBe('CLOSED');
    expect(after[0].realizedReturnPct).toBe(12.34);
    expect(after[0].closedAt).toBe('2026-04-26T02:00:00.000Z');
  });

  it('NaN/Infinity returnPct → 0 fallback', () => {
    const open = makeSnapshot({ status: 'OPEN', tradeId: 'trade-123' });
    const after = markSnapshotClosed([open], 'trade-123', NaN);
    expect(after[0].realizedReturnPct).toBe(0);
  });

  it('매칭 OPEN 없으면 no-op (PENDING 도 직접 CLOSED 차단)', () => {
    const pending = makeSnapshot({ status: 'PENDING', tradeId: 'trade-123' });
    const after = markSnapshotClosed([pending], 'trade-123', 5);
    expect(after[0].status).toBe('PENDING');
    expect(after[0].realizedReturnPct).toBeUndefined();
  });
});

// ─── expireStaleSnapshots ──────────────────────────────────────────────────

describe('expireStaleSnapshots', () => {
  it('30일 경과 PENDING → EXPIRED 일괄 전이', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    const old = makeSnapshot({
      id: 'old',
      recommendedAt: new Date(now.getTime() - SNAPSHOT_EXPIRY_MS - 1000).toISOString(),
      status: 'PENDING',
    });
    const fresh = makeSnapshot({
      id: 'fresh',
      stockCode: 'B000660',
      recommendedAt: new Date(now.getTime() - 1000).toISOString(),
      status: 'PENDING',
    });
    const after = expireStaleSnapshots([old, fresh], now);
    expect(after.find(s => s.id === 'old')!.status).toBe('EXPIRED');
    expect(after.find(s => s.id === 'fresh')!.status).toBe('PENDING');
  });

  it('OPEN/CLOSED 는 만료 대상 아님 (사용자 행동 추적 중)', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    const old = new Date(now.getTime() - SNAPSHOT_EXPIRY_MS - 1000).toISOString();
    const oldOpen = makeSnapshot({ id: 'oo', recommendedAt: old, status: 'OPEN' });
    const oldClosed = makeSnapshot({ id: 'oc', stockCode: 'B', recommendedAt: old, status: 'CLOSED' });
    const after = expireStaleSnapshots([oldOpen, oldClosed], now);
    expect(after.find(s => s.id === 'oo')!.status).toBe('OPEN');
    expect(after.find(s => s.id === 'oc')!.status).toBe('CLOSED');
  });

  it('변경 없으면 동일 참조 반환 (zustand 불필요한 set 차단)', () => {
    const fresh = makeSnapshot({ recommendedAt: new Date().toISOString() });
    const input = [fresh];
    const after = expireStaleSnapshots(input);
    expect(after).toBe(input); // 같은 참조
  });
});

// ─── computeSnapshotStats ─────────────────────────────────────────────────

describe('computeSnapshotStats', () => {
  it('빈 배열 → 모든 카운트 0', () => {
    const stats = computeSnapshotStats([]);
    expect(stats.totalCount).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.adoptionRate).toBe(0);
  });

  it('lifecycle 카운트 분류 정확', () => {
    const data: RecommendationSnapshot[] = [
      makeSnapshot({ id: '1', stockCode: 'A', status: 'PENDING' }),
      makeSnapshot({ id: '2', stockCode: 'B', status: 'OPEN' }),
      makeSnapshot({ id: '3', stockCode: 'C', status: 'CLOSED', realizedReturnPct: 5 }),
      makeSnapshot({ id: '4', stockCode: 'D', status: 'CLOSED', realizedReturnPct: -3 }),
      makeSnapshot({ id: '5', stockCode: 'E', status: 'EXPIRED' }),
    ];
    const stats = computeSnapshotStats(data);
    expect(stats.totalCount).toBe(5);
    expect(stats.pendingCount).toBe(1);
    expect(stats.openCount).toBe(1);
    expect(stats.closedCount).toBe(2);
    expect(stats.expiredCount).toBe(1);
    expect(stats.hitRate).toBe(0.5);   // 1 win / 2 closed
    expect(stats.avgReturnClosed).toBe(1); // (5 - 3) / 2
    expect(stats.adoptionRate).toBe(0.6); // (1 OPEN + 2 CLOSED) / 5
  });

  it('등급별 hitRate 분리 — STRONG_BUY vs BUY', () => {
    const data: RecommendationSnapshot[] = [
      makeSnapshot({ id: '1', stockCode: 'A', recommendation: 'STRONG_BUY', status: 'CLOSED', realizedReturnPct: 10 }),
      makeSnapshot({ id: '2', stockCode: 'B', recommendation: 'STRONG_BUY', status: 'CLOSED', realizedReturnPct: 5 }),
      makeSnapshot({ id: '3', stockCode: 'C', recommendation: 'STRONG_BUY', status: 'CLOSED', realizedReturnPct: -2 }),
      makeSnapshot({ id: '4', stockCode: 'D', recommendation: 'BUY', status: 'CLOSED', realizedReturnPct: 8 }),
      makeSnapshot({ id: '5', stockCode: 'E', recommendation: 'BUY', status: 'CLOSED', realizedReturnPct: -5 }),
    ];
    const stats = computeSnapshotStats(data);
    expect(stats.strongBuyHitRate).toBeCloseTo(2 / 3, 4);
    expect(stats.buyHitRate).toBe(0.5);
  });
});

// ─── getRecentSnapshots ────────────────────────────────────────────────────

describe('getRecentSnapshots', () => {
  it('recommendedAt 내림차순 + limit', () => {
    const data: RecommendationSnapshot[] = [
      makeSnapshot({ id: 'old', stockCode: 'A', recommendedAt: '2026-01-01T00:00:00.000Z' }),
      makeSnapshot({ id: 'mid', stockCode: 'B', recommendedAt: '2026-02-01T00:00:00.000Z' }),
      makeSnapshot({ id: 'new', stockCode: 'C', recommendedAt: '2026-03-01T00:00:00.000Z' }),
    ];
    const recent = getRecentSnapshots(data, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('new');
    expect(recent[1].id).toBe('mid');
  });
});

// ─── captureSnapshots (다건 일괄) ──────────────────────────────────────────

describe('captureSnapshots — 다건 일괄 + dedupe', () => {
  it('동일 종목 다건 추천 시 첫번째만 capture', () => {
    const stocks = [
      makeStockRecommendation({ code: 'A005930' }),
      makeStockRecommendation({ code: 'A005930' }), // 중복
      makeStockRecommendation({ code: 'B000660' }),
    ];
    const after = captureSnapshots([], stocks);
    expect(after).toHaveLength(2);
    expect(after.map(s => s.stockCode).sort()).toEqual(['A005930', 'B000660']);
  });
});
