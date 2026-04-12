// server/routes/failurePatternRouter.ts
// 반실패 패턴 DB API 라우터

import { Router, Request, Response } from 'express';
import {
  checkFailurePattern,
  saveFailureSnapshot,
  getFailurePatternCount,
  type FailurePatternEntry,
} from '../learning/failurePatternDB.js';
import { loadFailurePatterns } from '../persistence/failurePatternRepo.js';

const router = Router();

/**
 * GET /api/failure-patterns
 * 저장된 실패 패턴 목록 반환 (최근 50건)
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const patterns = loadFailurePatterns();
    res.json({
      count: patterns.length,
      patterns: patterns.slice(-50).reverse(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load failure patterns', details: error.message });
  }
});

/**
 * POST /api/failure-patterns/check
 * 신규 후보 조건 벡터와 실패 패턴 DB를 비교하여 경고 반환
 *
 * Body: { conditionScores: Record<number, number> }
 */
router.post('/check', (req: Request, res: Response) => {
  try {
    const { conditionScores } = req.body as { conditionScores?: Record<number, number> };
    if (!conditionScores || typeof conditionScores !== 'object') {
      return res.status(400).json({ error: 'conditionScores 필요' });
    }
    const warning = checkFailurePattern(conditionScores);
    res.json(warning);
  } catch (error: any) {
    res.status(500).json({ error: 'Failure pattern check failed', details: error.message });
  }
});

/**
 * POST /api/failure-patterns/save
 * 손절된 포지션의 진입 스냅샷을 DB에 저장
 *
 * Body: FailurePatternEntry
 */
router.post('/save', (req: Request, res: Response) => {
  try {
    const entry = req.body as FailurePatternEntry;
    if (!entry.stockCode || !entry.conditionScores) {
      return res.status(400).json({ error: 'stockCode, conditionScores 필요' });
    }
    // savedAt 자동 설정
    entry.savedAt = new Date().toISOString();
    saveFailureSnapshot(entry);
    res.json({
      success: true,
      totalPatterns: getFailurePatternCount(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save failure pattern', details: error.message });
  }
});

export default router;
