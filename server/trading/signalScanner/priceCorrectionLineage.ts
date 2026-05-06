/**
 * @responsibility Price Correction Lineage SSOT — 결정 추적성 (input snapshot + decision trace + ruleVersion)
 *
 * ADR-0414 §4 — Stage 1 Read-Only Mode. 모든 correction result 는 lineage 포함 의무.
 *
 * Stage 2/3 진입 시 사후 검증 가능 — `priceCorrectionEngine@v1-readonly` rule version 으로
 * 잘못된 의사결정 추적 + 임계 재조정 입력.
 *
 * 외부 의존성: 0 (영속 fs/디스크 I/O 0건 — 메모리 객체 합성만).
 */

import type { PriceCorrectionType } from './priceCorrectionEngine.js';

/**
 * Rule version SSOT — Stage 2/3 진입 시 변경 의무 (예: `priceCorrectionEngine@v2-shadow`).
 *
 * 정적 검증 (정적 grep 가드) — 본 PR 의 lineage rule version 은 *항상* `v1-readonly`.
 */
export const PRICE_CORRECTION_RULE_VERSION = 'priceCorrectionEngine@v1-readonly';

/**
 * 출처별 가격 스냅샷 — 다중 출처 1 종목 시점 데이터 캡처.
 */
export interface PriceSourceSnapshot {
  current?: number | null;
  previousClose?: number | null;
  currentDate?: string | null;
  previousCloseDate?: string | null;
}

/**
 * Lineage input snapshot — correction 결정 시점의 *모든 입력 출처* 캡처.
 *
 * 모든 필드 옵셔널 (출처 부재 가능). Stage 2/3 진입 시 사후 검증 입력.
 */
export interface PriceCorrectionLineageInput {
  yahoo?: PriceSourceSnapshot;
  kis?: PriceSourceSnapshot;
  krx?: PriceSourceSnapshot;
  recentDailyClose?: { close?: number | null; date?: string | null };
}

/**
 * Lineage 본체 — correction result 에 옵셔널 첨부.
 *
 * `decisionTrace` 는 결정 트리 통과 단계별 메시지 — 디버깅/사후 검증용.
 */
export interface PriceCorrectionLineage {
  inputSnapshot: PriceCorrectionLineageInput;
  decisionTrace: string[];
  correctionType: PriceCorrectionType;
  confidence: number;
  computedAt: string;
  ruleVersion: string;
}

/**
 * Lineage 합성 헬퍼 — priceCorrectionEngine 내부에서 사용.
 *
 * 외부 부작용 0 — 메모리 객체 1건 반환.
 *
 * @param inputSnapshot 다중 출처 스냅샷 (호출자가 합성)
 * @param decisionTrace 결정 트리 통과 단계 (호출자가 push)
 * @param correctionType 산출 결과
 * @param confidence 산출 결과 (0~1)
 * @param now 시각 주입 (테스트 시 deterministic)
 */
export function buildPriceCorrectionLineage(
  inputSnapshot: PriceCorrectionLineageInput,
  decisionTrace: ReadonlyArray<string>,
  correctionType: PriceCorrectionType,
  confidence: number,
  now: Date = new Date(),
): PriceCorrectionLineage {
  return {
    inputSnapshot: {
      ...(inputSnapshot.yahoo ? { yahoo: { ...inputSnapshot.yahoo } } : {}),
      ...(inputSnapshot.kis ? { kis: { ...inputSnapshot.kis } } : {}),
      ...(inputSnapshot.krx ? { krx: { ...inputSnapshot.krx } } : {}),
      ...(inputSnapshot.recentDailyClose
        ? { recentDailyClose: { ...inputSnapshot.recentDailyClose } }
        : {}),
    },
    decisionTrace: [...decisionTrace],
    correctionType,
    confidence,
    computedAt: now.toISOString(),
    ruleVersion: PRICE_CORRECTION_RULE_VERSION,
  };
}
