// @responsibility High-conviction confidence diagnostics SSOT (ADR-0398 + ADR-0415)
/**
 * sectorEnergyStrongBuyGate.ts (ADR-0398 = 사용자 명시 ADR-0373)
 *
 * Step 4: legacy STRONG_BUY conditions are retained as score/diagnostic evidence only.
 * 사용자 명시 정책 (절대 변경 금지):
 *   - 일반 BUY 차단 금지 (섹터에너지는 보조 신호, 개별 종목 수급/기술/펀더멘털 우선)
 *   - 6 조건 OR (ADR-0398 4 + ADR-0415 2):
 *       1. confidence<0.6
 *       2. dataQuality='DEGRADED'
 *       3. dataQuality='FAILED'
 *       4. sourceTier='YAHOO_ETF'
 *       5. dataQuality='STALE' (ADR-0415 — ADR-0398 누락 진단)
 *       6. dataQuality='PARTIAL_VOLUME' (ADR-0415 — BUY 까지만)
 *       7. sourceTier='KIS_STOCK_BASKET_DERIVED' (derived basket shadow-only)
 *
 * Phase 1 dead code — 호출자 0건. 실제 매매 결정 wiring 후속 PR (회귀 위험 격리).
 *
 * ENV 우회: SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true (default OFF, 정확 비교 ADR-0157)
 *   - 활성화 시 ADR-0397 동작 100% 복원 (회귀 1줄 즉시 롤백)
 *
 * 호출자 측 inline ENV 검사 0건 — SSOT 위임 (ADR-0185~0189 정합).
 */

import type {
  SectorEnergyDataQuality5,
  SectorEnergySourceTier,
} from '../clients/sectorEnergyDataQuality.js';

/** ADR-0398: legacy high-conviction diagnostic confidence threshold. */
export const CONFIDENCE_GATE_THRESHOLD = 0.6;

/** ADR-0398: STRONG_BUY 게이트 입력. */
export interface StrongBuyGateInput {
  /** ADR-0396: confidence (0~1, sourceWeight × freshnessWeight × coverage). */
  confidence: number;
  /** ADR-0396: 5단계 dataQuality. */
  dataQuality: SectorEnergyDataQuality5;
  /** ADR-0397: 원천 데이터 출처 5분기 (YAHOO_ETF 시 차단). */
  sourceTier: SectorEnergySourceTier;
}

/** ADR-0398: legacy high-conviction diagnostic result. */
export interface StrongBuyGateResult {
  /** Step 4 compatibility field. Always false; reasons are diagnostic only. */
  forbidStrongBuy: boolean;
  /** Diagnostic reason catalog (score/evidence only). */
  reasons: string[];
}

/**
 * ADR-0398: ENV `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true` SSOT 헬퍼.
 * 정확 비교 (=== 'true') ADR-0157 의무. default OFF.
 *
 * 호출자 측 inline ENV 검사 0건 — SSOT 위임 (ADR-0185~0189 정합).
 */
export function isSectorEnergyStrongBuyGateDisabled(): boolean {
  return process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED === 'true';
}

/**
 * ADR-0400: ENV `SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED=true` SSOT 헬퍼.
 * 정확 비교 (=== 'true') ADR-0157 의무. default OFF.
 *
 * 본 ENV 활성 시 legacy high-conviction diagnostic wiring 자체 비활성화 →
 * ADR-0398 dead code 동작 100% 복원 (회귀 1줄 즉시 롤백 안전망).
 *
 * 호출자 측 inline ENV 검사 0건 — SSOT 위임 (ADR-0185~0189 정합).
 */
export function isSectorEnergyStrongBuyGateWiringDisabled(): boolean {
  return process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED === 'true';
}

/**
 * Legacy high-conviction evidence SSOT — 4 조건 OR diagnostics.
 *
 * @param input ADR-0396 4-axis 합성 결과 부분 (confidence + dataQuality + sourceTier)
 * @returns forbidStrongBuy=false + reasons 카탈로그
 *
 * 안전 invariant:
 *   - 일반 BUY 차단 금지 — 본 함수는 final decision/label 을 바꾸지 않음
 *   - ENV 우회 활성 시 항상 forbidStrongBuy=false (ADR-0397 동작 복원)
 *   - NaN confidence → diagnostic fallback (forbidStrongBuy=false, reasons 에 안내)
 */
export function evaluateSectorEnergyStrongBuyGate(
  input: StrongBuyGateInput,
): StrongBuyGateResult {
  // ENV 우회 — 게이트 비활성 시 STRONG_BUY 자유 승격
  if (isSectorEnergyStrongBuyGateDisabled()) {
    return { forbidStrongBuy: false, reasons: [] };
  }

  const reasons: string[] = [];

  // 조건 1: confidence < 0.6 (저신뢰)
  if (!Number.isFinite(input.confidence)) {
    // NaN/Infinity 보수 fallback
    reasons.push('confidence 산출 실패 (NaN/Infinity) — high-conviction diagnostic only');
  } else if (input.confidence < CONFIDENCE_GATE_THRESHOLD) {
    reasons.push(`confidence < ${CONFIDENCE_GATE_THRESHOLD} (저신뢰)`);
  }

  // 조건 2: dataQuality === 'DEGRADED' (심각한 부족)
  if (input.dataQuality === 'DEGRADED') {
    reasons.push('dataQuality=DEGRADED (심각한 부족)');
  }

  // 조건 3: dataQuality === 'FAILED' (산출 불가)
  if (input.dataQuality === 'FAILED') {
    reasons.push('dataQuality=FAILED (산출 불가)');
  }

  // 조건 4: sourceTier === 'YAHOO_ETF' (해외 ETF 프록시 보조 신호)
  if (input.sourceTier === 'YAHOO_ETF' || input.sourceTier === 'YAHOO_GLOBAL_PROXY') {
    reasons.push(`sourceTier=${input.sourceTier} (해외 ETF 프록시 보조 신호)`);
  }

  // 조건 5 (ADR-0415): dataQuality === 'STALE' (6~8 섹터 정상, 신뢰도 부족)
  // ADR-0398 4 조건 OR 매트릭스에서 STALE 누락 진단 — 일반 BUY 진입 영향 0.
  if (input.dataQuality === 'STALE') {
    reasons.push('dataQuality=STALE (6~8 섹터 정상, 신뢰도 부족)');
  }

  // 조건 6 (ADR-0415): dataQuality === 'PARTIAL_VOLUME' (가격은 정상이나 거래량/일부 섹터 누락)
  // Step 4: PARTIAL_VOLUME is diagnostic evidence only; BUY_ALLOWED is preserved.
  if (input.dataQuality === 'PARTIAL_VOLUME') {
    reasons.push('dataQuality=PARTIAL_VOLUME (거래량/일부 섹터 누락 — high-conviction diagnostic only)');
  }

  // 조건 7: KIS representative basket is shadow/watch/ranking only until promotion audit.
  if (input.sourceTier === 'KIS_STOCK_BASKET_DERIVED') {
    reasons.push('sourceTier=KIS_STOCK_BASKET_DERIVED (derived basket shadow-only; promotion audit required)');
  }

  return {
    forbidStrongBuy: false,
    reasons,
  };
}
