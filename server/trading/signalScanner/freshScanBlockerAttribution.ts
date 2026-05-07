/**
 * @responsibility ADR-0420 Fresh Scan Blocker Attribution SSOT — 직전 스캔 단위 조건별 분해
 *
 * ADR-0420:
 * GATE1_PASS_ZERO is an aggregate symptom, not a root cause.
 * Fresh scan blocker attribution decomposes the last scan by condition status
 * so operators can distinguish true threshold rejection from DATA_UNAVAILABLE
 * and EVALUATOR_ERROR dominated scans.
 *
 * This module must not change gate thresholds, weights, or trading policy.
 * It only improves observability of the latest scan.
 *
 * 사용자 명시 핵심 불변식:
 *   1. GATE1_PASS_ZERO 는 단일 원인이 아니다. 반드시 조건별 분해가 필요하다.
 *   2. DATA_UNAVAILABLE 은 failed 가 아니다.
 *   3. unavailable/error 가 우세한 경우 Gate threshold 검토로 이어지면 안 된다.
 *   4. fresh scan 기준 attribution 과 last 7 days 누적 audit 은 분리되어야 한다.
 *   5. 이번 PR 은 관측성/진단 PR 이다. Gate threshold, weight, 매매 정책은
 *      절대 바꾸지 않는다.
 *
 * SSOT 재사용:
 *   - status 분류는 `inferStatusFromLegacyResult` (gateAuditRepo, ADR-0388) 위임.
 *   - 본 모듈은 *fresh scan snapshot* 만 담당. last 7 days 누적은 gateAuditRepo 분리.
 *
 * Gate stage 분리 한계:
 *   - 서버 측에는 명시적 Gate1/Gate2/Gate3 condition-key 분류가 없다 (클라이언트만 보유).
 *   - 따라서 본 모듈은 *all outputs 기준 fresh condition attribution* 으로 명명.
 *   - Gate1 precise stage tagging 은 후속 PR scope (TODO: ADR-0421 검토).
 *
 * 외부 의존성: 0 (KIS/Yahoo/외부 API 호출 0건).
 */

import { inferStatusFromLegacyResult } from '../../persistence/gateAuditRepo.js';
import type { ConditionEvalOutput } from '../../quant/conditions/types.js';

/**
 * 조건별 fresh 카운터.
 *
 * 분류 (사용자 §C 정합):
 *   - status === 'FIRED'             → passed++
 *   - status === 'THRESHOLD_NOT_MET' → failed++
 *   - status === 'DATA_UNAVAILABLE' / 'PROVIDER_DEGRADED' → unavailable++
 *   - status === 'SKIPPED_BY_POLICY' / 'SANITY_REJECTED' → skipped++
 *   - status === 'ERROR'             → error++
 *   - output null + context.hadRequiredData=false → unavailable++
 *   - output null + 그 외 → failed++ (legacy fallback via inferStatusFromLegacyResult)
 */
export interface ConditionBlockerBucket {
  conditionKey: string;
  passed: number;
  failed: number;
  unavailable: number;
  error: number;
  skipped: number;
  total: number;
  failedRate: number;
  unavailableRate: number;
  errorRate: number;
}

/**
 * 진단 분류 (사용자 §B + §H 정합).
 *
 * 운영자 가이드 — 매매 정책 변경 입력 절대 아님 (사용자 명시 핵심 불변식 #5).
 */
export type FreshScanDiagnosis =
  | 'TRUE_GATE1_REJECTION'
  | 'DATA_UNAVAILABLE_DOMINANT'
  | 'EVALUATOR_ERROR_DOMINANT'
  | 'MIXED'
  | 'NO_CANDIDATES'
  | 'UNKNOWN';

/**
 * Fresh scan blocker attribution snapshot — 직전 단일 스캔의 분해 결과.
 *
 * Gate1 precise stage tagging 은 후속 PR scope (서버 측 condition-key 매핑 SSOT
 * 부재). 본 PR 에서는 *all outputs 기준 fresh condition attribution* 사용.
 */
