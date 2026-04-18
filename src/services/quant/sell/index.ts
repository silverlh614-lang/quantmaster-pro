/**
 * sell/index.ts — 매도 엔진 barrel export
 *
 * 외부 호출자는 이 barrel만 import한다:
 *   import { evaluateSellSignals, PROFIT_TARGETS } from '../quant/sell';
 *
 * 개별 레이어 구현을 바꿔도 이 barrel의 공개 API는 유지된다.
 */

// 공용 유틸
export { calcPositionReturn, calcDrawdown } from './util';

// L1 — 기계적 손절
export { checkHardStopLoss } from './hardStopLoss';

// L2 — Pre-Mortem 펀더멘털 붕괴
export { evaluatePreMortems } from './preMortem';

// L3 — 분할 익절 + 트레일링
export { PROFIT_TARGETS, checkProfitTargets } from './partialProfit';
export {
  checkTrailingStop,
  updateTrailingHighWaterMark,
  resolveTrailingConfig,
} from './trailing';

// L1.5 — 3단 경보 손절 사다리 (Phase 3)
export {
  evaluateStopLadder,
  STOP_LADDER_CONFIG,
  type LadderRung,
  type LadderSignal,
} from './stopLossLadder';

// L4 — 과열 탐지
export { evaluateEuphoria } from './euphoria';

// L5 — 일목균형표 이탈 감지 (Phase 3)
export {
  evaluateIchimokuExit,
  computeIchimokuSeries,
  detectCloudBreakdown,
  detectChikouBreakdown,
  detectTkDeathWithCloudExit,
} from './ichimokuExit';

// 2D 낙폭 역치 (Phase 3)
export {
  DRAWDOWN_THRESHOLDS,
  resolveDrawdownThreshold,
} from './drawdownThresholds';

// 오케스트레이터
export {
  evaluateSellSignals,
  evaluateSellSignalsFromContext,
  type EvaluateSellSignalsOptions,
} from './orchestrator';

// Strategy Pattern (Phase 2)
export { SELL_LAYER_REGISTRY, SELL_LAYERS } from './registry';
export type { SellLayer } from './types';
