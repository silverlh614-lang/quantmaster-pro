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

export default router;
