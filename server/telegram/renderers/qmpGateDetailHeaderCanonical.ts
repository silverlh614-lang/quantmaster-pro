// @responsibility Builds canonical QMP Gate Detail header view from persisted scan forensic slices only.

import type { ScanSummary } from '../../trading/signalScanner/scanDiagnostics/scanSummaryTypes.js';
import { resolveScanMarketSessionView } from '../../trading/signalScanner/state/scanEvaluationState.js';
import { buildCanonicalForensicIds } from '../../trading/signalScanner/runtimeResolverTraceStep26.js';
import {
  buildSnapshotBundleFromScanSummary,
  getByPath,
  nullableNumber,
  numberOf,
  recordOf,
  text,
  topKey,
} from './snapshotBundle.js';

type AnyRecord = Record<string, unknown>;

export type QmpHeaderExecutionImpact = 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'LIVE_ORDER_ALLOWED';

export interface QmpGateDetailHeaderView {
  canonical: {
    canonicalForensicId: string;
    scanId: string;
    sourceSnapshotId: string;
    candidateSetId: string;
    gateScoreInputSnapshotId: string;
    viewSource: 'CanonicalGateForensicSnapshot';
    recomputed: false;
    legacyPathUsed: false;
  };
  executionImpactLanes: {
    live: QmpHeaderExecutionImpact;
    paper: 'NONE';
    shadow: 'NONE';
    learning: 'NONE';
    counterfactual: 'NONE';
  };
  sourceSnapshotId: string;
  asOf: string;
  session: {
    marketSessionState: string;
    canonicalSession: string;
    displaySession: string;
  };
  policy: {
    engineMode: string;
    effectiveRegime: string;
    displayRegime: string;
    riskOverride: string;
    liveEntryAllowed: boolean;
    liveOrderAllowed: boolean;
    brokerLiveOrderAllowed: boolean;
    paperOrderAllowed: boolean;
    shadowAllowed: boolean;
    shadowLearningAllowed: boolean;
    counterfactualAllowed: boolean;
    executionImpact: QmpHeaderExecutionImpact;
  };
  gate1: {
    totalCandidates: number;
    gate1Passed: number | null;
    gate1HardSurvivors: number | null;
    minSignalLivePass: number | null;
    minSignalFailed: number | null;
    averageScore: number | null;
    requiredScore: number | null;
    topBlockReason: string | null;
  };
  gate2: {
    passStrong: number | null;
    passWeak: number | null;
    pendingPreserved: number | null;
    watchPreserved: number | null;
    fail: number | null;
    dataIncomplete: number | null;
    liveLeadership: boolean | null;
    shadowLeadership: boolean | null;
    topMissingAxis: string | null;
    topBlockReason: string | null;
  };
  gate3: {
    samples: number;
    readiness: string;
    executionReady: number;
    lastTriggerFired: number;
    lastTriggerWait: number;
    lastTriggerThresholdNotMet: number;
    lastTriggerDataUnavailable: number;
    entryPriceFresh: number;
    rrrPass: number;
    rrrWatch: number;
    rrrFail: number;
    rrrMissing: number;
    priceNotConfirmed: number;
    volumeWeak: number;
    topBlockReason: string | null;
  };
  entryLane: {
    liveCandidates: number;
    liveOrderCreated: number;
    liveBlockedByPolicy: number;
    shadowDiagnosticCreated: number;
    shadowOrderCreated: number;
    paperExecutableCreated: number;
    paperObservationalCreated: number;
    counterfactualCreated: number;
    watchOnlyPreserved: number;
  };
  topBlocks: string[];
  summaryLine: string;
  safetyLine: string;
  missingSlices: string[];
}

interface PermissionView {
  marketSessionState: string;
  canonicalSession: string;
  displaySession: string;
  engineMode: string;
  displayRegime: string;
  riskOverride: string;
  liveEntryAllowed: boolean;
  liveOrderAllowed: boolean;
  brokerLiveOrderAllowed: boolean;
  paperOrderAllowed: boolean;
  shadowAllowed: boolean;
  shadowLearningAllowed: boolean;
  counterfactualAllowed: boolean;
  executionImpact: QmpHeaderExecutionImpact;
  shadowOnly: boolean;
}

