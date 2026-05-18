import type { KisOrderKind, OrderGatewayMetadata, OrderGatewayResult } from './kisOrderTypes.js';
import type { KisOrderErrorClassification } from './kisOrderErrorClassifier.js';
import { emitKisOrderOperationalWarn } from './kisOrderOperationalWarn.js';

export interface NormalizeKisOrderResultInput extends OrderGatewayMetadata {
  raw: unknown;
  orderKind: KisOrderKind;
  fallbackOrdNo?: string;
  context?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getString(record: Record<string, unknown> | null, keys: readonly string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function outputOf(raw: unknown): Record<string, unknown> | null {
  const record = asRecord(raw);
  return asRecord(record?.output) ?? record;
}

function extractOrdNo(raw: unknown): string | undefined {
  const root = asRecord(raw);
  const output = outputOf(raw);
  return (
    getString(output, ['ODNO', 'odno', 'ordNo', 'ORD_NO', 'orderNo', 'orgn_odno', 'ORGN_ODNO'])
    ?? getString(root, ['ODNO', 'odno', 'ordNo', 'ORD_NO', 'orderNo'])
  );
}

function rejectedReason(raw: unknown): string | null {
  const record = asRecord(raw);
  if (!record) return null;
  const rtCd = getString(record, ['rt_cd', 'rtCd', 'RT_CD']);
  if (rtCd && rtCd !== '0') {
    return getString(record, ['msg1', 'message', 'msg_cd', 'MSG1', 'MSG_CD']) ?? `KIS_REJECTED_${rtCd}`;
  }
  const output = asRecord(record.output);
  const reject = getString(output, ['rjct_yn', 'RJCT_YN']);
  if (reject === 'Y') {
    return getString(output, ['rjct_rson', 'RJCT_RSON', 'rjct_rson_name', 'RJCT_RSON_NAME']) ?? 'KIS_ORDER_REJECTED';
  }
  return null;
}

function withMetadata<T extends OrderGatewayResult>(
  result: T,
  metadata: OrderGatewayMetadata,
): T {
  return {
    ...result,
    ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
    ...(metadata.orderIntentId ? { orderIntentId: metadata.orderIntentId } : {}),
  };
}

function warnCodeForUnmapped(orderKind: KisOrderKind): 'P0_KIS_OCO_ORDER_FAILED' | 'P0_KIS_ORDER_RESULT_UNMAPPED' {
  return orderKind === 'OCO_STOP_LOSS' || orderKind === 'OCO_TAKE_PROFIT'
    ? 'P0_KIS_OCO_ORDER_FAILED'
    : 'P0_KIS_ORDER_RESULT_UNMAPPED';
}

export function normalizeKisOrderResult(input: NormalizeKisOrderResultInput): OrderGatewayResult {
  const metadata = {
    correlationId: input.correlationId,
    orderIntentId: input.orderIntentId,
  };

  const rejected = rejectedReason(input.raw);
  if (rejected) {
    emitKisOrderOperationalWarn({
      code: 'P0_KIS_ORDER_REJECTED',
      message: 'KIS order rejected by gateway response',
      context: {
        orderKind: input.orderKind,
        reason: rejected,
        executionImpact: 'LIVE_ORDER_BLOCKED',
        ...input.context,
      },
    });
    return withMetadata({
      kind: 'REJECTED',
      reason: rejected,
      executionImpact: 'LIVE_ORDER_BLOCKED',
      raw: input.raw,
    }, metadata);
  }

  const ordNo = extractOrdNo(input.raw) ?? input.fallbackOrdNo;
  if (input.orderKind === 'CANCEL') {
    if (ordNo) {
      return withMetadata({ kind: 'CANCEL_SUBMITTED', ordNo, raw: input.raw }, metadata);
    }
    return withMetadata({
      kind: 'CANCEL_FAILED',
      reason: 'KIS_CANCEL_RESULT_UNMAPPED',
      raw: input.raw,
    }, metadata);
  }

  if (ordNo) {
    return withMetadata({
      kind: 'SUBMITTED',
      ordNo,
      raw: input.raw,
    }, metadata);
  }

  emitKisOrderOperationalWarn({
    code: warnCodeForUnmapped(input.orderKind),
    message: 'KIS order result could not be mapped to a submitted order',
    context: {
      orderKind: input.orderKind,
      executionImpact: 'LIVE_ORDER_BLOCKED',
      ...input.context,
    },
    cause: input.raw,
  });
  return withMetadata({
    kind: 'FAILED_FATAL',
    reason: 'KIS_ORDER_RESULT_UNMAPPED',
    executionImpact: 'LIVE_ORDER_BLOCKED',
    raw: input.raw,
  }, metadata);
}

export function normalizeKisOrderError(
  classification: KisOrderErrorClassification,
  metadata: OrderGatewayMetadata = {},
): OrderGatewayResult {
  switch (classification.kind) {
    case 'CONFIG_MISSING':
      return withMetadata({
        kind: 'SKIPPED_KIS_NOT_CONFIGURED',
        executionImpact: 'LIVE_ORDER_BLOCKED',
      }, metadata);
    case 'RATE_LIMITED':
    case 'RETRYABLE_SERVER_ERROR':
      return withMetadata({
        kind: 'FAILED_RETRYABLE',
        reason: classification.reason,
        ...(classification.retryAfterMs !== undefined ? { retryAfterMs: classification.retryAfterMs } : {}),
        raw: classification.raw,
      }, metadata);
    case 'REJECTED':
      return withMetadata({
        kind: 'REJECTED',
        reason: classification.reason,
        executionImpact: 'LIVE_ORDER_BLOCKED',
        raw: classification.raw,
      }, metadata);
    case 'AUTH_FAILED':
    case 'FATAL':
      return withMetadata({
        kind: 'FAILED_FATAL',
        reason: classification.reason,
        executionImpact: 'LIVE_ORDER_BLOCKED',
        raw: classification.raw,
      }, metadata);
  }
}
