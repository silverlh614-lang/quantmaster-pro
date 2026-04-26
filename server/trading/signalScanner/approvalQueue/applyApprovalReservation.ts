// @responsibility 승인 큐 push 직후 8개 mutable 필드 갱신을 단일 SSOT 헬퍼로 분리

import { getSectorByCode } from '../../../screener/sectorMap.js';
import type { BuyListLoopMutables } from '../perSymbolEvaluation.js';

export interface ApplyApprovalReservationInput {
  mutables: BuyListLoopMutables;
  isMomentumShadow: boolean;
  tier: 'CONVICTION' | 'STANDARD' | 'PROBING';
  effectiveBudget: number;
  stockCode: string;
  stockSector?: string;
}

/**
 * ADR-0031 PR-65 — 라인 1070-1094 의 reservedSlots/probingReservedSlots/reservedTiers/
 * reservedIsMomentum/reservedBudgets/orderableCash/pendingSectorValue/reservedSectorValues
 * 8개 mutable 필드 동시 갱신을 단일 헬퍼로 분리. byte-equivalent — 본문 로직 변화 없음.
 *
 * 슬롯 예약 롤백 SSOT — flush 실패 시 단일 지점에서 reservedTiers/reservedBudgets/
 * reservedIsMomentum/reservedSectorValues 인덱스로 복원 가능.
 */
export function applyApprovalReservation(input: ApplyApprovalReservationInput): void {
  const { mutables, isMomentumShadow, tier, effectiveBudget, stockCode, stockSector } = input;

  // Phase 1 ①: 큐 푸시 시점에 슬롯·섹터 예약 기록 (플러시 후 실패 시 롤백)
  // MOMENTUM Shadow 는 LIVE 슬롯/섹터/PROBING 예산에서 모두 격리된다.
  if (!isMomentumShadow) {
    mutables.reservedSlots.value++;
    // Phase 4-⑧(수정): PROBING 티어 전용 슬롯 카운터
    if (tier === 'PROBING') mutables.probingReservedSlots.value++;
    mutables.reservedTiers.push(tier === 'PROBING' ? 'PROBING' : 'OTHER');
  } else {
    // 큐 index 와 mutables.reservedTiers 길이 정합성을 위해 플레이스홀더를 push
    mutables.reservedTiers.push('OTHER');
  }
  mutables.reservedIsMomentum.push(isMomentumShadow);
  // BUG #3 fix — 같은 스캔의 다음 후보가 동일 mutables.orderableCash.value 를 이중 사용하는 것을
  // 차단하기 위해, 승인 대기 시점에 즉시 예산을 예약(차감) 한다. 롤백 시 복원.
  if (!isMomentumShadow && effectiveBudget > 0) {
    mutables.orderableCash.value = Math.max(0, mutables.orderableCash.value - effectiveBudget);
    mutables.reservedBudgets.push(effectiveBudget);
  } else {
    mutables.reservedBudgets.push(0);
  }
  if (!isMomentumShadow) {
    const _sec = stockSector || getSectorByCode(stockCode) || '미분류';
    mutables.pendingSectorValue.set(_sec, (mutables.pendingSectorValue.get(_sec) ?? 0) + effectiveBudget);
    mutables.reservedSectorValues.push({ sector: _sec, value: effectiveBudget });
  }
}
