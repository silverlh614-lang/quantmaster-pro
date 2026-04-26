// @responsibility gateConfig 매매 엔진 모듈
/**
 * gateConfig.ts — 레짐별 Gate Score 임계값 단일 소스
 *
 * 기존 entryEngine.REGIME_GATE_MIN은 하드코딩이라 운용자가 실시간 조정 불가했다.
 * 이 모듈은 두 층위를 분리한다:
 *   1. GATE_SCORE_THRESHOLD_BY_REGIME — 베이스라인 (고정, 정책 값)
 *   2. runtime delta — 오버라이드로 베이스라인을 일시 완화 (TTL 자동 만료)
 *
 * getEffectiveGateThreshold(regime) = BASE[regime] + delta (하한 2.0 clamp)
 *
 * delta는 overrideExecutor가 "임계값 -0.5 완화" 액션에서 설정하고
 * setRuntimeThresholdDelta()로 호출한다. TTL 만료 또는 외부 clearRuntimeThresholdDelta()
 * 호출 시 0으로 복귀한다.
 *
 * 안전 장치:
 *   - 하한 2.0 — 아무리 완화해도 기본 모멘텀·거래량조차 없는 종목은 차단
 *   - LIVE 모드에서는 상위 레이어(overrideExecutor)가 완화 자체를 거부 (SHADOW 전용)
 */

import type { RegimeLevel } from '../../src/types/core.js';
import {
  GATE_SCORE_THRESHOLD_BY_REGIME as SHARED_SCORE_BANDS,
  getRegimeGateScoreBand,
} from '../../src/constants/gateConfig.js';

/**
 * 베이스라인 — 레짐별 Gate 통과 최소 점수(NORMAL). 약세장일수록 높다.
 *
 * src/constants/gateConfig.ts의 GATE_SCORE_THRESHOLD_BY_REGIME (STRONG/NORMAL 페어)
 * 를 단일 소스로 사용한다. 이 맵은 NORMAL만 서버용으로 투영한 호환 뷰.
 */
export const GATE_SCORE_THRESHOLD_BY_REGIME: Record<RegimeLevel, number> = {
  R1_TURBO:   SHARED_SCORE_BANDS.R1_TURBO.normal,
  R2_BULL:    SHARED_SCORE_BANDS.R2_BULL.normal,
  R3_EARLY:   SHARED_SCORE_BANDS.R3_EARLY.normal,
  R4_NEUTRAL: SHARED_SCORE_BANDS.R4_NEUTRAL.normal,
  R5_CAUTION: SHARED_SCORE_BANDS.R5_CAUTION.normal,
  R6_DEFENSE: SHARED_SCORE_BANDS.R6_DEFENSE.normal, // 999 — 매수 차단
};

/** 레짐별 (STRONG, NORMAL) 쌍 — quantFilter의 signalType 분류에서 사용. */
export function getRegimeGateBand(regime?: RegimeLevel | string): { strong: number; normal: number } {
  return getRegimeGateScoreBand(regime);
}

const MIN_EFFECTIVE_THRESHOLD = 2.0;

interface RuntimeDelta {
  value: number;        // 음수 = 완화, 양수 = 강화
  expiresAt: number;    // epoch ms
  source: string;       // 설정 주체 ('operator_override', 'calibration', ...)
}

let runtimeDelta: RuntimeDelta | null = null;

/**
 * 베이스라인 + 현재 유효한 delta를 합산한 실효 임계값.
 * delta가 만료되었으면 자동 클리어 후 베이스라인만 반환.
 */
export function getEffectiveGateThreshold(regime?: string): number {
  const base = GATE_SCORE_THRESHOLD_BY_REGIME[(regime ?? 'R4_NEUTRAL') as RegimeLevel]
    ?? GATE_SCORE_THRESHOLD_BY_REGIME.R4_NEUTRAL;

  if (runtimeDelta && Date.now() >= runtimeDelta.expiresAt) {
    runtimeDelta = null;
  }
  const delta = runtimeDelta?.value ?? 0;

  // R6는 차단용 999이므로 delta를 적용하지 않는다
  if (base >= 100) return base;

  return Math.max(MIN_EFFECTIVE_THRESHOLD, base + delta);
}

/**
 * 런타임 delta 설정. 기존 delta는 덮어쓴다.
 * @param value     음수 = 완화, 양수 = 강화 (예: -0.5)
 * @param ttlMs     유효 시간 (ms). 기본 30분.
 * @param source    설정 주체 (감사 로그용)
 */
export function setRuntimeThresholdDelta(
  value: number,
  ttlMs: number = 30 * 60_000,
  source: string = 'unknown',
): void {
  runtimeDelta = { value, expiresAt: Date.now() + ttlMs, source };
  console.log(
    `[GateConfig] 임계값 delta=${value >= 0 ? '+' : ''}${value} 설정 ` +
    `(source=${source}, TTL=${Math.round(ttlMs / 60_000)}분)`,
  );
}

export function clearRuntimeThresholdDelta(): void {
  if (runtimeDelta) {
    console.log(`[GateConfig] 임계값 delta 해제 (이전 value=${runtimeDelta.value})`);
  }
  runtimeDelta = null;
}

export interface ThresholdDeltaSnapshot {
  active: boolean;
  value: number;
  expiresAt: string | null;
  remainingMs: number;
  source: string | null;
}

export function getRuntimeThresholdSnapshot(): ThresholdDeltaSnapshot {
  if (!runtimeDelta || Date.now() >= runtimeDelta.expiresAt) {
    return { active: false, value: 0, expiresAt: null, remainingMs: 0, source: null };
  }
  return {
    active: true,
    value: runtimeDelta.value,
    expiresAt: new Date(runtimeDelta.expiresAt).toISOString(),
    remainingMs: runtimeDelta.expiresAt - Date.now(),
    source: runtimeDelta.source,
  };
}
