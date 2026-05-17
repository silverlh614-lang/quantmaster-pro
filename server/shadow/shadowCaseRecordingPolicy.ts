// @responsibility Runtime block/failure to ShadowCase adapter. Diagnostic-only; no order/broker imports.

import type { DataConfidence } from '../data/dataConfidenceRouter.js';
import type { EngineMode as RuntimeEngineMode, EngineRuntimePolicy } from '../runtime/engineRuntimePolicy.js';
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import { normalizeRegimeContext } from './regimeContext.js';
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
  rawRegime?: string;
  effectiveRegime?: string;
  regimeAtSignal?: string;
  regimeAtEntry?: string;
  regimeAtExit?: string;
  regimeAtOutcome?: string;
  r6Trigger?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  sourceFreshness?: string;
  regimeConfidence?: 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'UNKNOWN';
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
  conditionTags?: string[];
  sectorTag?: string;
  timeWindowTag?: string;
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
  const engineMode = toShadowEngineMode(input.runtimePolicy.engineMode);
  const regimeContext = normalizeRegimeContext({
    rawRegime: input.rawRegime,
    effectiveRegime: input.effectiveRegime,
    regimeAtSignal: input.regimeAtSignal,
    regimeAtEntry: input.regimeAtEntry,
    regimeAtExit: input.regimeAtExit,
    regimeAtOutcome: input.regimeAtOutcome,
    r6Trigger: input.r6Trigger,
    engineMode,
    marketSession: input.marketSession,
    sellOnlyActive: input.sellOnlyActive,
    hardBlockActive: input.hardBlockActive,
    blockedReason: input.blockedReason ?? input.runtimePolicy.reasonCodes[0],
    sourceFreshness: input.sourceFreshness,
    regimeConfidence: input.regimeConfidence,
  });
  return {
    caseId: input.caseId,
    signalId: input.signalId ?? input.caseId,
    symbol: input.symbol,
    symbolName: input.symbolName ?? input.symbol,
    detectedAt: now,
    marketSession: input.marketSession,
    engineMode,
    rawRegime: regimeContext.rawRegime,
    effectiveRegime: regimeContext.effectiveRegime,
    regimePhase: regimeContext.regimePhase,
    regimeAtSignal: regimeContext.regimeAtSignal,
    regimeAtEntry: regimeContext.regimeAtEntry,
    regimeAtExit: regimeContext.regimeAtExit,
    regimeAtOutcome: regimeContext.regimeAtOutcome,
    r6Trigger: regimeContext.r6Trigger,
    sellOnlyActive: regimeContext.sellOnlyActive,
    hardBlockActive: regimeContext.hardBlockActive,
    sourceFreshness: regimeContext.sourceFreshness,
    regimeConfidence: regimeContext.regimeConfidence,
    blockedReason: input.blockedReason ?? input.runtimePolicy.reasonCodes[0],
    dataProvider: input.dataProvider,
    dataHealth: toDataHealth(input.dataHealth),
    providerHealth: 'OK',
    confidenceLevel: toConfidenceLevel(input.dataHealth),
    expectedDecision: input.expectedDecision,
    actualDecision: input.actualDecision ?? (input.runtimePolicy.liveEntryAllowed ? 'LIVE_BUY_ALLOWED' : 'LIVE_BUY_BLOCKED'),
    shadowDecision: input.shadowDecision ?? (input.runtimePolicy.shadowBuyAllowed && input.runtimePolicy.shadowSellAllowed ? 'SHADOW_BUY_SELL_ALLOWED' : 'SHADOW_TRACK'),
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
    conditionTags: input.conditionTags,
    sectorTag: input.sectorTag,
    timeWindowTag: input.timeWindowTag,
    sourceConfidence: input.dataHealth === 'VERIFIED' ? 'VERIFIED' : 'FALLBACK',
    createdAt: now,
    updatedAt: now,
    state: input.runtimePolicy.liveEntryAllowed ? 'DECISION_MADE' : 'LIVE_BLOCKED_SHADOW_ALLOWED',
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
