// @responsibility Regime Kelly 단순 통과 SSOT — FOMC 게이팅 제거됨 (regime-only).

import type { FomcPhase } from './fomcCalendar.js';
import type { RegimeLevel } from '../../src/types/core.js';

/** 결합 결정의 어느 입력이 채택됐는지 — 진단 로그용 */
export type RegimeFomcSource = 'REGIME' | 'FOMC' | 'REGIME_ADJUSTMENT_ONLY' | 'LEGACY_PRODUCT';

export interface RegimeFomcResult {
  /** 결합된 Kelly 배율 (0 ~ 1.30 범위) */
  value: number;
  /** 어느 정책이 채택됐는지 */
  source: RegimeFomcSource;
  /** 진단 메시지용 설명 (텔레그램/로그 SSOT) */
  reason: string;
}

/**
 * FOMC/R6 게이팅 제거됨. regimeKelly 를 그대로 반환 (REGIME_ONLY).
 * fomcKelly, fomcPhase, regime 파라미터는 시그니처 호환을 위해 유지.
 */
export function combineRegimeAndFomcKelly(
  regimeKelly: number,
  _fomcKelly: number,
  _fomcPhase: FomcPhase,
  regime: RegimeLevel,
): RegimeFomcResult {
  return {
    value: regimeKelly,
    source: 'REGIME',
    reason: `${regime} ×${regimeKelly.toFixed(2)} (FOMC/VIX 게이팅 제거됨)`,
  };
}

/**
 * 진단 메시지용 — Kelly 배율 분해 라인.
 */
export function describeRegimeFomcCombination(result: RegimeFomcResult): string {
  return `[Kelly 결합] ${result.reason} → ×${result.value.toFixed(2)}`;
}
