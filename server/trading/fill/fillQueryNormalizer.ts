import type { FillQueryOrder, FillQueryResult, NormalizedKisFillRow } from './fillTypes.js';

export interface KisDailyCcldResponse {
  output?: unknown;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function normalizeKisFillRows(raw: unknown): NormalizedKisFillRow[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const output = (raw as KisDailyCcldResponse).output;
  if (!Array.isArray(output)) return null;

  return output
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
    .map((row) => {
      const ordNo = getString(row, ['odno', 'ODNO', 'orgn_odno', 'ORGN_ODNO']);
      const orderQty = toNumber(row.ord_qty ?? row.ORD_QTY);
      const filledQty = toNumber(row.tot_ccld_qty ?? row.TOT_CCLD_QTY ?? row.ccld_qty ?? row.CCLD_QTY);
      const avgPrice = toNumber(row.avg_prvs ?? row.AVG_PRVS ?? row.avg_prc ?? row.AVG_PRC);
      const rejected = getString(row, ['rjct_yn', 'RJCT_YN']) === 'Y';
      const rejectReason = getString(row, ['rjct_rson', 'RJCT_RSON', 'rjct_rson_name', 'RJCT_RSON_NAME']);
      return {
        ordNo,
        orderQty,
        filledQty,
        ...(avgPrice > 0 ? { avgPrice } : {}),
        ...(rejected ? { rejected } : {}),
        ...(rejectReason ? { rejectReason } : {}),
        raw: row,
      };
    })
    .filter((row) => row.ordNo.length > 0);
}

export function normalizeFillQueryResult(input: {
  order: FillQueryOrder;
  raw: unknown;
  emptyRetryable?: boolean;
}): FillQueryResult {
  const rows = normalizeKisFillRows(input.raw);
  if (rows === null) {
    return {
      kind: 'QUERY_FAILED',
      reason: 'MALFORMED_KIS_FILL_RESPONSE',
      retryable: true,
      raw: input.raw,
    };
  }

  if (rows.length === 0) {
    return {
      kind: 'EMPTY_RESPONSE',
      retryable: input.emptyRetryable ?? true,
      raw: input.raw,
    };
  }

  const row = rows.find((candidate) => candidate.ordNo === input.order.ordNo);
  if (!row) {
    return {
      kind: 'UNFILLED',
      reason: 'ORDER_NOT_FOUND_IN_CCLD_RESPONSE',
      retryable: true,
      raw: input.raw,
    };
  }

  if (row.rejected) {
    return {
      kind: 'REJECTED',
      reason: row.rejectReason ?? 'KIS_ORDER_REJECTED',
      raw: row.raw,
    };
  }

  if (row.filledQty >= input.order.orderQty && input.order.orderQty > 0) {
    return {
      kind: 'FILLED',
      filledQty: row.filledQty,
      avgPrice: row.avgPrice ?? 0,
      raw: row.raw,
    };
  }

  if (row.filledQty > 0) {
    return {
      kind: 'PARTIALLY_FILLED',
      filledQty: row.filledQty,
      remainingQty: Math.max(0, input.order.orderQty - row.filledQty),
      ...(row.avgPrice !== undefined ? { avgPrice: row.avgPrice } : {}),
      raw: row.raw,
    };
  }

  return {
    kind: 'UNFILLED',
    reason: 'KIS_ORDER_HAS_NO_CCLD_QTY',
    retryable: true,
    raw: row.raw,
  };
}
