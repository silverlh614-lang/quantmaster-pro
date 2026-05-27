// @responsibility ADR-0535 read-model builder/renderer projecting canonical regime/execution/scoring authorities into operator screens. Pure functions; no broker/order imports.

import type {
  FinalExecutionPolicyDisplayLabel,
  SourceSnapshotDecisionContext,
  SourceSnapshotDecisionContextInput,
  SourceSnapshotExecutionPolicyInput,
} from './sourceSnapshotDecisionContext.js';

/**
 * ADR-0535 — SourceSnapshotDecisionContext builder + shared renderer (READ-MODEL ONLY).
 *
 * 정본 계산을 절대 바꾸지 않는다. 빌더는 정본 객체(regimeResolver / engineRuntimePolicy /
 * gate0RegimeView / regimePositionPolicy)의 *투영(projection)* 만 수행한다(재계산 금지).
 * executionImpact 는 이 패치에서 항상 'NONE' 으로 표시 정규화된다.
 */

/**
 * resolver 2값 finalExecutionPolicy + engineMode/displayRegime 신호를 운영자 4값 DISPLAY 라벨로 매핑한다.
 * resolver 시그니처는 바꾸지 않으며, 이는 파생 표시 필드일 뿐이다(ADR-0535 §매핑 규칙).
 */
export function toFinalExecutionPolicyDisplayLabel(
  engineMode: string,
  displayRegime: string,
  finalExecutionPolicy2Value: string,
): FinalExecutionPolicyDisplayLabel {
  const mode = String(engineMode ?? '').trim().toUpperCase();
  const display = String(displayRegime ?? '').trim().toUpperCase();
  if (mode === 'SELL_ONLY' || display === 'SELL_ONLY') return 'SELL_ONLY';
  if (mode === 'OBSERVE_ONLY') return 'OBSERVE_ONLY';
  if (String(finalExecutionPolicy2Value ?? '').trim().toUpperCase() === 'LIVE_ORDER_ALLOWED') return 'LIVE_ALLOWED';
  return 'SHADOW_AND_DIAGNOSTIC_ONLY';
}

/**
 * EngineRuntimePolicy 의 4값 executionImpact / Gate0 의 표시 3값을 운영자 표시 3값으로 정규화한다.
 * 'LIVE_ORDER_ALLOWED' → 'NONE', 'LIVE_ORDER_BLOCKED' → 'LIVE_BLOCKED'. 이 패치 표시값은 NONE 이다.
 */
function normalizeExecutionImpact(value: string): 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_BLOCKED' {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'NEW_BUY_BLOCKED_ONLY') return 'NEW_BUY_BLOCKED_ONLY';
  if (v === 'LIVE_BLOCKED' || v === 'LIVE_ORDER_BLOCKED') return 'LIVE_BLOCKED';
  // 'NONE' | 'LIVE_ORDER_ALLOWED' | unknown → NONE (read-model executionImpact NONE invariant)
  return 'NONE';
}

function normalizeRiskOverride(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v || v.toUpperCase() === 'NONE') return null;
  return v;
}

/**
 * 정본 객체들에서 SourceSnapshotDecisionContext 를 투영한다(매크로 카드 측 입력 형상).
 * 어떤 권한/레짐/스코어도 재계산하지 않는다 — 정본 결과를 매핑만 한다.
 */
export function buildSourceSnapshotDecisionContext(
  input: SourceSnapshotDecisionContextInput,
): SourceSnapshotDecisionContext {
  const { regimeSnapshot, gate0View, executionPolicy, regimePositionPolicy } = input;

  const rawRegime = String(
    regimeSnapshot.detectedRegime ?? regimeSnapshot.diagnostics?.rawRegime ?? 'UNKNOWN',
  );
  const effectiveRegime = String(
    regimeSnapshot.effectiveRegime ?? gate0View.effectiveRegime ?? 'UNKNOWN',
  );
  const displayRegime = String(
    regimeSnapshot.displayRegime ?? gate0View.displayRegime ?? 'UNKNOWN',
  );
  const riskOverride = normalizeRiskOverride(regimeSnapshot.riskOverride);
  const policyView = riskOverride !== null ? riskOverride : displayRegime;

  return projectDecisionContext({
    snapshotId: regimeSnapshot.snapshotId,
    asOf: regimeSnapshot.asOf,
    ttlSec: regimeSnapshot.ttlSec,
    rawRegime,
    effectiveRegime,
    displayRegime,
    riskOverride,
    policyView,
    legacyEffectiveRegime: gate0View.legacy?.legacyEffective != null
      ? String(gate0View.legacy.legacyEffective)
      : undefined,
    executionPolicy,
    kellyMultiplier: input.kellyMultiplier,
    exposureCap: regimePositionPolicy.maxGrossExposurePct,
    maxPositions: regimePositionPolicy.maxPositions,
    positionCap: regimePositionPolicy.perPositionPct,
  });
}

