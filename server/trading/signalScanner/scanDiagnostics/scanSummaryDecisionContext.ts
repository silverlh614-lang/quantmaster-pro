// @responsibility Build canonical SourceSnapshotDecisionContext projections for scan summary child diagnostics.

import {
  buildDecisionContextFromScanSummaryView,
  formatDecisionContextAuthorityBlock,
} from '../../../runtime/sourceSnapshotDecisionContextBuilder.js';
import type { SourceSnapshotDecisionContext } from '../../../runtime/sourceSnapshotDecisionContext.js';
import { getRegimePositionPolicy } from '../../sizing/regimePositionPolicy.js';
import { resolveScanMarketSessionView } from '../state/scanEvaluationState.js';
import { buildGate0Decision, type Gate0Decision } from './gate0MacroPermissionDecision.js';
import type { ScanSummary } from './scanSummaryTypes.js';

const upper = (value: unknown): string => String(value ?? '').trim().toUpperCase();

export interface ScanSummaryPermissionView {
  canonicalSession: string;
  displaySession: string;
  engineMode: string;
  displayRegime: string;
  policyView: string;
  liveEntryAllowed: boolean;
  liveOrderAllowed: boolean;
  brokerRouteAlive: boolean;
  brokerLiveOrderAllowed: boolean;
  brokerExitOrderAllowed: boolean;
  paperOrderAllowed: boolean;
  shadowAllowed: boolean;
  watchAllowed: boolean;
  counterfactualAllowed: boolean;
  executionImpact: 'NONE';
  note: string;
}

export interface ChildRegimeDiagnosticContext {
  rawRegime: string;
  effectiveRegime: string;
  displayRegime: string;
  riskOverride: string;
  engineMode: string;
  policyView: string;
  liveEntryAllowed: boolean;
  shadowAllowed: boolean;
  counterfactualAllowed: boolean;
  sourceSnapshotId?: string;
  regimeContextSource: 'SourceSnapshotDecisionContext';
  regimeContextMatch: boolean;
  page2EffectiveRegime: string;
  childEffectiveRegime: string;
  legacyEffectiveRegime?: string;
  legacyDeprecated?: boolean;
  legacyUsedForDecision: false;
  regimeContextMismatch: boolean;
  legacyEffectiveRegimeLeak: boolean;
  nextAction: 'NONE' | 'USE_SOURCE_SNAPSHOT_DECISION_CONTEXT';
}

export interface ScanSummaryDecisionContextBundle {
  decisionContext: SourceSnapshotDecisionContext;
  permissionView: ScanSummaryPermissionView;
  gate0Decision: Gate0Decision;
  staleLegacyR6Path: boolean;
}