export interface FreshScanBlockerAttribution {
  scanId?: string;
  scannedAtKst?: string;
  candidates: number;
  entries: number;
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  lastTriggerPass: number;
  /** 조건별 fresh bucket (failed+unavailable+error 합 내림차순 정렬). */
  buckets: ConditionBlockerBucket[];
  /** failed 카운트 최대 condition (failed=0 시 undefined). */
  topFailedCondition?: ConditionBlockerBucket;
  /** unavailable 카운트 최대 condition (unavailable=0 시 undefined). */
  topUnavailableCondition?: ConditionBlockerBucket;
  /** error 카운트 최대 condition (error=0 시 undefined). */
  topErrorCondition?: ConditionBlockerBucket;
  /** 운영자 가이드 분류 — 매매 정책 변경 입력 아님. */
  recommendedDiagnosis: FreshScanDiagnosis;
}

/**
 * 단일 후보 평가 outputs 입력 형식 (recordGateAuditByStatus 와 동일).
 *
 * `gate.outputs` 직접 그대로 전달 가능 — schema 정합.
 */
export type FreshAttributionOutputItem = {
  key: string;
  output: Pick<ConditionEvalOutput, 'score' | 'status'> | null;
  context?: { evaluatorKey?: string; hadRequiredData?: boolean; skippedByPolicy?: boolean };
};

/**
 * SSOT 임계 — 분기별 정수 이름 (사용자 §H 정합, 변경 시 ADR 갱신 의무).
 *
 * 절대 변경 금지: 본 임계는 *진단 가이드만* 결정 — 매매 결정 무관.
 */
export const FRESH_DIAGNOSIS_THRESHOLDS = {
  /** unavailable / totalRelevant > 0.5 시 DATA_UNAVAILABLE_DOMINANT. */
  UNAVAILABLE_DOMINANT_RATIO: 0.5,
  /** error / totalRelevant > 0.3 시 EVALUATOR_ERROR_DOMINANT. */
  ERROR_DOMINANT_RATIO: 0.3,
  /** failed / totalRelevant > 0.7 시 TRUE_GATE1_REJECTION. */
  TRUE_FAIL_DOMINANT_RATIO: 0.7,
} as const;

/**
 * fresh outputs 누적기 — 단일 후보의 `gate.outputs` 를 conditionKey 별 bucket 에 가산.
 *
 * SSOT: status 분류는 `inferStatusFromLegacyResult` 위임.
 *
 * 멱등 (동일 결과 재호출 시 단순 누적). 외부 부작용 0.
 */
export function accumulateFreshAttribution(
  acc: Map<string, ConditionBlockerBucket>,
  outputs: FreshAttributionOutputItem[],
): void {
  for (const { key, output, context } of outputs) {
    let bucket = acc.get(key);
    if (!bucket) {
      bucket = {
        conditionKey: key,
        passed: 0,
        failed: 0,
        unavailable: 0,
        error: 0,
        skipped: 0,
        total: 0,
        failedRate: 0,
        unavailableRate: 0,
        errorRate: 0,
      };
      acc.set(key, bucket);
    }
    const status = inferStatusFromLegacyResult(output, context);
    switch (status) {
      case 'FIRED':
        bucket.passed += 1;
        break;
      case 'THRESHOLD_NOT_MET':
        bucket.failed += 1;
        break;
      case 'DATA_UNAVAILABLE':
      case 'PROVIDER_DEGRADED':
        bucket.unavailable += 1;
        break;
      case 'SKIPPED_BY_POLICY':
      case 'SANITY_REJECTED':
        bucket.skipped += 1;
        break;
      case 'ERROR':
        bucket.error += 1;
        break;
    }
    bucket.total += 1;
  }
}

/**
 * bucket 의 *Rate 필드 후처리 — total 변경 시 호출.
 *
 * total=0 시 모든 rate 0 (NaN 방지). 외부 부작용 0.
 */
export function finalizeBucketRates(bucket: ConditionBlockerBucket): void {
  if (bucket.total <= 0) {
    bucket.failedRate = 0;
    bucket.unavailableRate = 0;
    bucket.errorRate = 0;
    return;
  }
  bucket.failedRate = bucket.failed / bucket.total;
  bucket.unavailableRate = bucket.unavailable / bucket.total;
  bucket.errorRate = bucket.error / bucket.total;
}

/**
 * 진단 분류 SSOT — 사용자 §H 결정 트리 정확 정합.
 *
 * 결정 트리 (위에서 아래로 첫 매칭):
 *   1. candidates === 0 → NO_CANDIDATES
 *   2. totalRelevant (failed+unavailable+error) === 0 → UNKNOWN
 *   3. unavailable / totalRelevant > 0.5 → DATA_UNAVAILABLE_DOMINANT
 *   4. error / totalRelevant > 0.3 → EVALUATOR_ERROR_DOMINANT
 *   5. failed / totalRelevant > 0.7 → TRUE_GATE1_REJECTION
 *   6. 그 외 → MIXED
 *
 * 외부 부작용 0.
 */
