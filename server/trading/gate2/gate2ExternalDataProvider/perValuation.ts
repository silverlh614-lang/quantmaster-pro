// @responsibility Gate2 PER valuation engine — KIS FHKST01010100 추출·판정 + 정본 snapshot quote 재사용(정본 데이터 SSOT, patch) 단일 모듈.

import { realDataKisGet } from '../../../clients/kisClient/http.js';
import { HAS_REAL_DATA_CLIENT } from '../../../clients/kisClient/constants.js';
import { getStockByCode } from '../../../persistence/krxStockMasterRepo.js';
import { cleanSymbol, finiteNumber, isRecord } from './helpers.js';
import type { Gate2DartEvaluationFinancials, Gate2PerValuationResult } from './types.js';

/**
 * Gate2 PER dedup (정본 데이터 SSOT, patch): 정본 SourceSnapshot quote 의 valuation 필드를 재사용해
 * Gate2 PER 의 FHKST01010100 중복 호출을 제거하는 플래그. 정본 스냅샷 운영 플래그에 종속.
 * OFF 시 기존 재호출 경로 100% 유지 (회귀 0). 호출 시점에 env 를 읽어 토글 가능.
 */
function gate2PerReuseSnapshotEnabled(): boolean {
  return process.env.USE_UNIFIED_SOURCE_SNAPSHOT === 'true';
}

function hasKisValuationCredentials(): boolean {
  return HAS_REAL_DATA_CLIENT || Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

export function emptyPerValuation(reason = 'PER_MISSING', attempted = false): Gate2PerValuationResult {
  return {
    attempted,
    per: null,
    eps: null,
    currentPrice: null,
    listedShares: null,
    source: 'NONE',
    reason,
    dartEpsComputed: false,
    perComputedFromPriceAndEps: false,
    perCacheHit: false,
  };
}

function pickKisValuationOutput(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const buckets = [data.output, data.output1, data.output2];
  for (const bucket of buckets) {
    if (isRecord(bucket)) return bucket;
    if (Array.isArray(bucket)) {
      const first = bucket.find(isRecord);
      if (first) return first;
    }
  }
  return null;
}

function firstPositiveNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value != null && value > 0) return value;
  }
  return null;
}

function firstFiniteNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

