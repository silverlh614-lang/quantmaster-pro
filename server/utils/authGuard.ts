/**
 * @responsibility Operator 권한이 필요한 라우트의 Bearer 토큰을 검증한다.
 *
 * 보안 패치 Tier 1 #1 — `/api/auto-trade/*`, `/api/operator/*`, `/api/emergency-*`
 * 등 시스템 제어 권한이 부여된 라우트 앞에 `router.use(requireOperatorToken)` 한 줄로
 * 적용한다. 토큰 미설정·불일치 모두 본 함수가 SSOT.
 *
 * Brute-force 방어는 `authRateLimit.enforceAuthRateLimit` (preflight) +
 * `apiAuthBlacklistRepo.recordAuthFailure` (401 시) 책임 — 본 모듈은 토큰 검증만 한다.
 */

import type { Request, Response, NextFunction } from 'express';
import { recordAuthFailure, resetAuthFailureCounter } from '../persistence/apiAuthBlacklistRepo.js';

/** Express req → 클라이언트 IP. proxy(Railway) 환경 X-Forwarded-For 우선, 없으면 socket. */
export function extractClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const ra = req.socket?.remoteAddress ?? req.ip ?? '';
  return String(ra || 'unknown');
}

/** Bearer / x-operator-token 헤더에서 토큰 추출. 실패 시 빈 문자열. */
export function extractToken(req: Request): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const xtok = req.headers['x-operator-token'];
  if (typeof xtok === 'string') return xtok.trim();
  return '';
}

/** 상수시간 비교 — 사이드채널 길이 누설 차단. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 미들웨어 — OPERATOR_TOKEN env 기반 Bearer 검증.
 *
 * - OPERATOR_TOKEN 미설정 + LIVE 모드: 401 (LIVE 가 무방비 노출되는 사고 차단).
 * - OPERATOR_TOKEN 미설정 + SHADOW/VTS: 통과 (개발 편의).
 * - 토큰 일치: 통과 + 누적 카운터 리셋.
 * - 불일치: 401 + recordAuthFailure(ip) → 임계 도달 시 다음 요청부터 enforceAuthRateLimit 가 차단.
 *
 * Brute-force 차단 알림은 `authRateLimit.notifyBruteForceBlock` 가 담당.
 * 본 미들웨어 자체는 알림을 보내지 않는다 (단일 책임).
 */
export function requireOperatorToken(req: Request, res: Response, next: NextFunction): void {
  const ip = extractClientIp(req);
  const expected = process.env.OPERATOR_TOKEN ?? '';

  if (!expected) {
    if (process.env.AUTO_TRADE_MODE === 'LIVE') {
      res.status(401).json({ ok: false, error: 'OPERATOR_TOKEN_NOT_SET' });
      return;
    }
    next();
    return;
  }

  const provided = extractToken(req);
  if (!provided || !constantTimeEquals(provided, expected)) {
    const blocked = recordAuthFailure(ip);
    if (blocked) {
      // dynamic import 로 순환 차단 (authRateLimit 가 본 모듈의 extractClientIp 를 사용).
      void import('./authRateLimit.js').then((m) => m.notifyBruteForceBlock(ip));
    }
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  resetAuthFailureCounter(ip);
  next();
}
