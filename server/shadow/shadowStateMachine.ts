// @responsibility Shadow case 명시 상태머신 — 불가능 전이는 integrity issue 로 기록
import type { ConfidenceLevel, DataHealth, EngineMode, ExecutionImpact, ShadowLifecycleState, ShadowStateTransition } from './shadowTypes.js';

const IMPACT_NONE_MODES: ReadonlySet<EngineMode> = new Set(['SHADOW_ONLY', 'SELL_ONLY', 'OBSERVE_ONLY']);

const ALLOWED: Record<ShadowLifecycleState, readonly ShadowLifecycleState[]> = {
  CANDIDATE_DETECTED: ['SHADOW_SIGNAL_APPROVED', 'GATE_EVALUATED', 'QUARANTINED'],
  SHADOW_SIGNAL_APPROVED: ['SHADOW_ORDER_CREATED', 'QUARANTINED'],
  GATE_EVALUATED: ['DECISION_MADE', 'REJECTED_TRACE_ONLY', 'QUARANTINED'],
  DECISION_MADE: ['LIVE_APPROVED', 'LIVE_BLOCKED_SHADOW_ALLOWED', 'SHADOW_ONLY', 'REJECTED_TRACE_ONLY', 'QUARANTINED'],
  LIVE_APPROVED: ['SHADOW_ORDER_CREATED', 'QUARANTINED'],
  LIVE_BLOCKED_SHADOW_ALLOWED: ['SHADOW_ORDER_CREATED', 'QUARANTINED'],
  SHADOW_ONLY: ['SHADOW_ORDER_CREATED', 'QUARANTINED'],
  REJECTED_TRACE_ONLY: ['REFLECTION_READY', 'QUARANTINED'],
  SHADOW_ORDER_CREATED: ['SHADOW_PAPER_FILLED', 'QUARANTINED'],
  SHADOW_PAPER_FILLED: ['SHADOW_POSITION_OPENED', 'QUARANTINED'],
  SHADOW_POSITION_OPENED: ['SHADOW_MONITORING', 'SHADOW_EXIT_TRIGGERED', 'QUARANTINED'],
  SHADOW_MONITORING: ['SHADOW_EXIT_TRIGGERED', 'SHADOW_POSITION_CLOSED', 'QUARANTINED'],
  SHADOW_EXIT_TRIGGERED: ['SHADOW_PAPER_SOLD', 'QUARANTINED'],
  SHADOW_PAPER_SOLD: ['SHADOW_POSITION_CLOSED', 'QUARANTINED'],
  SHADOW_POSITION_CLOSED: ['OUTCOME_LABELED', 'QUARANTINED'],
  OUTCOME_LABELED: ['REFLECTION_READY', 'QUARANTINED'],
  REFLECTION_READY: ['PARAM_UPDATE_CANDIDATE', 'QUARANTINED'],
  PARAM_UPDATE_CANDIDATE: ['REFLECTION_READY'],
  QUARANTINED: [],
};

export interface TransitionInput {
  caseId: string;
  from?: ShadowLifecycleState;
  to: ShadowLifecycleState;
  reason: string;
  engineMode: EngineMode;
  executionImpact: ExecutionImpact;
  dataHealth: DataHealth;
  confidenceLevel: ConfidenceLevel;
  now?: Date;
}

export interface TransitionResult {
  ok: boolean;
  transition: ShadowStateTransition;
}

function forceNoneImpact(engineMode: EngineMode, impact: ExecutionImpact): ExecutionImpact {
  return IMPACT_NONE_MODES.has(engineMode) ? 'NONE' : impact;
}

function canTransition(from: ShadowLifecycleState | undefined, to: ShadowLifecycleState): boolean {
  if (!from) return to === 'CANDIDATE_DETECTED';
  return ALLOWED[from]?.includes(to) ?? false;
}

export function transitionShadowState(input: TransitionInput): TransitionResult {
  const executionImpact = forceNoneImpact(input.engineMode, input.executionImpact);
  const ok = canTransition(input.from, input.to);
  const transition: ShadowStateTransition = {
    caseId: input.caseId,
    from: input.from,
    to: ok ? input.to : input.from ?? 'QUARANTINED',
    timestamp: (input.now ?? new Date()).toISOString(),
    reason: input.reason,
    engineMode: input.engineMode,
    executionImpact,
    dataHealth: input.dataHealth,
    confidenceLevel: input.confidenceLevel,
    integrityIssue: ok ? undefined : `invalid_transition:${input.from ?? 'NONE'}->${input.to}`,
  };
  return { ok, transition };
}

export function isShadowNoImpactMode(mode: EngineMode): boolean {
  return IMPACT_NONE_MODES.has(mode);
}
