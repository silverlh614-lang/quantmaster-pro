// @responsibility Gate2 PER/DART 데이터 라인 표시·분류 순수 함수 SSOT (값 무변경, 외부 호출 0, 진단 표시 전용).

import type {
  Gate2DartLineHealth,
  Gate2DerivedMetrics,
  Gate2ExternalRefreshTrace,
  Gate2PerValuationDisplay,
  Gate2PerValuationSource,
  Gate2ProjectedCondition,
} from './types.js';

/**
 * PER non-positive(음수/0) 또는 비가용을 나타내는 reason 토큰.
 * 값 자체는 바꾸지 않고 rawPER 노출 여부 판정에만 사용한다.
 */
function isNonPositiveReason(reason: string | undefined): boolean {
  if (!reason) return false;
  const upper = reason.toUpperCase();
  return upper.includes('NON_POSITIVE') || upper.includes('NEGATIVE');
}

/**
 * §B — PER valuation 표시 분류.
 * PER 값/판정 임계는 건드리지 않고, 표시·분류 필드만 산출한다.
 * - perStatus: condition.status !== 'UNAVAILABLE' 이면 AVAILABLE.
 * - rawPER: 정규화 전 값 (metrics.per 그대로; non-positive 도 그대로 노출).
 * - normalizedPER: 양수만, 아니면 null.
 * - confidence: unavailable/non-positive → LOW, KIS direct → HIGH, KIS 파생 → MEDIUM, 그 외 source 기반.
 * - highConvictionImpact 는 projection 기존값 재사용, entryHardBlockImpact='NO', executionImpact='NONE'.
 */