function sanitizedKisValuationRaw(output: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!output) return undefined;
  const keepKeys = [
    'stck_prpr',
    'prpr',
    'per',
    'hts_per',
    'eps',
    'stac_eps',
    'lstn_stcn',
    'hts_avls',
    'pbr',
    'bps',
  ];
  const sanitized: Record<string, unknown> = {};
  for (const key of keepKeys) {
    if (output[key] != null) sanitized[key] = output[key];
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function listedSharesFromMaster(symbol: string): number | null {
  const entry = getStockByCode(cleanSymbol(symbol));
  return typeof entry?.listedShares === 'number' && Number.isFinite(entry.listedShares) && entry.listedShares > 0
    ? entry.listedShares
    : null;
}

function netIncomeFromDartFin(dartFin: Gate2DartEvaluationFinancials | null | undefined): number | null {
  if (!isRecord(dartFin)) return null;
  return finiteNumber(dartFin.netIncome);
}

function sharesFromDartFin(dartFin: Gate2DartEvaluationFinancials | null | undefined): number | null {
  if (!isRecord(dartFin)) return null;
  const shares = finiteNumber(dartFin.sharesOutstanding ?? dartFin.weightedAverageShares ?? dartFin.listedShares);
  return shares != null && shares > 0 ? shares : null;
}

function reasonForMissingPer(input: {
  directPer: number | null;
  currentPrice: number | null;
  kisEps: number | null;
  dartEps: number | null;
  listedShares: number | null;
  output: Record<string, unknown> | null;
}): string {
  if (!input.output) return 'KIS_PER_OUTPUT_MISSING';
  if (input.kisEps != null && input.kisEps <= 0) return 'EPS_NON_POSITIVE';
  if (input.dartEps != null && input.dartEps <= 0) return 'EPS_NON_POSITIVE';
  if (input.directPer != null && input.directPer <= 0) return 'PER_NON_POSITIVE_OR_UNAVAILABLE';
  if (input.currentPrice == null || input.currentPrice <= 0) return 'PRICE_MISSING';
  if (input.kisEps == null && input.dartEps == null) {
    return input.listedShares == null ? 'SHARES_OUTSTANDING_MISSING' : 'EPS_MISSING';
  }
  return 'PER_UNAVAILABLE';
}

/**
 * 정본 데이터 SSOT(Gate2 PER dedup, patch): FHKST01010100 output 으로부터 Gate2PerValuationResult 를 구성하는 순수 함수.
 * re-fetch 경로와 정본 snapshotQuote 재사용 경로가 동일 로직을 공유하여 byte-equivalent 를 보장한다.
 * (PER 값·판정·결정 로직 0 변경 — 기존 fetchGate2PerValuation 본문을 그대로 이관).
 */
function buildPerValuationFromOutput(
  symbol: string,
  output: Record<string, unknown> | null,
  dartFin: Gate2DartEvaluationFinancials | null | undefined,
): Gate2PerValuationResult {
  const raw = sanitizedKisValuationRaw(output);
  const rawDirectPer = firstFiniteNumber(output, ['per', 'PER', 'hts_per', 'HTS_PER']);
  const directPer = rawDirectPer != null && rawDirectPer > 0 ? rawDirectPer : null;
  const currentPrice = firstPositiveNumber(output, ['stck_prpr', 'STCK_PRPR', 'prpr', 'close']);
  const kisEps = firstFiniteNumber(output, ['eps', 'EPS', 'stac_eps', 'STAC_EPS']);
  const listedShares = firstPositiveNumber(output, ['lstn_stcn', 'LSTN_STCN', 'listedShares'])
    ?? sharesFromDartFin(dartFin)
    ?? listedSharesFromMaster(symbol);
  if (directPer != null && directPer > 0) {
    return {
      attempted: true,
      per: directPer,
      eps: kisEps,
      currentPrice,
      listedShares,
      source: 'KIS',
      reason: directPer > 30 ? 'PER_TOO_HIGH' : 'PER_ACCEPTABLE',
      raw,
      dartEpsComputed: false,
      perComputedFromPriceAndEps: false,
      perCacheHit: false,
    };
  }
  if (currentPrice != null && currentPrice > 0 && kisEps != null && kisEps > 0) {
    return {
      attempted: true,
      per: currentPrice / kisEps,
      eps: kisEps,
      currentPrice,
      listedShares,
      source: 'KIS',
      reason: 'PER_COMPUTED_FROM_KIS_PRICE_EPS',
      raw,
      dartEpsComputed: false,
      perComputedFromPriceAndEps: true,
      perCacheHit: false,
    };
  }
  const netIncome = netIncomeFromDartFin(dartFin);
  const rawDartEps = netIncome != null && listedShares != null && listedShares > 0
    ? netIncome / listedShares
    : null;
  const dartEps = rawDartEps != null && rawDartEps > 0 ? rawDartEps : null;
  if (currentPrice != null && currentPrice > 0 && dartEps != null && dartEps > 0) {
    return {
      attempted: true,
      per: currentPrice / dartEps,
      eps: dartEps,
      currentPrice,
      listedShares,
      source: 'DART_EPS_PRICE',
      reason: 'PER_COMPUTED_FROM_DART_EPS_AND_KIS_PRICE',
      raw,
      dartEpsComputed: true,
      perComputedFromPriceAndEps: true,
      perCacheHit: false,
    };
  }
  return {
    ...emptyPerValuation(reasonForMissingPer({
      directPer: rawDirectPer,
      currentPrice,
      kisEps,
      dartEps: rawDartEps,
      listedShares,
      output,
    }), true),
    eps: kisEps ?? rawDartEps,
    currentPrice,
    listedShares,
    source: output ? 'KIS' : 'NONE',
    raw,
    dartEpsComputed: rawDartEps != null,
  };
}

/**
 * 정본 데이터 SSOT(Gate2 PER dedup, patch): 정본 SourceSnapshot quote(동일 FHKST01010100 응답) 의 per/eps/listedShares/currentPrice 를
 * fetchGate2PerValuation 추출 키와 동일한 output 레코드로 합성한다 (콤마 제거된 숫자 → 동일 finiteNumber 결과).
 * 어떤 valuation 필드도 유효하지 않으면 null (재호출 fallback).
 */
function synthesizePerOutputFromSnapshotQuote(snapshotQuote: {
  per?: number | null;
  eps?: number | null;
  listedShares?: number | null;
  currentPrice?: number | null;
} | null | undefined): Record<string, unknown> | null {
  if (!snapshotQuote) return null;
  const per = finiteNumber(snapshotQuote.per);
  const eps = finiteNumber(snapshotQuote.eps);
  const listedShares = finiteNumber(snapshotQuote.listedShares);
  const currentPrice = finiteNumber(snapshotQuote.currentPrice);
  // 정본 quote 가 valuation 신호(PER 산출에 쓰이는 필드)를 전혀 갖지 않으면 재호출 fallback.
  if (per == null && eps == null && currentPrice == null && listedShares == null) return null;
  const output: Record<string, unknown> = {};
  if (per != null) output.per = per;
  if (eps != null) output.eps = eps;
  if (listedShares != null) output.lstn_stcn = listedShares;
  if (currentPrice != null) output.stck_prpr = currentPrice;
  return output;
}

export async function fetchGate2PerValuation(input: {
  symbol: string;
  dartFin?: Gate2DartEvaluationFinancials | null;
  snapshotQuote?: {
    per?: number | null;
    eps?: number | null;
    listedShares?: number | null;
    currentPrice?: number | null;
  } | null;
}): Promise<Gate2PerValuationResult> {
  const symbol = cleanSymbol(input.symbol);
  if (!hasKisValuationCredentials()) return emptyPerValuation('KIS_PER_CONFIG_MISSING', false);
  // Gate2 PER dedup (정본 데이터 SSOT, patch): 정본 snapshot quote 가 valuation 데이터를 보유하면 동일 FHKST01010100
  // 재호출을 skip 하고 그 값으로 동일 로직을 통해 결과를 구성한다 (byte-equivalent).
  if (gate2PerReuseSnapshotEnabled()) {
    const synthesized = synthesizePerOutputFromSnapshotQuote(input.snapshotQuote);
    if (synthesized) {
      return buildPerValuationFromOutput(symbol, synthesized, input.dartFin);
    }
  }
  try {
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
        __kisPurpose: 'GATE2_PER_VALUATION',
      },
      'LOW',
    );
    const output = pickKisValuationOutput(data);
    return buildPerValuationFromOutput(symbol, output, input.dartFin);
  } catch (error) {
    return {
      ...emptyPerValuation(error instanceof Error ? `KIS_PER_PROVIDER_ERROR:${error.name}` : 'KIS_PER_PROVIDER_ERROR', true),
      source: 'KIS',
    };
  }
}
