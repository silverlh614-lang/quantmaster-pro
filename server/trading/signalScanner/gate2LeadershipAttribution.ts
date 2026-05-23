/**
 * @responsibility ADR-0422 Gate2 / NO_LEADERSHIP Fresh Attribution SSOT
 *
 * ADR-0422:
 * NO_LEADERSHIP and Gate2_PASS_ZERO are aggregate symptoms, not root causes.
 * Gate2 attribution decomposes Gate1 survivors by condition status so operators
 * can distinguish true leadership rejection from sector-data staleness,
 * DATA_UNAVAILABLE, evaluator errors, and pre-breakout waits.
 *
 * This module must not change gate thresholds, weights, sector scoring, or
 * trading policy. It only improves observability of the latest scan.
 *
 * 사용자 명시 핵심 불변식:
 *   1. Gate2_PASS_ZERO 는 단일 원인이 아니다 — 조건별 분해 의무.
 *   2. NO_LEADERSHIP 은 *진짜 주도주 부재* 와 *섹터/수급/성장 데이터 품질 문제* 를 구분.
 *   3. DATA_UNAVAILABLE 은 failed 가 아님 (ADR-0416 정합).
 *   4. STALE 은 진짜 failed 와 분리해 표시 (failed 와 별도 카운터).
 *   5. fresh scan attribution 과 last 7 days 누적 audit 분리.
 *   6. 매매 정책 변경 0 — 진단 only.
 *
 * SSOT 재사용:
 *   - status 분류는 `inferStatusFromLegacyResult` (ADR-0388) + `accumulateFreshAttribution`
 *     (ADR-0420 freshScanBlockerAttribution) 위임 가능. 본 모듈은 Gate2 *정밀* attribution
 *     이 필요할 때 *생존 후보 (gate1Pass)* 기준으로 별도 분해.
 *
 * Gate stage 분리 한계:
 *   - 서버 측에는 명시적 Gate1/Gate2/Gate3 condition-key 분류가 없다 (클라이언트만 보유).
 *   - 본 PR 은 *all outputs 기준 fresh condition attribution* (ADR-0420) 위에 STALE / WAIT
 *     카운터 추가 + Gate1 survivor 비례 진단 (denominator=gate1Pass) 로 구현.
 *   - Gate2 precise survivor-level trace 는 후속 PR scope (TODO: server-side stage tagging).
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건).
 */

import type { ConditionEvalOutput } from '../../quant/conditions/types.js';
import { inferStatusFromLegacyResult } from '../../persistence/gateAuditRepo.js';

/**
 * Gate2 조건별 fresh 카운터.
 *
 * 분류 (사용자 §D 정합):
 *   - status === 'FIRED'                          → passed++
 *   - status === 'THRESHOLD_NOT_MET'              → failed++
 *   - status === 'DATA_UNAVAILABLE'               → unavailable++
 *   - status === 'PROVIDER_DEGRADED' + isStale    → stale++ (PROVIDER_DEGRADED 는 STALE 동등)
 *   - status === 'PROVIDER_DEGRADED' + !isStale   → unavailable++ (정합 차원 stale 아님)
 *   - status === 'SKIPPED_BY_POLICY' / 'SANITY_REJECTED' → skipped++
 *   - status === 'ERROR'                          → error++
 *   - 호출자가 wait 분류 신호 전달 → wait++
 *   - output null + context.hadRequiredData=false → unavailable++
 *   - output null + 그 외 → failed++ (legacy fallback)
 */
export type Gate2ConditionStatus = 'PASSED' | 'FAILED' | 'UNAVAILABLE' | 'WAIT' | 'STALE' | 'ERROR';

export type Gate2NearMissBucket =
  | 'PROBING'
  | 'WATCH_ONLY'
  | 'SHADOW_ONLY'
  | 'DATA_BLOCKED_NEAR_MISS';

export interface Gate2ConditionGapTrace {
  code: string;
  status: Gate2ConditionStatus;
  rawValue?: number | string | boolean;
  threshold?: number;
  gap?: number;
  gapPct?: number;
  nearMiss?: boolean;
  nearMissBucket?: Gate2NearMissBucket;
  providerIssue?: boolean;
  marketSignal?: boolean;
  reason?: string;
}

export interface Gate2BlockerBucket {
  conditionKey: string;
  passed: number;
  failed: number;
  unavailable: number;
  error: number;
  skipped: number;
  /** ADR-0422 신규 — STALE 데이터 (sectorEnergy / PROVIDER_DEGRADED+isStale) 분리 카운터. */
  stale: number;
  /** ADR-0422 신규 — pre-breakout WAIT 등 "조건 미충족이 아닌 대기" 분리 카운터. */
  wait: number;
  total: number;
  failedRate: number;
  unavailableRate: number;
  errorRate: number;
  staleRate: number;
  waitRate: number;
  /** ADR-P0-8 — condition-level conservative near-miss/gap traces for diagnostics only. */
  conditionGaps?: Gate2ConditionGapTrace[];
}

/**
 * Gate2 / leadership 진단 분류 (사용자 §B + §E 정합).
 *
 * 운영자 가이드 — 매매 정책 변경 입력 절대 아님 (사용자 명시 핵심 불변식 #6).
 */
export type Gate2LeadershipDiagnosis =
  | 'TRUE_NO_LEADERSHIP'
  | 'SECTOR_DATA_STALE_DOMINANT'
  | 'DATA_UNAVAILABLE_DOMINANT'
  | 'EVALUATOR_ERROR_DOMINANT'
  | 'PRE_BREAKOUT_WAIT_DOMINANT'
  | 'GATE_RECHECK_DOMINANT'
  | 'MIXED'
  | 'NO_GATE1_SURVIVORS'
  | 'UNKNOWN';


export type Gate2LeadershipDominantReason =
  | 'SECTOR_DATA_STALE'
  | 'BREAKOUT_MOMENTUM_NOT_CONFIRMED'
  | 'FUNDAMENTAL_DATA_UNAVAILABLE'
  | 'MIXED'
  | 'UNKNOWN';

export type Gate2LeadershipBlocker =
  | 'OFFICIAL_INDEX_UNAVAILABLE'
  | 'OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD'
  | 'SECTOR_STALE'
  | 'SECTOR_UNAVAILABLE'
  | 'FUNDAMENTAL_UNAVAILABLE'
  | 'BREAKOUT_MOMENTUM_FAIL'
  | 'RELATIVE_STRENGTH_FAIL'
  | 'VOLUME_CONFIRMATION_FAIL'
  | 'NO_LEADERSHIP_AFTER_ALL_CHECKS';