/**
 * scan_blockers 측 thin 빌더 진입점 — regimeSnapshot/gate0View 가 없는 화면이
 * 동일 SourceSnapshotDecisionContext 형상을 생산하도록 primitives 를 받는다(화면 간 동일 snapshotId ⟹ 동일 권위).
 */
export interface ScanSummaryDecisionContextInput {
  snapshotId: string;
  asOf: string;
  ttlSec: number;
  rawRegime: string;
  effectiveRegime: string;
  displayRegime: string;
  riskOverride?: string | null;
  legacyEffectiveRegime?: string;
  executionPolicy: SourceSnapshotExecutionPolicyInput;
  kellyMultiplier?: number;
  exposureCap: number;
  maxPositions: number;
  positionCap: number;
}

export function buildDecisionContextFromScanSummaryView(
  input: ScanSummaryDecisionContextInput,
): SourceSnapshotDecisionContext {
  const riskOverride = normalizeRiskOverride(input.riskOverride);
  const displayRegime = String(input.displayRegime ?? 'UNKNOWN');
  const policyView = riskOverride !== null ? riskOverride : displayRegime;
  return projectDecisionContext({
    snapshotId: input.snapshotId,
    asOf: input.asOf,
    ttlSec: input.ttlSec,
    rawRegime: String(input.rawRegime ?? 'UNKNOWN'),
    effectiveRegime: String(input.effectiveRegime ?? 'UNKNOWN'),
    displayRegime,
    riskOverride,
    policyView,
    legacyEffectiveRegime: input.legacyEffectiveRegime,
    executionPolicy: input.executionPolicy,
    kellyMultiplier: input.kellyMultiplier,
    exposureCap: input.exposureCap,
    maxPositions: input.maxPositions,
    positionCap: input.positionCap,
  });
}

interface ProjectionPrimitives {
  snapshotId: string;
  asOf: string;
  ttlSec: number;
  rawRegime: string;
  effectiveRegime: string;
  displayRegime: string;
  riskOverride: string | null;
  policyView: string;
  legacyEffectiveRegime?: string;
  executionPolicy: SourceSnapshotExecutionPolicyInput;
  kellyMultiplier?: number;
  exposureCap: number;
  maxPositions: number;
  positionCap: number;
}

function projectDecisionContext(p: ProjectionPrimitives): SourceSnapshotDecisionContext {
  const ep = p.executionPolicy;
  const finalExecutionPolicy = toFinalExecutionPolicyDisplayLabel(
    ep.engineMode,
    p.displayRegime,
    ep.finalExecutionPolicy,
  );
  const marketRegime = {
    rawRegime: p.rawRegime,
    effectiveRegime: p.effectiveRegime,
    displayRegime: p.displayRegime,
    riskOverride: p.riskOverride,
    policyView: p.policyView,
    ...(p.legacyEffectiveRegime !== undefined
      ? { legacyEffectiveRegime: p.legacyEffectiveRegime, legacyDeprecated: true }
      : {}),
    legacyUsedForDecision: false as const,
    source: 'RegimeResolver.canonicalOutput' as const,
  };
  return {
    snapshotId: p.snapshotId,
    asOf: p.asOf,
    ttlSec: p.ttlSec,
    regimeConstitution: marketRegime,
    marketRegime,
    executionPolicy: {
      finalExecutionPolicy,
      liveEntryAllowed: ep.liveEntryAllowed,
      liveExitAllowed: ep.liveExitAllowed,
      brokerOrderAllowed: ep.brokerOrderAllowed,
      brokerLiveOrderAllowed: ep.brokerLiveOrderAllowed ?? ep.brokerOrderAllowed,
      brokerExitOrderAllowed: ep.brokerExitOrderAllowed ?? ep.liveExitAllowed,
      shadowBuyAllowed: ep.shadowBuyAllowed,
      shadowSellAllowed: ep.shadowSellAllowed,
      shadowLearningAllowed: ep.shadowLearningAllowed,
      counterfactualAllowed: ep.counterfactualAllowed,
      diagnosticAllowed: ep.diagnosticAllowed,
      ...(ep.liveBlockReason ? { liveBlockReason: ep.liveBlockReason } : {}),
      ...(ep.executionPermissionReason ? { executionPermissionReason: ep.executionPermissionReason } : {}),
      executionImpact: normalizeExecutionImpact(ep.executionImpact),
    },
    scoringPolicy: {
      scorePenalty: Number.isFinite(ep.scorePenalty as number) ? (ep.scorePenalty as number) : 0,
      sizingMultiplier: Number.isFinite(ep.sizingMultiplier as number) ? (ep.sizingMultiplier as number) : 1,
      kellyMultiplier: Number.isFinite(p.kellyMultiplier as number) ? (p.kellyMultiplier as number) : 1,
      exposureCap: p.exposureCap,
      maxPositions: p.maxPositions,
      positionCap: p.positionCap,
    },
    freshnessPolicy: {
      snapshotFreshnessForLive: ep.snapshotFreshnessForLive ?? 'UNKNOWN',
      snapshotFreshnessForShadow: ep.snapshotFreshnessForShadow ?? ep.snapshotFreshnessForLive ?? 'UNKNOWN',
      usableForLiveOrder: ep.usableForLiveOrder ?? ep.liveEntryAllowed,
      usableForBrokerOrder: ep.usableForBrokerOrder ?? ep.brokerOrderAllowed,
    },
  };
}

