/**
 * sell/registry.ts — SELL_LAYER_REGISTRY 선언형 배열
 *
 * 매도 레이어 파이프라인의 단일 진실 공급원.
 * 새 레이어 추가 시 이 배열에 한 줄 추가하는 것만으로 orchestrator에 편입된다.
 * 오케스트레이터 본문은 변경할 필요가 없다 (Open-Closed).
 *
 * priority 숫자가 작을수록 먼저 실행:
 *   10 — L1 하드 손절 (HARD_STOP 시 즉시 중단)
 *   20 — L3 분할 익절 (수익 확정 우선)
 *   25 — L3 트레일링 스톱
 *   30 — L2 Pre-Mortem 펀더멘털 붕괴
 *   40 — L4 과열 탐지 (1일 1회)
 *
 * Phase 3~4에서 추가될 레이어 priority 예약:
 *   12 — L1.5 StopLossLadder (하드 손절 직후, 알림만 내는 경보 단계)
 *   35 — L5 Ichimoku 이탈
 *   38 — L5 VDA (Volume Dry-up Alert)
 */

import type { SellLayer } from './types';
import type { SellSignal } from '../../../types/sell';
import { checkHardStopLoss } from './hardStopLoss';
import { checkProfitTargets } from './partialProfit';
import { checkTrailingStop } from './trailing';
import { evaluatePreMortems } from './preMortem';
import { evaluateEuphoria } from './euphoria';

const neverShortCircuit = (): boolean => false;

const L1_HARD_STOP: SellLayer = {
  id: 'L1_HARD_STOP',
  priority: 10,
  evaluate(ctx) {
    const signal = checkHardStopLoss(ctx.position, ctx.regime);
    return signal ? [signal] : [];
  },
  // HARD_STOP만 중단, REVALIDATE_GATE1은 경보이므로 이후 레이어 계속 진행
  shortCircuit(signals: SellSignal[]) {
    return signals.some(s => s.action === 'HARD_STOP');
  },
};

const L3_PROFIT_TAKE: SellLayer = {
  id: 'L3_PROFIT_TAKE',
  priority: 20,
  evaluate(ctx) {
    return checkProfitTargets(ctx.position, ctx.regime);
  },
  shortCircuit: neverShortCircuit,
};

const L3_TRAILING: SellLayer = {
  id: 'L3_TRAILING',
  priority: 25,
  evaluate(ctx) {
    const signal = checkTrailingStop(ctx.position);
    return signal ? [signal] : [];
  },
  shortCircuit: neverShortCircuit,
};

const L2_PRE_MORTEM: SellLayer = {
  id: 'L2_PRE_MORTEM',
  priority: 30,
  evaluate(ctx) {
    const triggers = evaluatePreMortems(ctx.position, ctx.preMortem, {
      roeTypeHistory: ctx.roeTypeHistory,
      assetTurnoverHistory: ctx.assetTurnoverHistory,
    });
    return triggers.map(pm => ({
      action: 'PRE_MORTEM' as const,
      ratio: pm.sellRatio,
      orderType: 'MARKET' as const,
      severity: pm.severity,
      reason: pm.reason,
    }));
  },
  shortCircuit: neverShortCircuit,
};

const L4_EUPHORIA: SellLayer = {
  id: 'L4_EUPHORIA',
  priority: 40,
  evaluate(ctx) {
    if (!ctx.euphoria) return [];
    const signal = evaluateEuphoria(ctx.position, ctx.euphoria);
    return signal ? [signal] : [];
  },
  shortCircuit: neverShortCircuit,
};

/**
 * 레이어 파이프라인 선언형 배열.
 * Phase 3~5에서 새 레이어를 이 배열에 단순 추가한다.
 */
export const SELL_LAYER_REGISTRY: readonly SellLayer[] = [
  L1_HARD_STOP,
  L3_PROFIT_TAKE,
  L3_TRAILING,
  L2_PRE_MORTEM,
  L4_EUPHORIA,
];

/** 개별 레이어 접근용 (테스트·진단 목적) */
export const SELL_LAYERS = {
  L1_HARD_STOP,
  L3_PROFIT_TAKE,
  L3_TRAILING,
  L2_PRE_MORTEM,
  L4_EUPHORIA,
} as const;
