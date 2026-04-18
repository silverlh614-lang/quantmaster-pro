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
import { evaluateStopLadder } from './stopLossLadder';
import { checkProfitTargets } from './partialProfit';
import { checkTrailingStop } from './trailing';
import { evaluatePreMortems } from './preMortem';
import { evaluateEuphoria } from './euphoria';
import { evaluateIchimokuExit } from './ichimokuExit';
import { evaluateVdaAlert } from './volumeDryupAlert';

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

const L1_5_STOP_LADDER: SellLayer = {
  id: 'L1_5_STOP_LADDER',
  priority: 12,
  evaluate(ctx) {
    return evaluateStopLadder(ctx.position);
  },
  // FULL 단계(전량)는 즉시 중단 — 다른 레이어 평가 불필요
  shortCircuit(signals: SellSignal[]) {
    return signals.some(s => s.action === 'STOP_LADDER' && s.ratio === 1.0);
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
      regime: ctx.regime,
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

const L5_ICHIMOKU_EXIT: SellLayer = {
  id: 'L5_ICHIMOKU_EXIT',
  priority: 35,
  evaluate(ctx) {
    const signal = evaluateIchimokuExit(ctx.position, ctx.candles);
    return signal ? [signal] : [];
  },
  // 전량 청산 신호(ratio=1.0)는 중단, 30%/50%는 계속
  shortCircuit(signals: SellSignal[]) {
    return signals.some(s => s.action === 'ICHIMOKU_EXIT' && s.ratio === 1.0);
  },
};

const L5_5_VDA: SellLayer = {
  id: 'L5_5_VDA',
  priority: 38,
  evaluate(ctx) {
    const signal = evaluateVdaAlert(ctx.position, ctx.volumeStats, ctx.candles);
    return signal ? [signal] : [];
  },
  // VDA는 매도보다 조기 경보 성격이 강해 shortCircuit하지 않는다
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
  L1_5_STOP_LADDER,
  L3_PROFIT_TAKE,
  L3_TRAILING,
  L2_PRE_MORTEM,
  L5_ICHIMOKU_EXIT,
  L5_5_VDA,
  L4_EUPHORIA,
];

/** 개별 레이어 접근용 (테스트·진단 목적) */
export const SELL_LAYERS = {
  L1_HARD_STOP,
  L1_5_STOP_LADDER,
  L3_PROFIT_TAKE,
  L3_TRAILING,
  L2_PRE_MORTEM,
  L5_ICHIMOKU_EXIT,
  L5_5_VDA,
  L4_EUPHORIA,
} as const;