export interface Gate2LeadershipAttribution {
  gate1Pass: number;
  gate2Pass: number;
  blockedBySectorStaleCount: number;
  blockedByConditionFailCount: number;
  blockedByUnavailableFundamentalCount: number;
  sectorStaleContributionPct: number;
  dominantReason: Gate2LeadershipDominantReason;
  officialIndex: {
    status: 'VERIFIED' | 'PARTIAL' | 'UNAVAILABLE';
    coverage: number;
    promotionAllowed: boolean;
    impact: 'NONE' | 'NO_LIVE_PROMOTION_ONLY';
  };
  shadowSector: {
    status: 'AVAILABLE' | 'UNAVAILABLE';
    sourceTier: string;
    shadowLeadershipAllowed: boolean;
    confidence: 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED' | 'UNKNOWN';
  };
  breakoutMomentum: {
    status: 'CONFIRMED' | 'NOT_CONFIRMED';
    blocker: 'NONE' | 'BREAKOUT_MOMENTUM_FAIL';
  };
  final: {
    liveLeadership: boolean;
    shadowLeadership: boolean;
    noLeadershipReason: string;
    executionImpact: 'NONE';
  };
  blockers: Gate2LeadershipBlocker[];
}

/**
 * SectorEnergy 진단 메타 — Gate2 진단 분류 입력 + /scan_blockers 표시용.
 *
 * 사용자 명시 §F — sectorEnergy 를 *고치지 말고* 상태가 Gate2/NO_LEADERSHIP 진단에
 *   영향을 주는지 명확히 *표시* 만. 본 PR scope 외 (ADR-0423 후속).
 */
export interface SectorEnergyDiagnostic {
  dataQuality?: string;
  validSectorCount?: number;
  expectedSectorCount?: number;
  reason?: string;
  indexCodeCoverage?: number;
  officialIndexCoverage?: number;
  internalProxyCoverage?: number;
  stockBasketCoverage?: number;
  selectedSectorEnergySourceTier?: string;
  leadershipConfidence?: 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED';
  promotionAllowed?: boolean;
  sectorBoostAllowed?: boolean;
  strongBuyAllowed?: boolean;
  shadowLeadershipAllowed?: boolean;
  counterfactualAllowed?: boolean;
  reasonCodes?: string[];
  isStale?: boolean;
}

/**
 * 매수 차단 사유 카운트 — 기존 waitDistribution 에서 발췌 (gate1 survivor 기준).
 *
 * 사용자 명시 §E — Gate 재검증 미달 / Pre-breakout WAIT / Sizing advisory / Drift REMOVE 분해.
 */
export interface Gate2BlockReasons {
  gateRecheckMiss: number;
  preBreakoutWait: number;
  sizingBlocked: number;
  driftRemove: number;
}

/**
 * Gate2 fresh attribution snapshot — 직전 단일 스캔의 Gate1 생존 → Gate2 분해.
 *
 * Gate2 precise survivor-level tagging 한계 — 서버 측 condition-key 분류 SSOT 부재
 * (사용자 §C 명시). 본 PR 은 *all outputs 기준 + survivor denominator + STALE/WAIT
 * 카운터 분리* 로 구현. 후속 PR 에서 server-side stage tagging 도입 시 정확도 향상.
 */
export interface Gate2FreshAttribution {
  scanId?: string;
  scannedAtKst?: string;
  candidates: number;
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  entries: number;
  lastTriggerPass: number;
  /** Gate2 조건별 buckets (failed+unavailable+error+stale+wait 합 내림차순 정렬). */
  buckets: Gate2BlockerBucket[];
  /** ADR-P0-8 — true fail/unavailable/wait/near-miss condition traces. Diagnostic only. */
  conditionGaps: Gate2ConditionGapTrace[];
  nearMissConditions: string[];
  topFailedCondition?: Gate2BlockerBucket;
  topUnavailableCondition?: Gate2BlockerBucket;
  topErrorCondition?: Gate2BlockerBucket;
  /** ADR-0422 신규 — STALE 카운트 최대 condition (stale=0 시 undefined). */
  topStaleCondition?: Gate2BlockerBucket;
  /** ADR-0422 신규 — wait 카운트 최대 condition (wait=0 시 undefined). */
  topWaitCondition?: Gate2BlockerBucket;
  /** SectorEnergy 진단 (사용자 §F — *표시* 만, 수정 금지). */
  sectorEnergy?: SectorEnergyDiagnostic;
  /** 매수 차단 사유 분해 (기존 waitDistribution 에서 발췌). */
  blockReasons?: Gate2BlockReasons;
  /** Gate2 true failed 조건 수 (unavailable/stale/wait 제외). */
  gate2TrueFailedCount: number;
  /** Gate2 unavailable/provider issue 조건 수 (failed 아님). */
  gate2UnavailableCount: number;
  /** Gate2 blocked-but-watch 보존 예상 수. */
  gate2WatchPreservedCount: number;
  /** Gate2 blocked-but-shadow 보존 예상 수. */
  gate2ShadowPreservedCount: number;
  /** Gate2 NO_LEADERSHIP 원인 축 분해 (diagnostic only). */
  leadershipAttribution: Gate2LeadershipAttribution;
  /** 운영자 가이드 분류. */
  recommendedDiagnosis: Gate2LeadershipDiagnosis;
}

/**
 * 단일 후보 평가 outputs 입력 형식.
 */
export type Gate2AttributionOutputItem = {
  key: string;
  output:
    | (Pick<ConditionEvalOutput, 'score' | 'status'> & Partial<Pick<ConditionEvalOutput, 'detail'>>)
    | null;
  context?: { evaluatorKey?: string; hadRequiredData?: boolean; skippedByPolicy?: boolean };
  /** 호출자가 wait 분류 신호 전달 — pre-breakout WAIT 등 (output.status 와 별개). */
  waitMarker?: boolean;
  /** ADR-P0-8 — optional metric attribution; ignored by live decisions. */
  rawValue?: number | string | boolean;
  threshold?: number;
  reason?: string;
};

/**
 * SSOT 임계 — 사용자 §E 결정 트리 정확 정합 (변경 시 ADR 갱신 의무).
 *
 * 절대 변경 금지: 본 임계는 *진단 가이드만* 결정 — 매매 결정 무관.
 */
export const GATE2_DIAGNOSIS_THRESHOLDS = {
  /** stale / totalRelevant > 0.4 시 SECTOR_DATA_STALE_DOMINANT (sectorEnergy.isStale 도 무관). */
  STALE_DOMINANT_RATIO: 0.4,
  /** unavailable / totalRelevant > 0.5 시 DATA_UNAVAILABLE_DOMINANT. */
  UNAVAILABLE_DOMINANT_RATIO: 0.5,
  /** error / totalRelevant > 0.3 시 EVALUATOR_ERROR_DOMINANT. */
  ERROR_DOMINANT_RATIO: 0.3,
  /** preBreakoutWait / max(1, gate1Pass) > 0.5 OR wait/totalRelevant>0.5 시 PRE_BREAKOUT_WAIT. */
  WAIT_DOMINANT_RATIO: 0.5,
  /** gateRecheckMiss / max(1, gate1Pass) > 0.5 시 GATE_RECHECK_DOMINANT. */
  GATE_RECHECK_DOMINANT_RATIO: 0.5,
  /** failed / totalRelevant > 0.7 시 TRUE_NO_LEADERSHIP. */
  TRUE_FAIL_DOMINANT_RATIO: 0.7,
} as const;

