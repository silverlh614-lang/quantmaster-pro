/**
 * @responsibility 추천 이력·월간 통계 GET 엔드포인트 (ADR-0019 PR-B)
 */

import { Router, Request, Response } from 'express';
import { getRecommendations, getMonthlyStats } from '../learning/recommendationTracker.js';

const router = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

router.get('/history', (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit);
  try {
    const all = getRecommendations();
    // 시간 역순 (signalTime ISO 문자열 비교)
    const sorted = [...all].sort((a, b) => (b.signalTime ?? '').localeCompare(a.signalTime ?? ''));
    res.json({
      total: all.length,
      limit,
      records: sorted.slice(0, limit),
    });
  } catch (e) {
    console.error('[recommendationsRouter] /history 실패:', e);
    res.status(500).json({ error: 'recommendation_history_failed' });
  }
});

router.get('/stats', (_req: Request, res: Response) => {
  try {
    const all = getRecommendations();
    const monthly = getMonthlyStats();
    const pendingCount = all.filter(r => r.status === 'PENDING').length;
    res.json({
      monthly,
      totalCount: all.length,
      pendingCount,
    });
  } catch (e) {
    console.error('[recommendationsRouter] /stats 실패:', e);
    res.status(500).json({ error: 'recommendation_stats_failed' });
  }
});

// ─── PR-M: 일별 시계열 (어제/오늘 비교) ────────────────────────────────────

export interface DailyTimeseriesPoint {
  /** YYYY-MM-DD (KST) */
  date: string;
  total: number;
  wins: number;
  losses: number;
  pending: number;
  expired: number;
  /** wins / (wins + losses), closed=0 시 null */
  winRate: number | null;
  /** WIN/LOSS 평균 actualReturn — 표본 0 시 null */
  avgReturn: number | null;
}

const ONE_DAY = 24 * 60 * 60 * 1000;

function kstDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 추천 records 를 KST 일자별 그룹핑하여 days 일치 시계열 반환.
 * - rangeEnd 기본 오늘 KST 자정
 * - days 기본 7
 * - rangeEnd 기준 (days-1) 일 전부터 rangeEnd 까지 inclusive
 * - 빈 일자도 0 카운트로 채워짐 (차트에서 누락 회피)
 */
export function buildRecommendationTimeseries(
  records: Array<{ signalTime?: string; status: string; actualReturn?: number }>,
  days: number,
  now: number = Date.now(),
): DailyTimeseriesPoint[] {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));

  // KST 자정 기준 시작점 정렬
  const nowKst = new Date(now + 9 * 3_600_000);
  const todayKstMidnightUtc = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 3_600_000;

  // 일자별 빈 슬롯 초기화
  const slots = new Map<string, DailyTimeseriesPoint>();
  for (let i = safeDays - 1; i >= 0; i -= 1) {
    const dayUtc = todayKstMidnightUtc - i * ONE_DAY;
    const key = new Date(dayUtc + 9 * 3_600_000).toISOString().slice(0, 10);
    slots.set(key, {
      date: key,
      total: 0, wins: 0, losses: 0, pending: 0, expired: 0,
      winRate: null, avgReturn: null,
    });
  }

  const returnSums = new Map<string, { sum: number; count: number }>();

  for (const rec of records) {
    const key = kstDateKey(rec.signalTime);
    if (!key) continue;
    const slot = slots.get(key);
    if (!slot) continue;
    slot.total += 1;
    if (rec.status === 'WIN') slot.wins += 1;
    else if (rec.status === 'LOSS') slot.losses += 1;
    else if (rec.status === 'PENDING') slot.pending += 1;
    else if (rec.status === 'EXPIRED') slot.expired += 1;
    if ((rec.status === 'WIN' || rec.status === 'LOSS') &&
        typeof rec.actualReturn === 'number' && Number.isFinite(rec.actualReturn)) {
      const cur = returnSums.get(key) ?? { sum: 0, count: 0 };
      cur.sum += rec.actualReturn;
      cur.count += 1;
      returnSums.set(key, cur);
    }
  }

  // winRate / avgReturn 계산
  for (const slot of slots.values()) {
    const closed = slot.wins + slot.losses;
    slot.winRate = closed > 0 ? slot.wins / closed : null;
    const r = returnSums.get(slot.date);
    slot.avgReturn = r && r.count > 0 ? r.sum / r.count : null;
  }

  return Array.from(slots.values()).sort((a, b) => a.date.localeCompare(b.date));
}

router.get('/timeseries', (req: Request, res: Response) => {
  const rawDays = Number(req.query.days);
  const days = Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(90, Math.floor(rawDays)) : 7;
  try {
    const all = getRecommendations();
    const series = buildRecommendationTimeseries(all, days);
    res.json({ days, series });
  } catch (e) {
    console.error('[recommendationsRouter] /timeseries 실패:', e);
    res.status(500).json({ error: 'recommendation_timeseries_failed' });
  }
});

export default router;