function hasOwn(record: AnyRecord | null, key: string): boolean {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function nullableCount(record: AnyRecord | null, key: string, missingSlices: string[], label: string): number | null {
  if (!hasOwn(record, key)) {
    missingSlices.push(`${label}.${key} missing`);
    return null;
  }
  return numberOf(record?.[key], 0);
}

function requiredCount(record: AnyRecord | null, key: string, missingSlices: string[], label: string): number {
  const value = nullableCount(record, key, missingSlices, label);
  return value ?? 0;
}

function firstReason(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = recordOf(value[0]);
  const reason = text(first?.reason, '');
  return reason.length > 0 ? reason : null;
}

function stringOrNull(value: unknown): string | null {
  const resolved = text(value, '');
  return resolved.length > 0 ? resolved : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeEngineMode(value: unknown): string {
  const raw = text(value, 'UNKNOWN').toUpperCase();
  return raw === 'SELL_ONLY' ? 'NORMAL' : raw;
}

function resolvePermission(summary: ScanSummary | null, missingSlices: string[], effectiveRegime: string): PermissionView {
  const macro = summary?.macroGateState;
  const sessionView = resolveScanMarketSessionView({
    explicitMarketSessionState: summary?.scanEvaluation?.marketSessionState,
    macroGateState: macro,
    asOf: summary?.scanEvaluation?.asOf,
    timeLabel: summary?.time,
  });
  const rawSession =
    macro?.displaySession ??
    macro?.canonicalSession ??
    summary?.scanEvaluation?.marketSessionState ??
    'UNKNOWN';
  if (
    (String(rawSession).toUpperCase() === 'UNKNOWN' || String(rawSession).toUpperCase() === 'BUY_ALLOWED') &&
    sessionView.displaySession === 'CLOSED_SHADOW_OBSERVE'
  ) {
    missingSlices.push(`WARN_SESSION_HEADER_MISMATCH: raw=${rawSession} resolved=CLOSED_SHADOW_OBSERVE`);
  }

  const displayRegime = text(macro?.displayRegime ?? macro?.regime ?? effectiveRegime, effectiveRegime).toUpperCase();
  const riskOverride = text(macro?.riskOverride, 'NONE').toUpperCase();
  const engineMode = normalizeEngineMode(macro?.engineMode ?? summary?.scanEvaluation?.engineMode ?? displayRegime);
  const shadowOnly = engineMode === 'SHADOW_ONLY' || displayRegime === 'SHADOW_ONLY' || riskOverride === 'SHADOW_ONLY';
  const liveSession = sessionView.canonicalSession === 'REGULAR_OPEN';
  const brokerRouteAlive = macro?.brokerRouteAlive ?? macro?.brokerOrderAllowed ?? true;
  const rawBrokerLiveOrderAllowed =
    macro?.brokerLiveOrderAllowed ??
    (brokerRouteAlive === true && liveSession && !shadowOnly && macro?.liveEntryAllowed === true);
  const liveOrderAllowed = rawBrokerLiveOrderAllowed === true && !shadowOnly && liveSession;
  const scanImpact = summary?.scanEvaluation?.executionImpact;
  const executionImpact: QmpHeaderExecutionImpact = liveOrderAllowed
    ? 'LIVE_ORDER_ALLOWED'
    : scanImpact === 'NEW_BUY_BLOCKED_ONLY'
      ? 'NEW_BUY_BLOCKED_ONLY'
      : 'NONE';

  return {
    marketSessionState: sessionView.marketSessionState,
    canonicalSession: sessionView.canonicalSession,
    displaySession: sessionView.displaySession,
    engineMode,
    displayRegime,
    riskOverride,
    liveEntryAllowed: liveOrderAllowed,
    liveOrderAllowed,
    brokerLiveOrderAllowed: liveOrderAllowed,
    paperOrderAllowed: macro?.paperOrderAllowed ?? true,
    shadowAllowed: macro?.shadowAllowed ?? macro?.shadowBuyAllowed ?? true,
    shadowLearningAllowed: macro?.shadowLearningAllowed ?? summary?.scanEvaluation?.shadowLearningAllowed ?? true,
    counterfactualAllowed: macro?.counterfactualAllowed ?? true,
    executionImpact,
    shadowOnly,
  };
}

function buildGate1(summary: ScanSummary | null, missingSlices: string[]): QmpGateDetailHeaderView['gate1'] {
  const forensic = recordOf(summary?.gate1MinimumSignalForensicAdr0505);
  const minSignal = recordOf(summary?.entryFilterDecomposition?.minSignalScoreDecompositionReport);
  const softLane = summary?.gate2SoftLeadershipLane;
  const totalCandidates = numberOf(summary?.candidates ?? forensic?.totalCandidates, 0);
  const minSignalFailed = hasOwn(minSignal, 'minSignalFailed')
    ? numberOf(minSignal?.minSignalFailed, 0)
    : null;
  const minSignalLivePass = softLane?.minSignalLivePass !== undefined
    ? softLane.minSignalLivePass
    : minSignalFailed !== null
      ? Math.max(0, numberOf(minSignal?.totalCandidates ?? totalCandidates, totalCandidates) - minSignalFailed)
      : null;
  const gate1Passed = numberOf(getByPath(summary, 'gateLayerAudit.gate1PassCount') ?? getByPath(summary, 'gatePassDistribution.gate1Pass'), Number.NaN);

  if (!summary?.gate2SoftLeadershipLane) missingSlices.push('gate1.gate2SoftLeadershipLane missing');
  if (!minSignal) missingSlices.push('gate1.minSignalScoreDecompositionReport missing');

  return {
    totalCandidates,
    gate1Passed: Number.isFinite(gate1Passed) ? gate1Passed : null,
    gate1HardSurvivors: softLane?.gate1HardSurvivors ?? null,
    minSignalLivePass,
    minSignalFailed,
    averageScore: nullableNumber(forensic?.actualScoreAvg),
    requiredScore: nullableNumber(forensic?.requiredScoreAvg),
    topBlockReason:
      firstReason(getByPath(summary, 'gateLayerAudit.topGate1BlockReasons')) ??
      topKey(forensic?.dominantFailureDistribution ?? forensic?.missingPositiveSourceCounts, 'none'),
  };
}

function buildGate2(summary: ScanSummary | null, missingSlices: string[]): QmpGateDetailHeaderView['gate2'] {
  const attribution = recordOf(summary?.freshGate2Attribution);
  const leadership = recordOf(attribution?.leadershipAttribution);
  const final = recordOf(leadership?.final);
  const shadowSector = recordOf(leadership?.shadowSector);
  const softLane = summary?.gate2SoftLeadershipLane;
  const gate2Pass = numberOf(attribution?.gate2Pass ?? getByPath(summary, 'gatePassDistribution.gate2Pass'), Number.NaN);
  const gate2TrueFailed = hasOwn(attribution, 'gate2TrueFailedCount') ? numberOf(attribution?.gate2TrueFailedCount, 0) : null;
  const gate2Unavailable = hasOwn(attribution, 'gate2UnavailableCount') ? numberOf(attribution?.gate2UnavailableCount, 0) : null;
  const secondaryMissingAxis =
    stringOrNull(getByPath(attribution, 'topUnavailableCondition.conditionKey')) ??
    stringOrNull(getByPath(attribution, 'leadershipAttribution.officialIndex.blocker')) ??
    stringOrNull(getByPath(attribution, 'leadershipAttribution.final.noLeadershipReason'));
  const topMissingAxes = [
    boolOrNull(final?.liveLeadership) === false ? 'SECTOR_LEADERSHIP' : null,
    secondaryMissingAxis,
  ].filter((value): value is string => Boolean(value));

  if (!attribution) missingSlices.push('gate2.freshGate2Attribution missing');

  return {
    passStrong: null,
    passWeak: Number.isFinite(gate2Pass) ? gate2Pass : null,
    pendingPreserved: softLane?.gate2PendingPreserved ?? null,
    watchPreserved: hasOwn(attribution, 'gate2WatchPreservedCount') ? numberOf(attribution?.gate2WatchPreservedCount, 0) : null,
    fail: gate2TrueFailed,
    dataIncomplete: gate2Unavailable,
    liveLeadership: boolOrNull(final?.liveLeadership),
    shadowLeadership: boolOrNull(shadowSector?.shadowLeadershipAllowed) ?? boolOrNull(final?.shadowLeadership),
    topMissingAxis: Array.from(new Set(topMissingAxes)).join(',') || null,
    topBlockReason:
      stringOrNull(getByPath(attribution, 'recommendedDiagnosis')) ??
      stringOrNull(getByPath(attribution, 'leadershipAttribution.final.noLeadershipReason')),
  };
}

function deriveGate3TopBlock(gate3: QmpGateDetailHeaderView['gate3'], entryPriceStaleBlocked: number): string | null {
  const hasActualMissingData =
    gate3.lastTriggerDataUnavailable > 0 ||
    gate3.rrrMissing > 0 ||
    entryPriceStaleBlocked > 0;
  if (hasActualMissingData) return 'GATE3_DATA_INCOMPLETE';
  if (gate3.lastTriggerWait > 0 && gate3.lastTriggerThresholdNotMet > 0) return 'PRE_BREAKOUT_WAIT';
  if (gate3.priceNotConfirmed > 0) return 'PRICE_NOT_CONFIRMED';
  if (gate3.volumeWeak > 0) return 'VOLUME_WEAK';
  return null;
}

function buildGate3(summary: ScanSummary | null, missingSlices: string[]): {
  gate3: QmpGateDetailHeaderView['gate3'];
  entryPriceStaleBlocked: number;
} {
  const raw = recordOf(getByPath(summary, 'gateLayerAudit.gate3Consolidated'));
  if (!raw) missingSlices.push('gate3.gateLayerAudit.gate3Consolidated missing');
  if (raw && !hasOwn(raw, 'setupReadyCount')) {
    missingSlices.push('gate3.setupReadyCount missing from persisted gate3Consolidated');
  }
  const priceFreshness = recordOf(raw?.priceFreshness);
  if (raw && !hasOwn(priceFreshness, 'VERIFIED')) {
    missingSlices.push('gate3.priceFreshness.VERIFIED missing from persisted gate3Consolidated');
  }

  const gate3: QmpGateDetailHeaderView['gate3'] = {
    samples: requiredCount(raw, 'samples', missingSlices, 'gate3'),
    readiness: topKey(raw?.timingReadiness, 'UNKNOWN'),
    executionReady: requiredCount(raw, 'executionReadyCount', missingSlices, 'gate3'),
    lastTriggerFired: requiredCount(raw, 'lastTriggerFiredCount', missingSlices, 'gate3'),
    lastTriggerWait: requiredCount(raw, 'lastTriggerWaitCount', missingSlices, 'gate3'),
    lastTriggerThresholdNotMet: requiredCount(raw, 'lastTriggerThresholdNotMetCount', missingSlices, 'gate3'),
    lastTriggerDataUnavailable: requiredCount(raw, 'lastTriggerDataUnavailableCount', missingSlices, 'gate3'),
    entryPriceFresh: numberOf(priceFreshness?.VERIFIED, 0),
    rrrPass: requiredCount(raw, 'rrrPassCount', missingSlices, 'gate3'),
    rrrWatch: requiredCount(raw, 'rrrWatchCount', missingSlices, 'gate3'),
    rrrFail: requiredCount(raw, 'rrrFailCount', missingSlices, 'gate3'),
    rrrMissing: requiredCount(raw, 'rrrMissingCount', missingSlices, 'gate3'),
    priceNotConfirmed: requiredCount(raw, 'priceNotConfirmedCount', missingSlices, 'gate3'),
    volumeWeak: requiredCount(raw, 'volumeWeakCount', missingSlices, 'gate3'),
    topBlockReason: null,
  };
  const entryPriceStaleBlocked = requiredCount(raw, 'entryPriceStaleCount', missingSlices, 'gate3');
  gate3.topBlockReason = deriveGate3TopBlock(gate3, entryPriceStaleBlocked);
  return { gate3, entryPriceStaleBlocked };
}

function buildEntryLane(
  summary: ScanSummary | null,
  permission: PermissionView,
): {
  entryLane: QmpGateDetailHeaderView['entryLane'];
  rawLiveOrderCreated: number;
  runtimePaperObservationalCreated: number;
} {
  const explicit = summary?.entryLaneSplit;
  const paperCounts = deriveRuntimePaperEntryCounts(summary);
  const liveCandidates = numberOf(explicit?.liveCandidates ?? summary?.liveEligibleCount, 0);
  const rawLiveOrderCreated = numberOf(explicit?.liveOrderCreated, 0);
  const liveOrderCreated = permission.shadowOnly ? 0 : rawLiveOrderCreated;
  const liveBlockedByPolicy = explicit?.liveBlockedByPolicy !== undefined
    ? numberOf(explicit.liveBlockedByPolicy, 0)
    : permission.liveOrderAllowed ? 0 : liveCandidates;
  const shadowDiagnosticCreated = numberOf(
    explicit?.shadowDiagnosticCreated ??
      (permission.shadowOnly
        ? Math.max(numberOf(summary?.entries, 0), numberOf(getByPath(summary, 'provisionalShadowLane.created'), 0))
        : getByPath(summary, 'provisionalShadowLane.created')),
    0,
  );

  return {
    rawLiveOrderCreated,
    runtimePaperObservationalCreated: paperCounts.observationalCreated,
    entryLane: {
      liveCandidates,
      liveOrderCreated,
      liveBlockedByPolicy,
      shadowDiagnosticCreated,
      shadowOrderCreated: numberOf(explicit?.shadowOrderCreated, 0),
      paperExecutableCreated: paperCounts.executableCreated || numberOf(explicit?.paperExecutableCreated, 0),
      paperObservationalCreated: paperCounts.observationalCreated || numberOf(explicit?.paperObservationalCreated, 0),
      counterfactualCreated: numberOf(
        explicit?.counterfactualCreated ??
          getByPath(summary, 'entryFilterDecomposition.ledgerRowsCreated') ??
          getByPath(summary, 'candidatePool.counterfactualRecorded'),
        0,
      ),
      watchOnlyPreserved: numberOf(explicit?.watchOnlyPreserved ?? summary?.gate2SoftLeadershipLane?.gate2PendingPreserved, 0),
    },
  };
}

function paperKindFromRecord(record: AnyRecord): string {
  const explicitKind = upper(record.paperEntryKind);
  if (explicitKind) return explicitKind;
  const executionAllowed = upper(record.executionPermission) === 'ALLOW';
  const scorePass = record.minSignalLivePass === true;
  const gate1Pass = record.gate1HardSurvivor === true;
  const gate2Pass = record.gate2PendingPreserved === false;
  const sizingPass = record.sizingAllowed === true;
  if (scorePass && gate1Pass && gate2Pass && executionAllowed && sizingPass) return 'EXECUTABLE_PAPER_ENTRY';
  if (gate1Pass && record.gate2PendingPreserved === true && !executionAllowed) return 'OBSERVATIONAL_PAPER_ENTRY';
  if (gate1Pass && record.gate2PendingPreserved === true) return 'PRE_BREAKOUT_WATCH_ENTRY';
  return 'COUNTERFACTUAL_ENTRY';
}

function paperRecordFromCandidate(candidate: AnyRecord): AnyRecord {
  return {
    ...candidate,
    decision: candidate.paperEntryDecision,
    executionPermission: candidate.executionPermission,
    paperEntryKind: candidate.paperEntryKind,
  };
}

function deriveRuntimePaperEntryCounts(summary: ScanSummary | null): {
  executableCreated: number;
  observationalCreated: number;
} {
  const forensic = summary?.paperEntryForensic;
  const rawRecords = Array.isArray(forensic?.decisionRecords) && forensic.decisionRecords.length > 0
    ? forensic.decisionRecords
    : Array.isArray(forensic?.candidates)
      ? forensic.candidates.map((candidate) => paperRecordFromCandidate(candidate as unknown as AnyRecord))
      : [];
  let executableCreated = 0;
  let observationalCreated = 0;
  for (const raw of rawRecords) {
    const record = recordOf(raw);
    if (!record || upper(record.decision) !== 'CREATED') continue;
    const kind = paperKindFromRecord(record);
    if (kind === 'EXECUTABLE_PAPER_ENTRY') executableCreated += 1;
    if (kind === 'OBSERVATIONAL_PAPER_ENTRY' || kind === 'PRE_BREAKOUT_WATCH_ENTRY') observationalCreated += 1;
  }
  return { executableCreated, observationalCreated };
}

function addBlock(blocks: string[], block: string | null | undefined): void {
  if (block && !blocks.includes(block)) blocks.push(block);
}

function buildTopBlocks(input: {
  permission: PermissionView;
  gate2: QmpGateDetailHeaderView['gate2'];
  gate3: QmpGateDetailHeaderView['gate3'];
  summary: ScanSummary | null;
}): string[] {
  const blocks: string[] = [];
  if (input.permission.shadowOnly) addBlock(blocks, 'SHADOW_ONLY_POLICY');
  if (!input.permission.brokerLiveOrderAllowed) addBlock(blocks, 'BROKER_LIVE_ORDER_BLOCKED');
  if (input.gate2.liveLeadership === false) addBlock(blocks, 'NO_LEADERSHIP');
  if (input.gate2.liveLeadership === null && input.gate2.topBlockReason) addBlock(blocks, 'GATE2_LEADERSHIP_NOT_CONFIRMED');
  if (input.gate3.topBlockReason !== 'GATE3_DATA_INCOMPLETE') addBlock(blocks, input.gate3.topBlockReason);
  if (numberOf(getByPath(input.summary, 'canonicalRuntimeResolution.sizing.hardBlockCount'), 0) > 0) {
    addBlock(blocks, 'RISK_SIZING_ZERO');
  }
  // ADR-0534: SectorEnergy 최종 판단은 canonical 단일 source 만 읽는다. legacy 두 경로는
  // canonical 부재(레거시 summary) 시에만 쓰이는 방어용 fallback 으로 강등.
  const canonicalPromotionAllowed = getByPath(
    input.summary,
    'sectorEnergySupplyUnknownAdr0488.sectorEnergyCanonicalState.promotionAllowed',
  );
  const promotionAllowed =
    canonicalPromotionAllowed ??
    getByPath(input.summary, 'freshGate2Attribution.leadershipAttribution.officialIndex.promotionAllowed') ??
    getByPath(input.summary, 'sectorEnergySupplyUnknownAdr0488.sectorEnergyMaster.promotionAllowed');
  if (promotionAllowed === false) addBlock(blocks, 'SECTOR_OFFICIAL_PROMOTION_DISABLED');
  if (input.gate3.topBlockReason === 'GATE3_DATA_INCOMPLETE') addBlock(blocks, 'GATE3_DATA_INCOMPLETE');
  return blocks.length > 0 ? blocks : ['NONE'];
}

function warnCanonicalMismatch(reason: string, missingSlices: string[]): void {
  const marker = `[QMP_GATE_HEADER_CANONICAL_MISMATCH] ${reason}`;
  missingSlices.push(marker);
  console.warn(marker);
}

function validateHeader(
  view: QmpGateDetailHeaderView,
  rawLiveOrderCreated: number,
  entryPriceStaleBlocked: number,
  missingSlices: string[],
  runtimePaperObservationalCreated: number,
  sectorShadowLeadershipAllowed: boolean | null,
): void {
  if (view.policy.engineMode === 'SHADOW_ONLY' && view.entryLane.liveOrderCreated !== 0) {
    warnCanonicalMismatch('SHADOW_ONLY header liveOrderCreated must be 0', missingSlices);
  }
  if (view.policy.engineMode === 'SHADOW_ONLY' && rawLiveOrderCreated > 0) {
    warnCanonicalMismatch(`raw liveOrderCreated=${rawLiveOrderCreated} clamped for SHADOW_ONLY display`, missingSlices);
  }
  if (
    view.topBlocks.includes('GATE3_DATA_INCOMPLETE') &&
    view.gate3.lastTriggerDataUnavailable === 0 &&
    view.gate3.rrrMissing === 0 &&
    entryPriceStaleBlocked === 0
  ) {
    warnCanonicalMismatch('GATE3_DATA_INCOMPLETE without actual missing Gate3 evidence', missingSlices);
  }
  if (
    runtimePaperObservationalCreated > 0 &&
    view.entryLane.paperObservationalCreated !== runtimePaperObservationalCreated
  ) {
    warnCanonicalMismatch(
      `paperObservational header=${view.entryLane.paperObservationalCreated} runtime=${runtimePaperObservationalCreated}`,
      missingSlices,
    );
  }
  if (
    sectorShadowLeadershipAllowed !== null &&
    view.gate2.shadowLeadership !== sectorShadowLeadershipAllowed
  ) {
    warnCanonicalMismatch(
      `gate2.shadowLeadershipAllowed header=${view.gate2.shadowLeadership} sector=${sectorShadowLeadershipAllowed}`,
      missingSlices,
    );
  }
}

function resolveSectorShadowLeadershipAllowed(summary: ScanSummary | null): boolean | null {
  return boolOrNull(getByPath(summary, 'freshGate2Attribution.leadershipAttribution.shadowSector.shadowLeadershipAllowed')) ??
    boolOrNull(getByPath(summary, 'freshGate2Attribution.sectorEnergy.shadowLeadershipAllowed')) ??
    boolOrNull(getByPath(summary, 'sectorEnergySupplyUnknownAdr0488.sectorEnergyMaster.shadowLeadershipAllowed'));
}

// ADR-0528: /gate_full 과 /scan_blockers full 이 동일 canonical 원장을 본다는 불변식을 검증한다.
// id 가 sourceSnapshotId 와 어긋나거나, 비-live lane 이 매수차단을 운반하면 CANONICAL_VIEW_DIVERGENCE.
function validateCanonicalViewConsistency(view: QmpGateDetailHeaderView): void {
  const c = view.canonical;
  const divergences: string[] = [];
  if (c.canonicalForensicId !== `forensic:${c.sourceSnapshotId}`) {
    divergences.push(`canonicalForensicId=${c.canonicalForensicId} expected=forensic:${c.sourceSnapshotId}`);
  }
  if (c.gateScoreInputSnapshotId !== `gateScoreInput:${c.sourceSnapshotId}`) {
    divergences.push(`gateScoreInputSnapshotId=${c.gateScoreInputSnapshotId} expected=gateScoreInput:${c.sourceSnapshotId}`);
  }
  if (!c.candidateSetId.startsWith(`candidateSet:${c.sourceSnapshotId}:`)) {
    divergences.push(`candidateSetId=${c.candidateSetId} not aligned with sourceSnapshotId=${c.sourceSnapshotId}`);
  }
  if (view.sourceSnapshotId !== c.sourceSnapshotId) {
    divergences.push(`headerSnapshot=${view.sourceSnapshotId} canonicalSnapshot=${c.sourceSnapshotId}`);
  }
  const lanes = view.executionImpactLanes;
  if (lanes.paper !== 'NONE' || lanes.shadow !== 'NONE' || lanes.learning !== 'NONE' || lanes.counterfactual !== 'NONE') {
    divergences.push('non-live executionImpact lane carried buy-block (invariant #8)');
  }
  for (const divergence of divergences) {
    const marker = `[CANONICAL_VIEW_DIVERGENCE] ${divergence}`;
    view.missingSlices.push(marker);
    console.warn(marker);
  }
}

export function buildQmpGateDetailHeaderView(summary: ScanSummary | null): QmpGateDetailHeaderView {
  const missingSlices: string[] = [];
  const base = buildSnapshotBundleFromScanSummary(summary);
  const forensicIds = buildCanonicalForensicIds(summary);
  const permission = resolvePermission(summary, missingSlices, base.effectiveRegime);
  const gate1 = buildGate1(summary, missingSlices);
  const gate2 = buildGate2(summary, missingSlices);
  const { gate3, entryPriceStaleBlocked } = buildGate3(summary, missingSlices);
  const { entryLane, rawLiveOrderCreated, runtimePaperObservationalCreated } = buildEntryLane(summary, permission);
  const topBlocks = buildTopBlocks({ permission, gate2, gate3, summary });

  const view: QmpGateDetailHeaderView = {
    canonical: {
      canonicalForensicId: forensicIds.canonicalForensicId,
      scanId: forensicIds.scanId,
      sourceSnapshotId: forensicIds.sourceSnapshotId,
      candidateSetId: forensicIds.candidateSetId,
      gateScoreInputSnapshotId: forensicIds.gateScoreInputSnapshotId,
      viewSource: 'CanonicalGateForensicSnapshot',
      recomputed: false,
      legacyPathUsed: false,
    },
    // 불변식 #8: 실거래 차단(live)과 Shadow/Paper/Learning/Counterfactual 차단은 분리.
    // 비-live lane 은 executionImpact 로 매수차단을 표현하지 않는다(권한 boolean 으로만 게이팅).
    executionImpactLanes: {
      live: permission.executionImpact,
      paper: 'NONE',
      shadow: 'NONE',
      learning: 'NONE',
      counterfactual: 'NONE',
    },
    sourceSnapshotId: base.sourceSnapshotId,
    asOf: base.asOf,
    session: {
      marketSessionState: permission.marketSessionState,
      canonicalSession: permission.canonicalSession,
      displaySession: permission.displaySession,
    },
    policy: {
      engineMode: permission.engineMode,
      effectiveRegime: base.effectiveRegime,
      displayRegime: permission.displayRegime,
      riskOverride: permission.riskOverride,
      liveEntryAllowed: permission.liveEntryAllowed,
      liveOrderAllowed: permission.liveOrderAllowed,
      brokerLiveOrderAllowed: permission.brokerLiveOrderAllowed,
      paperOrderAllowed: permission.paperOrderAllowed,
      shadowAllowed: permission.shadowAllowed,
      shadowLearningAllowed: permission.shadowLearningAllowed,
      counterfactualAllowed: permission.counterfactualAllowed,
      executionImpact: permission.executionImpact,
    },
    gate1,
    gate2,
    gate3,
    entryLane,
    topBlocks,
    summaryLine: `${permission.displaySession} / ${permission.engineMode} / ${base.effectiveRegime}`,
    safetyLine: entryLane.liveOrderCreated === 0
      ? '실거래 주문 0개 - Shadow/Watch/Learning only'
      : `실거래 주문 ${entryLane.liveOrderCreated}개 - live order path visible`,
    missingSlices,
  };
  validateHeader(
    view,
    rawLiveOrderCreated,
    entryPriceStaleBlocked,
    missingSlices,
    runtimePaperObservationalCreated,
    resolveSectorShadowLeadershipAllowed(summary),
  );
  validateCanonicalViewConsistency(view);
  return view;
}

function nullableText(value: number | string | null): string {
  return value === null ? 'null' : String(value);
}

function warnings(view: QmpGateDetailHeaderView): string[] {
  return view.missingSlices.filter((item) =>
    item.startsWith('WARN_') || item.startsWith('[QMP_GATE_HEADER_CANONICAL_MISMATCH]'),
  );
}

// ADR-0528: /gate_full 과 /scan_blockers full 이 공유하는 단일 canonical 헤더 블록.
// 두 명령은 본 블록을 동일 source(getLastScanSummary → CanonicalGateForensicSnapshot view)로 렌더한다.
export function renderCanonicalForensicHeaderBlock(view: QmpGateDetailHeaderView): string {
  const c = view.canonical;
  const lanes = view.executionImpactLanes;
  const divergences = view.missingSlices
    .filter((item) => item.startsWith('[CANONICAL_VIEW_DIVERGENCE]'))
    .map((item) => item.replace('[CANONICAL_VIEW_DIVERGENCE] ', ''));
  return [
    '[Canonical Forensic View]',
    `canonicalForensicId=${c.canonicalForensicId}`,
    `scanId=${c.scanId}`,
    `sourceSnapshotId=${c.sourceSnapshotId}`,
    `candidateSetId=${c.candidateSetId}`,
    `gateScoreInputSnapshotId=${c.gateScoreInputSnapshotId}`,
    `viewSource=${c.viewSource}`,
    `recomputed=${c.recomputed}`,
    `legacyPathUsed=${c.legacyPathUsed}`,
    `executionImpact: live=${lanes.live} paper=${lanes.paper} shadow=${lanes.shadow} learning=${lanes.learning} counterfactual=${lanes.counterfactual}`,
    ...(divergences.length > 0 ? [`CANONICAL_VIEW_DIVERGENCE: ${divergences.join(' | ')}`] : []),
  ].join('\n');
}

export function renderQmpGateDetailHeaderView(view: QmpGateDetailHeaderView): string {
  const headerWarnings = warnings(view);
  return [
    renderCanonicalForensicHeaderBlock(view),
    '',
    '[QMP Gate Detail]',
    `snapshot: ${view.sourceSnapshotId}`,
    `asOf: ${view.asOf}`,
    `session/mode/regime: ${view.session.displaySession} / ${view.policy.engineMode} / ${view.policy.effectiveRegime}`,
    `policy: liveOrderAllowed=${view.policy.liveOrderAllowed} brokerLiveOrderAllowed=${view.policy.brokerLiveOrderAllowed} shadowAllowed=${view.policy.shadowAllowed} counterfactualAllowed=${view.policy.counterfactualAllowed} executionImpact=${view.policy.executionImpact}`,
    `G1: hardSurvivors=${nullableText(view.gate1.gate1HardSurvivors)} minSignalPass=${nullableText(view.gate1.minSignalLivePass)} avgScore=${nullableText(view.gate1.averageScore)} required=${nullableText(view.gate1.requiredScore)} topBlock=${view.gate1.topBlockReason ?? 'null'}`,
    `G2: liveLeadership=${nullableText(view.gate2.liveLeadership === null ? null : String(view.gate2.liveLeadership))} shadowLeadershipAllowed=${nullableText(view.gate2.shadowLeadership === null ? null : String(view.gate2.shadowLeadership))} pending=${nullableText(view.gate2.pendingPreserved)} topMissing=${view.gate2.topMissingAxis ?? 'null'}`,
    `G3: ready=${view.gate3.executionReady} wait=${view.gate3.lastTriggerWait} dataUnavailable=${view.gate3.lastTriggerDataUnavailable} rrrMissing=${view.gate3.rrrMissing} rrr=${view.gate3.rrrPass}/${view.gate3.rrrWatch}/${view.gate3.rrrFail} priceNotConfirmed=${view.gate3.priceNotConfirmed} volumeWeak=${view.gate3.volumeWeak}`,
    `Entry: liveOrderCreated=${view.entryLane.liveOrderCreated} shadowDiagnostic=${view.entryLane.shadowDiagnosticCreated} paperObservational=${view.entryLane.paperObservationalCreated} counterfactual=${view.entryLane.counterfactualCreated} liveBlockedByPolicy=${view.entryLane.liveBlockedByPolicy}`,
    `TopBlocks: ${view.topBlocks.join(', ')}`,
    `Safety: ${view.safetyLine}`,
    ...(headerWarnings.length > 0 ? [`HeaderWarnings: ${headerWarnings.join(' | ')}`] : []),
    'Full forensic: /gate_full or /scan_blockers full',
  ].join('\n');
}