export function parseScanSummaryDate(summary: ScanSummary): Date | null {
  const sourceHealth = summary.sourceSnapshotDataHealth as { asOf?: string } | undefined;
  const candidates = [
    summary.scanEvaluation?.asOf,
    sourceHealth?.asOf,
    summary.snapshotId,
    summary.time,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = String(candidate);
    const normalized = raw.includes(' KST') ? raw.replace(' KST', '+09:00') : raw;
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return null;
}

export function resolveScanSummaryPermissionView(summary: ScanSummary): ScanSummaryPermissionView {
  const mg = summary.macroGateState;
  const sessionView = resolveScanMarketSessionView({
    explicitMarketSessionState: summary.scanEvaluation?.marketSessionState,
    macroGateState: mg,
    asOf: summary.scanEvaluation?.asOf ?? parseScanSummaryDate(summary)?.toISOString(),
    timeLabel: summary.time,
  });
  const displayRegime = mg?.displayRegime ?? mg?.regime ?? summary.scanEvaluation?.engineMode ?? 'UNKNOWN';
  const engineMode = mg?.engineMode ?? summary.scanEvaluation?.engineMode ?? displayRegime;
  const shadowOnly = upper(engineMode) === 'SHADOW_ONLY'
    || upper(displayRegime) === 'SHADOW_ONLY'
    || upper(mg?.riskOverride) === 'SHADOW_ONLY';
  const liveSession = sessionView.canonicalSession === 'REGULAR_OPEN';
  const brokerRouteAlive = mg?.brokerRouteAlive ?? mg?.brokerOrderAllowed ?? true;
  const brokerLive = mg?.brokerLiveOrderAllowed ?? (brokerRouteAlive === true && liveSession && !shadowOnly && mg?.liveEntryAllowed === true);
  const brokerExit = mg?.brokerExitOrderAllowed ?? (brokerRouteAlive === true && liveSession && !shadowOnly && mg?.liveExitAllowed === true);
  const liveOrderAllowed = brokerLive === true && !shadowOnly && liveSession;
  const riskOverride = mg?.riskOverride ?? 'NONE';
  const policyView = riskOverride !== 'NONE' ? riskOverride : displayRegime;
  return {
    canonicalSession: sessionView.canonicalSession,
    displaySession: sessionView.displaySession,
    engineMode,
    displayRegime,
    policyView,
    liveEntryAllowed: liveOrderAllowed,
    liveOrderAllowed,
    brokerRouteAlive,
    brokerLiveOrderAllowed: liveOrderAllowed,
    brokerExitOrderAllowed: brokerExit,
    paperOrderAllowed: mg?.paperOrderAllowed ?? true,
    shadowAllowed: mg?.shadowAllowed ?? mg?.shadowBuyAllowed ?? true,
    watchAllowed: true,
    counterfactualAllowed: mg?.counterfactualAllowed ?? true,
    executionImpact: 'NONE',
    note: sessionView.canonicalSession === 'HOLIDAY'
      ? 'Holiday blocks live broker orders; paper/shadow observation remains allowed.'
      : 'Paper/shadow observation permission is separate from live broker orders.',
  };
}

export function buildScanSummaryDecisionContextBundle(
  summary: ScanSummary,
): ScanSummaryDecisionContextBundle | null {
  const mg = summary.macroGateState;
  if (!mg) return null;
  const permissionView = resolveScanSummaryPermissionView(summary);
  const rawRegime = mg.macroRegimeRaw ?? String(summary.scanEvaluation?.diagnostics?.rawRegime ?? mg.regime ?? 'UNKNOWN');
  const legacyEffectiveRegime = mg.macroRegimeEffective ?? mg.regime ?? 'UNKNOWN';
  const displayRegime = mg.displayRegime ?? mg.regime ?? 'UNKNOWN';
  const staleLegacyR6Path =
    legacyEffectiveRegime === 'R6_DEFENSE' &&
    displayRegime !== 'R6_DEFENSE' &&
    mg.regime !== 'R6_DEFENSE';
  const effectiveRegime = summary.scanEvaluation?.effectiveRegime ?? (staleLegacyR6Path ? rawRegime : legacyEffectiveRegime);
  const riskOverride = mg.riskOverride ?? 'NONE';
  const policyView = riskOverride !== 'NONE' ? riskOverride : displayRegime;
  const positionPolicy = getRegimePositionPolicy(policyView || effectiveRegime);
  const gate0Decision = buildGate0Decision(summary, parseScanSummaryDate(summary) ?? new Date());
  const decisionContext = buildDecisionContextFromScanSummaryView({
    snapshotId: gate0Decision.sourceSnapshotId,
    asOf: mg.regimeSnapshotAsOf ?? 'N/A',
    ttlSec: mg.regimeSnapshotTtlSec ?? 0,
    rawRegime: rawRegime ?? 'UNKNOWN',
    effectiveRegime: effectiveRegime ?? 'UNKNOWN',
    displayRegime: displayRegime ?? 'UNKNOWN',
    riskOverride,
    ...(staleLegacyR6Path ? { legacyEffectiveRegime } : {}),
    executionPolicy: {
      finalExecutionPolicy: gate0Decision.finalExecutionPolicy,
      liveEntryAllowed: permissionView.liveEntryAllowed,
      liveExitAllowed: gate0Decision.liveExitAllowed,
      brokerOrderAllowed: permissionView.brokerLiveOrderAllowed,
      brokerLiveOrderAllowed: permissionView.brokerLiveOrderAllowed,
      brokerExitOrderAllowed: permissionView.brokerExitOrderAllowed,
      shadowBuyAllowed: mg.shadowBuyAllowed ?? gate0Decision.shadowAllowed,
      shadowSellAllowed: mg.shadowSellAllowed ?? gate0Decision.shadowAllowed,
      shadowLearningAllowed: gate0Decision.shadowLearningAllowed,
      counterfactualAllowed: gate0Decision.counterfactualAllowed,
      diagnosticAllowed: gate0Decision.diagnosticAllowed,
      liveBlockReason: gate0Decision.liveBlockReason,
      executionPermissionReason: gate0Decision.executionPermissionReason,
      executionImpact: gate0Decision.executionImpact,
      engineMode: gate0Decision.engineMode,
      snapshotFreshnessForLive: gate0Decision.snapshotFreshnessForLive,
      snapshotFreshnessForShadow: gate0Decision.snapshotFreshnessForShadow,
      usableForLiveOrder: gate0Decision.usableForLiveOrder,
      usableForBrokerOrder: gate0Decision.usableForBrokerOrder,
    },
    kellyMultiplier: mg.finalKellyMultiplier,
    exposureCap: positionPolicy.maxGrossExposurePct,
    maxPositions: positionPolicy.maxPositions,
    positionCap: positionPolicy.perPositionPct,
  });
  return { decisionContext, permissionView, gate0Decision, staleLegacyR6Path };
}

export function formatScanSummaryDecisionContextAuthorityLines(summary: ScanSummary): {
  lines: string[];
  bundle: ScanSummaryDecisionContextBundle | null;
} {
  const bundle = buildScanSummaryDecisionContextBundle(summary);
  if (!bundle) return { lines: [], bundle };
  return {
    bundle,
    lines: formatDecisionContextAuthorityBlock(bundle.decisionContext, {
      comparisonSnapshotId: summary.snapshotId,
    }),
  };
}

export function buildDiagnosticRegimeContext(summary: ScanSummary): ChildRegimeDiagnosticContext {
  const bundle = buildScanSummaryDecisionContextBundle(summary);
  const mr = bundle?.decisionContext.regimeConstitution;
  const ep = bundle?.decisionContext.executionPolicy;
  const fallback = summary.macroGateState;
  const effectiveRegime = mr?.effectiveRegime ?? summary.scanEvaluation?.effectiveRegime ?? fallback?.macroRegimeEffective ?? fallback?.regime ?? 'UNKNOWN';
  const legacyEffectiveRegime = mr?.legacyEffectiveRegime;
  const page2EffectiveRegime = mr?.effectiveRegime ?? effectiveRegime;
  const childEffectiveRegime = effectiveRegime;
  const regimeContextMismatch = childEffectiveRegime !== page2EffectiveRegime;
  const legacyEffectiveRegimeLeak =
    legacyEffectiveRegime !== undefined &&
    childEffectiveRegime === legacyEffectiveRegime &&
    childEffectiveRegime !== page2EffectiveRegime;
  return {
    rawRegime: mr?.rawRegime ?? fallback?.macroRegimeRaw ?? fallback?.regime ?? 'UNKNOWN',
    effectiveRegime,
    displayRegime: mr?.displayRegime ?? fallback?.displayRegime ?? fallback?.regime ?? 'UNKNOWN',
    riskOverride: mr?.riskOverride ?? fallback?.riskOverride ?? 'NONE',
    engineMode: ep ? bundle?.gate0Decision.engineMode ?? 'UNKNOWN' : fallback?.engineMode ?? 'UNKNOWN',
    policyView: mr?.policyView ?? fallback?.riskOverride ?? fallback?.displayRegime ?? 'UNKNOWN',
    liveEntryAllowed: ep?.liveEntryAllowed ?? false,
    shadowAllowed: ep?.shadowBuyAllowed ?? fallback?.shadowAllowed ?? fallback?.shadowBuyAllowed ?? true,
    counterfactualAllowed: ep?.counterfactualAllowed ?? fallback?.counterfactualAllowed ?? true,
    sourceSnapshotId: (summary.entryFilterDecomposition as { sourceSnapshotId?: string } | undefined)?.sourceSnapshotId ?? bundle?.decisionContext.snapshotId,
    regimeContextSource: 'SourceSnapshotDecisionContext',
    regimeContextMatch: !regimeContextMismatch && !legacyEffectiveRegimeLeak,
    page2EffectiveRegime,
    childEffectiveRegime,
    ...(legacyEffectiveRegime !== undefined ? { legacyEffectiveRegime, legacyDeprecated: true } : {}),
    legacyUsedForDecision: false,
    regimeContextMismatch,
    legacyEffectiveRegimeLeak,
    nextAction: regimeContextMismatch || legacyEffectiveRegimeLeak ? 'USE_SOURCE_SNAPSHOT_DECISION_CONTEXT' : 'NONE',
  };
}
