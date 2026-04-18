/**
 * operatorRouter.ts — 운용자 오버라이드 REST 엔드포인트
 *
 * POST /api/operator/override — Telegram 인라인 버튼과 동일한 3택을 API로도 노출.
 *   body: { action: 'EXPAND_UNIVERSE' | 'RELAX_THRESHOLD' | 'HOLD', context?: string }
 *   response: { ok, data: OverrideResult }
 *
 * GET  /api/operator/override/status — 현재 활성 오버라이드 + 오늘 사용량 + Gate delta 스냅샷.
 * GET  /api/operator/override/history — 최근 20건 감사 로그.
 *
 * 인증: API 키(env OPERATOR_API_KEY). 미설정 시 로컬 전용으로 간주되어 통과.
 * Telegram 웹훅은 webhookHandler에서 이미 chat_id로 인증되므로 이 라우터를 경유하지 않는다.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok, err, asyncHandler, validate } from '../utils/apiResponse.js';
import { executeOverride } from '../orchestrator/overrideExecutor.js';
import {
  canApplyToday,
  getActiveOverride,
  listRecentOverrides,
} from '../persistence/overrideLedger.js';
import { getRuntimeThresholdSnapshot } from '../trading/gateConfig.js';

const router = Router();

const OverrideBodySchema = z.object({
  action: z.enum(['EXPAND_UNIVERSE', 'RELAX_THRESHOLD', 'HOLD']),
  context: z.string().max(200).optional(),
});

/**
 * 인증 미들웨어. OPERATOR_API_KEY 미설정 시 개발 편의상 통과.
 * 설정된 경우 Authorization: Bearer <key> 또는 x-operator-key 헤더 필요.
 */
function requireOperatorAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.OPERATOR_API_KEY;
  if (!expected) {
    next();
    return;
  }
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const xkey = String(req.headers['x-operator-key'] ?? '');
  if (bearer === expected || xkey === expected) {
    next();
    return;
  }
  err(res, 401, 'UNAUTHORIZED', 'OPERATOR_API_KEY 불일치');
}

router.post(
  '/override',
  requireOperatorAuth,
  validate(OverrideBodySchema, 'body'),
  asyncHandler(async (req, res) => {
    const { action, context } = req.body as z.infer<typeof OverrideBodySchema>;
    const result = await executeOverride({
      action,
      context: context ?? 'api',
      source: 'api:/api/operator/override',
    });
    // 가드 차단·한도 초과는 HTTP 409, 성공/noop은 200
    if (result.status === 'REJECTED') {
      err(res, 409, 'OVERRIDE_REJECTED', result.summary, result.detail);
      return;
    }
    ok(res, result);
  }),
);

router.get(
  '/override/status',
  requireOperatorAuth,
  (_req: Request, res: Response) => {
    ok(res, {
      dailyUsage: canApplyToday(),
      active: getActiveOverride(),
      gateThreshold: getRuntimeThresholdSnapshot(),
    });
  },
);

router.get(
  '/override/history',
  requireOperatorAuth,
  (_req: Request, res: Response) => {
    ok(res, { entries: listRecentOverrides(20) });
  },
);

export default router;
