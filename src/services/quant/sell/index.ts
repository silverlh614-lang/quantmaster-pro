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

// L5.5 — Volume Dry-up Alert (Phase 4)
export {
  evaluateVdaAlert,
  calcVdaScore,
  type VdaScoreBreakdown,
} from './volumeDryupAlert';

// Phase 4: PositionEventBus — 단일 신호 채널
export {
  PositionEventBus,
  positionEventBus,
  publishSellSignals,
  publishLifecycleTransition,
  publishHighWaterMark,
  type PositionEvent,
  type PositionEventType,
  type PositionEventPayload,
  type PositionEventHandler,
} from './positionEventBus';

// Phase 4: 매도 27단계 대칭 체크리스트
export {
  evaluateSellChecklist27,
  SURVIVAL_EXIT_IDS,
  WARNING_EXIT_IDS,
  PRECISION_EXIT_IDS,
  type SellConditionId,
  type ConditionBreachMap,
  type SellChecklistInput,
  type SellChecklistResult,
} from './sellChecklist27';

// Phase 4: Trailing OCO 동적 갱신
export {
  calcTrailingStopPrice,
  syncTrailingOco,
  type OcoAdapter,
  type TrailingStopInput,
  type TrailingStopCalcResult,
  type SyncTrailingOcoOptions,
  type SyncTrailingOcoResult,
} from './trailingOcoSyncer';

// Phase 5: 매도 감사 로그 (자기 학습의 입력)
export {
  buildAuditEntry,
  computeVerdict,
  aggregateLayerReliability,
  type SellAuditEntry,
  type AuditLogAdapter,
  type AuditLogFilter,
  type RecordSellDecisionInput,
  type LayerReliabilityStats,
} from './sellAuditLog';
export {
  attachAuditLogger,
  type AuditContextBuilder,
} from './sellAuditLogAttach';

// Phase 5: Shadow Sell Mode
export {
  buildShadowRecord,
  evaluateShadowOutcome,
  aggregateShadowStats,
  isShadowMode,
  type ShadowSellRecord,
  type RecordShadowInput,
  type ShadowLayerStats,
  type ShadowSellModeFlag,
} from './shadowSellMode';

// Phase 5: Pre-Flight Sell Simulation
export {
  runPreFlightSellSim,
  type PreFlightScenario,
  type PreFlightScenarioId,
  type PreFlightScenarioResult,
  type PreFlightReport,
} from './preFlightSellSim';

// 오케스트레이터
export {
  evaluateSellSignals,
  evaluateSellSignalsFromContext,
  type EvaluateSellSignalsOptions,
} from './orchestrator';

// Strategy Pattern (Phase 2)
export { SELL_LAYER_REGISTRY, SELL_LAYERS } from './registry';
export type { SellLayer } from './types';
