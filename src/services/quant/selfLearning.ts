/**
 * @responsibility 자기학습 5계층 시리즈 (PR-A~J) 통합 barrel — 외부 사용자 1-stop 진입점
 *
 * PR-K (리팩토링): PR-A~J 의 모듈이 분산되어 호출자가 어디서 import 해야 할지
 * 헷갈리는 drift 위험을 단일 진입점으로 차단. 본 모듈은 re-export 만 — 새 로직 0.
 */

// PR-A — 데이터 무결성 어댑터
export {
  CHECKLIST_TO_CONDITION_ID,
  checklistToConditionScores,
  getConditionSources,
  approximateGateScores,
  GATE1_CONDITION_IDS,
  GATE2_CONDITION_IDS,
  GATE3_CONDITION_IDS,
} from './checklistToConditionScores';

// PR-B — RecommendationSnapshot lifecycle
export {
  buildSnapshotFromRecommendation,
  captureSnapshot,
  captureSnapshots,
  markSnapshotOpen,
  markSnapshotClosed,
  expireStaleSnapshots,
  computeSnapshotStats,
  getRecentSnapshots,
  canTransition,
  SNAPSHOT_EXPIRY_MS,
  SNAPSHOT_MAX_RETAINED,
  SNAPSHOT_SCHEMA_VERSION,
} from './recommendationSnapshotRepo';

// PR-C — AI/COMPUTED 차등 학습
export {
  SOURCE_LEARNING_MULTIPLIER,
  getSourceMultiplier,
  resolveSource,
  isSourceWeightingDisabled,
} from './sourceWeighting';

// PR-D — 손실 원인 자동 분류
export {
  classifyLossReason,
  buildLossReasonMeta,
  MACRO_SHOCK_VKOSPI_DELTA,
  MACRO_SHOCK_RETURN_PCT_MAX,
  STOP_TOO_TIGHT_HOLDING_DAYS_MAX,
  STOP_TOO_TIGHT_RETURN_PCT_MIN,
  STOP_TOO_TIGHT_RETURN_PCT_MAX,
  OVERHEATED_ENTRY_HOLDING_DAYS_MAX,
  OVERHEATED_PSYCHOLOGY_THRESHOLD,
  STOP_TOO_LOOSE_RETURN_PCT_MAX,
} from './lossReasonClassifier';

// PR-E — 손실 원인별 학습 가중치
export {
  LOSS_REASON_LEARNING_MULTIPLIER,
  getTradeLearningWeight,
  isLossReasonWeightingDisabled,
  summarizeLossReasonBreakdown,
} from './lossReasonWeighting';

// PR-F — Profit Factor / Edge Score
export {
  computeConditionEdge,
  type ConditionEdgeStats,
} from './conditionEdgeScore';

// PR-G — Regime Memory Bank
export {
  ALL_REGIMES,
  getEvolutionWeightsByRegime,
  saveEvolutionWeightsByRegime,
  evaluateFeedbackLoopByRegime,
  evaluateAllRegimes,
  type RegimeKey,
} from './regimeMemoryBank';

// PR-I — 조건 귀인 분석
export {
  classifyConditionAttribution,
  classifyAllConditions,
  ATTRIBUTION_MIN_GROUP,
  ATTRIBUTION_SPREAD_THRESHOLD,
  ATTRIBUTION_ABS_THRESHOLD,
  RISK_PROTECTOR_LOW_THRESHOLD,
  type AttributionClass,
  type ConditionAttribution,
} from './conditionAttribution';

// PR-J — Shadow Model
export {
  compareShadowVsLive,
  isPromotable,
  type ConditionDivergence,
  type ShadowComparisonResult,
} from './learningShadowModel';

// 핵심 학습 엔진 + 옵션
export {
  evaluateFeedbackLoop,
  CALIBRATION_MIN_TRADES,
  type FeedbackLoopOptions,
} from './feedbackLoopEngine';
