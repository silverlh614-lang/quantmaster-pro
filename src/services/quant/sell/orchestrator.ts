/**
 * sell/orchestrator.ts — Strategy Pattern 기반 통합 매도 사이클 실행기
 *
 * Phase 2 재설계: L1→L3→L2→L4 순서의 하드코딩을 제거하고,
 * SELL_LAYER_REGISTRY의 priority 정렬 + shortCircuit 판정을 도는
 * 일반 루프로 단순화한다.
 *
 * 새 레이어 추가 절차 (Phase 3~5):
 *   1) sell/<newLayer>.ts 작성
 *   2) sell/registry.ts의 SELL_LAYER_REGISTRY 배열에 한 줄 추가
 *   본 파일은 수정할 필요 없음 (Open-Closed).
 */

import type {
  ActivePosition,
  SellSignal,
  PreMortemData,
  EuphoriaData,
  SellContext,
} from '../../../types/sell';
import type { RegimeLevel, ROEType } from '../../../types/core';
import { SELL_LAYER_REGISTRY } from './registry';

/** 기존(Phase 1) 옵션 객체 시그니처 — 하위 호환 유지 */
export interface EvaluateSellSignalsOptions {
  position: ActivePosition;
  regime: RegimeLevel;
  preMortemData: PreMortemData;
  /** null = 오늘 이미 체크했거나 데이터 미수집 */
  euphoriaData: EuphoriaData | null;
  /** Phase 2 추가: ROE 단일 출처용 */
  roeTypeHistory?: ROEType[];
  assetTurnoverHistory?: number[];
}

/**
 * SellContext를 받아 SELL_LAYER_REGISTRY를 priority 순으로 돌며 신호 누적.
 * shortCircuit이 true를 반환하는 레이어가 나오면 이후 레이어는 평가하지 않는다.
 */
export function evaluateSellSignalsFromContext(ctx: SellContext): SellSignal[] {
  const results: SellSignal[] = [];

  // priority 오름차순 정렬 (불변성 유지 — registry 원본 수정 없음)
  const layers = [...SELL_LAYER_REGISTRY].sort((a, b) => a.priority - b.priority);

  for (const layer of layers) {
    const signals = layer.evaluate(ctx);
    if (signals.length === 0) continue;

    results.push(...signals);

    if (layer.shortCircuit(signals)) break;
  }

  return results;
}

/**
 * 단일 포지션 평가 — Phase 1 호환 진입점.
 * 내부적으로 SellContext를 빌드해 evaluateSellSignalsFromContext로 위임.
 *
 * @returns 발동된 매도 신호 배열 (빈 배열 = 아무것도 없음)
 */
export function evaluateSellSignals(opts: EvaluateSellSignalsOptions): SellSignal[] {
  const ctx: SellContext = {
    position: opts.position,
    regime: opts.regime,
    preMortem: opts.preMortemData,
    euphoria: opts.euphoriaData,
    roeTypeHistory: opts.roeTypeHistory,
    assetTurnoverHistory: opts.assetTurnoverHistory,
  };
  return evaluateSellSignalsFromContext(ctx);
}