export interface DecisionContextAuthorityBlockOptions {
  comparisonSnapshotId?: string;
}

/**
 * 두 운영자 화면이 공유하는 권위 위계 렌더러(SSOT). 동일 snapshotId ⟹ 동일 라인 보장.
 * comparisonSnapshotId 가 ctx.snapshotId 와 다르면 DIFFERENT_SNAPSHOT 마커를 명시한다(불변식 #5/#6).
 */
export function formatDecisionContextAuthorityBlock(
  ctx: SourceSnapshotDecisionContext,
  opts: DecisionContextAuthorityBlockOptions = {},
): string[] {
  const mr = ctx.marketRegime;
  const ep = ctx.executionPolicy;
  const displayPolicy = mr.riskOverride != null
    ? `${mr.displayRegime} (riskOverride=${mr.riskOverride})`
    : mr.displayRegime;
  const liveBuyEmoji = ep.liveEntryAllowed ? '🟢' : '🔴';
  const liveBuyLabel = ep.liveEntryAllowed ? 'ALLOWED' : 'BLOCKED';
  const shadowLabel = ep.shadowLearningAllowed ? 'ON' : 'OFF';
  const shadowEmoji = ep.shadowLearningAllowed ? '🟢' : '🔴';

  const lines = [
    `🧭 Market Raw: ${mr.rawRegime}`,
    `🎚 Scoring Effective: ${mr.effectiveRegime}`,
    `🛡 Display/Policy: ${displayPolicy}`,
    `🚦 Execution: ${ep.finalExecutionPolicy}`,
    `${liveBuyEmoji} Live Buy: ${liveBuyLabel}`,
    `${shadowEmoji} Shadow/Learning: ${shadowLabel}`,
    `snapshotId=${ctx.snapshotId} asOf=${ctx.asOf} ttlSec=${ctx.ttlSec}`,
  ];

  if (mr.legacyEffectiveRegime !== undefined) {
    lines.push(`legacyEffectiveRegime=${mr.legacyEffectiveRegime} deprecated=true usedForDecision=false`);
  }

  if (opts.comparisonSnapshotId !== undefined && opts.comparisonSnapshotId !== ctx.snapshotId) {
    lines.push(`⚠️ DIFFERENT_SNAPSHOT: this=${ctx.snapshotId} other=${opts.comparisonSnapshotId}`);
  }

  return lines;
}

/**
 * 권위 위계 불변식(INV-1..INV-7) 진단 검증 — 컨텍스트 단독으로 검증 가능한 항목만 확인한다.
 * 위반 코드 목록을 반환한다(빈 배열 = OK). DIAGNOSTIC/log-only: 프로덕션에서 throw 하지 않는다.
 */
export function assertDecisionContextInvariants(ctx: SourceSnapshotDecisionContext): string[] {
  const violations: string[] = [];
  const mr = ctx.marketRegime;
  const ep = ctx.executionPolicy;

  // INV-2: non-LIVE display label ⟹ liveEntryAllowed === false.
  if (ep.finalExecutionPolicy !== 'LIVE_ALLOWED' && ep.liveEntryAllowed) {
    violations.push('INV-2');
  }

  // INV-3: displayRegime === 'SHADOW_ONLY' ⟹ brokerOrderAllowed === false.
  if (String(mr.displayRegime).toUpperCase() === 'SHADOW_ONLY' && ep.brokerOrderAllowed) {
    violations.push('INV-3');
  }

  // INV-4: legacyUsedForDecision must be literal false; legacy (if present) must be deprecated.
  if ((mr.legacyUsedForDecision as boolean) !== false) {
    violations.push('INV-4');
  }
  if (mr.legacyEffectiveRegime !== undefined && mr.legacyDeprecated !== true) {
    violations.push('INV-4');
  }

  // INV-7: regime slots must never carry an execution/display policy literal.
  const policyLikes = ['SHADOW_ONLY', 'SELL_ONLY', 'OBSERVE_ONLY'];
  if (policyLikes.includes(String(mr.rawRegime).toUpperCase())
    || policyLikes.includes(String(mr.effectiveRegime).toUpperCase())) {
    violations.push('INV-7');
  }
  // INV-7: policy slot must never carry an R-regime / scoring-regime literal.
  const policySlot = String(ep.finalExecutionPolicy).toUpperCase();
  if (policySlot.startsWith('R') || policySlot.includes('_EARLY') || policySlot.includes('_CAUTION')) {
    violations.push('INV-7');
  }

  return Array.from(new Set(violations));
}
