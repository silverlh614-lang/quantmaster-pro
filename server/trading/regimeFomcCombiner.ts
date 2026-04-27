// @responsibility Regime + FOMC Kelly 결합 SSOT — ADR-0076 옵션 C (FOMC 우선 + R6 보호)
/**
 * regimeFomcCombiner.ts — Regime kellyMultiplier 와 FOMC kellyMultiplier 결합 SSOT.
 *
 * 사용자 운영 보고 (2026-04-27): "FOMC 와 기본 Kelly 레짐이 개념이 중복됨 (오버랩).
 * FOMC 기간에는 기본 Kelly 레짐보다 FOMC 원칙을 우선."
 *
 * 기존 결합 (signalScanner/preflight/dryRunScanner 3 호출 지점):
 *   rawKelly = regimeKelly × fomcKelly × vixKelly × ipsKelly × ...
 *
 * 문제: regimeKelly 와 fomcKelly 가 *같은 차원* (Kelly 사이즈 보수성) 의 정책이라
 * 곱셈 결합 시 두 번 적용되어 보수성 누적. 예: PRE_1 (0.75) × R2_BULL (0.8) = 0.60
 * → 사용자가 *FOMC 직전에 사이즈 75%* 만 의도한 것인데 실제로는 60% 까지 압축.
 *
 * 해결 (옵션 C):
 *   - R6_DEFENSE (시장 전체 붕괴): kelly=0 절대 우선 — allowedSignals=[] 와 정합
 *   - FOMC NORMAL (게이트 비활성): regimeKelly 만 사용 (FOMC 영향 없음)
 *   - FOMC 활성 (PRE_3/PRE_2/PRE_1/DAY/POST_1/POST_2): FOMC 우선 (regimeKelly 미적용)
 *
 * 결과:
 *   - PRE_1 + R2_BULL: 0.75 (FOMC 우선)
 *   - PRE_1 + R5_CAUTION: 0.75 (FOMC 우선) — R5 무력화 의도. 약세 신호는 R6 escalation 으로
 *   - DAY + R2_BULL: 0 (FOMC DAY 차단)
 *   - POST_1 + R2_BULL: 1.30 (FOMC 부스트)
 *   - PRE_1 + R6_DEFENSE: 0 (R6 보호 — allowedSignals=[] 와 정합)
 *
 * 환경 변수 롤백: `FOMC_REGIME_OVERRIDE_DISABLED=true` 시 기존 곱셈 패턴 복원.
 */

import type { FomcPhase } from './fomcCalendar.js';
import type { RegimeLevel } from '../../src/types/core.js';

/** 결합 결정의 어느 입력이 채택됐는지 — 진단 로그용 */
export type RegimeFomcSource = 'REGIME' | 'FOMC' | 'R6_OVERRIDE' | 'LEGACY_PRODUCT';

export interface RegimeFomcResult {
  /** 결합된 Kelly 배율 (0 ~ 1.30 범위) */
  value: number;
  /** 어느 정책이 채택됐는지 */
  source: RegimeFomcSource;
  /** 진단 메시지용 설명 (텔레그램/로그 SSOT) */
  reason: string;
}

/**
 * Regime kellyMultiplier 와 FOMC kellyMultiplier 를 단일 값으로 결합 (ADR-0076 옵션 C).
 *
 * 우선순위:
 *   1. `FOMC_REGIME_OVERRIDE_DISABLED=true` ENV → 기존 곱셈 패턴 복원 (LEGACY_PRODUCT)
 *   2. R6_DEFENSE → 0 강제 (R6_OVERRIDE)
 *   3. FOMC NORMAL → regimeKelly 만 (REGIME)
 *   4. FOMC 활성 (그 외 phase) → fomcKelly 만 (FOMC)
 */
export function combineRegimeAndFomcKelly(
  regimeKelly: number,
  fomcKelly: number,
  fomcPhase: FomcPhase,
  regime: RegimeLevel,
): RegimeFomcResult {
  // ENV 롤백 — 기존 곱셈 패턴 복원
  if (process.env.FOMC_REGIME_OVERRIDE_DISABLED === 'true') {
    return {
      value: regimeKelly * fomcKelly,
      source: 'LEGACY_PRODUCT',
      reason: `LEGACY 곱셈 (${regime} ×${regimeKelly.toFixed(2)} × FOMC ${fomcPhase} ×${fomcKelly.toFixed(2)})`,
    };
  }

  // R6_DEFENSE: 시장 전체 붕괴 — 절대 우선 (allowedSignals=[] 와 정합)
  if (regime === 'R6_DEFENSE') {
    return {
      value: 0,
      source: 'R6_OVERRIDE',
      reason: 'R6_DEFENSE 매수 차단 (FOMC 무관)',
    };
  }

  // FOMC NORMAL: 게이트 비활성 → regime 만
  if (fomcPhase === 'NORMAL') {
    return {
      value: regimeKelly,
      source: 'REGIME',
      reason: `${regime} ×${regimeKelly.toFixed(2)} (FOMC 비활성)`,
    };
  }

  // FOMC 활성: FOMC 우선 (regime 무시)
  return {
    value: fomcKelly,
    source: 'FOMC',
    reason: `FOMC ${fomcPhase} ×${fomcKelly.toFixed(2)} 우선 (${regime} ×${regimeKelly.toFixed(2)} 무시)`,
  };
}

/**
 * 진단 메시지용 — Kelly 배율 분해 라인을 RegimeFomcResult 로 재구성.
 *
 * @example
 *   "[Kelly 결합] FOMC PRE_1 ×0.75 우선 (R2_BULL ×0.80 무시)"
 *   "[Kelly 결합] R2_BULL ×0.80 (FOMC 비활성)"
 *   "[Kelly 결합] R6_DEFENSE 매수 차단 (FOMC 무관)"
 */
export function describeRegimeFomcCombination(result: RegimeFomcResult): string {
  return `[Kelly 결합] ${result.reason} → ×${result.value.toFixed(2)}`;
}