/**
 * 빈 bucket 생성 SSOT.
 */
function emptyBucket(key: string): Gate2BlockerBucket {
  return {
    conditionKey: key,
    passed: 0,
    failed: 0,
    unavailable: 0,
    error: 0,
    skipped: 0,
    stale: 0,
    wait: 0,
    total: 0,
    failedRate: 0,
    unavailableRate: 0,
    errorRate: 0,
    staleRate: 0,
    waitRate: 0,
  };
}

/**
 * detail 문자열에서 STALE 신호 검출 SSOT.
 *
 * sectorEnergy / PROVIDER_DEGRADED 등 일부 evaluator 가 detail 에 'STALE' /
 * 'dataQuality=STALE' 명시. 본 헬퍼는 그런 케이스를 stale 카운터로 분리.
 */

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ratioFromMaybePercent(value: unknown): number {
  if (!finiteNumber(value)) return 0;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

function readNumericField(source: Record<string, unknown>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const value = source[name];
    if (finiteNumber(value)) return value;
  }
  return undefined;
}

function parseDetailNumber(detail: string | undefined, names: readonly string[]): number | undefined {
  if (!detail) return undefined;
  for (const name of names) {
    const re = new RegExp(`${name}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
    const m = detail.match(re);
    if (m) {
      const parsed = Number(m[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function inferGapTrace(input: {
  key: string;
  output: Gate2AttributionOutputItem['output'];
  context?: Gate2AttributionOutputItem['context'];
  status: Gate2ConditionStatus;
  waitMarker?: boolean;
  rawValue?: number | string | boolean;
  threshold?: number;
  reason?: string;
}): Gate2ConditionGapTrace {
  const outputRecord = (input.output && typeof input.output === 'object')
    ? input.output as Record<string, unknown>
    : {};
  const detail = input.output?.detail;
  const rawValue = input.rawValue ?? readNumericField(outputRecord, ['rawValue', 'value', 'ratio', 'score', 'currentValue']);
  const threshold = input.threshold ?? readNumericField(outputRecord, ['threshold', 'required', 'requiredValue', 'min']);
  const numericRaw = finiteNumber(rawValue) ? rawValue : undefined;
  const numericThreshold = threshold ?? parseDetailNumber(detail, ['threshold', 'required', 'min']);
  const gap = finiteNumber(numericRaw) && finiteNumber(numericThreshold)
    ? Number((numericRaw - numericThreshold).toFixed(4))
    : undefined;
  const gapPct = finiteNumber(numericRaw) && finiteNumber(numericThreshold) && numericThreshold !== 0
    ? Number((((numericRaw - numericThreshold) / Math.abs(numericThreshold)) * 100).toFixed(2))
    : undefined;

  let nearMiss = false;
  let nearMissBucket: Gate2NearMissBucket | undefined;
  if (input.status === 'UNAVAILABLE' || input.status === 'STALE') {
    nearMiss = true;
    nearMissBucket = 'DATA_BLOCKED_NEAR_MISS';
  } else if (input.status === 'WAIT') {
    nearMiss = true;
    nearMissBucket = 'WATCH_ONLY';
  } else if (input.status === 'FAILED' && finiteNumber(numericRaw) && finiteNumber(numericThreshold) && numericThreshold > 0) {
    const ratio = numericRaw / numericThreshold;
    if (input.key === 'breakout_momentum' && ratio >= 0.8) {
      nearMiss = true;
      nearMissBucket = 'PROBING';
    } else if ((input.key === 'volume_surge' || input.key === 'volume_breakout') && ratio >= 0.7) {
      nearMiss = true;
      nearMissBucket = 'WATCH_ONLY';
    } else if (input.key === 'trend_acceleration' && numericRaw > 0) {
      nearMiss = true;
      nearMissBucket = 'PROBING';
    } else if ((input.key === 'turtle_high' || input.key === 'pullback' || input.key === 'vcp') && ratio >= 0.97) {
      nearMiss = true;
      nearMissBucket = 'WATCH_ONLY';
    }
  }

  return {
    code: input.key,
    status: input.status,
    ...(rawValue !== undefined ? { rawValue } : {}),
    ...(finiteNumber(numericThreshold) ? { threshold: numericThreshold } : {}),
    ...(gap !== undefined ? { gap } : {}),
    ...(gapPct !== undefined ? { gapPct } : {}),
    ...(nearMiss ? { nearMiss, nearMissBucket } : {}),
    providerIssue: input.status === 'UNAVAILABLE' || input.status === 'STALE' || input.status === 'ERROR',
    marketSignal: input.status === 'FAILED',
    reason: input.reason ?? detail ?? (input.waitMarker ? 'PRE_BREAKOUT_WAIT' : input.status),
  };
}

export function detailIndicatesStale(detail: string | undefined): boolean {
  if (!detail || typeof detail !== 'string') return false;
  return /\bSTALE\b|dataQuality\s*[:=]\s*STALE/i.test(detail);
}

/**
 * Gate2 outputs 누적기 — 단일 후보의 outputs 를 conditionKey 별 bucket 에 가산.
 *
 * SSOT: status 분류는 `inferStatusFromLegacyResult` (ADR-0388) 위임.
 *
 * 분류 우선순위 (위에서 아래로 첫 매칭):
 *   1. waitMarker=true → wait++ (pre-breakout WAIT 등 호출자 신호)
 *   2. status === 'FIRED' → passed++
 *   3. status === 'THRESHOLD_NOT_MET' → failed++
 *   4. status === 'PROVIDER_DEGRADED' + (detail STALE) → stale++
 *   5. status === 'DATA_UNAVAILABLE' → unavailable++
 *   6. status === 'PROVIDER_DEGRADED' (STALE 아님) → unavailable++ (PROVIDER_DEGRADED 는 ADR-0388 정합)
 *   7. status === 'SKIPPED_BY_POLICY' / 'SANITY_REJECTED' → skipped++
 *   8. status === 'ERROR' → error++
 *
 * 외부 부작용 0 (Map mutate 만).
 */
export function accumulateGate2Attribution(
  acc: Map<string, Gate2BlockerBucket>,
  outputs: Gate2AttributionOutputItem[],
): void {
  for (const { key, output, context, waitMarker, rawValue, threshold, reason } of outputs) {
    let bucket = acc.get(key);
    if (!bucket) {
      bucket = emptyBucket(key);
      acc.set(key, bucket);
    }

    bucket.total += 1;

    // 1. wait marker 우선 — 호출자 명시 신호.
    if (waitMarker) {
      bucket.wait += 1;
      bucket.conditionGaps = bucket.conditionGaps ?? [];
      bucket.conditionGaps.push(inferGapTrace({ key, output, context, status: 'WAIT', waitMarker, rawValue, threshold, reason }));
      continue;
    }

    const status = inferStatusFromLegacyResult(output, context);
    const detailIsStale = detailIndicatesStale(output?.detail ?? undefined);

    let traceStatus: Gate2ConditionStatus = 'FAILED';
    switch (status) {
      case 'FIRED':
        bucket.passed += 1;
        traceStatus = 'PASSED';
        break;
      case 'THRESHOLD_NOT_MET':
        bucket.failed += 1;
        traceStatus = 'FAILED';
        break;
      case 'DATA_UNAVAILABLE':
        bucket.unavailable += 1;
        traceStatus = 'UNAVAILABLE';
        break;
      case 'PROVIDER_DEGRADED':
        // PROVIDER_DEGRADED + detail STALE → stale 분리. 그 외 unavailable.
        if (detailIsStale) {
          bucket.stale += 1;
          traceStatus = 'STALE';
        } else {
          bucket.unavailable += 1;
          traceStatus = 'UNAVAILABLE';
        }
        break;
      case 'SKIPPED_BY_POLICY':
      case 'SANITY_REJECTED':
        bucket.skipped += 1;
        traceStatus = 'UNAVAILABLE';
        break;
      case 'ERROR':
        bucket.error += 1;
        traceStatus = 'ERROR';
        break;
    }
    bucket.conditionGaps = bucket.conditionGaps ?? [];
    bucket.conditionGaps.push(inferGapTrace({ key, output, context, status: traceStatus, rawValue, threshold, reason }));
  }
}

/**
 * bucket 의 *Rate 필드 후처리 — total 변경 시 호출.
 */
export function finalizeGate2BucketRates(bucket: Gate2BlockerBucket): void {
  if (bucket.total <= 0) {
    bucket.failedRate = 0;
    bucket.unavailableRate = 0;
    bucket.errorRate = 0;
    bucket.staleRate = 0;
    bucket.waitRate = 0;
    return;
  }
  bucket.failedRate = bucket.failed / bucket.total;
  bucket.unavailableRate = bucket.unavailable / bucket.total;
  bucket.errorRate = bucket.error / bucket.total;
  bucket.staleRate = bucket.stale / bucket.total;
  bucket.waitRate = bucket.wait / bucket.total;
}

/**
 * Top-N 추출 SSOT — 카운트 내림차순 + 동률 시 conditionKey 알파벳 (deterministic).
 */
function pickTopBucket(
  buckets: Gate2BlockerBucket[],
  field: 'failed' | 'unavailable' | 'error' | 'stale' | 'wait',
): Gate2BlockerBucket | undefined {
  let top: Gate2BlockerBucket | undefined;
  for (const b of buckets) {
    if (b[field] <= 0) continue;
    if (
      !top ||
      b[field] > top[field] ||
      (b[field] === top[field] && b.conditionKey < top.conditionKey)
    ) {
      top = b;
    }
  }
  return top;
}

/**
 * Gate2 / leadership 진단 분류 SSOT — 사용자 §E 결정 트리 정확 정합.
 *
 * 결정 트리 (위에서 아래 첫 매칭):
 *   1. gate1Pass === 0 → NO_GATE1_SURVIVORS
 *   2. totalRelevant === 0 → UNKNOWN
 *   3. stale / totalRelevant > 0.4 OR sectorEnergy.isStale === true
 *      → SECTOR_DATA_STALE_DOMINANT
 *   4. unavailable / totalRelevant > 0.5 → DATA_UNAVAILABLE_DOMINANT
 *   5. error / totalRelevant > 0.3 → EVALUATOR_ERROR_DOMINANT
 *   6. (preBreakoutWait / max(1, gate1Pass) > 0.5) OR (wait / totalRelevant > 0.5)
 *      → PRE_BREAKOUT_WAIT_DOMINANT
 *   7. gateRecheckMiss / max(1, gate1Pass) > 0.5 → GATE_RECHECK_DOMINANT
 *   8. failed / totalRelevant > 0.7 → TRUE_NO_LEADERSHIP
 *   9. 그 외 → MIXED
 *
 * 외부 부작용 0.
 */
export function computeGate2LeadershipDiagnosis(input: {
  buckets: Gate2BlockerBucket[];
  gate1Pass: number;
  blockReasons?: Gate2BlockReasons;
  sectorEnergy?: SectorEnergyDiagnostic;
}): Gate2LeadershipDiagnosis {
  const { buckets, gate1Pass, blockReasons, sectorEnergy } = input;

  if (gate1Pass <= 0) return 'NO_GATE1_SURVIVORS';

  let totalFailed = 0;
  let totalUnavailable = 0;
  let totalError = 0;
  let totalStale = 0;
  let totalWait = 0;
  for (const b of buckets) {
    totalFailed += b.failed;
    totalUnavailable += b.unavailable;
    totalError += b.error;
    totalStale += b.stale;
    totalWait += b.wait;
  }
  const totalRelevant = totalFailed + totalUnavailable + totalError + totalStale + totalWait;

  if (totalRelevant <= 0) {
    // sectorEnergy.isStale 만 있는 경우 — 진단 우선 표시.
    if (sectorEnergy?.isStale) return 'SECTOR_DATA_STALE_DOMINANT';
    return 'UNKNOWN';
  }

  // 3. SECTOR_DATA_STALE_DOMINANT — stale 비율 우세 OR sectorEnergy isStale 명시.
  if (
    totalStale / totalRelevant > GATE2_DIAGNOSIS_THRESHOLDS.STALE_DOMINANT_RATIO ||
    sectorEnergy?.isStale === true
  ) {
    return 'SECTOR_DATA_STALE_DOMINANT';
  }

  // 4. DATA_UNAVAILABLE_DOMINANT.
  if (totalUnavailable / totalRelevant > GATE2_DIAGNOSIS_THRESHOLDS.UNAVAILABLE_DOMINANT_RATIO) {
    return 'DATA_UNAVAILABLE_DOMINANT';
  }

  // 5. EVALUATOR_ERROR_DOMINANT.
  if (totalError / totalRelevant > GATE2_DIAGNOSIS_THRESHOLDS.ERROR_DOMINANT_RATIO) {
    return 'EVALUATOR_ERROR_DOMINANT';
  }

  // 6. PRE_BREAKOUT_WAIT_DOMINANT — blockReasons.preBreakoutWait OR wait bucket 비율.
  const safeGate1Pass = Math.max(1, gate1Pass);
  if (
    (blockReasons?.preBreakoutWait ?? 0) / safeGate1Pass > GATE2_DIAGNOSIS_THRESHOLDS.WAIT_DOMINANT_RATIO ||
    totalWait / totalRelevant > GATE2_DIAGNOSIS_THRESHOLDS.WAIT_DOMINANT_RATIO
  ) {
    return 'PRE_BREAKOUT_WAIT_DOMINANT';
  }

  // 7. GATE_RECHECK_DOMINANT.
  if (
    (blockReasons?.gateRecheckMiss ?? 0) / safeGate1Pass >
    GATE2_DIAGNOSIS_THRESHOLDS.GATE_RECHECK_DOMINANT_RATIO
  ) {
    return 'GATE_RECHECK_DOMINANT';
  }

  // 8. TRUE_NO_LEADERSHIP — failed 비율 우세.
  if (totalFailed / totalRelevant > GATE2_DIAGNOSIS_THRESHOLDS.TRUE_FAIL_DOMINANT_RATIO) {
    return 'TRUE_NO_LEADERSHIP';
  }

  return 'MIXED';
}

/**
 * Gate2 fresh attribution builder SSOT — 누적 buckets + 메타데이터 → 최종 snapshot.
 *
 * 정렬: bucket.failed + unavailable + error + stale + wait 합 내림차순.
 *
 * 외부 부작용 0.
 */

function buildGate2LeadershipAttribution(input: {
  sorted: Gate2BlockerBucket[];
  gate1Pass: number;
  gate2Pass: number;
  sectorEnergy?: SectorEnergyDiagnostic;
}): Gate2LeadershipAttribution {
  const conditionKeys = new Set(['momentum', 'breakout_momentum', 'turtle_high', 'vcp', 'pullback', 'trend_acceleration']);
  const fundamentalKeys = new Set(['earnings_quality', 'per', 'sectorLeadership', 'sector_leadership', 'sectorBoost', 'sector_boost']);
  const relativeStrengthKeys = new Set(['relative_strength', 'relativeStrength', 'rs', 'rs_percentile']);
  const volumeKeys = new Set(['volume_surge', 'volume_breakout', 'volumeEnergy', 'volume_energy']);
  const blockedByConditionFailCount = input.sorted
    .filter((b) => conditionKeys.has(b.conditionKey))
    .reduce((sum, b) => sum + b.failed, 0);
  const blockedByUnavailableFundamentalCount = input.sorted
    .filter((b) => fundamentalKeys.has(b.conditionKey))
    .reduce((sum, b) => sum + b.unavailable + b.stale + b.error, 0);
  const breakoutMomentumFailCount = input.sorted
    .filter((b) => b.conditionKey === 'breakout_momentum')
    .reduce((sum, b) => sum + b.failed + b.wait, 0);
  const relativeStrengthFailCount = input.sorted
    .filter((b) => relativeStrengthKeys.has(b.conditionKey))
    .reduce((sum, b) => sum + b.failed, 0);
  const volumeConfirmationFailCount = input.sorted
    .filter((b) => volumeKeys.has(b.conditionKey))
    .reduce((sum, b) => sum + b.failed, 0);
  const blockedBySectorStaleCount = input.sectorEnergy?.isStale ? input.gate1Pass : input.sorted
    .filter((b) => b.conditionKey.toLowerCase().includes('sector'))
    .reduce((sum, b) => sum + b.stale, 0);
  const denom = Math.max(1, input.gate1Pass);
  const sectorStaleContributionPct = Math.round((blockedBySectorStaleCount / denom) * 1000) / 10;
  let dominantReason: Gate2LeadershipDominantReason = 'UNKNOWN';
  if (blockedBySectorStaleCount / denom >= 0.5) dominantReason = 'SECTOR_DATA_STALE';
  else if (blockedByUnavailableFundamentalCount / denom >= 0.5) dominantReason = 'FUNDAMENTAL_DATA_UNAVAILABLE';
  else if (blockedByConditionFailCount / denom >= 0.5) dominantReason = 'BREAKOUT_MOMENTUM_NOT_CONFIRMED';
  else if (blockedBySectorStaleCount + blockedByUnavailableFundamentalCount + blockedByConditionFailCount > 0) dominantReason = 'MIXED';
  const officialCoverage = ratioFromMaybePercent(
    input.sectorEnergy?.officialIndexCoverage ?? input.sectorEnergy?.indexCodeCoverage,
  );
  const officialIndexStatus: Gate2LeadershipAttribution['officialIndex']['status'] =
    officialCoverage >= 0.8 ? 'VERIFIED'
      : officialCoverage > 0 ? 'PARTIAL'
        : 'UNAVAILABLE';
  const promotionAllowed = input.sectorEnergy?.promotionAllowed === true;
  const sourceTier = input.sectorEnergy?.selectedSectorEnergySourceTier ?? 'NONE';
  const confidence = input.sectorEnergy?.leadershipConfidence ?? (
    officialIndexStatus === 'VERIFIED' ? 'VERIFIED'
      : officialIndexStatus === 'PARTIAL' ? 'PARTIAL'
        : sourceTier === 'INTERNAL_GROUPED_SNAPSHOT' || sourceTier === 'KIS_STOCK_BASKET_DERIVED' ? 'SHADOW_ONLY'
          : 'UNKNOWN'
  );
  const shadowLeadershipAllowed = input.sectorEnergy?.shadowLeadershipAllowed === true || confidence === 'SHADOW_ONLY' || confidence === 'PARTIAL' || confidence === 'VERIFIED';
  const breakoutConfirmed = breakoutMomentumFailCount === 0;
  const blockers: Gate2LeadershipBlocker[] = [];
  if (officialCoverage <= 0) blockers.push('OFFICIAL_INDEX_UNAVAILABLE');
  if (officialCoverage < 0.8) blockers.push('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
  if (blockedBySectorStaleCount > 0 || input.sectorEnergy?.isStale) blockers.push('SECTOR_STALE');
  if (input.sectorEnergy && confidence === 'BLOCKED') blockers.push('SECTOR_UNAVAILABLE');
  if (blockedByUnavailableFundamentalCount > 0) blockers.push('FUNDAMENTAL_UNAVAILABLE');
  if (!breakoutConfirmed) blockers.push('BREAKOUT_MOMENTUM_FAIL');
  if (relativeStrengthFailCount > 0) blockers.push('RELATIVE_STRENGTH_FAIL');
  if (volumeConfirmationFailCount > 0) blockers.push('VOLUME_CONFIRMATION_FAIL');
  if (blockers.length === 0) blockers.push('NO_LEADERSHIP_AFTER_ALL_CHECKS');
  const liveLeadership = promotionAllowed && input.gate2Pass > 0;
  const finalNoLeadershipReason = liveLeadership
    ? 'LIVE_LEADERSHIP_CONFIRMED'
    : !promotionAllowed && !breakoutConfirmed
      ? 'LIVE_PROMOTION_DISABLED_AND_BREAKOUT_NOT_CONFIRMED'
      : !promotionAllowed
        ? 'LIVE_PROMOTION_DISABLED_BY_OFFICIAL_INDEX'
        : !breakoutConfirmed
          ? 'BREAKOUT_MOMENTUM_NOT_CONFIRMED'
          : 'NO_LEADERSHIP_AFTER_ALL_CHECKS';
  return {
    gate1Pass: input.gate1Pass,
    gate2Pass: input.gate2Pass,
    blockedBySectorStaleCount,
    blockedByConditionFailCount,
    blockedByUnavailableFundamentalCount,
    sectorStaleContributionPct,
    dominantReason,
    officialIndex: {
      status: officialIndexStatus,
      coverage: officialCoverage,
      promotionAllowed,
      impact: promotionAllowed ? 'NONE' : 'NO_LIVE_PROMOTION_ONLY',
    },
    shadowSector: {
      status: shadowLeadershipAllowed ? 'AVAILABLE' : 'UNAVAILABLE',
      sourceTier,
      shadowLeadershipAllowed,
      confidence,
    },
    breakoutMomentum: {
      status: breakoutConfirmed ? 'CONFIRMED' : 'NOT_CONFIRMED',
      blocker: breakoutConfirmed ? 'NONE' : 'BREAKOUT_MOMENTUM_FAIL',
    },
    final: {
      liveLeadership,
      shadowLeadership: shadowLeadershipAllowed,
      noLeadershipReason: finalNoLeadershipReason,
      executionImpact: 'NONE',
    },
    blockers,
  };
}

export function buildGate2FreshAttribution(input: {
  buckets: Gate2BlockerBucket[];
  candidates: number;
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  entries: number;
  lastTriggerPass: number;
  blockReasons?: Gate2BlockReasons;
  sectorEnergy?: SectorEnergyDiagnostic;
  scanId?: string;
  scannedAtKst?: string;
}): Gate2FreshAttribution {
  for (const b of input.buckets) finalizeGate2BucketRates(b);

  const sorted = [...input.buckets].sort((a, b) => {
    const aRel = a.failed + a.unavailable + a.error + a.stale + a.wait;
    const bRel = b.failed + b.unavailable + b.error + b.stale + b.wait;
    if (bRel !== aRel) return bRel - aRel;
    return a.conditionKey.localeCompare(b.conditionKey);
  });

  const conditionGaps = sorted.flatMap((b) => b.conditionGaps ?? []);
  const nearMissConditions = Array.from(new Set(conditionGaps.filter((g) => g.nearMiss).map((g) => g.code))).sort();

  const recommendedDiagnosis = computeGate2LeadershipDiagnosis({
    buckets: sorted,
    gate1Pass: input.gate1Pass,
    blockReasons: input.blockReasons,
    sectorEnergy: input.sectorEnergy,
  });
  const leadershipAttribution = buildGate2LeadershipAttribution({
    sorted,
    gate1Pass: input.gate1Pass,
    gate2Pass: input.gate2Pass,
    ...(input.sectorEnergy ? { sectorEnergy: input.sectorEnergy } : {}),
  });
  const gate2TrueFailedCount = sorted.reduce((sum, b) => sum + b.failed, 0);
  const gate2UnavailableCount = sorted.reduce((sum, b) => sum + b.unavailable + b.stale + b.error, 0);
  const waitPreserved = input.blockReasons?.preBreakoutWait ?? sorted.reduce((sum, b) => sum + b.wait, 0);
  const sizingPreserved = input.blockReasons?.sizingBlocked ?? 0;
  const nearMissPreserved = nearMissConditions.length;
  const softPreserved = input.gate1Pass > 0 && input.gate2Pass === 0
    ? Math.max(
        waitPreserved + sizingPreserved,
        gate2UnavailableCount > 0 ? Math.min(input.gate1Pass, gate2UnavailableCount) : 0,
        nearMissPreserved > 0 ? Math.min(input.gate1Pass, nearMissPreserved) : 0,
      )
    : 0;

  return {
    ...(input.scanId ? { scanId: input.scanId } : {}),
    ...(input.scannedAtKst ? { scannedAtKst: input.scannedAtKst } : {}),
    candidates: input.candidates,
    gate1Pass: input.gate1Pass,
    gate2Pass: input.gate2Pass,
    gate3Pass: input.gate3Pass,
    entries: input.entries,
    lastTriggerPass: input.lastTriggerPass,
    buckets: sorted,
    conditionGaps,
    nearMissConditions,
    topFailedCondition: pickTopBucket(sorted, 'failed'),
    topUnavailableCondition: pickTopBucket(sorted, 'unavailable'),
    topErrorCondition: pickTopBucket(sorted, 'error'),
    topStaleCondition: pickTopBucket(sorted, 'stale'),
    topWaitCondition: pickTopBucket(sorted, 'wait'),
    gate2TrueFailedCount,
    gate2UnavailableCount,
    gate2WatchPreservedCount: softPreserved,
    gate2ShadowPreservedCount: softPreserved,
    ...(input.sectorEnergy ? { sectorEnergy: input.sectorEnergy } : {}),
    ...(input.blockReasons ? { blockReasons: input.blockReasons } : {}),
    leadershipAttribution,
    recommendedDiagnosis,
  };
}

/**
 * SectorEnergyDiagnostic SSOT 빌더 — macroState 영속 필드 → diagnostic 객체.
 *
 * isStale 결정: dataQuality === 'STALE' 또는 'DEGRADED' 시 true. validSectorCount 가
 * expected 보다 부족해도 dataQuality 가 OK 인 경우는 false.
 *
 * 외부 부작용 0.
 */
export function buildSectorEnergyDiagnostic(input: {
  dataQuality?: string;
  validSectorCount?: number;
  expectedSectorCount?: number;
  reasons?: string[];
  indexCodeCoverage?: number;
  officialIndexCoverage?: number;
  internalProxyCoverage?: number;
  stockBasketCoverage?: number;
  selectedSectorEnergySourceTier?: string;
  leadershipConfidence?: 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED';
  promotionAllowed?: boolean;
  sectorBoostAllowed?: boolean;
  strongBuyAllowed?: boolean;
  shadowLeadershipAllowed?: boolean;
  counterfactualAllowed?: boolean;
  reasonCodes?: string[];
}): SectorEnergyDiagnostic {
  const isStale =
    input.dataQuality === 'STALE' ||
    input.dataQuality === 'DEGRADED' ||
    input.dataQuality === 'FAILED';
  return {
    ...(input.dataQuality ? { dataQuality: input.dataQuality } : {}),
    ...(typeof input.validSectorCount === 'number' ? { validSectorCount: input.validSectorCount } : {}),
    ...(typeof input.expectedSectorCount === 'number'
      ? { expectedSectorCount: input.expectedSectorCount }
      : {}),
    ...(input.reasons && input.reasons.length > 0 ? { reason: input.reasons.slice(0, 3).join(' / ') } : {}),
    ...(typeof input.indexCodeCoverage === 'number'
      ? { indexCodeCoverage: input.indexCodeCoverage }
      : {}),
    ...(typeof input.officialIndexCoverage === 'number'
      ? { officialIndexCoverage: input.officialIndexCoverage }
      : {}),
    ...(typeof input.internalProxyCoverage === 'number'
      ? { internalProxyCoverage: input.internalProxyCoverage }
      : {}),
    ...(typeof input.stockBasketCoverage === 'number'
      ? { stockBasketCoverage: input.stockBasketCoverage }
      : {}),
    ...(input.selectedSectorEnergySourceTier ? { selectedSectorEnergySourceTier: input.selectedSectorEnergySourceTier } : {}),
    ...(input.leadershipConfidence ? { leadershipConfidence: input.leadershipConfidence } : {}),
    ...(typeof input.promotionAllowed === 'boolean' ? { promotionAllowed: input.promotionAllowed } : {}),
    ...(typeof input.sectorBoostAllowed === 'boolean' ? { sectorBoostAllowed: input.sectorBoostAllowed } : {}),
    ...(typeof input.strongBuyAllowed === 'boolean' ? { strongBuyAllowed: input.strongBuyAllowed } : {}),
    ...(typeof input.shadowLeadershipAllowed === 'boolean' ? { shadowLeadershipAllowed: input.shadowLeadershipAllowed } : {}),
    ...(typeof input.counterfactualAllowed === 'boolean' ? { counterfactualAllowed: input.counterfactualAllowed } : {}),
    ...(input.reasonCodes && input.reasonCodes.length > 0 ? { reasonCodes: input.reasonCodes } : {}),
    isStale,
  };
}

/**
 * Gate2 fresh attribution 운영자 가이드 SSOT (사용자 §E 권장 메시지).
 *
 * 매매 정책 변경 입력 절대 아님 — 운영자 *데이터 점검 우선순위* 만 안내.
 */
export function describeGate2Diagnosis(diagnosis: Gate2LeadershipDiagnosis): string | null {
  switch (diagnosis) {
    case 'TRUE_NO_LEADERSHIP':
      return 'Gate2 통과 0개. 시장 안정 + 진짜 주도주 부재. 매매 정책 변경 불필요 — 다음 사이클 자연 대기.';
    case 'SECTOR_DATA_STALE_DOMINANT':
      return 'sectorEnergy STALE 우세. Gate2 완화 전 sector data 점검 우선 (ADR-0423 후속 PR scope).';
    case 'DATA_UNAVAILABLE_DOMINANT':
      return 'DATA_UNAVAILABLE 비중 높음. Gate2 완화 전 데이터 소스 점검 우선 (KRX/NAVER/CACHE).';
    case 'EVALUATOR_ERROR_DOMINANT':
      return 'evaluator error 비중 높음. evaluator patch 가 우선 — Gate2 임계 변경 부적합.';
    case 'PRE_BREAKOUT_WAIT_DOMINANT':
      return 'Pre-breakout WAIT 우세. 후보는 있으나 진입 트리거 미발동 — 다음 사이클 재시도.';
    case 'GATE_RECHECK_DOMINANT':
      return 'Gate 재검증 미달 우세. minGate 임계 또는 sectorBoost 검토 (ADR-0075/0125 정합).';
    case 'MIXED':
      return 'failed/unavailable/error/stale/wait 가 혼재. 단일 임계 변경 권고 부적합 — 운영자 종합 검토 필요.';
    case 'NO_GATE1_SURVIVORS':
      return 'Gate1 통과자 0 — Gate2 분해 무의미. /scan_blockers GATE1_PASS_ZERO 우선 확인 (ADR-0420).';
    case 'UNKNOWN':
      return 'Gate2 attribution 데이터 부족 — 다음 스캔 후 재검토.';
  }
}

/**
 * /scan_blockers 메시지 Gate2 attribution 섹션 SSOT (사용자 §G 정합).
 *
 * `attribution` undefined 시 null (정상 시 미노출).
 *
 * 표시 정책:
 *   - gate1Pass>0 + gate2Pass=0 시점에만 노출 (Gate2 PASS_ZERO 진단 핵심 의도).
 *   - gate1Pass=0 → NO_GATE1_SURVIVORS 진단 시점은 ADR-0420 fresh attribution 이 노출.
 *   - 텔레그램 메시지 길이 제한 — Top 5 만 표시 (사용자 §G).
 *
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 — 진단 only.
 *   - last 7 days /gate_audit 와 분리 명시 (사용자 §H).
 */
export function formatGate2AttributionSection(
  attribution: Gate2FreshAttribution | null | undefined,
  options?: { topN?: number },
): string | null {
  if (!attribution) return null;
  // 정책: gate1Pass=0 시 ADR-0420 GATE1_PASS_ZERO 분석 우선 — 본 섹션 미노출.
  if (attribution.gate1Pass <= 0) return null;
  // 정책: gate2Pass>0 (정상 운영) 시 미노출 — Gate2_PASS_ZERO 만 진단 가치.
  if (attribution.gate2Pass > 0) return null;

  const topN = Math.max(1, Math.min(options?.topN ?? 5, attribution.buckets.length));
  const topBuckets = attribution.buckets.slice(0, topN);

  const lines: string[] = [];
  lines.push('🚧 <b>Gate2 / Leadership blockers (ADR-0422 fresh attribution):</b>');
  lines.push(
    `  • candidates=${attribution.candidates} gate1Pass=${attribution.gate1Pass} gate2Pass=${attribution.gate2Pass}`,
  );
  lines.push(
    `  • split: gate2TrueFailedCount=${attribution.gate2TrueFailedCount} / ` +
    `gate2UnavailableCount=${attribution.gate2UnavailableCount} / ` +
    `gate2WatchPreservedCount=${attribution.gate2WatchPreservedCount} / ` +
    `gate2ShadowPreservedCount=${attribution.gate2ShadowPreservedCount}`,
  );

  const leadership = attribution.leadershipAttribution;
  lines.push(
    `  • Gate2LeadershipAttribution: sectorStale=${leadership.blockedBySectorStaleCount} / ` +
    `conditionFail=${leadership.blockedByConditionFailCount} / ` +
    `fundamentalUnavailable=${leadership.blockedByUnavailableFundamentalCount} / ` +
    `sectorStaleContributionPct=${leadership.sectorStaleContributionPct.toFixed(1)}% / ` +
    `dominant=${leadership.dominantReason}`,
  );

  lines.push(
    `  officialIndex: status=${leadership.officialIndex.status} coverage=${(leadership.officialIndex.coverage * 100).toFixed(1)}% ` +
    `promotionAllowed=${leadership.officialIndex.promotionAllowed} impact=${leadership.officialIndex.impact}`,
  );
  lines.push(
    `  shadowSector: status=${leadership.shadowSector.status} sourceTier=${leadership.shadowSector.sourceTier} ` +
    `shadowLeadershipAllowed=${leadership.shadowSector.shadowLeadershipAllowed} confidence=${leadership.shadowSector.confidence}`,
  );
  lines.push(`  breakoutMomentum: status=${leadership.breakoutMomentum.status} blocker=${leadership.breakoutMomentum.blocker}`);
  lines.push(
    `  final: liveLeadership=${leadership.final.liveLeadership} shadowLeadership=${leadership.final.shadowLeadership} ` +
    `noLeadershipReason=${leadership.final.noLeadershipReason} executionImpact=${leadership.final.executionImpact}`,
  );
  lines.push(`  blockers: ${leadership.blockers.join(',')}`);

  if (attribution.nearMissConditions.length > 0) {
    lines.push(`  • nearMissConditions: ${attribution.nearMissConditions.slice(0, 8).join(', ')}`);
  }
  if (topBuckets.length > 0) {
    lines.push('  • Top condition blockers:');
    for (const b of topBuckets) {
      lines.push(
        `    ${b.conditionKey} — failed ${b.failed} / unavailable ${b.unavailable} / error ${b.error} / stale ${b.stale} / wait ${b.wait}`,
      );
    }
  }

  // top* 항목 (사용자 §G 권장 출력).
  const topFailed = attribution.topFailedCondition;
  const topUnavailable = attribution.topUnavailableCondition;
  const topError = attribution.topErrorCondition;
  const topStale = attribution.topStaleCondition;
  const topWait = attribution.topWaitCondition;
  if (topFailed) {
    lines.push(`  • topFailedCondition: ${topFailed.conditionKey} failed=${topFailed.failed}/${topFailed.total}`);
  }
  if (topUnavailable) {
    lines.push(
      `  • topUnavailableCondition: ${topUnavailable.conditionKey} unavailable=${topUnavailable.unavailable}/${topUnavailable.total}`,
    );
  }
  if (topError) {
    lines.push(`  • topErrorCondition: ${topError.conditionKey} error=${topError.error}/${topError.total}`);
  } else {
    lines.push('  • topErrorCondition: none');
  }
  if (topStale) {
    lines.push(`  • topStaleCondition: ${topStale.conditionKey} stale=${topStale.stale}/${topStale.total}`);
  }
  if (topWait) {
    lines.push(`  • topWaitCondition: ${topWait.conditionKey} wait=${topWait.wait}/${topWait.total}`);
  }

  // blockReasons (Gate 재검증 미달 / Pre-breakout WAIT / Sizing advisory / Drift REMOVE).
  const br = attribution.blockReasons;
  if (br) {
    const items: string[] = [];
    if (br.gateRecheckMiss > 0) items.push(`Gate 재검증 미달 ${br.gateRecheckMiss}`);
    if (br.preBreakoutWait > 0) items.push(`Pre-breakout WAIT ${br.preBreakoutWait}`);
    if (br.sizingBlocked > 0) items.push(`SIZING_ADVISORY_LOW ${br.sizingBlocked} (hardBlock=0)`);
    if (br.driftRemove > 0) items.push(`Drift REMOVE ${br.driftRemove}`);
    if (items.length > 0) {
      lines.push(`  • 차단 사유: ${items.join(' / ')}`);
    }
  }

  // sectorEnergy 진단 (사용자 §F — 표시 only, 수정 금지).
  const se = attribution.sectorEnergy;
  if (se && (se.dataQuality !== undefined || se.isStale)) {
    lines.push('');
    lines.push('🌐 <b>SectorEnergy 진단 (ADR-0422 — 표시 only, ADR-0423 후속 PR 수리):</b>');
    if (se.dataQuality) lines.push(`  • dataQuality: ${se.dataQuality}`);
    if (typeof se.validSectorCount === 'number') {
      const expected =
        typeof se.expectedSectorCount === 'number' ? `/${se.expectedSectorCount}` : '';
      lines.push(`  • validSectorCount: ${se.validSectorCount}${expected}`);
    }
    if (se.reason) lines.push(`  • reason: ${se.reason}`);
    if (typeof se.officialIndexCoverage === 'number') {
      lines.push(`  officialIndexCoverage: ${(ratioFromMaybePercent(se.officialIndexCoverage) * 100).toFixed(1)}%`);
    }
    if (typeof se.internalProxyCoverage === 'number') {
      lines.push(`  internalProxyCoverage: ${(ratioFromMaybePercent(se.internalProxyCoverage) * 100).toFixed(1)}%`);
    }
    if (typeof se.stockBasketCoverage === 'number') {
      lines.push(`  stockBasketCoverage: ${(ratioFromMaybePercent(se.stockBasketCoverage) * 100).toFixed(1)}%`);
    }
    if (se.selectedSectorEnergySourceTier) lines.push(`  selectedSectorEnergySourceTier: ${se.selectedSectorEnergySourceTier}`);
    if (se.leadershipConfidence) lines.push(`  leadershipConfidence: ${se.leadershipConfidence}`);
    if (typeof se.promotionAllowed === 'boolean') lines.push(`  promotionAllowed: ${se.promotionAllowed}`);
    if (typeof se.sectorBoostAllowed === 'boolean') lines.push(`  sectorBoostAllowed: ${se.sectorBoostAllowed}`);
    if (typeof se.strongBuyAllowed === 'boolean') lines.push(`  strongBuyAllowed: ${se.strongBuyAllowed}`);
    if (typeof se.shadowLeadershipAllowed === 'boolean') lines.push(`  shadowLeadershipAllowed: ${se.shadowLeadershipAllowed}`);
    if (typeof se.counterfactualAllowed === 'boolean') lines.push(`  counterfactualAllowed: ${se.counterfactualAllowed}`);
    if (typeof se.indexCodeCoverage === 'number') {
      lines.push(`  • indexCodeCoverage: ${(se.indexCodeCoverage * 100).toFixed(1)}%`);
    }
  }

  lines.push('');
  lines.push(`🎯 <b>진단:</b> <b>${attribution.recommendedDiagnosis}</b>`);
  const guidance = describeGate2Diagnosis(attribution.recommendedDiagnosis);
  if (guidance) {
    lines.push(`  • <i>${guidance}</i>`);
  }

  lines.push('');
  lines.push('  <i>* fresh attribution 은 직전 스캔 snapshot 기준 — last 7 days 누적</i>');
  lines.push('  <i>  audit 와 분리 (/gate_audit 는 누적, /scan_blockers 는 fresh).</i>');

  return lines.join('\n');
}
