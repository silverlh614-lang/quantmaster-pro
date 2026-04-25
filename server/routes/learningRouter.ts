/**
 * @responsibility 운영자 진단용 학습 이력·상태 GET 엔드포인트를 제공한다.
 */

import { Router, Request, Response } from 'express';
import { getLearningStatus, getLearningHistory } from '../learning/learningHistorySummary.js';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  try {
    const snapshot = getLearningStatus();
    res.json(snapshot);
  } catch (e) {
    console.error('[learningRouter] /status 실패:', e);
    res.status(500).json({ error: 'learning_status_failed' });
  }
});

router.get('/history', (req: Request, res: Response) => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw >= 1 && raw <= 30 ? Math.floor(raw) : 7;
  try {
    const summary = getLearningHistory(days);
    res.json(summary);
  } catch (e) {
    console.error('[learningRouter] /history 실패:', e);
    res.status(500).json({ error: 'learning_history_failed' });
  }
});

export default router;
