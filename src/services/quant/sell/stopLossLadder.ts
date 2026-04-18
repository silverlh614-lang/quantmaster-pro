/**
 * sell/stopLossLadder.ts — L1.5 3단 경보 손절 사다리
 *
 * 기존 checkHardStopLoss의 "단일 역치 → 전량 청산" 단일 단계를 보완.
 * -15% ALERT(경보만, 매도 없음) → -25% HALF(50% 매도) → -30% FULL(전량)의
 * 3단 사다리를 독립 레이어로 분리한다.
 *
 * 가격축 단계와 lifecycle 단계(ALERT/EXIT_PREP/FULL_EXIT)의 양방향 동기화는
 * Phase 4의 PositionEventBus가 담당한다. 이 모듈은 순수함수로 신호만 생성.
 *
 * 프로파일별(A/B/C/D) 사다리 값은 STOP_LADDER_CONFIG로 외부화하여
 * 백테스팅 시 튜닝 가능하게 한다.
 */

import type { ActivePosition, SellSignal } from '../../../types/sell';
import type { StockProfileType } from '../../../types/core';
import { calcPositionReturn } from './util';

// ─── 사다리 단계 타입 ─────────────────────────────────────────────────────────

export type LadderRung = 'ALERT' | 'HALF' | 'FULL';

interface LadderLevel {
  /** 발동 기준 수익률 (음수, e.g., -0.15 = -15%) */
  threshold: number;
  /** 매도 비율 (0~1). ALERT는 0 = 경보만 */
  sellRatio: number;
  /** lifecycle 매핑 단계 — Phase 4에서 PositionEventBus가 소비 */
  lifecycleStage: 'ALERT' | 'EXIT_PREP' | 'FULL_EXIT';
}

/**
 * 프로파일별 3단 사다리 설정.
 *
 * 대형 주도주(A)는 변동성이 낮아 사다리를 뒤로 미루고,
 * 촉매 플레이(D)는 손실이 빠르게 확대되므로 타이트하게 조인다.
 *
 * 백테스팅 시 이 상수만 교체하면 전략 튜닝이 가능하다.
 */
export const STOP_LADDER_CONFIG: Record<StockProfileType, Record<LadderRung, LadderLevel>> = {
  A: {
    ALERT: { threshold: -0.15, sellRatio: 0,    lifecycleStage: 'ALERT' },
    HALF:  { threshold: -0.25, sellRatio: 0.50, lifecycleStage: 'EXIT_PREP' },
    FULL:  { threshold: -0.30, sellRatio: 1.0,  lifecycleStage: 'FULL_EXIT' },
  },
  B: {
    ALERT: { threshold: -0.12, sellRatio: 0,    lifecycleStage: 'ALERT' },
    HALF:  { threshold: -0.20, sellRatio: 0.50, lifecycleStage: 'EXIT_PREP' },
    FULL:  { threshold: -0.25, sellRatio: 1.0,  lifecycleStage: 'FULL_EXIT' },
  },
  C: {
    ALERT: { threshold: -0.10, sellRatio: 0,    lifecycleStage: 'ALERT' },
    HALF:  { threshold: -0.15, sellRatio: 0.50, lifecycleStage: 'EXIT_PREP' },
    FULL:  { threshold: -0.20, sellRatio: 1.0,  lifecycleStage: 'FULL_EXIT' },
  },
  D: {
    ALERT: { threshold: -0.07, sellRatio: 0,    lifecycleStage: 'ALERT' },
    HALF:  { threshold: -0.12, sellRatio: 0.50, lifecycleStage: 'EXIT_PREP' },
    FULL:  { threshold: -0.15, sellRatio: 1.0,  lifecycleStage: 'FULL_EXIT' },
  },
};

/** 사다리 발동 결과 — 일반 SellSignal보다 정밀한 메타 데이터 포함 */
export interface LadderSignal extends SellSignal {
  action: 'STOP_LADDER';
  rung: LadderRung;
  /** lifecycle 동기화용 — Phase 4 EventBus가 소비 */
  lifecycleStage: 'ALERT' | 'EXIT_PREP' | 'FULL_EXIT';
}

/**
 * 현재 수익률이 프로파일별 사다리 역치에 도달했는지 검사.
 *
 * 반환 규칙:
 *   - 여러 단계가 동시 돌파되어도 가장 아래 단계(FULL)만 반환
 *     (상위 단계는 이미 이전에 발동되었거나 이번 사이클에 동시 발동되므로
 *      실매도 비율이 중복되지 않도록 가장 강한 단계만 내보냄)
 *   - ALERT는 경보 전용이므로 sellRatio=0인 신호를 내보내 호출자가 알림만 발송
 *
 * @returns 발동된 사다리 신호 배열 (빈 배열 = 이상 없음)
 */
export function evaluateStopLadder(position: ActivePosition): LadderSignal[] {
  const currentReturn = calcPositionReturn(position);
  const cfg = STOP_LADDER_CONFIG[position.profile];

  // 가장 강한 단계부터 역순 검사 — 가장 낮은 threshold에 도달했으면 그것만 내보낸다.
  const rungsByStrength: LadderRung[] = ['FULL', 'HALF', 'ALERT'];

  for (const rung of rungsByStrength) {
    const level = cfg[rung];
    if (currentReturn <= level.threshold) {
      return [{
        action: 'STOP_LADDER',
        rung,
        ratio: level.sellRatio,
        orderType: rung === 'FULL' ? 'MARKET' : 'LIMIT',
        price: rung === 'FULL' ? undefined : position.currentPrice,
        severity: rung === 'FULL' ? 'CRITICAL' : rung === 'HALF' ? 'HIGH' : 'MEDIUM',
        lifecycleStage: level.lifecycleStage,
        reason: `손절 사다리 ${rung}: 수익률 ${(currentReturn * 100).toFixed(1)}% ≤ ${(level.threshold * 100).toFixed(0)}% (profile ${position.profile}). `
          + (level.sellRatio === 0 ? '경보만 — 매도 없음.' : `${(level.sellRatio * 100).toFixed(0)}% 매도.`),
      }];
    }
  }

  return [];
}
