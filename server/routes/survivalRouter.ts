/**
 * @responsibility GET /api/account/survival 엔드포인트 — SurvivalSnapshot read-only 노출
 */

import { Router, type Request, type Response } from 'express';
import { collectSurvivalSnapshot } from '../health/survival.js';

const router = Router();

router.get('/survival', async (_req: Request, res: Response) => {
  try {
    const snapshot = await collectSurvivalSnapshot();
    res.json(snapshot);
  } catch (e) {
    console.error('[survivalRouter] /survival 실패:', e);
    res.status(500).json({ error: 'survival_snapshot_failed' });
  }
});

export default router;
