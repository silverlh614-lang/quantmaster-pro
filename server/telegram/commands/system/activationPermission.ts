// @responsibility /approve_activation·/revoke_activation 운영자 게이팅 SSOT — allowlist 우선, 미설정 시 소유자 chat(TELEGRAM_CHAT_ID) fallback (ADR-0636 addendum). 신규 ENV 0.
import type { CommandContext } from '../_types.js';

function splitIds(value: string | undefined): string[] {
  return (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

/**
 * 활성화 승인/철회 운영자 게이팅. /strategy 의 resolveStrategyPermission 과 의도는 같으나
 * 단일 소유자 봇 사용성을 위해 **allowlist 미설정 시 소유자 chat fallback** 을 추가한다.
 *
 * 우선순위:
 *  1. TELEGRAM_OPERATOR_USER_IDS / TELEGRAM_ADMIN_USER_IDS 설정 시 → 엄격 allowlist 매칭만
 *     (운영자가 명시 allowlist 를 두면 그 규약을 그대로 존중 — 기존 strategy 동치).
 *  2. allowlist 미설정 시 → 소유자 chat(TELEGRAM_CHAT_ID)에서 온 메시지면 운영자로 인정.
 *     개인 단일 소유자 봇의 private 채널 = 소유자 본인이라는 강한 신호.
 *  3. 그 외(레거시/로컬/테스트) → userId 미상이면 통과, 'operator'/'admin'/'system' 리터럴 통과.
 *
 * /strategy(실거래 apply_live)는 본 함수를 쓰지 않는다 — 인증 완화는 활성화 승인 경로 한정.
 */
export function resolveActivationPermission(
  ctx: Pick<CommandContext, 'userId' | 'chatId'>,
): boolean {
  const operatorIds = splitIds(process.env.TELEGRAM_OPERATOR_USER_IDS);
  const adminIds = splitIds(process.env.TELEGRAM_ADMIN_USER_IDS);
  const userId = ctx.userId;

  // 1. allowlist 설정 시: 엄격 매칭 (기존 규약 보존).
  if (operatorIds.length || adminIds.length) {
    return !!userId && (operatorIds.includes(userId) || adminIds.includes(userId));
  }

  // 2. allowlist 미설정: 소유자 chat fallback.
  const ownerChatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (ownerChatId && (ctx.chatId ?? '').trim() === ownerChatId) return true;

  // 3. 레거시/로컬/테스트 폴백 (strategy rollback 규약 동치).
  if (!userId) return true;
  return userId === 'operator' || userId === 'admin' || userId === 'system';
}
