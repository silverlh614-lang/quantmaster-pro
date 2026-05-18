// @responsibility Bridge P0 operational warnings to compact Telegram operations alerts.

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { shouldEmitWarn } from './warnDedupStore.js';
import type { OperationalWarnPayload } from './operationalWarnTypes.js';

function telegramDedupKey(payload: OperationalWarnPayload): string {
  return `telegram:p0:${payload.code}:${payload.symbol ?? 'GLOBAL'}:${payload.mode ?? 'NA'}`;
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
  }).catch((cause) => {
    console.warn('[P2][TELEGRAM][OPERATIONAL_WARN_TELEGRAM_FAILED] P0 compact alert delivery failed', {
      code: 'OPERATIONAL_WARN_TELEGRAM_FAILED',
      cause: cause instanceof Error ? { name: cause.name, message: cause.message, stack: cause.stack } : cause,
    });
  });
}