export function computeRecommendedDiagnosis(
  buckets: ConditionBlockerBucket[],
  candidates: number,
): FreshScanDiagnosis {
  if (candidates <= 0) return 'NO_CANDIDATES';
  let totalFailed = 0;
  let totalUnavailable = 0;
  let totalError = 0;
  for (const b of buckets) {
    totalFailed += b.failed;
    totalUnavailable += b.unavailable;
    totalError += b.error;
  }
  const totalRelevant = totalFailed + totalUnavailable + totalError;
  if (totalRelevant <= 0) return 'UNKNOWN';
  if (totalUnavailable / totalRelevant > FRESH_DIAGNOSIS_THRESHOLDS.UNAVAILABLE_DOMINANT_RATIO) {
    return 'DATA_UNAVAILABLE_DOMINANT';
  }
  if (totalError / totalRelevant > FRESH_DIAGNOSIS_THRESHOLDS.ERROR_DOMINANT_RATIO) {
    return 'EVALUATOR_ERROR_DOMINANT';
  }
  if (totalFailed / totalRelevant > FRESH_DIAGNOSIS_THRESHOLDS.TRUE_FAIL_DOMINANT_RATIO) {
    return 'TRUE_GATE1_REJECTION';
  }
  return 'MIXED';
}

/**
 * Top-N 추출 SSOT — 카운트 내림차순 + 동률 시 conditionKey 알파벳 (deterministic).
 *
 * 카운트=0 시 undefined.
 */
