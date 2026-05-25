// @responsibility ADR-0527 per-candidate unified execution-permission SSOT producer — derives A (resolveExecutionPermission, byte-equivalent) + B label from persisted summary, merges, aggregates. No formatter/LIVE path mutation.

import {
  resolveExecutionPermission,
  type ResolveExecutionPermissionInput,
} from '../../../runtime/executionPermissionResolver.js';
import {
  resolveFinalExecutionDecision,
  type FinalDecision,
  type FinalDecisionEffectiveRegime,
  type FinalDecisionEngineMode,
  type FinalDecisionEntryTimingSignal,
  type FinalDecisionMarketSession,
  type FinalDecisionProviderHealthStatus,
  type FinalDecisionShadowMode,
} from '../../gates/finalDecisionResolver.js';
import { labelFromFinalScore, type ConvictionLabel } from '../../gates/simpleDecision.js';
import {
  toUnifiedExecutionPermission,
  type ExecutionScopedCount,
  type UnifiedExecutionPermissionAggregate,
  type UnifiedExecutionPermissionResolution,
} from '../../gates/unifiedExecutionContract.js';
import { buildGate3RuntimeClosureSummary } from '../../../quant/gate3RuntimeClosure.js';
import { buildGate2ConfluenceSummary, type Gate2Status } from '../../../quant/gate2ConfluenceScore.js';
import { logger } from '../../../utils/logger.js';
import type { CandidateGateEvaluationView } from './candidateGateEvaluationView.js';
import type { ScanSummary } from './scanSummaryTypes.js';

type AnyRecord = Record<string, unknown>;

function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(recordOf).filter((item): item is AnyRecord => Boolean(item)) : [];
}

function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function bool(value: unknown): boolean {
  return value === true || String(value ?? '').trim().toLowerCase() === 'true';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ── meta 해석 (candidateGateEvaluationView 와 동일 우선순위) ──

function resolveSourceSnapshotId(summary: AnyRecord): string {
  return text(
    summary.sourceSnapshotId
      ?? summary.snapshotId
      ?? getByPath(summary, 'scanEvaluation.scanId')
      ?? getByPath(summary, 'candidatePool.sourceSnapshotId')
      ?? getByPath(summary, 'entryFilterDecomposition.sourceSnapshotId')
      ?? getByPath(summary, 'gateLayerAudit.sourceSnapshotId')
      ?? getByPath(summary, 'macroGateState.regimeSnapshotId'),
    'SNAPSHOT_MISSING',
  );
}

/** 실제 스캔 시각 — 더미 시각(1970) 의존 제거(divergence 원인 차단). */
function resolveScanAsOf(summary: AnyRecord): string {
  return text(
    getByPath(summary, 'scanEvaluation.asOf')
      ?? summary.asOf
      ?? summary.time
      ?? getByPath(summary, 'macroGateState.regimeSnapshotAsOf'),
    new Date(0).toISOString(),
  );
}

// ── A 입력 도출 (persist 된 macroGateState 에서) ──

function normalizeEngineMode(value: unknown): FinalDecisionEngineMode {
  const raw = text(value, 'OBSERVE_ONLY').toUpperCase();
  if (raw === 'NORMAL' || raw === 'DEGRADED' || raw === 'SELL_ONLY' || raw === 'SHADOW_ONLY' || raw === 'OBSERVE_ONLY') return raw;
  if (raw === 'LIVE') return 'NORMAL';
  return 'OBSERVE_ONLY';
}

function normalizeMarketSession(value: unknown): FinalDecisionMarketSession {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'REGULAR' || raw === 'PRE_MARKET' || raw === 'POST_MARKET' || raw === 'HOLIDAY' || raw === 'LUNCH' || raw === 'UNKNOWN') return raw;
  if (raw === 'NON_TRADING_DAY' || raw === 'CLOSED' || raw === 'BUY_ALLOWED') {
    return raw === 'BUY_ALLOWED' ? 'REGULAR' : 'HOLIDAY';
  }
  return 'UNKNOWN';
}

function normalizeRegime(value: unknown): FinalDecisionEffectiveRegime {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  if (raw === 'GREEN' || raw === 'YELLOW' || raw === 'RED' || raw === 'R6_DEFENSE' || raw === 'R5_STABILIZING' || raw === 'UNKNOWN') return raw;
  if (raw.startsWith('R6')) return 'R6_DEFENSE';
  if (raw.startsWith('R5')) return 'R5_STABILIZING';
  return 'UNKNOWN';
}

function normalizeHealth(value: unknown): FinalDecisionProviderHealthStatus {
  const raw = text(value, 'VERIFIED').toUpperCase();
  if (raw === 'VERIFIED' || raw === 'DEGRADED' || raw === 'STALE' || raw === 'MISSING') return raw;
  if (raw === 'FRESH' || raw === 'OK' || raw === 'PASS') return 'VERIFIED';
  return 'DEGRADED';
}

