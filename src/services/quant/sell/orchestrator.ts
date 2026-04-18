/**
 * sell/orchestrator.ts — 통합 매도 사이클 실행기 (Phase 1 버전)
 *
 * 단일 포지션에 대한 완전한 매도 평가 실행 (L1 → L3 → L2 → L4 순).
 * Phase 2에서 Strategy Pattern 레지스트리 기반으로 재설계 예정이며,
 * 이 파일의 공개 시그니처 `evaluateSellSignals`는 유지된다.
 *
 * autoTradeEngine.ts(서버)의 runSellCycle()에서 각 포지션에 대해 호출.
 * 비동기 데이터 페칭 후 이 함수에 순수 데이터를 주입한다.
 */

import type {
  ActivePosition,
  SellSignal,
  PreMortemData,
  EuphoriaData,
  SellContext,
} from '../../../types/sell';
import type { RegimeLevel } from '../../../types/core';
import { checkHardStopLoss } from './hardStopLoss';
import { checkProfitTargets } from './partialProfit';
import { checkTrailingStop } from './trailing';
import { evaluatePreMortems } from './preMortem';
import { evaluateEuphoria } from './euphoria';

/** 기존(Phase 1) 옵션 객체 시그니처 — 하위 호환 유지 */
export interface EvaluateSellSignalsOptions {
  position: ActivePosition;
  regime: RegimeLevel;
  preMortemData: PreMortemData;
  /** null = 오늘 이미 체크했거나 데이터 미수집 */
  euphoriaData: EuphoriaData | null;
}

/**
 * 단일 포지션 평가 — L1 → L3 → L2 → L4 순.
 * @returns 발동된 매도 신호 배열 (빈 배열 = 아무것도 없음)
 */
export function evaluateSellSignals(opts: EvaluateSellSignalsOptions): SellSignal[] {
  const { position, regime, preMortemData, euphoriaData } = opts;
  const results: SellSignal[] = [];

  // L1: 하드 손절 (최우선 — 발동 시 하위 레이어 건너뜀)
  const stopSignal = checkHardStopLoss(position, regime);
  if (stopSignal) {
    results.push(stopSignal);
    if (stopSignal.action === 'HARD_STOP') return results;
  }

  // L3: 분할 익절 (L2보다 먼저 — 수익 확정 우선)
  const profitSignals = checkProfitTargets(position, regime);
  results.push(...profitSignals);

  // L3: 트레일링 스톱
  const trailSignal = checkTrailingStop(position);
  if (trailSignal) results.push(trailSignal);

  // L2: Pre-Mortem 펀더멘털 붕괴
  const preMortems = evaluatePreMortems(position, preMortemData);
  for (const pm of preMortems) {
    results.push({
      action: 'PRE_MORTEM',
      ratio: pm.sellRatio,
      orderType: 'MARKET',
      severity: pm.severity,
      reason: pm.reason,
    });
  }

  // L4: 과열 탐지 (당일 데이터 있을 때만)
  if (euphoriaData) {
    const euphSignal = evaluateEuphoria(position, euphoriaData);
    if (euphSignal) results.push(euphSignal);
  }

  return results;
}

/**
 * SellContext 기반 평가 — Phase 2부터 권장되는 컨텍스트 주입형 API.
 * 현재는 기존 evaluateSellSignals로 위임한다.
 */
export function evaluateSellSignalsFromContext(ctx: SellContext): SellSignal[] {
  return evaluateSellSignals({
    position: ctx.position,
    regime: ctx.regime,
    preMortemData: ctx.preMortem,
    euphoriaData: ctx.euphoria,
  });
}
