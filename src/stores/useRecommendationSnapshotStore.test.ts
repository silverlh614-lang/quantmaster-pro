/**
 * @responsibility useRecommendationSnapshotStore.getTimeBandWindow 회귀 (ADR-0019 후속 wiring D4)
 *
 * stockCode → 최신 snapshot lifecycle 기반 TimeBand 윈도 (createdAt/expiresAt)
 * selector 검증 — repo toTimeBandWindow 와 단일 출처 정합.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useRecommendationSnapshotStore } from './useRecommendationSnapshotStore';
import {
  getSnapshotExpiresAt,
} from '../services/quant/recommendationSnapshotRepo';
import type { RecommendationSnapshot } from '../types/portfolio';
import type { ConditionId } from '../types/core';

function makeSnapshot(
  overrides: Partial<RecommendationSnapshot> = {},
): RecommendationSnapshot {
  return {
    id: `rec-snap-${Date.now()}-A005930`,
    recommendedAt: '2026-05-01T09:00:00.000Z',
    stockCode: 'A005930',
    stockName: '삼성전자',
    recommendation: 'STRONG_BUY',
    entryPrice: 70000,
    conditionScores: {} as Record<ConditionId, number>,
    conditionSources: {} as Record<ConditionId, 'COMPUTED' | 'AI'>,
    gate1Score: 10,
    gate2Score: 15,
    gate3Score: 10,
    finalScore: 35,
    status: 'PENDING',
    schemaVersion: 1,
    ...overrides,
  };
}

beforeEach(() => {
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.clear();
  }
  useRecommendationSnapshotStore.getState().__resetForTests();
});

describe('getTimeBandWindow — stockCode 기반 TimeBand 윈도 selector', () => {
  it('PENDING snapshot → 윈도 반환 (expiresAt = recommendedAt + 30일 단일 출처)', () => {
    const snap = makeSnapshot();
    useRecommendationSnapshotStore.setState({ snapshots: [snap] });

    const w = useRecommendationSnapshotStore.getState().getTimeBandWindow('A005930');
    expect(w).not.toBeNull();
    expect(w!.createdAt).toBe(snap.recommendedAt);
    expect(w!.expiresAt).toBe(getSnapshotExpiresAt({ recommendedAt: snap.recommendedAt }));
  });

  it('snapshot 부재 stockCode → null', () => {
    expect(useRecommendationSnapshotStore.getState().getTimeBandWindow('Z999999')).toBeNull();
  });

  it('OPEN/CLOSED 최신 snapshot → null (만료 비대상 — 띠 미표시)', () => {
    useRecommendationSnapshotStore.setState({
      snapshots: [makeSnapshot({ id: 'o', status: 'OPEN', tradeId: 't-1' })],
    });
    expect(useRecommendationSnapshotStore.getState().getTimeBandWindow('A005930')).toBeNull();

    useRecommendationSnapshotStore.setState({
      snapshots: [makeSnapshot({ id: 'c', status: 'CLOSED', realizedReturnPct: 5 })],
    });
    expect(useRecommendationSnapshotStore.getState().getTimeBandWindow('A005930')).toBeNull();
  });

  it('동일 stockCode 다건 — 최신 recommendedAt snapshot 의 lifecycle 이 윈도 결정', () => {
    const oldExpired = makeSnapshot({
      id: 'old',
      recommendedAt: '2026-01-01T00:00:00.000Z',
      status: 'EXPIRED',
    });
    const newPending = makeSnapshot({
      id: 'new',
      recommendedAt: '2026-06-01T00:00:00.000Z',
      status: 'PENDING',
    });
    useRecommendationSnapshotStore.setState({ snapshots: [oldExpired, newPending] });

    const w = useRecommendationSnapshotStore.getState().getTimeBandWindow('A005930');
    expect(w).not.toBeNull();
    expect(w!.createdAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('expireStale 전이 후에도 EXPIRED 윈도 유지 (재검증 대기 표시 — repo 와 동일 시점 기준)', () => {
    const recommendedAt = '2026-01-01T00:00:00.000Z';
    useRecommendationSnapshotStore.setState({
      snapshots: [makeSnapshot({ recommendedAt, status: 'PENDING' })],
    });
    useRecommendationSnapshotStore.getState().expireStale();

    const state = useRecommendationSnapshotStore.getState();
    expect(state.snapshots[0].status).toBe('EXPIRED');
    const w = state.getTimeBandWindow('A005930');
    expect(w).not.toBeNull();
    expect(w!.expiresAt).toBe(getSnapshotExpiresAt({ recommendedAt }));
  });
});
