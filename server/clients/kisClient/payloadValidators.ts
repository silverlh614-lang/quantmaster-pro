// @responsibility KIS supply payload classifiers
/**
 * KIS 수급/공매도 materializer 앞단의 defensive validator.
 * HTTP 200이어도 quote-like/price-only output이면 데이터 장애나 시장 신호가 아니라
 * endpoint/field mismatch 진단으로 분리하고 materialize 하지 않는다.
 */

export const INVESTOR_FLOW_FIELD_CANDIDATES = [
  'frgn_ntby_qty',
  'frgn_ntby_tr_pbmn',
  'orgn_ntby_qty',
  'orgn_ntby_tr_pbmn',
  'prsn_ntby_qty',
  'prsn_ntby_tr_pbmn',
  'frgn_seln_qty',
  'frgn_shnu_qty',
  'orgn_seln_qty',
  'orgn_shnu_qty',
  'prsn_seln_qty',
  'prsn_shnu_qty',
  'FRGN_NETBUY_QTY',
  'INST_NETBUY_QTY',
  'INDV_NETBUY_QTY',
] as const;

export const QUOTE_LIKE_FIELDS = [
  'stck_prpr',
  'prdy_vrss',
  'prdy_vrss_sign',
  'prdy_ctrt',
  'acml_vol',
  'prdy_vol',
  'cntg_vol',
  'stck_cntg_hour',
  'tday_rltv',
] as const;

export const SHORT_FIELD_CANDIDATES = [
  'ssts_cntg_qty',
  'ssts_tr_pbmn',
  'shts_cntg_qty',
  'shts_tr_pbmn',
  'stss_cntg_qty',
  'stss_tr_pbmn',
  'short_qty',
  'short_amt',
  'short_balance_qty',
  'short_balance_amt',
  'ssts_tr_pbmn_rlim',
  'ssts_vol_rlim',
  'stss_rate',
  'short_rate',
] as const;


// TODO(KIS): 올바른 investor flow / short selling TR·필드 조합이 확정되면
// *_FIELD_CANDIDATES를 내부 mapping으로 확장하고 MATERIALIZED 경로만 승격한다.

export type KisPayloadStatus =
  | 'MATERIALIZED'
  | 'QUOTE_LIKE_OUTPUT'
  | 'FIELD_MISSING'
  | 'FIELD_MISMATCH'
  | 'FIELD_MISMATCH_CONFIRMED'
  | 'HTTP_OK_BUT_EMPTY';

export interface KisPayloadClassification {
  status: KisPayloadStatus;
  materialized: boolean;
  usableForSignal: boolean;
  usableForExecution: boolean;
  providerIssue: false;
  marketSignal: false;
  executionImpact: 'NONE';
  reason: string;
  endpointMismatch?: boolean;
  outputKeys: string[];
  investorHits?: number;
  shortHits?: number;
  quoteHits: number;
}

export type KisPayloadRow = Record<string, unknown>;

export function collectKeys(outputRows: KisPayloadRow[] | null | undefined): string[] {
  const keys = new Set<string>();
  for (const row of outputRows ?? []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) keys.add(key);
  }
  return [...keys];
}

export function countHits(keys: string[], candidates: readonly string[]): number {
  const normalized = new Set(keys.flatMap((key) => [key, key.toLowerCase()]));
  return candidates.filter((candidate) => normalized.has(candidate) || normalized.has(candidate.toLowerCase())).length;
}

function base(
  status: KisPayloadStatus,
  rows: KisPayloadRow[] | null | undefined,
  reason: string,
  extra: Partial<KisPayloadClassification> = {},
): KisPayloadClassification {
  return {
    status,
    materialized: status === 'MATERIALIZED',
    usableForSignal: status === 'MATERIALIZED',
    usableForExecution: false,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'NONE',
    reason,
    outputKeys: collectKeys(rows),
    quoteHits: countHits(collectKeys(rows), QUOTE_LIKE_FIELDS),
    ...extra,
  };
}

export function classifyInvestorFlowPayload(
  outputRows: KisPayloadRow[] | null | undefined,
  _sourceMeta: Record<string, unknown> = {},
): KisPayloadClassification {
  if (!outputRows || outputRows.length === 0) {
    return base('HTTP_OK_BUT_EMPTY', outputRows, 'HTTP_OK_BUT_EMPTY_NO_ROWS', { usableForSignal: false });
  }

  const keys = collectKeys(outputRows);
  const investorHits = countHits(keys, INVESTOR_FLOW_FIELD_CANDIDATES);
  const quoteHits = countHits(keys, QUOTE_LIKE_FIELDS);

  if (quoteHits >= 3 && investorHits === 0) {
    return base('QUOTE_LIKE_OUTPUT', outputRows, 'ENDPOINT_RETURNS_QUOTE_LIKE_OUTPUT', {
      investorHits,
      quoteHits,
      endpointMismatch: true,
      usableForSignal: false,
    });
  }

  if (investorHits === 0) {
    return base('FIELD_MISSING', outputRows, 'NO_INVESTOR_NET_BUY_FIELDS', {
      investorHits,
      quoteHits,
      usableForSignal: false,
    });
  }

  return base('MATERIALIZED', outputRows, 'INVESTOR_FLOW_FIELDS_PRESENT', {
    investorHits,
    quoteHits,
  });
}

export function classifyShortPayload(
  outputRows: KisPayloadRow[] | null | undefined,
  _sourceMeta: Record<string, unknown> = {},
): KisPayloadClassification {
  if (!outputRows || outputRows.length === 0) {
    return base('HTTP_OK_BUT_EMPTY', outputRows, 'HTTP_OK_BUT_EMPTY_NO_ROWS', { usableForSignal: false });
  }

  const keys = collectKeys(outputRows);
  const shortHits = countHits(keys, SHORT_FIELD_CANDIDATES);
  const quoteHits = countHits(keys, QUOTE_LIKE_FIELDS);

  if (quoteHits >= 3 && shortHits === 0) {
    return base('FIELD_MISMATCH_CONFIRMED', outputRows, 'NO_SHORT_SELLING_FIELDS', {
      shortHits,
      quoteHits,
      endpointMismatch: true,
      usableForSignal: false,
    });
  }

  if (shortHits === 0) {
    return base('FIELD_MISSING', outputRows, 'NO_SHORT_SELLING_FIELDS', {
      shortHits,
      quoteHits,
      endpointMismatch: true,
      usableForSignal: false,
    });
  }

  return base('MATERIALIZED', outputRows, 'SHORT_SELLING_FIELDS_PRESENT', {
    shortHits,
    quoteHits,
  });
}

export function describeKisPayloadStatus(status: KisPayloadStatus): string {
  switch (status) {
    case 'FIELD_MISMATCH':
    case 'FIELD_MISMATCH_CONFIRMED':
      return 'FIELD_MISMATCH: endpoint returned quote-like or price-only fields';
    case 'HTTP_OK_BUT_EMPTY':
      return 'HTTP_OK_BUT_EMPTY: no rows returned, not treated as market signal';
    case 'FIELD_MISSING':
      return 'FIELD_MISSING: rows exist but required materializer fields are absent';
    case 'QUOTE_LIKE_OUTPUT':
      return 'QUOTE_LIKE_OUTPUT: diagnostic only, not usable for investor flow';
    case 'MATERIALIZED':
      return 'MATERIALIZED: required fields present';
  }
}
