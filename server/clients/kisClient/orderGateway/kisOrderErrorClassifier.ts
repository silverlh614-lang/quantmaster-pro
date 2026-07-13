/**
 * @responsibility KIS 주문 에러 분류기 — 응답·예외를 재시도·거부·치명 등 에러 종류로 판별한다.
 */

type KisOrderErrorKind =
  | 'CONFIG_MISSING'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'RETRYABLE_SERVER_ERROR'
  | 'REJECTED'
  | 'FATAL';

export interface KisOrderErrorClassification {
  kind: KisOrderErrorKind;
  reason: string;
  retryAfterMs?: number;
  raw?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function nested(record: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = record;
  for (const key of path) {
    const current = asRecord(cursor);
    if (!current) return undefined;
    cursor = current[key];
  }
  return cursor;
}

function extractStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  if (record) {
    const direct = numberFrom(record.status ?? record.statusCode ?? record.httpStatus);
    if (direct !== undefined) return direct;
    const responseStatus = numberFrom(nested(record, ['response', 'status']) ?? nested(record, ['response', 'statusCode']));
    if (responseStatus !== undefined) return responseStatus;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const statusMatch = message.match(/\b(40[0139]|429|5\d\d)\b/u);
  return statusMatch ? Number(statusMatch[1]) : undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  const record = asRecord(error);
  if (!record) return undefined;
  const direct = numberFrom(record.retryAfterMs);
  if (direct !== undefined) return direct;
  const retryAfter = numberFrom(nested(record, ['response', 'headers', 'retry-after']));
  if (retryAfter !== undefined) return retryAfter * 1000;
  return undefined;
}

function extractReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  if (typeof error === 'string' && error.trim().length > 0) return error.trim();
  const record = asRecord(error);
  if (record) {
    return (
      stringFrom(record.reason)
      ?? stringFrom(record.message)
      ?? stringFrom(record.msg1)
      ?? stringFrom(record.msg_cd)
      ?? stringFrom(nested(record, ['response', 'data', 'msg1']))
      ?? stringFrom(nested(record, ['response', 'data', 'message']))
      ?? 'KIS_ORDER_ERROR'
    );
  }
  return 'KIS_ORDER_ERROR';
}

function looksRejected(error: unknown): boolean {
  const record = asRecord(error);
  const reason = extractReason(error).toLowerCase();
  if (record) {
    const rtCd = stringFrom(record.rt_cd ?? record.rtCd ?? nested(record, ['response', 'data', 'rt_cd']));
    if (rtCd && rtCd !== '0') return true;
  }
  return reason.includes('reject') || reason.includes('거부') || reason.includes('주문불가');
}

export function classifyKisOrderError(error: unknown): KisOrderErrorClassification {
  const status = extractStatus(error);
  const reason = extractReason(error);
  const retryAfterMs = extractRetryAfterMs(error);

  if (status === 401 || status === 403) {
    return { kind: 'AUTH_FAILED', reason, raw: error };
  }
  if (status === 429) {
    return {
      kind: 'RATE_LIMITED',
      reason,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      raw: error,
    };
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return { kind: 'RETRYABLE_SERVER_ERROR', reason, raw: error };
  }
  if (looksRejected(error)) {
    return { kind: 'REJECTED', reason, raw: error };
  }
  return { kind: 'FATAL', reason, raw: error };
}

export function classifyMissingKisConfig(reason = 'KIS_APP_KEY_OR_SECRET_MISSING'): KisOrderErrorClassification {
  return { kind: 'CONFIG_MISSING', reason };
}