function shadowModeFor(engineMode: FinalDecisionEngineMode): FinalDecisionShadowMode {
  if (engineMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  if (engineMode === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';
  return 'NORMAL';
}

/** macroGateState 에서 A 입력의 정책/통신/사이징 컨텍스트(per-scan 공통)를 도출한다. */
interface ScanExecutionContext {
  engineMode: FinalDecisionEngineMode;
  operationMode: string;
  marketSession: FinalDecisionMarketSession;
  effectiveRegime: FinalDecisionEffectiveRegime;
  brokerOrderAllowed: boolean;
  operatorOrderAllowed: boolean;
  realTradingEnabled: boolean;
  macroLiveAllowed: boolean;
  providerIssue: boolean;
  marketSignal: boolean;
  kellyFraction: number | null;
  kellySizingMultiplier: number | null;
}

function deriveScanExecutionContext(summary: AnyRecord): ScanExecutionContext {
  const macro = recordOf(summary.macroGateState) ?? {};
  const engineMode = normalizeEngineMode(
    macro.engineMode ?? summary.engineMode ?? getByPath(summary, 'scanEvaluation.engineMode'),
  );
  const marketSession = normalizeMarketSession(
    macro.canonicalSession ?? macro.displaySession ?? summary.marketSession ?? summary.marketSessionState,
  );
  const effectiveRegime = normalizeRegime(
    macro.macroRegimeEffective ?? macro.regime ?? macro.displayRegime ?? macro.riskOverride,
  );
  const sellOnly = bool(macro.sellOnlyMode);
  const operationMode = sellOnly ? 'SELL_ONLY' : 'NORMAL';
  // broker/operator/realTrading 권한 — macroGateState 정본(부재 시 LIVE 기본 true, A 와 동일 default).
  const brokerOrderAllowed = macro.brokerOrderAllowed !== false && macro.brokerLiveOrderAllowed !== false;
  const operatorOrderAllowed = macro.liveEntryAllowed !== false;
  const realTradingEnabled = bool(macro.autoTradeEnabled) || macro.autoTradeEnabled === undefined;
  const macroLiveAllowed = macro.liveEntryAllowed !== false && !bool(macro.diagnosticLiveEntryBlocked);
  const providerIssue = bool(macro.providerIssue ?? summary.providerIssue);
  const marketSignal = bool(macro.marketSignal ?? summary.marketSignal);
  const kellyFraction = finiteNumber(macro.finalKellyMultiplier);
  const kellySizingMultiplier = finiteNumber(macro.kellyMultiplierFromRegime);
  return {
    engineMode,
    operationMode,
    marketSession,
    effectiveRegime,
    brokerOrderAllowed,
    operatorOrderAllowed,
    realTradingEnabled,
    macroLiveAllowed,
    providerIssue,
    marketSignal,
    kellyFraction,
    kellySizingMultiplier,
  };
}

/**
 * per-candidate gate quality 통과 여부 — Phase1 candidateGateViews 의 gate 통과에서 도출.
 * Gate1 통과 AND Gate2 통과 권한(pass/pass_weak)을 quality 정본으로 본다(execution permission 입력용).
 */
function gateQualityPassedFor(view: CandidateGateEvaluationView | undefined): boolean {
  if (!view) return false;
  return view.gate1.passPermission && view.gate2.passPermission;
}

// ── per-candidate 통합 정본 생산 ──

/**
 * persisted ScanSummary 에서 per-candidate 통합 실행허가 정본(A 병합 B)을 결정론적으로 빌드한다.
 * - A: deriveScanExecutionContext + Phase1 gateQualityPassed → resolveExecutionPermission (LIVE 와 동일 로직, byte-equivalent).
 * - B: gate3 closure result(gate1/gate2/gate3 status + entryTimingSignal) → resolveFinalExecutionDecision(실제 스캔 시각).
 * - 병합: toUnifiedExecutionPermission (permission boolean 은 A 만, decision/conviction/reasonCodes 라벨은 B).
 * 동일 summary → 동일 결과. 더미 시각/네트워크/캐시 미사용. summary/traces 부재 시 빈 배열 + SDS 로깅.
 */
export function buildCandidateExecutionResolutions(summary: ScanSummary | null): UnifiedExecutionPermissionResolution[] {
  const summaryRecord = recordOf(summary);
  if (!summaryRecord) {
    logger.debug('[ADR-0527] candidateExecutionResolution build skipped: summary 미존재 (graceful empty)');
    return [];
  }
  const entryFilter = recordOf(summaryRecord.entryFilterDecomposition);
  const candidateTraces = arrayOfRecords(entryFilter?.candidateTraces);
  if (candidateTraces.length === 0) {
    logger.debug('[ADR-0527] candidateExecutionResolution build skipped: candidateTraces 미존재/빈 배열 (graceful empty)');
    return [];
  }

  const sourceSnapshotId = resolveSourceSnapshotId(summaryRecord);
  const asOf = resolveScanAsOf(summaryRecord);
  const ctx = deriveScanExecutionContext(summaryRecord);

  // Phase1 View per-symbol — gate quality 정본 + B 라벨용 convictionLabel.
  const views = (summaryRecord.candidateGateViews ?? []) as CandidateGateEvaluationView[];
  const viewBySymbol = new Map<string, CandidateGateEvaluationView>();
  for (const view of views) viewBySymbol.set(view.symbol, view);

  // gate3 closure — gate1/gate2/gate3 status + entryTimingSignal 정본(스캔-시점 traces, 캐시 미사용 → 결정론).
  // gate2StatusBySymbol 은 Phase1 과 동일 confluence 정본에서 도출.
  const confluence = buildGate2ConfluenceSummary({
    traces: candidateTraces as readonly Record<string, unknown>[],
    sourceSnapshotId,
  });
  const gate2StatusBySymbol = new Map<string, Gate2Status | string>(
    confluence.results.map((r) => [r.symbol, r.gate2Status]),
  );
  const closure = buildGate3RuntimeClosureSummary({
    traces: candidateTraces as readonly Record<string, unknown>[],
    sourceSnapshotId,
    gate2StatusBySymbol,
  });
  const closureBySymbol = new Map(closure.results.map((r) => [r.symbol, r]));

  const resolutions: UnifiedExecutionPermissionResolution[] = [];
  for (const candidateTrace of candidateTraces) {
    const symbol = text(candidateTrace.symbol ?? getByPath(candidateTrace, 'quote.symbol'), 'UNKNOWN');
    const view = viewBySymbol.get(symbol);
    const closureResult = closureBySymbol.get(symbol);

    // A — LIVE 와 동일 로직(byte-equivalent). per-candidate gateQualityPassed = ctx.macroLiveAllowed && view gate quality.
    const aInput: ResolveExecutionPermissionInput = {
      sourceSnapshotId,
      asOf,
      gateQualityPassed: ctx.macroLiveAllowed && gateQualityPassedFor(view),
      engineMode: ctx.engineMode,
      operationMode: ctx.operationMode,
      effectiveRegime: ctx.effectiveRegime,
      marketSessionState: ctx.marketSession,
      brokerOrderAllowed: ctx.brokerOrderAllowed,
      operatorOrderAllowed: ctx.operatorOrderAllowed,
      realTradingEnabled: ctx.realTradingEnabled,
      providerIssue: ctx.providerIssue || bool(candidateTrace.providerIssue),
      marketSignal: ctx.marketSignal,
      kellyFraction: ctx.kellyFraction,
      kellySizingMultiplier: ctx.kellySizingMultiplier,
    };
    const permission = resolveExecutionPermission(aInput);

    // B — 실제 스캔 시각으로 decision 라벨 산출(더미 시각 의존 0). gate3 closure 정본에서 입력 매핑.
    const entryTimingSignal = (closureResult?.entryTimingSignal ?? 'DATA_INCOMPLETE') as FinalDecisionEntryTimingSignal;
    const decisionOut = resolveFinalExecutionDecision(
      {
        sourceSnapshotId,
        symbol,
        asOf,
        gate1Status: closureResult?.gate1Status ?? 'DATA_INCOMPLETE',
        gate2Status: closureResult?.gate2Status ?? 'DATA_INCOMPLETE',
        gate3Readiness: closureResult?.gate3Readiness ?? 'SKIPPED',
        entryTimingSignal,
        engineMode: ctx.engineMode,
        marketSession: ctx.marketSession,
        effectiveRegime: ctx.effectiveRegime,
        riskOverride: ctx.effectiveRegime === 'R6_DEFENSE' ? 'R6_DEFENSE' : 'NONE',
        providerHealth: {
          quote: normalizeHealth(closureResult?.priceFreshness),
          supply: normalizeHealth(getByPath(candidateTrace, 'providerHealth.supply') ?? candidateTrace.supplyConfidence),
          dart: normalizeHealth(getByPath(candidateTrace, 'providerHealth.dart') ?? candidateTrace.dartConfidence),
          macro: normalizeHealth(getByPath(candidateTrace, 'providerHealth.macro') ?? getByPath(summaryRecord, 'providerHealth.macro')),
        },
        dataConfidenceCeiling: 'HIGH',
        marketSignal: ctx.marketSignal,
        providerIssue: ctx.providerIssue || bool(candidateTrace.providerIssue),
        shadowMode: shadowModeFor(ctx.engineMode),
        requestedSide: 'BUY',
        currentPositionState: 'NONE',
        isDiagnosticOnly: bool(candidateTrace.isDiagnosticOnly) || entryTimingSignal === 'DATA_INCOMPLETE',
      },
      new Date(asOf),
    );

    // B decision 라벨 → UnifiedExecutionPermissionResolution.decision(FinalDecision 어휘) 매핑.
    const decision: FinalDecision = decisionOut.liveBuyAllowed
      ? 'BUY'
      : decisionOut.finalAction === 'LIVE_SELL_ALLOWED' || decisionOut.finalAction === 'SHADOW_SELL_ALLOWED'
        ? 'SELL_ONLY_ALLOWED'
        : decisionOut.finalAction === 'BLOCKED'
          ? 'BLOCK'
          : decisionOut.shadowBuyAllowed
            ? 'BUY'
            : 'HOLD';
    const convictionLabel: ConvictionLabel = view ? convictionFromView(view) : labelFromFinalScore(NaN);

    resolutions.push(
      toUnifiedExecutionPermission(permission, {
        decision,
        convictionLabel,
        reasonCodes: [...new Set([...decisionOut.blockReasons, ...decisionOut.advisoryReasons])],
      }),
    );
  }
  return resolutions;
}

/** Phase1 View 의 gate 통과에서 conviction 라벨 도출(스캔-시점, 점수 무의존 → 결정론). */
function convictionFromView(view: CandidateGateEvaluationView): ConvictionLabel {
  if (view.gate1.status === 'DATA_INCOMPLETE' || view.gate2.status === 'DATA_INCOMPLETE') return 'DATA_INCOMPLETE';
  if (view.gate1.passPermission && view.gate2.status === 'PASS' && view.gate3.readiness === 'READY') return 'HIGH_CONVICTION';
  if (view.gate1.passPermission && view.gate2.passPermission) return 'BUY';
  if (view.gate1.passPermission || view.gate2.status === 'WATCH') return 'WATCH';
  return 'LOW_SCORE';
}

function scoped(scope: ExecutionScopedCount['scope'], value: number): ExecutionScopedCount {
  return { scope, value };
}

/**
 * per-candidate 통합 정본 → UnifiedExecutionPermissionAggregate roll-up.
 * 모든 필드는 *Count / *Created(건수) — permission(boolean)과 명명 분리(ADR-0527 §Decision.2).
 * shadowOrderCreated(count) ≠ per-candidate shadowPermissionAllowed(boolean).
 */
export function aggregateUnifiedExecutionPermission(
  resolutions: readonly UnifiedExecutionPermissionResolution[],
): UnifiedExecutionPermissionAggregate {
  const blockReasonDistribution: Record<string, number> = {};
  let entryReady = 0;
  let liveBuyAllowed = 0;
  let liveBuyBlocked = 0;
  let shadowOrderCreated = 0;
  let observeOnly = 0;
  let blocked = 0;
  let providerIssueIsolated = 0;

  for (const r of resolutions) {
    const isEntry = r.decision === 'BUY';
    if (isEntry) entryReady += 1;
    if (r.liveOrderAllowed) liveBuyAllowed += 1;
    else if (isEntry) liveBuyBlocked += 1;
    // shadowOrderCreated(count) — entry 의도 + live 차단 시 shadow 로 흡수된 건수.
    if (isEntry && !r.liveOrderAllowed && r.shadowPermissionAllowed) shadowOrderCreated += 1;
    if (r.decision === 'HOLD') observeOnly += 1;
    if (r.decision === 'BLOCK') blocked += 1;
    if (r.providerIssueIsolated) providerIssueIsolated += 1;
    for (const reason of r.reasonCodes) {
      blockReasonDistribution[reason] = (blockReasonDistribution[reason] ?? 0) + 1;
    }
  }

  const topBlockReason = Object.entries(blockReasonDistribution)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';

  return {
    entryReadyCount: scoped('ALL_CANDIDATES', entryReady),
    liveBuyAllowedCount: scoped('LIVE_SAMPLE', liveBuyAllowed),
    liveBuyBlockedCount: scoped('LIVE_SAMPLE', liveBuyBlocked),
    shadowOrderCreated: scoped('PAPER_OBSERVATIONAL', shadowOrderCreated),
    observeOnlyCount: scoped('ALL_CANDIDATES', observeOnly),
    blockedCount: scoped('ALL_CANDIDATES', blocked),
    providerIssueIsolatedCount: scoped('ALL_CANDIDATES', providerIssueIsolated),
    blockReasonDistribution,
    topBlockReason,
  };
}
