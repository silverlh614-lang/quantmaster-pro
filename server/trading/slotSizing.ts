// @responsibility 슬롯 sizing 분할 분모 정책 함수 SSOT — PR-S2 자본 가중 옵트인 게이트.
/**
 * slotSizing.ts — ADR-0085 §트랙 2 PR-S2 인프라
 *
 * `perSymbolEvaluation.ts:902 remainingSlots` 분할 분모를 자본 가중 옵트인 활성화.
 * Default 비활성 — `SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED=true` ENV 명시 시 활성.
 *
 * Default 동작 = `effectiveMaxPositions - rawCount - reservedSlots` (현재 byte-equivalent).
 * 활성화 시 = `effectiveMaxPositions - consumed - reservedSlots` (PR-S1 SSOT 재사용).
 *
 * 본 PR 은 정책 함수 SSOT 만 — `perSymbolEvaluation.ts` wiring 은 후속 PR 에서 운영
 * 데이터 누적 후 활성화 (LIVE 매매 신규 진입 포지션 크기 영향 격리).
 */

import { computeSlotConsumption } from './slotAccounting.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

export interface SlotSizingDecision {
  /** sizing 분할 분모 — 호출자가 budget / N 계산 시 사용 */
  effectiveDenominator: number;
  /** 단순 활성 카운트 (자본 가중 비활성 fallback) */
  rawCount: number;
  /** 자본 가중 합계 (PR-S1 SSOT — 활성화 시 사용) */
  consumed: number;
  /** 결정 source */
  source: 'SIMPLE' | 'CAPITAL_WEIGHTED';
  reason: string;
}

export interface SlotSizingInput {
  effectiveMaxPositions: number;
  reservedSlots: number;
  shadows: ServerShadowTrade[];
}

/**
 * 본 정책 활성화 ENV — *명시 활성화* 만 자본 가중 적용.
 *
 * Default 미설정 시 단순 카운트 (현재 동작) — LIVE 매매 영향 0.
 */
export function isCapitalWeightedSizingEnabled(): boolean {
  return process.env.SLOT_CAPITAL_WEIGHTED_SIZING_ENABLED === 'true';
}

/**
 * 슬롯 sizing 분할 분모 결정.
 *
 * @returns effectiveDenominator >= 1 (floor 보장 — 0/음수 → 1)
 */
export function evaluateSlotSizing(input: SlotSizingInput): SlotSizingDecision {
  const slot = computeSlotConsumption(input.shadows, input.effectiveMaxPositions);
  const reserved = Number.isFinite(input.reservedSlots) ? Math.max(0, input.reservedSlots) : 0;

  if (isCapitalWeightedSizingEnabled()) {
    const denom = Math.max(1, input.effectiveMaxPositions - slot.consumed - reserved);
    return {
      effectiveDenominator: denom,
      rawCount: slot.rawCount,
      consumed: slot.consumed,
      source: 'CAPITAL_WEIGHTED',
      reason: `자본 가중 활성 (consumed ${slot.consumed.toFixed(2)} + reserved ${reserved} / max ${input.effectiveMaxPositions})`,
    };
  }

  // Default — 단순 카운트 (현재 동작 byte-equivalent)
  const denom = Math.max(1, input.effectiveMaxPositions - slot.rawCount - reserved);
  return {
    effectiveDenominator: denom,
    rawCount: slot.rawCount,
    consumed: slot.consumed,
    source: 'SIMPLE',
    reason: `단순 카운트 (rawCount ${slot.rawCount} + reserved ${reserved} / max ${input.effectiveMaxPositions})`,
  };
}
