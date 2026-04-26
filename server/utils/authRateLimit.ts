/**
 * @responsibility 차단된 IP 의 운영자 API 진입을 사전 차단하고 임계 도달 시 텔레그램 경보를 보낸다.
 *
 * 보안 패치 Tier 1 #3 — `requireOperatorToken` 의 토큰 검증 직전에 실행되는 preflight.
 * IP 가 이미 차단 상태면 403 즉시 반환, 차단되지 않은 경우 통과.
 *
 * 토큰 검증 후 401 → `recordAuthFailure` 호출은 `authGuard.requireOperatorToken` 책임.
 * 본 모듈은 "차단된 IP 의 진입 차단 + 새 차단 발생 시 알림" 한 가지 책임만 가진다.
 */

import type { Request, Response, NextFunction } from 'express';
import { isIpBlacklisted } from '../persistence/apiAuthBlacklistRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { extractClientIp } from './authGuard.js';

const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const _lastAlertAt = new Map<string, number>();

/** 신규 차단 발생 시 호출 — IP 별 1시간 dedupe + Telegram HIGH 발송. */
export async function notifyBruteForceBlock(ip: string, now: number = Date.now()): Promise<void> {
  const last = _lastAlertAt.get(ip) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) return;
  _lastAlertAt.set(ip, now);
  try {
    await sendTelegramAlert(
      `🛑 API 인증 무차별 대입 차단\nIP: <code>${ip}</code>\n5분 내 401 누적 임계 도달 → 1시간 차단`,
      { priority: 'HIGH', dedupeKey: `api_auth_block:${ip}`, cooldownMs: ALERT_COOLDOWN_MS },
    );
  } catch (e) {
    console.warn('[authRateLimit] 텔레그램 차단 알림 실패:', e instanceof Error ? e.message : e);
  }
}

/**
 * Preflight 미들웨어 — IP 가 블랙리스트면 403, 아니면 통과.
 * `requireOperatorToken` 보다 먼저 라우터 체인에 등록한다.
 */
export function enforceAuthRateLimit(req: Request, res: Response, next: NextFunction): void {
  if ((process.env.API_AUTH_BLACKLIST_DISABLED ?? '').toLowerCase() === 'true') {
    next();
    return;
  }
  const ip = extractClientIp(req);
  if (isIpBlacklisted(ip)) {
    res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    return;
  }
  next();
}

export const __testOnly = {
  resetAlertDedupe(): void {
    _lastAlertAt.clear();
  },
};
