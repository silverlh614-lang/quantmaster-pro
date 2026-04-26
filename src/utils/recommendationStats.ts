// @responsibility 추천 이력 records → signalType + period 분리 통계 계산 (ADR-0034 PR-G)

import type { ClientRecommendationRecord } from '../api/recommendationsClient';

export type StatsPeriod = '7d' | '30d' | '90d' | 'ALL';

export interface BreakdownStats {
  total: number;
  wins: number;
  losses: number;
  expired: number;
  pending: number;
  /** wins / (wins + losses), expired/pending 제외. closed 표본 0건이면 null. */
  winRate: number | null;
  /** 단순 평균 수익률 (closed 만). */
  avgReturn: number | null;
  /** 표본 신뢰 가능 (closed ≥ 5건). */
  sampleSufficient: boolean;
}

const PERIOD_DAYS: Record<StatsPeriod, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  'ALL': null,
};

const MIN_SAMPLE = 5;

function isWithinPeriod(rec: ClientRecommendationRecord, period: StatsPeriod, now: number): boolean {
  const days = PERIOD_DAYS[period];
  if (days == null) return true;
  if (!rec.signalTime) return false;
  const t = Date.parse(rec.signalTime);
  if (!Number.isFinite(t)) return false;
  return (now - t) <= days * 24 * 60 * 60 * 1000;
}

function emptyStats(): BreakdownStats {
  return {
    total: 0, wins: 0, losses: 0, expired: 0, pending: 0,
    winRate: null, avgReturn: null, sampleSufficient: false,
  };
}

function computeStats(records: ClientRecommendationRecord[]): BreakdownStats {
  if (records.length === 0) return emptyStats();
  let wins = 0, losses = 0, expired = 0, pending = 0;
  let returnSum = 0, returnCount = 0;
  for (const r of records) {
    if (r.status === 'WIN') wins += 1;
    else if (r.status === 'LOSS') losses += 1;
    else if (r.status === 'EXPIRED') expired += 1;
    else if (r.status === 'PENDING') pending += 1;
    if ((r.status === 'WIN' || r.status === 'LOSS') && typeof r.actualReturn === 'number' && Number.isFinite(r.actualReturn)) {
      returnSum += r.actualReturn;
      returnCount += 1;
    }
  }
  const closed = wins + losses;
  const winRate = closed > 0 ? wins / closed : null;
  const avgReturn = returnCount > 0 ? returnSum / returnCount : null;
  return {
    total: records.length,
    wins, losses, expired, pending,
    winRate, avgReturn,
    sampleSufficient: closed >= MIN_SAMPLE,
  };
}

export interface SignalBreakdown {
  period: StatsPeriod;
  all: BreakdownStats;
  strongBuy: BreakdownStats;
  buy: BreakdownStats;
}

/**
 * records 를 기간 + signalType 별로 분리 통계 계산.
 * `now` 기본값은 `Date.now()` — 테스트에서 주입 가능.
 */
export function computeSignalBreakdown(
  records: ClientRecommendationRecord[],
  period: StatsPeriod,
  now: number = Date.now(),
): SignalBreakdown {
  const filtered = records.filter(r => isWithinPeriod(r, period, now));
  return {
    period,
    all: computeStats(filtered),
    strongBuy: computeStats(filtered.filter(r => r.signalType === 'STRONG_BUY')),
    buy: computeStats(filtered.filter(r => r.signalType === 'BUY')),
  };
}
