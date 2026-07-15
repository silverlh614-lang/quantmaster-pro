// @responsibility 레짐 값 히스테리시스 SSOT — effectiveRegime flapping 디바운스(확정 dwell). 순수 함수, R6 즉시 예외는 호출자 게이트.

import type { RegimeLevel } from '../../../src/types/core.js';

export interface RegimeHysteresisInput {
  /** 이번 tick raw 기반으로 계산된 effective. */
  computedEffective: RegimeLevel;
  /** 마지막으로 확정된 effective(직전 영속값). */
  confirmedEffective: RegimeLevel;
  pendingRegime?: RegimeLevel;
  pendingSince?: string; // ISO
  pendingCount?: number;
  nowMs: number;
  minDwellMs: number;
  minConfirmations: number;
}

export interface RegimeHysteresisResult {
  /** confirmed(보류 시) 또는 computed(채택 시). */
  effectiveRegime: RegimeLevel;
  pendingRegime?: RegimeLevel;
  pendingSince?: string;
  pendingCount: number;
  /** true 면 이번 tick 변경을 보류(확정값 유지). */
  held: boolean;
}

/**
 * 레짐 값 디바운스 — 새 레짐이 minDwellMs 연속(같은 후보)으로 유지되고 minConfirmations 회
 * 이상 관측돼야 실제 채택. 그 전엔 confirmed 유지(held). 교차 flap(R3↔R4)은 매 tick 후보가
 * 바뀌거나 confirmed 로 복귀해 pending 이 리셋 → 확정값에 머무름(안정).
 *
 * R6 진입/이탈·R6 복구 flow 의 즉시성은 호출자가 게이트(본 함수 호출 전 분기) — 본 함수는 순수 디바운스.
 */
export function applyRegimeHysteresis(input: RegimeHysteresisInput): RegimeHysteresisResult {
  const { computedEffective, confirmedEffective, nowMs, minDwellMs, minConfirmations } = input;

  // 변화 없음 → pending 클리어, 확정 유지.
  if (computedEffective === confirmedEffective) {
    return { effectiveRegime: confirmedEffective, pendingCount: 0, held: false };
  }

  const sameCandidate = input.pendingRegime === computedEffective && typeof input.pendingSince === 'string';
  const count = sameCandidate ? (input.pendingCount ?? 0) + 1 : 1;
  const since = sameCandidate ? (input.pendingSince as string) : new Date(nowMs).toISOString();
  const sinceMs = Date.parse(since);
  const elapsed = Number.isFinite(sinceMs) ? nowMs - sinceMs : 0;

  const confirmed = count >= Math.max(1, minConfirmations) && elapsed >= minDwellMs;
  if (confirmed) {
    return { effectiveRegime: computedEffective, pendingCount: 0, held: false };
  }
  // 아직 미확정 → 확정값 유지(hold), pending 갱신.
  return {
    effectiveRegime: confirmedEffective,
    pendingRegime: computedEffective,
    pendingSince: since,
    pendingCount: count,
    held: true,
  };
}

/** ENV `REGIME_HYSTERESIS_ENABLED=true` → 레짐 값 디바운스 활성(execution-adjacent, 기본 OFF byte-identical). */
export function isRegimeHysteresisEnabled(): boolean {
  return process.env.REGIME_HYSTERESIS_ENABLED === 'true';
}

/** ENV `REGIME_HYSTERESIS_MIN_DWELL_MIN`(분) → ms. 기본 15분 · 상한 120 · 음수/NaN→기본. */
export function regimeHysteresisMinDwellMs(): number {
  const raw = Number(process.env.REGIME_HYSTERESIS_MIN_DWELL_MIN);
  if (!Number.isFinite(raw) || raw < 0) return 15 * 60_000;
  return Math.min(120, Math.trunc(raw)) * 60_000;
}

/** ENV `REGIME_HYSTERESIS_MIN_CONFIRMATIONS` 확정 최소 관측 횟수. 기본 2 · 하한 1 · 상한 20. */
export function regimeHysteresisMinConfirmations(): number {
  const raw = Number(process.env.REGIME_HYSTERESIS_MIN_CONFIRMATIONS);
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return Math.min(20, Math.trunc(raw));
}