function pickTop(
  buckets: ConditionBlockerBucket[],
  field: 'failed' | 'unavailable' | 'error',
): ConditionBlockerBucket | undefined {
  let top: ConditionBlockerBucket | undefined;
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
 * Fresh scan blocker attribution builder SSOT — 누적 buckets + 메타데이터 → 최종 snapshot.
 *
 * 정렬: bucket.failed + unavailable + error 합 내림차순 (운영자 시각 가시성).
 *
 * 외부 부작용 0.
 */
export function buildFreshScanBlockerAttribution(input: {
  buckets: ConditionBlockerBucket[];
  candidates: number;
  entries: number;
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  lastTriggerPass: number;
  scanId?: string;
  scannedAtKst?: string;
}): FreshScanBlockerAttribution {
  for (const b of input.buckets) finalizeBucketRates(b);

  const sorted = [...input.buckets].sort((a, b) => {
    const aRel = a.failed + a.unavailable + a.error;
    const bRel = b.failed + b.unavailable + b.error;
    if (bRel !== aRel) return bRel - aRel;
    return a.conditionKey.localeCompare(b.conditionKey);
  });

  return {
    ...(input.scanId ? { scanId: input.scanId } : {}),
    ...(input.scannedAtKst ? { scannedAtKst: input.scannedAtKst } : {}),
    candidates: input.candidates,
    entries: input.entries,
    gate1Pass: input.gate1Pass,
    gate2Pass: input.gate2Pass,
    gate3Pass: input.gate3Pass,
    lastTriggerPass: input.lastTriggerPass,
    buckets: sorted,
    topFailedCondition: pickTop(sorted, 'failed'),
    topUnavailableCondition: pickTop(sorted, 'unavailable'),
    topErrorCondition: pickTop(sorted, 'error'),
    recommendedDiagnosis: computeRecommendedDiagnosis(sorted, input.candidates),
  };
}

/**
 * /scan_blockers 메시지 fresh attribution 섹션 SSOT (사용자 §F 정합).
 *
 * `attribution` undefined 시 null (정상 시 미노출). gate1Pass>0 (즉 진입 0건 아님)
 * 시에도 진단 가치는 있지만, *GATE1_PASS_ZERO 상세* 가 본 PR 핵심 의도이므로
 * gate1Pass=0 + candidates>0 시점에만 노출 (잡음 차단).
 *
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 금지 — 진단 only (ADR-0412/0414 정합).
 *   - last 7 days gate_audit 와 fresh blockers 분리 명시 (사용자 §F 핵심).
 *   - 텔레그램 메시지 길이 제한 — Top 4 만 표시 (사용자 §L 권장).
 */
export function formatFreshAttributionSection(
  attribution: FreshScanBlockerAttribution | null | undefined,
  options?: { topN?: number },
): string | null {
  if (!attribution) return null;
  // 정책: gate1Pass>0 (정상 운영) 또는 candidates=0 (NO_CANDIDATES) 시 미노출.
  // GATE1_PASS_ZERO + 후보 1+ 인 시점만 운영자에게 가치 있는 진단.
  if (attribution.candidates <= 0) return null;
  if (attribution.gate1Pass > 0) return null;

  const topN = Math.max(1, Math.min(options?.topN ?? 4, attribution.buckets.length));
  const topBuckets = attribution.buckets.slice(0, topN);

  const lines: string[] = [];
  lines.push('🚧 <b>GATE1_PASS_ZERO 상세 (ADR-0420 fresh attribution):</b>');
  lines.push(
    `  • candidates=${attribution.candidates} entries=${attribution.entries} gate1Pass=${attribution.gate1Pass}`,
  );

  // Top blockers (failed/unavailable/error 분리).
  if (topBuckets.length > 0) {
    lines.push('  • Top condition blockers:');
    for (const b of topBuckets) {
      lines.push(
        `    ${b.conditionKey} — failed ${b.failed} / unavailable ${b.unavailable} / error ${b.error}`,
      );
    }
  }

  // top* 항목 (사용자 §F 권장 출력).
  const topFailed = attribution.topFailedCondition;
  const topUnavailable = attribution.topUnavailableCondition;
  const topError = attribution.topErrorCondition;
  if (topFailed) {
    lines.push(
      `  • topFailedCondition: ${topFailed.conditionKey} failed=${topFailed.failed}/${topFailed.total}`,
    );
  }
  if (topUnavailable) {
    lines.push(
      `  • topUnavailableCondition: ${topUnavailable.conditionKey} unavailable=${topUnavailable.unavailable}/${topUnavailable.total}`,
    );
  } else {
    lines.push('  • topUnavailableCondition: none');
  }
  if (topError) {
    lines.push(
      `  • topErrorCondition: ${topError.conditionKey} error=${topError.error}/${topError.total}`,
    );
  } else {
    lines.push('  • topErrorCondition: none');
  }

  lines.push(`  • diagnosis: <b>${attribution.recommendedDiagnosis}</b>`);

  // 진단 분류별 운영자 가이드 메시지 (사용자 §E 권장).
  const guidance = describeFreshDiagnosis(attribution.recommendedDiagnosis);
  if (guidance) {
    lines.push(`  • <i>${guidance}</i>`);
  }

  lines.push('');
  lines.push('  <i>* fresh attribution 은 직전 스캔 snapshot 기준 — last 7 days 누적</i>');
  lines.push('  <i>  audit 와 분리 (/gate_audit 는 누적, /scan_blockers 는 fresh).</i>');

  return lines.join('\n');
}

/**
 * 진단 분류별 운영자 가이드 문구 SSOT (사용자 §E 권장).
 *
 * 매매 정책 변경 입력 절대 아님 — 운영자 *데이터 점검 우선순위* 만 안내.
 */
export function describeFreshDiagnosis(diagnosis: FreshScanDiagnosis): string | null {
  switch (diagnosis) {
    case 'TRUE_GATE1_REJECTION':
      return 'Gate1 통과 0개. 데이터 부재/오류보다 실제 조건 미달이 우세합니다. 다음 스캔 자연 회복 가능 — 매매 정책 변경 불필요.';
    case 'DATA_UNAVAILABLE_DOMINANT':
      return 'Gate1 통과 0개이나 DATA_UNAVAILABLE 비중이 높습니다. Gate 완화 전 데이터 소스 점검이 우선입니다.';
    case 'EVALUATOR_ERROR_DOMINANT':
      return 'Gate1 통과 0개이나 evaluator error 비중이 높습니다. evaluator patch 가 우선입니다.';
    case 'MIXED':
      return 'failed/unavailable/error 가 혼재합니다. 단일 임계 변경 권고 부적합 — 운영자 종합 검토 필요.';
    case 'NO_CANDIDATES':
      return '후보 0개 — Gate 분해 무의미. 워치리스트 수집 단계 점검 필요.';
    case 'UNKNOWN':
      return 'fresh attribution 데이터 부족 — 다음 스캔 후 재검토.';
  }
}