export function classifyPerValuationDisplay(input: {
  perCondition: Pick<Gate2ProjectedCondition, 'status' | 'value'>;
  metricsPer: number | null;
  perSource?: Gate2PerValuationSource;
  perReason?: string;
  highConvictionImpact: Gate2PerValuationDisplay['highConvictionImpact'];
}): Gate2PerValuationDisplay {
  const { perCondition, metricsPer, perSource, perReason, highConvictionImpact } = input;
  const perStatus: Gate2PerValuationDisplay['perStatus'] =
    perCondition.status !== 'UNAVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE';

  const rawPER = metricsPer ?? null;
  const normalizedPER = typeof rawPER === 'number' && rawPER > 0 ? rawPER : null;

  let confidence: Gate2PerValuationDisplay['confidence'];
  if (perStatus === 'UNAVAILABLE' || isNonPositiveReason(perReason) || normalizedPER == null) {
    confidence = 'LOW';
  } else if (perSource === 'KIS' && (perReason ?? '').toUpperCase().includes('COMPUTED')) {
    // KIS price/eps 파생 (직접 PER 아님) → 보수적으로 MEDIUM.
    confidence = 'MEDIUM';
  } else if (perSource === 'KIS') {
    // KIS direct PER.
    confidence = 'HIGH';
  } else if (perSource === 'DART_EPS_PRICE' || perSource === 'CACHE') {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return {
    perStatus,
    rawPER,
    normalizedPER,
    confidence,
    highConvictionImpact,
    entryHardBlockImpact: 'NO',
    executionImpact: 'NONE',
  };
}

const DART_REQUIRED_FIELDS = ['roe', 'opm', 'ocfToNi', 'icr', 'earningsQuality'] as const;
type DartFieldKey = (typeof DART_REQUIRED_FIELDS)[number];

/**
 * metrics 에서 각 DART 라인 필드의 가용 여부를 null 기준으로 판정한다.
 * ocfToNi 는 earningsQualityScore(=OCF/NI 비율) 로 대표, earningsQuality 는 동일 score 의 존재로 본다.
 */
function dartFieldAvailable(metrics: Gate2DerivedMetrics, field: DartFieldKey): boolean {
  switch (field) {
    case 'roe':
      return metrics.roe != null;
    case 'opm':
      return metrics.opm != null;
    case 'ocfToNi':
      return metrics.earningsQualityScore != null;
    case 'icr':
      return metrics.icr != null;
    case 'earningsQuality':
      return metrics.earningsQualityScore != null;
    default:
      return false;
  }
}

/**
 * §C — DART degraded 를 condition 단위로 분해.
 * transport/parse error(dartHttpStatus>=400 || dartErrorCode) 일 때만 providerIssue=true / status=DEGRADED.
 * 단순 부재·기간 미보고(요청 성공, rawRows=0, 에러 없음)는 EMPTY_VALID + providerIssue=false.
 * 어떤 경우에도 marketSignal=false, executionImpact='NONE' (OCF/NI·ICR null 은 시장 신호 아님).
 */
export function classifyDartLineHealth(input: {
  metrics: Gate2DerivedMetrics;
  refreshTrace?: Gate2ExternalRefreshTrace;
}): Gate2DartLineHealth {
  const { metrics, refreshTrace } = input;

  const availableFields: string[] = [];
  const missingFields: string[] = [];
  for (const field of DART_REQUIRED_FIELDS) {
    if (dartFieldAvailable(metrics, field)) availableFields.push(field);
    else missingFields.push(field);
  }

  const attempted = refreshTrace?.dartRequestAttempted === true;
  const httpStatus = refreshTrace?.dartHttpStatus;
  const errorCode = refreshTrace?.dartErrorCode;
  const transportOrParseError =
    (typeof httpStatus === 'number' && httpStatus >= 400) ||
    (typeof errorCode === 'string' && errorCode.length > 0);
  const rawRows = refreshTrace?.dartRawRows ?? 0;

  let status: Gate2DartLineHealth['status'];
  if (!attempted) {
    status = 'NOT_ATTEMPTED';
  } else if (transportOrParseError) {
    status = 'DEGRADED';
  } else if (missingFields.length === 0) {
    status = 'VERIFIED';
  } else if (availableFields.length > 0) {
    status = 'PARTIAL';
  } else if (rawRows === 0) {
    // 요청 성공·에러 없음·행 0 → 미보고/기간 (정상 빈 응답).
    status = 'EMPTY_VALID';
  } else {
    // 행은 있으나 파생 필드 0 (정규화 누락) — 부분 부재로 분류.
    status = 'PARTIAL';
  }

  // providerIssue 는 transport/parse error 일 때만 true. 단순 부재/기간 미보고는 false.
  const providerIssue = transportOrParseError;

  // primaryIssue: 가장 핵심 미가용 필드(earnings_quality 우선)를 DATA_UNAVAILABLE:<field> 로 노출.
  let primaryIssue = 'NONE';
  if (missingFields.length > 0) {
    const ranked = ['earningsQuality', 'icr', 'ocfToNi', 'opm', 'roe'];
    const topMissing = ranked.find(field => missingFields.includes(field)) ?? missingFields[0];
    const label = topMissing === 'earningsQuality' ? 'earnings_quality' : topMissing;
    primaryIssue = `DATA_UNAVAILABLE:${label}`;
  }

  // ADR-0532 확장 진단(표시 전용): KIS L1 재무 머지 반영 여부. currentRatio 는 DART 정규화가
  // 산출하지 않고 KIS stability-ratio(crnt_rate)만 제공 → non-null 이면 KIS 머지가 적용된 것.
  const kisMergeApplied = metrics.currentRatio != null;
  const financeSource: 'KIS_PRIMARY' | 'DART_OR_DERIVED' | 'UNAVAILABLE' =
    kisMergeApplied ? 'KIS_PRIMARY' : metrics.roe != null || metrics.opm != null ? 'DART_OR_DERIVED' : 'UNAVAILABLE';

  return {
    status,
    availableFields,
    missingFields,
    primaryIssue,
    providerIssue,
    marketSignal: false,
    executionImpact: 'NONE',
    kisFinance: {
      financeSource,
      kisMergeApplied,
      debtRatio: metrics.debtRatio,
      currentRatio: metrics.currentRatio,
      roe: metrics.roe,
      opm: metrics.opm,
    },
  };
}
