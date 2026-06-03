/**
 * @responsibility ADR-0557 Consumer Contract — UnifiedSourceSnapshot.perSymbol freshness 를 진단/관찰(observability) 카운트로 집계·노출. 판단(gate/score/permission/주문) 영향 0.
 *
 * ADR-0556 묶음0 dead carry 해소: SymbolDataCollector(생산자)가 채운
 * `SymbolSnapshotData.freshness`(per-field DataHealth 매핑)의 최소 소비처.
 *
 * 엄격 계약:
 *   1. 진단/관찰 전용 — freshness 를 읽어 FRESH/STALE/MISSING/DEGRADED 카운트로 *노출*만 한다.
 *      gate 점수·confidence·executionPermission·후보 선정·주문에 절대 영향 0 (불변식 #5).
 *   2. flag ON 경로 전용 — freshness 는 USE_UNIFIED_SOURCE_SNAPSHOT=true 에서만 산출되므로,
 *      소비도 perSymbol 부재(undefined) 시 미실행 → byte-equivalent.
 *   3. 신규 store/타입 신설 0 — 기존 DataHealth 어휘 + SymbolFieldFreshness 만 읽는다.
 *   4. throw 금지(불변식 #1) — undefined/부분 결측은 graceful 하게 무시한다.
 *
 * 불변식 #6: freshness.providerIssue=true 여도 marketSignal 은 항상 false — 본 요약은
 * provider 건강 *데이터*일 뿐 시장(약세) 신호로 변환하지 않는다.
 */

import type { SymbolSnapshotData } from '../sourceSnapshot/symbolSnapshotData.js';
import type { DataHealth } from '../../../src/types/shadowCase.js';

/** per-field DataHealth 별 종목 카운트 (관찰 전용). */
export interface PerSymbolFreshnessSummary {
  /** freshness 가 산출된(=flag ON) 종목 수. */
  symbolsWithFreshness: number;
  /** freshness 미산출 종목 수 (flag OFF 또는 부분 결측). */
  symbolsWithoutFreshness: number;
  /** 한 개 이상 필드가 STALE/MISSING/DEGRADED 로 격리된 종목 수 (providerIssue=true). */
  providerIssueSymbols: number;
  /** 필드별 DataHealth 등급 카운트 합산 (quote+technicalIndicators+supply+dartFinancials). */
  fieldHealthCounts: Record<DataHealth, number>;
}

const EMPTY_HEALTH_COUNTS = (): Record<DataHealth, number> => ({
  VERIFIED: 0,
  DEGRADED: 0,
  STALE: 0,
  MISSING: 0,
  AI_ESTIMATED: 0,
  UNKNOWN: 0,
});

/**
 * perSymbol map 을 순회해 freshness 를 집계한다. 순수 함수 — I/O·상태 변경 0.
 * perSymbol 부재(flag OFF) 시 모든 카운트 0 (소비 분기 미실행과 동치 — byte-equivalent).
 */
export function summarizePerSymbolFreshness(
  perSymbol: Record<string, SymbolSnapshotData> | undefined,
): PerSymbolFreshnessSummary {
  const summary: PerSymbolFreshnessSummary = {
    symbolsWithFreshness: 0,
    symbolsWithoutFreshness: 0,
    providerIssueSymbols: 0,
    fieldHealthCounts: EMPTY_HEALTH_COUNTS(),
  };

  if (!perSymbol || typeof perSymbol !== 'object') return summary;

  for (const sym of Object.values(perSymbol)) {
    const freshness = sym?.freshness;
    if (!freshness) {
      summary.symbolsWithoutFreshness += 1;
      continue;
    }
    summary.symbolsWithFreshness += 1;
    if (freshness.providerIssue) summary.providerIssueSymbols += 1;

    // 각 필드 DataHealth 등급을 합산 카운트로 노출 (관찰 전용).
    for (const health of [
      freshness.quote,
      freshness.technicalIndicators,
      freshness.supply,
      freshness.dartFinancials,
    ]) {
      if (health in summary.fieldHealthCounts) {
        summary.fieldHealthCounts[health] += 1;
      } else {
        // 예기치 못한 값은 UNKNOWN 으로 격리 (throw 금지 — 불변식 #1).
        summary.fieldHealthCounts.UNKNOWN += 1;
      }
    }
  }

  return summary;
}

/**
 * 요약을 단일 진단 로그 라인으로 직렬화한다 (key=value, grep 안정성).
 * marketSignal=false 를 명시 표기 — providerIssue ≠ 약세 신호(불변식 #6) 가시화.
 */
export function formatPerSymbolFreshnessSummary(summary: PerSymbolFreshnessSummary): string {
  const c = summary.fieldHealthCounts;
  return (
    '[UNIFIED_SNAPSHOT_FRESHNESS] ' +
    `symbolsWithFreshness=${summary.symbolsWithFreshness} ` +
    `symbolsWithoutFreshness=${summary.symbolsWithoutFreshness} ` +
    `providerIssueSymbols=${summary.providerIssueSymbols} ` +
    `fieldVERIFIED=${c.VERIFIED} fieldDEGRADED=${c.DEGRADED} ` +
    `fieldSTALE=${c.STALE} fieldMISSING=${c.MISSING} ` +
    `fieldUNKNOWN=${c.UNKNOWN} ` +
    'marketSignal=false executionImpact=NONE'
  );
}
