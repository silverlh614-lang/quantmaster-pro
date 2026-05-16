// @responsibility Runtime block/failure to ShadowCase adapter. Diagnostic-only; no order/broker imports.

import type { DataConfidence } from '../data/dataConfidenceRouter.js';
import type { EngineMode as RuntimeEngineMode, EngineRuntimePolicy } from '../runtime/engineRuntimePolicy.js';
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import type {
  ConfidenceLevel,
  DataHealth,
  EngineMode as ShadowEngineMode,
  OutcomeLabel,
  ShadowCase,
} from './shadowTypes.js';

export interface ShadowOutcomeHorizonInput {
  outcomeLabel?: OutcomeLabel;
  returnPct?: number;
  checkedAt?: string;
}

export interface BuildShadowCaseForRuntimeInput {
  runtimePolicy: EngineRuntimePolicy;
  caseId: string;
  signalId?: string;
  symbol: string;
  symbolName?: string;
  timestamp?: string;
  marketSession: string;
  blockedReason?: string;
  dataProvider?: string;
  dataHealth?: DataConfidence;
  expectedDecision?: string;
  actualDecision?: string;
  shadowDecision?: string;
  postOutcome?: string;
  learningTag: string;
  entryPriceVirtual?: number;
  stopPriceVirtual?: number;
  targetPriceVirtual?: number;
  horizon1d?: ShadowOutcomeHorizonInput;
  horizon3d?: ShadowOutcomeHorizonInput;
  horizon5d?: ShadowOutcomeHorizonInput;
  horizon10d?: ShadowOutcomeHorizonInput;
}

function toShadowEngineMode(mode: RuntimeEngineMode): ShadowEngineMode {
  if (mode === 'DEGRADED') return 'NORMAL';
  return mode;
}

function toDataHealth(confidence?: DataConfidence): DataHealth {
  if (confidence === 'VERIFIED') return 'OK';
  if (confidence === 'STALE') return 'STALE';
  if (confidence === 'DEGRADED') return 'DEGRADED';
  if (confidence === 'MISSING') return 'UNAVAILABLE';
  if (confidence === 'AI_ESTIMATED') return 'DEGRADED';
  return 'OK';
}

function toConfidenceLevel(confidence?: DataConfidence): ConfidenceLevel {
  if (confidence === 'VERIFIED') return 'VERIFIED';
  if (confidence === 'AI_ESTIMATED') return 'AI_ESTIMATE';
  if (confidence === 'MISSING') return 'LOW';
  if (confidence === 'DEGRADED' || confidence === 'STALE') return 'FALLBACK';
  return 'CALCULATED';
}

export function buildShadowCaseForRuntime(input: BuildShadowCaseForRuntimeInput): ShadowCase {
  const now = input.timestamp ?? new Date().toISOString();
  return {
    caseId: input.caseId,
    signalId: input.signalId ?? input.caseId,
    symbol: input.symbol,
    symbolName: input.symbolName ?? input.symbol,
    detectedAt: now,
    marketSession: input.marketSession,
    engineMode: toShadowEngineMode(input.runtimePolicy.engineMode),
    blockedReason: input.blockedReason ?? input.runtimePolicy.reasonCodes[0],
    dataProvider: input.dataProvider,
    dataHealth: toDataHealth(input.dataHealth),
    providerHealth: 'OK',
    confidenceLevel: toConfidenceLevel(input.dataHealth),
    expectedDecision: input.expectedDecision,
    actualDecision: input.actualDecision ?? (input.runtimePolicy.liveBuyAllowed ? 'LIVE_BUY_ALLOWED' : 'LIVE_BUY_BLOCKED'),
    shadowDecision: input.shadowDecision ?? (input.runtimePolicy.shadowAllowed ? 'SHADOW_TRACK' : undefined),
    postOutcome: input.postOutcome,
    executionImpact: 'NONE',
    entryPriceVirtual: input.entryPriceVirtual,
    stopPriceVirtual: input.stopPriceVirtual,
    targetPriceVirtual: input.targetPriceVirtual,
    virtualOutcome1d: input.horizon1d?.outcomeLabel,
    virtualOutcome3d: input.horizon3d?.outcomeLabel,
    virtualOutcome5d: input.horizon5d?.outcomeLabel,
    virtualOutcome10d: input.horizon10d?.outcomeLabel,
    virtualReturnPct1d: input.horizon1d?.returnPct,
    virtualReturnPct3d: input.horizon3d?.returnPct,
    virtualReturnPct5d: input.horizon5d?.returnPct,
    virtualReturnPct10d: input.horizon10d?.returnPct,
    virtualCheckedAt1d: input.horizon1d?.checkedAt,
    virtualCheckedAt3d: input.horizon3d?.checkedAt,
    virtualCheckedAt5d: input.horizon5d?.checkedAt,
    virtualCheckedAt10d: input.horizon10d?.checkedAt,
    outcomeLabel: 'ACTIVE',
    learningTag: input.learningTag,
    sourceConfidence: input.dataHealth === 'VERIFIED' ? 'VERIFIED' : 'FALLBACK',
    createdAt: now,
    updatedAt: now,
    state: input.runtimePolicy.liveBuyAllowed ? 'DECISION_MADE' : 'LIVE_BLOCKED_SHADOW_ALLOWED',
    liveOrderCreated: false,
    brokerOrderCreated: false,
    brokerOrdersCreated: 0,
    counterfactualRecorded: true,
  };
}

export function recordShadowCaseForRuntimePolicy(
  ledger: ShadowCaseLedgerStore,
  input: BuildShadowCaseForRuntimeInput,
): ShadowCase {
  return ledger.upsertCase(buildShadowCaseForRuntime(input));
}
