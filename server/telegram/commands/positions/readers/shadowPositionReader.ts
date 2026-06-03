// @responsibility ShadowPositionRegistry position source reader.

import type { PositionSourceResult } from '../positionSourceTypes.js';

/**
 * 순수 stub — ShadowPositionRegistry 모듈/주입 부재. 항상 EMPTY 반환.
 *
 * 중복정리 #3 정합: 6-reader 우선순위 1순위 슬롯이지만 실 구현이 없어 등재 0건.
 * 표시 1차 소스는 ShadowPositionLedger(getOpenPositions) 이며 본 reader 는
 * counts/diagnostics 에서 항상 0 으로 집계된다 (위장된 "1순위" 동작 없음).
 * Registry 영속 도입 시 이 stub 을 실 구현으로 교체.
 */
export async function readShadowPositionRegistryPositions(): Promise<PositionSourceResult> {
  return {
    source: 'ShadowPositionRegistry',
    kind: 'EMPTY',
    diagnostics: {
      reason: 'SHADOW_POSITION_REGISTRY_NOT_CONFIGURED',
    },
  };
}
