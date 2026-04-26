/**
 * @responsibility 조건별 수익률 귀인 통계 GET 엔드포인트 (ADR-0025 PR-H)
 */

import { Router, Request, Response } from 'express';
import {
  computeAttributionStats,
  loadAttributionRecords,
} from '../persistence/attributionRepo.js';

const router = Router();

router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = computeAttributionStats();
    const totalRecords = loadAttributionRecords().length;
    res.json({ stats, totalRecords });
  } catch (e) {
    console.error('[attributionRouter] /stats 실패:', e);
    res.status(500).json({ error: 'attribution_stats_failed' });
  }
});

export default router;
