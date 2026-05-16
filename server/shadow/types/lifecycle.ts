// @responsibility Shadow lifecycle state and transition contracts.
import type { EngineMode, ExecutionImpact } from '../../runtime/engineRuntimePolicy.js';
import type { ConfidenceLevel, DataHealth } from './shadowCase.js';

export type ShadowLifecycleState =
  | 'CANDIDATE_DETECTED'
  | 'SHADOW_SIGNAL_APPROVED'
  | 'GATE_EVALUATED'
  | 'DECISION_MADE'
  | 'LIVE_APPROVED'
  | 'LIVE_BLOCKED_SHADOW_ALLOWED'
  | 'SHADOW_ONLY'
  | 'REJECTED_TRACE_ONLY'
  | 'SHADOW_ORDER_CREATED'
  | 'SHADOW_PAPER_FILLED'
  | 'SHADOW_POSITION_OPENED'
  | 'SHADOW_MONITORING'
  | 'SHADOW_EXIT_TRIGGERED'
  | 'SHADOW_PAPER_SOLD'
  | 'SHADOW_POSITION_CLOSED'
  | 'OUTCOME_LABELED'
  | 'REFLECTION_READY'
  | 'PARAM_UPDATE_CANDIDATE'
  | 'QUARANTINED';

export interface ShadowStateTransition {
  caseId: string;
  from?: ShadowLifecycleState;
  to: ShadowLifecycleState;
  timestamp: string;
  reason: string;
  engineMode: EngineMode;
  executionImpact: ExecutionImpact;
  dataHealth: DataHealth;
  confidenceLevel: ConfidenceLevel;
  integrityIssue?: string;
}
