/**
 * @responsibility RecommendationSnapshot CRUD + state machine + 통계 — 사용자 노출 추천 lifecycle SSOT
 *
 * ADR-0019 (PR-B): 추천 발령 시점부터 사용자 행동 (매수→매도) 까지 전 lifecycle
 * 추적. 클라이언트 zustand persist 영속. 서버 recommendationTracker (SHADOW
 * 자동매매 신호) 와 별개 모듈.
 */
import type { ConditionId } from '../../types/core';
import type {
  RecommendationSnapshot,
  SnapshotStats,
} from '../../types/portfolio';
import type { StockRecommendation } from '../stock/types';
import {
  checklistToConditionScores,
  approximateGateScores,
  getConditionSources,
} from './checklistToConditionScores';

/** 30일 EXPIRED 임계 (ms) */
export const SNAPSHOT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/** localStorage 1000건 hard cap (FIFO trim) */
export const SNAPSHOT_MAX_RETAINED = 1000;

const SNAPSHOT_SCHEMA_VERSION = 1;

// ─── State machine: status 전이 가능성 검사 ──────────────────────────────────

const ALLOWED_TRANSITIONS: Record<RecommendationSnapshot['status'], RecommendationSnapshot['status'][]> = {
  PENDING: ['OPEN', 'EXPIRED'],
  OPEN: ['CLOSED'],
  CLOSED: [],
  EXPIRED: [], // EXPIRED → 어떤 상태로도 전이 불가 (만료 추천으로는 성과 추적 불가)
};

