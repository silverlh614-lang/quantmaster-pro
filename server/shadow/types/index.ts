// @responsibility Shadow type barrel. Runtime EngineMode/ExecutionImpact are re-exported from runtime SSOT.
export type { EngineMode, ExecutionImpact } from '../../runtime/engineRuntimePolicy.js';
export type { ShadowLifecycleState, ShadowStateTransition } from './lifecycle.js';
export type { DataHealth, ProviderHealth, ConfidenceLevel, SourceConfidence, ShadowCase } from './shadowCase.js';
export type { OutcomeLabel } from './outcome.js';
export type { IntegrityIssue, IntegritySeverity } from './integrity.js';
export type { ReturnFlowCheck } from './returnFlow.js';
export type { PromotionReport, PromotionStatus } from './promotion.js';
