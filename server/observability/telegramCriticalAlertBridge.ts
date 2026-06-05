// @responsibility Bridge P0 operational warnings to compact Telegram operations alerts.

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { shouldEmitWarn } from './warnDedupStore.js';
import type { OperationalWarnPayload } from './operationalWarnTypes.js';

function telegramDedupKey(payload: OperationalWarnPayload): string {
  return `telegram:p0:${payload.code}:${payload.symbol ?? 'GLOBAL'}:${payload.mode ?? 'NA'}`;
}

/**
 * ADR-0573 후속: P0 operational warn 의 ack 흡수 패밀리 키.
 * 한 incident 가 여러 P0 코드(예: assertSettled 의 P0_BUY_SIGNAL_STUCK +
 * P0_SHADOW_EXECUTION_STUCK)를 동시에 내보내면 telegramDedupKey 가 코드별로 달라
 * 각각 T1 ack 으로 등록 → 재발송/60분 에스컬레이션이 incident 당 중복 발생한다.
 * correlationId(tradeId/orderIntentId) 또는 symbol+mode 로 묶어 같은 incident 의
 * 후속 P0 ack 이 이전 ack 을 흡수(registerPendingAck)하게 한다 → incident 당 활성
 * [확인] 1건. 식별자 부재(글로벌 P0)면 undefined → 기존 코드별 동작 보존(byte-equivalent).
 */
function ackFamilyKeyFor(payload: OperationalWarnPayload): string | undefined {
  if (payload.correlationId) return `op_warn_p0:corr:${payload.correlationId}`;
  if (payload.symbol) return `op_warn_p0:sym:${payload.symbol}:${payload.mode ?? 'NA'}`;
  return undefined;
}

export function formatTelegramCriticalWarn(payload: OperationalWarnPayload): string {
  return [
    `🚨 ${payload.priority} ${payload.domain}`,
    `code=${payload.code}`,
    payload.symbol ? `symbol=${payload.symbol}` : undefined,
    `impact=${payload.executionImpact}`,
    payload.mode ? `mode=${payload.mode}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function emitTelegramCriticalAlert(payload: OperationalWarnPayload): void {
  if (payload.priority !== 'P0') return;

  const dedupKey = telegramDedupKey(payload);
  const dedup = shouldEmitWarn(dedupKey, payload.ttlSec || 30);
  if (!dedup.allowed) return;

  void sendTelegramAlert(formatTelegramCriticalWarn(payload), {
    priority: 'CRITICAL',
    dedupeKey: dedupKey,
    cooldownMs: payload.ttlSec * 1000,
    category: 'OPERATIONAL_WARN_P0',
    ackFamilyKey: ackFamilyKeyFor(payload),
  }).catch((cause) => {
    console.warn('[P2][TELEGRAM][OPERATIONAL_WARN_TELEGRAM_FAILED] P0 compact alert delivery failed', {
      code: 'OPERATIONAL_WARN_TELEGRAM_FAILED',
      cause: cause instanceof Error ? { name: cause.name, message: cause.message, stack: cause.stack } : cause,
    });
  });
}
