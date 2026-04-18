// server/routes/failurePatternRouter.ts
// 반실패 패턴 DB API 라우터 — apiResponse + zod 표준 적용 예시

import { Router } from 'express';
import { z } from 'zod';
import {
  checkFailurePattern,
  saveFailureSnapshot,
  getFailurePatternCount,
} from '../learning/failurePatternDB.js';
import { loadFailurePatterns } from '../persistence/failurePatternRepo.js';
import { ok, asyncHandler, validateBody } from '../utils/apiResponse.js';

const router = Router();

// ── 요청 스키마 ──────────────────────────────────────────────────────────
const ConditionScoresSchema = z.record(z.coerce.number().int(), z.number().min(0).max(10));

const CheckBody = z.object({
  conditionScores: ConditionScoresSchema,
});

const SaveBody = z.object({
  id: z.string().min(1).optional(),
  stockCode: z.string().min(1),
  stockName: z.string().min(1),
  entryDate: z.string(),
  exitDate: z.string(),
  returnPct: z.number(),
  conditionScores: ConditionScoresSchema,
  gate1Score: z.number(),
  gate2Score: z.number(),
  gate3Score: z.number(),
  finalScore: z.number(),
  gate2PassCount: z.number().nullable().optional(),
  rsPercentile: z.number().nullable().optional(),
  vkospi: z.number().nullable().optional(),
  mtfScore: z.number().nullable().optional(),
  marketRegime: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
});

// ── 라우트 ────────────────────────────────────────────────────────────────

/**
 * GET /api/failure-patterns — 저장된 실패 패턴 목록 (최근 50건)
 */
router.get('/', asyncHandler(async (_req, res) => {
  const patterns = loadFailurePatterns();
  ok(res, {
    count: patterns.length,
    patterns: patterns.slice(-50).reverse(),
  });
}));

/**
 * POST /api/failure-patterns/check — 후보 조건 벡터 vs DB 코사인 유사도
 */
router.post('/check', validateBody(CheckBody), asyncHandler(async (req, res) => {
  const { conditionScores } = req.body as z.infer<typeof CheckBody>;
  const warning = checkFailurePattern(conditionScores);
  ok(res, warning);
}));

/**
 * POST /api/failure-patterns/save — 손절 스냅샷 저장
 */
router.post('/save', validateBody(SaveBody), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof SaveBody>;
  const entry = {
    ...body,
    id: body.id ?? `${body.stockCode}_${body.entryDate}`,
    savedAt: new Date().toISOString(),
  };
  saveFailureSnapshot(entry);
  ok(res, { totalPatterns: getFailurePatternCount() });
}));

export default router;
