/**
 * @responsibility TimeBand 만료(remainingPct=0) ↔ repo EXPIRED 전이 동일 시점 기준 고정 (ADR-0019 후속 wiring D4)
 *
 * expiresAt 단일 출처 (recommendedAt + SNAPSHOT_EXPIRY_MS) 가 TimeBand 시각화와
 * recommendationSnapshotRepo.expireStaleSnapshots 양쪽에서 같은 기준 시각으로
 * 작동함을 cross-module 로 고정 — 이중 기준 금지.
 */
import { describe, it, expect } from 'vitest';
import { computeRemainingPct, classifyTimeBandGrade } from './TimeBand';
import {
  expireStaleSnapshots,
  getSnapshotExpiresAt,
  toTimeBandWindow,
  SNAPSHOT_EXPIRY_MS,
} from '../../services/quant/recommendationSnapshotRepo';
import type { RecommendationSnapshot } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

const RECOMMENDED_AT = '2026-05-01T09:00:00.000Z';

function makePendingSnapshot(): RecommendationSnapshot {
  return {
    id: 'rec-snap-1-A005930',
    recommendedAt: RECOMMENDED_AT,
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
  };
}

const expiresAtMs = new Date(RECOMMENDED_AT).getTime() + SNAPSHOT_EXPIRY_MS;

describe('TimeBand 만료 ↔ repo EXPIRED — 동일 시점 기준 (ADR-0019 D4)', () => {
  it('expiresAt 단일 출처 — getSnapshotExpiresAt = recommendedAt + SNAPSHOT_EXPIRY_MS', () => {
    expect(getSnapshotExpiresAt({ recommendedAt: RECOMMENDED_AT })).toBe(
      new Date(expiresAtMs).toISOString(),
    );
  });

  it('만료 1ms 전 — TimeBand 잔여 > 0 AND repo PENDING 유지', () => {
    const now = expiresAtMs - 1;
    const w = toTimeBandWindow(makePendingSnapshot())!;
    expect(computeRemainingPct(w.createdAt, w.expiresAt, now)).toBeGreaterThan(0);
    const after = expireStaleSnapshots([makePendingSnapshot()], new Date(now));
    expect(after[0].status).toBe('PENDING');
  });

  it('만료 1ms 후 — TimeBand remainingPct=0 (EXPIRED grade) AND repo EXPIRED 전이', () => {
    const now = expiresAtMs + 1;
    const w = toTimeBandWindow(makePendingSnapshot())!;
    const pct = computeRemainingPct(w.createdAt, w.expiresAt, now);
    expect(pct).toBe(0);
    expect(classifyTimeBandGrade(pct)).toBe('EXPIRED');
    const after = expireStaleSnapshots([makePendingSnapshot()], new Date(now));
    expect(after[0].status).toBe('EXPIRED');
  });

  it('경계 정확 시각 (now=expiresAt) — TimeBand 보수적 만료 표시 (0), repo 는 직후 ms 전이 (UI 가 repo 보다 늦게 만료를 표시하는 경우 없음)', () => {
    const w = toTimeBandWindow(makePendingSnapshot())!;
    expect(computeRemainingPct(w.createdAt, w.expiresAt, expiresAtMs)).toBe(0);
    // repo strict (now > expiresAt) — 같은 기준 시각, 포함성만 1ms 보수 방향 차이
    const atBoundary = expireStaleSnapshots([makePendingSnapshot()], new Date(expiresAtMs));
    expect(atBoundary[0].status).toBe('PENDING');
    const justAfter = expireStaleSnapshots([makePendingSnapshot()], new Date(expiresAtMs + 1));
    expect(justAfter[0].status).toBe('EXPIRED');
  });

  it('repo EXPIRED 전이 직후 snapshot 의 윈도 — TimeBand 도 EXPIRED grade (양방향 정합)', () => {
    const expired = expireStaleSnapshots([makePendingSnapshot()], new Date(expiresAtMs + 1))[0];
    expect(expired.status).toBe('EXPIRED');
    const w = toTimeBandWindow(expired)!;
    expect(w).not.toBeNull();
    const pct = computeRemainingPct(w.createdAt, w.expiresAt, expiresAtMs + 1);
    expect(classifyTimeBandGrade(pct)).toBe('EXPIRED');
  });
});
