// @responsibility quant index 엔진 모듈
// L1 — 기계적 손절
export { checkHardStopLoss } from './hardStopLoss';

// L2 — Pre-Mortem 펀더멘털 붕괴
export { evaluatePreMortems } from './preMortem';

// L3 — 분할 익절 + 트레일링
export { PROFIT_TARGETS, checkProfitTargets } from './partialProfit';
export {
  checkTrailingStop
} from './trailing';

// L1.5 — 3단 경보 손절 사다리 (Phase 3)
export {
  evaluateStopLadder,
  STOP_LADDER_CONFIG
} from './stopLossLadder';

// L4 — 과열 탐지
export { evaluateEuphoria } from './euphoria';

// L5 — 일목균형표 이탈 감지 (Phase 3)
export {
  evaluateIchimokuExit,
  computeIchimokuSeries,
  detectCloudBreakdown,
  detectTkDeathWithCloudExit,
} from './ichimokuExit';

// 2D 낙폭 역치 (Phase 3)
export {
  DRAWDOWN_THRESHOLDS,
  resolveDrawdownThreshold,
} from './drawdownThresholds';

// L5.5 — Volume Dry-up Alert (Phase 4)
export {
  calcVdaScore
} from './volumeDryupAlert';

// Phase 4: PositionEventBus — 단일 신호 채널
export {
  PositionEventBus,
  publishSellSignals,
  type PositionEvent
} from './positionEventBus';

// Phase 4: 매도 27단계 대칭 체크리스트
export {
  evaluateSellChecklist27,
  SURVIVAL_EXIT_IDS,
  WARNING_EXIT_IDS,
  PRECISION_EXIT_IDS,
  type ConditionBreachMap
} from './sellChecklist27';

// Phase 4: Trailing OCO 동적 갱신
export {
  calcTrailingStopPrice,
  syncTrailingOco,
  type OcoAdapter
} from './trailingOcoSyncer';

// Phase 5: 매도 감사 로그 (자기 학습의 입력)
export {
  buildAuditEntry,
  computeVerdict,
  aggregateLayerReliability,
  type SellAuditEntry
} from './sellAuditLog';
// Phase 5: Shadow Sell Mode
export {
  buildShadowRecord,
  evaluateShadowOutcome,
  aggregateShadowStats,
  isShadowMode,
  type ShadowSellRecord
} from './shadowSellMode';

// Phase 5: Pre-Flight Sell Simulation
export {
  runPreFlightSellSim
} from './preFlightSellSim';

// 오케스트레이터
export {
  evaluateSellSignals,
  evaluateSellSignalsFromContext
} from './orchestrator';

// Strategy Pattern (Phase 2)
export { SELL_LAYER_REGISTRY, SELL_LAYERS } from './registry';