export function canTransition(
  from: RecommendationSnapshot['status'],
  to: RecommendationSnapshot['status'],
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ─── 입력 변환 ───────────────────────────────────────────────────────────────

/**
 * StockRecommendation 으로부터 RecommendationSnapshot 생성 입력을 만든다.
 * id 와 status 는 자동 부여.
 */
export function buildSnapshotFromRecommendation(
  stock: StockRecommendation,
  now: Date = new Date(),
): RecommendationSnapshot {
  const conditionScores = checklistToConditionScores(stock.checklist);
  const conditionSources = getConditionSources();
  const gate = approximateGateScores(conditionScores);

  const targetPrice =
    typeof stock.targetPrice === 'number' && stock.targetPrice > 0 ? stock.targetPrice : undefined;
  const stopLossPrice =
    typeof stock.stopLoss === 'number' && stock.stopLoss > 0 ? stock.stopLoss : undefined;
  const entryPrice =
    typeof stock.currentPrice === 'number' && stock.currentPrice > 0 ? stock.currentPrice : 0;

  const rrr =
    targetPrice && stopLossPrice && entryPrice > stopLossPrice
      ? Number(((targetPrice - entryPrice) / (entryPrice - stopLossPrice)).toFixed(2))
      : undefined;

  const recommendation: RecommendationSnapshot['recommendation'] =
    stock.type === 'STRONG_BUY' || stock.type === 'BUY' || stock.type === 'STRONG_SELL' || stock.type === 'SELL'
      ? stock.type
      : 'NEUTRAL';

  return {
    id: `rec-snap-${now.getTime()}-${stock.code}`,
    recommendedAt: now.toISOString(),
    stockCode: stock.code,
    stockName: stock.name,
    recommendation,
    entryPrice,
    targetPrice,
    stopLossPrice,
    rrr,
    conditionScores,
    conditionSources,
    gate1Score: gate.g1,
    gate2Score: gate.g2,
    gate3Score: gate.g3,
    finalScore: gate.final,
    confluence: typeof stock.confidenceScore === 'number' ? stock.confidenceScore : undefined,
    sector: stock.relatedSectors?.[0],
    status: 'PENDING',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
}

// ─── CRUD + 상태 전이 — 순수 함수 (배열 in / 배열 out) ──────────────────────

/**
 * 신규 스냅샷을 추가한다. 동일 stockCode 의 PENDING/OPEN snapshot 이 이미
 * 있으면 무시 (idempotent). 1000건 hard cap 으로 FIFO trim.
 *
 * @returns 변경된 배열 (입력은 mutate 하지 않음)
 */
export function captureSnapshot(
  existing: RecommendationSnapshot[],
  candidate: RecommendationSnapshot,
): RecommendationSnapshot[] {
  const hasActive = existing.some(
    s => s.stockCode === candidate.stockCode && (s.status === 'PENDING' || s.status === 'OPEN'),
  );
  if (hasActive) return existing;

  const next = [...existing, candidate];
  if (next.length > SNAPSHOT_MAX_RETAINED) {
    return next.slice(next.length - SNAPSHOT_MAX_RETAINED);
  }
  return next;
}

/**
 * 여러 추천을 한 번에 capture (fetchStocks 완료 후 일괄 호출용).
 */
export function captureSnapshots(
  existing: RecommendationSnapshot[],
  stocks: StockRecommendation[],
  now: Date = new Date(),
): RecommendationSnapshot[] {
  let acc = existing;
  for (const stock of stocks) {
    const candidate = buildSnapshotFromRecommendation(stock, now);
    acc = captureSnapshot(acc, candidate);
  }
  return acc;
}

/**
 * stockCode 의 PENDING snapshot → OPEN 전이 + tradeId 연결.
 * 매칭되는 PENDING 이 없으면 입력 그대로 반환.
 */
export function markSnapshotOpen(
  existing: RecommendationSnapshot[],
  stockCode: string,
  tradeId: string,
  now: Date = new Date(),
): RecommendationSnapshot[] {
  const idx = existing.findIndex(s => s.stockCode === stockCode && s.status === 'PENDING');
  if (idx < 0) return existing;
  const target = existing[idx];
  if (!canTransition(target.status, 'OPEN')) return existing;
  const updated: RecommendationSnapshot = {
    ...target,
    status: 'OPEN',
    openedAt: now.toISOString(),
    tradeId,
  };
  return [...existing.slice(0, idx), updated, ...existing.slice(idx + 1)];
}

/**
 * tradeId 매칭 OPEN snapshot → CLOSED 전이 + realizedReturnPct 기록.
 */
export function markSnapshotClosed(
  existing: RecommendationSnapshot[],
  tradeId: string,
  realizedReturnPct: number,
  now: Date = new Date(),
): RecommendationSnapshot[] {
  const idx = existing.findIndex(s => s.tradeId === tradeId && s.status === 'OPEN');
  if (idx < 0) return existing;
  const target = existing[idx];
  if (!canTransition(target.status, 'CLOSED')) return existing;
  const updated: RecommendationSnapshot = {
    ...target,
    status: 'CLOSED',
    closedAt: now.toISOString(),
    realizedReturnPct: Number.isFinite(realizedReturnPct)
      ? Number(realizedReturnPct.toFixed(2))
      : 0,
  };
  return [...existing.slice(0, idx), updated, ...existing.slice(idx + 1)];
}

/**
 * 30일 경과 PENDING snapshot 을 EXPIRED 로 일괄 전이.
 * OPEN/CLOSED 는 만료 대상 아님 (사용자 행동 추적 중).
 */
export function expireStaleSnapshots(
  existing: RecommendationSnapshot[],
  now: Date = new Date(),
  expiryMs: number = SNAPSHOT_EXPIRY_MS,
): RecommendationSnapshot[] {
  const cutoff = now.getTime() - expiryMs;
  const nowIso = now.toISOString();
  let mutated = false;
  const next = existing.map(s => {
    if (s.status !== 'PENDING') return s;
    const recommendedMs = new Date(s.recommendedAt).getTime();
    if (!Number.isFinite(recommendedMs) || recommendedMs >= cutoff) return s;
    if (!canTransition(s.status, 'EXPIRED')) return s;
    mutated = true;
    return { ...s, status: 'EXPIRED' as const, expiredAt: nowIso };
  });
  return mutated ? next : existing;
}

// ─── 통계 ────────────────────────────────────────────────────────────────────

/**
 * 전체 snapshot 통계를 계산한다. 표본 0건 시 모든 비율은 0.
 */
export function computeSnapshotStats(snapshots: RecommendationSnapshot[]): SnapshotStats {
  const totalCount = snapshots.length;
  const pendingCount = snapshots.filter(s => s.status === 'PENDING').length;
  const openCount = snapshots.filter(s => s.status === 'OPEN').length;
  const closedCount = snapshots.filter(s => s.status === 'CLOSED').length;
  const expiredCount = snapshots.filter(s => s.status === 'EXPIRED').length;

  const closedSnapshots = snapshots.filter(s => s.status === 'CLOSED');
  const wins = closedSnapshots.filter(s => (s.realizedReturnPct ?? 0) > 0);
  const hitRate = closedCount > 0 ? wins.length / closedCount : 0;

  const closedStrongBuy = closedSnapshots.filter(s => s.recommendation === 'STRONG_BUY');
  const winsStrongBuy = closedStrongBuy.filter(s => (s.realizedReturnPct ?? 0) > 0);
  const strongBuyHitRate = closedStrongBuy.length > 0 ? winsStrongBuy.length / closedStrongBuy.length : 0;

  const closedBuy = closedSnapshots.filter(s => s.recommendation === 'BUY');
  const winsBuy = closedBuy.filter(s => (s.realizedReturnPct ?? 0) > 0);
  const buyHitRate = closedBuy.length > 0 ? winsBuy.length / closedBuy.length : 0;

  const avgReturnClosed =
    closedCount > 0
      ? closedSnapshots.reduce((s, snap) => s + (snap.realizedReturnPct ?? 0), 0) / closedCount
      : 0;

  // adoption: PENDING 이외 모든 status 가 사용자 행동 또는 자동 만료 결과. OPEN/CLOSED 만 진짜 채택.
  const adopted = openCount + closedCount;
  const adoptionRate = totalCount > 0 ? adopted / totalCount : 0;

  return {
    totalCount,
    pendingCount,
    openCount,
    closedCount,
    expiredCount,
    hitRate: Number(hitRate.toFixed(4)),
    strongBuyHitRate: Number(strongBuyHitRate.toFixed(4)),
    buyHitRate: Number(buyHitRate.toFixed(4)),
    avgReturnClosed: Number(avgReturnClosed.toFixed(2)),
    adoptionRate: Number(adoptionRate.toFixed(4)),
  };
}

/**
 * UI 표시용 — 최근 snapshot N건 (recommendedAt 내림차순).
 */
export function getRecentSnapshots(
  snapshots: RecommendationSnapshot[],
  limit: number = 50,
): RecommendationSnapshot[] {
  return [...snapshots]
    .sort((a, b) => new Date(b.recommendedAt).getTime() - new Date(a.recommendedAt).getTime())
    .slice(0, limit);
}

// ─── TimeBand 연동 (ADR-0019 후속 wiring — PENDING_WIRING D4) ────────────────

/**
 * TimeBand / VerdictCard 가 소비하는 시간 윈도 props 계약
 * (`TimeBand.createdAt` / `TimeBand.expiresAt`).
 */
export interface SnapshotTimeBandWindow {
  /** 추천 발령 시각 (= RecommendationSnapshot.recommendedAt) */
  createdAt: string;
  /** 만료 시각 — recommendedAt + SNAPSHOT_EXPIRY_MS 단일 출처 도출 */
  expiresAt: string;
}

/**
 * snapshot 만료 시각 단일 출처 — `recommendedAt + SNAPSHOT_EXPIRY_MS`.
 *
 * expireStaleSnapshots 의 30일 EXPIRED 전이와 *정확히 동일 상수·동일 기점*
 * (이중 기준 금지). 경계 포함성: TimeBand 는 now ≥ expiresAt 에 remainingPct=0
 * (보수적), repo 전이는 now > expiresAt — UI 가 repo 보다 늦게 만료를 표시하는
 * 경우는 없다 (1ms 단위 보수 방향 정렬, 회귀 테스트로 고정).
 *
 * @returns ISO 문자열. recommendedAt 이 유효하지 않으면 null (TimeBand 미표시).
 */
export function getSnapshotExpiresAt(
  snapshot: Pick<RecommendationSnapshot, 'recommendedAt'>,
  expiryMs: number = SNAPSHOT_EXPIRY_MS,
): string | null {
  const recommendedMs = new Date(snapshot.recommendedAt).getTime();
  if (!Number.isFinite(recommendedMs)) return null;
  return new Date(recommendedMs + expiryMs).toISOString();
}

/**
 * snapshot → TimeBand/VerdictCard props 어댑터.
 *
 * 만료가 적용되는 lifecycle 상태에만 윈도를 노출한다:
 * - PENDING: 30일 카운트다운 진행 중 → 윈도 노출
 * - EXPIRED: 이미 만료 → 윈도 노출 (TimeBand remainingPct=0, "재검증 대기")
 * - OPEN/CLOSED: repo 만료 대상 아님 (사용자 행동 추적 중) → null (띠 미표시 —
 *   띠가 줄어드는데 상태는 영원히 안 바뀌는 거짓 UI 차단)
 */
export function toTimeBandWindow(
  snapshot: Pick<RecommendationSnapshot, 'recommendedAt' | 'status'>,
): SnapshotTimeBandWindow | null {
  if (snapshot.status !== 'PENDING' && snapshot.status !== 'EXPIRED') return null;
  const expiresAt = getSnapshotExpiresAt(snapshot);
  if (expiresAt === null) return null;
  return { createdAt: snapshot.recommendedAt, expiresAt };
}
