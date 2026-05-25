// @responsibility ADR-0523 Telegram Gate/Execution/Learning snapshot bundle contracts and compact extraction helpers.

import type { QmpGateDetailHeaderView } from './qmpGateDetailHeaderCanonical.js';

export type TelegramVerbosity = 'COMPACT' | 'DETAIL' | 'FULL_FORENSIC' | 'DEBUG_RAW';
export type TelegramChannelKind = 'SIGNAL' | 'OPERATOR' | 'DEBUG' | 'DM';
export type Severity = 'INFO' | 'WATCH' | 'ACTION' | 'BLOCKED' | 'ERROR' | 'DEBUG';

export interface Gate1Summary {
  evaluated: number;
  total: number;
  pass: number;
  averageScore: number | null;
  requiredScore: number | null;
  scoreNormalized: number;
  technicalProjected: number;
  rsUsable: number;
  mainIssue: string;
  topBlockReason?: string;
  nextAction: string;
}

export interface Gate2Summary {
  evaluated: number;
  passStrong: number;
  passWeak: number;
  watch: number;
  fail: number;
  dataIncomplete: number;
  rsUsable: number;
  supplyUsable: number;
  sectorUsable: number;
  technicalUsable: number;
  fundamentalUsable: number;
  topPositiveAxis: string;
  topMissingAxis: string;
  nextAction: string;
}

export interface Gate3Summary {
  evaluated: number;
  ready: number;
  triggerWait: number;
  setupReady: number;
  dataIncomplete: number;
  timingFail: number;
  rrrComputed: number;
  rrrMissing: number;
  lastTriggerTriggered: number;
  lastTriggerWait: number;
  priceConfirmed: number;
  volumeWeak: number;
  falseBreakoutPass: number;
  falseBreakoutWatch: number;
  nextAction: string;
}

export interface ExecutionSummary {
  entryReady: number;
  liveBuyAllowed: number;
  liveBuyBlocked: number;
  shadowBuyAllowed: number;
  observeOnly: number;
  blocked: number;
  topBlockReason: string;
  providerIssueConvertedToMarketSignal: number;
  executionImpact: string;
  brokerOrderAllowed?: boolean;
  nextAction: string;
}

export interface LearningSummary {
  seedsCreated: number;
  pending: number;
  labeled: number;
  win: number;
  loss: number;
  missedWin: number;
  avoidedLoss: number;
  dataInsufficient: number;
  shadowWins: number;
  shadowLosses: number;
  blockedMissed: number;
  blockedAvoided: number;
  topPositive: string;
  topOverBlock: string;
  feedbackLine?: string;
  nextAction: string;
}

export interface ProviderHealthSummary {
  providerIssue: boolean;
  marketSignal: boolean;
  topProviderIssue?: string;
}

export interface SnapshotBundle {
  sourceSnapshotId: string;
  asOf: string;
  marketSession: string;
  engineMode: string;
  effectiveRegime: string;
  executionImpact: string;
  shadowLearning: boolean;
  gate1?: Gate1Summary;
  gate2?: Gate2Summary;
  gate3?: Gate3Summary;
  execution?: ExecutionSummary;
  learning?: LearningSummary;
  providerHealth?: ProviderHealthSummary;
  qmpGateDetailHeader?: QmpGateDetailHeaderView;
  fullForensicText?: string;
}

type AnyRecord = Record<string, unknown>;

export function recordOf(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

export function getByPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

export function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.map(recordOf).filter((item): item is AnyRecord => Boolean(item)) : [];
}

export function text(value: unknown, fallback = 'UNKNOWN'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function numberOf(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function boolOf(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
}

export function topKey(counts: unknown, fallback = 'none'): string {
  const record = recordOf(counts);
  if (!record) return fallback;
  const [top] = Object.entries(record)
    .map(([key, value]) => [key, numberOf(value, 0)] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return top ? top[0] : fallback;
}

export function topKeyWithCount(counts: unknown, fallback = 'none'): string {
  const record = recordOf(counts);
  if (!record) return fallback;
  const [top] = Object.entries(record)
    .map(([key, value]) => [key, numberOf(value, 0)] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return top ? `${top[0]}:${top[1]}` : fallback;
}

export function lineCount(message: string): number {
  return message.split('\n').filter(line => line.trim().length > 0).length;
}

export function formatKst(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return `${value} KST`;
  return `${date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false })} KST`;
}

function resolveSourceSnapshotId(summary: AnyRecord | null): string {
  return text(
    summary?.sourceSnapshotId
      ?? summary?.snapshotId
      ?? getByPath(summary, 'scanEvaluation.scanId')
      ?? getByPath(summary, 'candidatePool.sourceSnapshotId')
      ?? getByPath(summary, 'entryFilterDecomposition.sourceSnapshotId')
      ?? getByPath(summary, 'gateLayerAudit.sourceSnapshotId')
      ?? getByPath(summary, 'macroGateState.regimeSnapshotId'),
    'SNAPSHOT_MISSING',
  );
}

export function buildSnapshotBundleFromScanSummary(summaryRaw: unknown, overrides: Partial<SnapshotBundle> = {}): SnapshotBundle {
  const summary = recordOf(summaryRaw);
  const forensic = recordOf(summary?.gate1MinimumSignalForensicAdr0505);
  const gateLayer = recordOf(summary?.gateLayerAudit);
  const gate3 = recordOf(getByPath(summary, 'gateLayerAudit.gate3Consolidated'));
  const macro = recordOf(summary?.macroGateState);
  const candidates = numberOf(summary?.candidates ?? forensic?.totalCandidates, 0);
  const evaluatedGate1 = numberOf(forensic?.evaluatedCandidateCount ?? candidates, candidates);
  const asOf = text(summary?.asOf ?? summary?.time ?? macro?.regimeSnapshotAsOf, new Date(0).toISOString());
  const engineMode = text(summary?.engineMode ?? macro?.engineMode ?? macro?.displayRegime, 'UNKNOWN').toUpperCase();
  const marketSession = text(summary?.marketSession ?? macro?.canonicalSession ?? macro?.displaySession, 'UNKNOWN').toUpperCase();
  // 정본 effectiveRegime 은 scanEvaluation(buildCanonicalRegimeDiagnostics) 이 SSOT 다.
  // macroRegimeEffective 는 legacyRegimeNotUsedForDecision(폐기된 R6 transition machine) 이므로
  // 정본/회귀(regime)보다 뒤로 강등한다 — 상단 JSON 이 R6_DEFENSE 로 오표기되는 것을 막는다.
  const effectiveRegime = text(
    summary?.effectiveRegime
      ?? getByPath(summary, 'scanEvaluation.effectiveRegime')
      ?? macro?.regime
      ?? macro?.macroRegimeEffective
      ?? macro?.riskOverride
      ?? macro?.displayRegime,
    'UNKNOWN',
  ).toUpperCase();
  const gate1: Gate1Summary | undefined = candidates > 0 || forensic ? {
    evaluated: evaluatedGate1,
    total: candidates,
    pass: numberOf(getByPath(summary, 'gateLayerAudit.gate1PassCount') ?? getByPath(summary, 'gatePassDistribution.gate1Pass'), 0),
    averageScore: nullableNumber(forensic?.actualScoreAvg),
    requiredScore: nullableNumber(forensic?.requiredScoreAvg),
    scoreNormalized: numberOf(forensic?.watchlistScoreNormalizedCount ?? forensic?.watchlistScoreNormalized, 0),
    technicalProjected: numberOf(forensic?.technicalProjectedCount, 0),
    rsUsable: numberOf(forensic?.rsScoreUsableCount, 0),
    mainIssue: topKey(forensic?.dominantFailureDistribution ?? forensic?.missingPositiveSourceCounts ?? getByPath(gateLayer, 'topGate1BlockReasons'), 'none'),
    topBlockReason: text(getByPath(gateLayer, 'topGate1BlockReasons.0.reason'), 'none'),
    nextAction: 'Gate2 confluence review',
  } : undefined;
  // ADR-0526 Phase 1b: gate2 표시 정본 = 스캔-시점 View(candidateGateAggregate). aggregate 부재 시 undefined(기존과 동일 graceful).
  const candidateGateAggregate = summary?.candidateGateAggregate;
  const gate2 = candidateGateAggregate ? gate2SummaryFromAggregate(candidateGateAggregate) : undefined;
  const bundle: SnapshotBundle = {
    sourceSnapshotId: resolveSourceSnapshotId(summary),
    asOf,
    marketSession,
    engineMode,
    effectiveRegime,
    executionImpact: text(overrides.executionImpact ?? getByPath(gate3, 'executionImpact') ?? 'NONE', 'NONE'),
    shadowLearning: boolOf(overrides.shadowLearning ?? true, true),
    gate1,
    gate2,
    gate3: gate3 ? {
      evaluated: numberOf(gate3.samples, 0),
      ready: numberOf(gate3.executionReadyCount ?? gate3.lastTriggerFiredCount, 0),
      triggerWait: numberOf(gate3.lastTriggerWaitCount, 0),
      setupReady: numberOf(gate3.setupReadyCount, 0),
      dataIncomplete: numberOf(getByPath(gate3, 'timingReadiness.DATA_INCOMPLETE') ?? gate3.lastTriggerDataUnavailableCount, 0),
      timingFail: numberOf(gate3.lastTriggerThresholdNotMetCount, 0),
      rrrComputed: numberOf(gate3.rrrPassCount, 0) + numberOf(gate3.rrrWatchCount, 0) + numberOf(gate3.rrrFailCount, 0),
      rrrMissing: numberOf(gate3.rrrMissingCount, 0),
      lastTriggerTriggered: numberOf(gate3.lastTriggerFiredCount, 0),
      lastTriggerWait: numberOf(gate3.lastTriggerWaitCount, 0),
      priceConfirmed: numberOf(gate3.priceBreakoutConfirmedCount, 0) + numberOf(gate3.priceNearBreakoutCount, 0) + numberOf(gate3.pricePullbackEntryCount, 0),
      volumeWeak: numberOf(gate3.volumeWeakCount, 0),
      falseBreakoutPass: numberOf(gate3.falseBreakoutPassCount ?? getByPath(gate3, 'falseBreakoutRisk.LOW'), 0),
      falseBreakoutWatch: numberOf(getByPath(gate3, 'falseBreakoutRisk.WATCH') ?? gate3.falseBreakoutHighCount, 0),
      nextAction: 'wait trigger / observe 3D',
    } : undefined,
    providerHealth: {
      providerIssue: boolOf(summary?.providerIssue, false),
      marketSignal: boolOf(summary?.marketSignal, false),
      topProviderIssue: topKey(getByPath(summary, 'providerIssueDistribution')),
    },
    ...overrides,
  };
  return bundle;
}

export function compactNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * ADR-0526 §Decision.5 — gate2 PASS/FAIL status 정본은 CandidateGateEvaluationAggregate(스캔-시점 View)다.
 * formatter 는 본 함수로 View aggregate 에서 status count + 표시용 coverage 를 읽는다(buildGate2ConfluenceSummary 재실행 금지).
 * ScopedCount(.value) 와 gate2Coverage(표시용 보조)를 carry. aggregate 부재 시 빈 요약(graceful).
 */
export function gate2SummaryFromAggregate(raw: unknown): Gate2Summary {
  const aggregate = recordOf(raw);
  const coverage = recordOf(aggregate?.gate2Coverage);
  const countOf = (field: string): number => numberOf(getByPath(aggregate, `${field}.value`), 0);
  const passStrong = countOf('gate2PassStrongCount');
  const passWeak = countOf('gate2PassWeakCount');
  const evaluated = numberOf(getByPath(aggregate, 'evaluatedCount.value'), 0);
  return {
    evaluated,
    passStrong,
    passWeak,
    watch: countOf('gate2WatchCount'),
    fail: countOf('gate2FailCount'),
    dataIncomplete: countOf('gate2DataIncompleteCount'),
    rsUsable: numberOf(coverage?.rsUsable, 0),
    supplyUsable: numberOf(coverage?.supplyUsable, 0),
    sectorUsable: numberOf(coverage?.sectorUsable, 0),
    technicalUsable: numberOf(coverage?.technicalUsable, 0),
    fundamentalUsable: numberOf(coverage?.fundamentalUsable, 0),
    topPositiveAxis: text(coverage?.topPositiveAxis, 'none'),
    topMissingAxis: text(coverage?.topMissingAxis, 'none'),
    nextAction: `Gate3 timing for ${passStrong + passWeak} candidates`,
  };
}

export function gate2SummaryFromConfluence(raw: unknown): Gate2Summary {
  const summary = recordOf(raw);
  const evaluated = numberOf(summary?.evaluated, 0);
  return {
    evaluated,
    passStrong: numberOf(summary?.gate2PassStrong, 0),
    passWeak: numberOf(summary?.gate2PassWeak, 0),
    watch: numberOf(summary?.gate2Watch, 0),
    fail: numberOf(summary?.gate2Fail, 0),
    dataIncomplete: numberOf(summary?.dataIncomplete, 0),
    rsUsable: numberOf(summary?.rsUsable, 0),
    supplyUsable: numberOf(summary?.supplyUsable, 0),
    sectorUsable: numberOf(summary?.sectorUsable, 0),
    technicalUsable: numberOf(summary?.technicalUsable, 0),
    fundamentalUsable: numberOf(summary?.fundamentalUsable, 0),
    topPositiveAxis: text(summary?.topPositiveAxis, 'none'),
    topMissingAxis: text(summary?.topMissingAxis, 'none'),
    nextAction: `Gate3 timing for ${numberOf(summary?.gate2PassStrong, 0) + numberOf(summary?.gate2PassWeak, 0)} candidates`,
  };
}

export function gate3SummaryFromRuntimeClosure(raw: unknown): Gate3Summary {
  const summary = recordOf(raw);
  const evaluated = numberOf(summary?.evaluated, 0);
  return {
    evaluated,
    ready: numberOf(summary?.gate3Ready, 0) + numberOf(summary?.shadowReady, 0),
    triggerWait: numberOf(summary?.triggerWait, 0),
    setupReady: numberOf(summary?.setupReady, 0),
    dataIncomplete: numberOf(summary?.dataIncomplete, 0),
    timingFail: numberOf(summary?.timingFail, 0),
    rrrComputed: numberOf(summary?.rrrComputed, 0),
    rrrMissing: numberOf(summary?.rrrMissing, 0),
    lastTriggerTriggered: numberOf(summary?.lastTriggerTriggered, 0),
    lastTriggerWait: numberOf(summary?.lastTriggerWait, 0),
    priceConfirmed: numberOf(summary?.priceConfirmed, 0),
    volumeWeak: numberOf(getByPath(summary, 'volumeConfirmationBreakPointDistribution.VOLUME_WEAK'), 0),
    falseBreakoutPass: numberOf(summary?.falseBreakoutPass, 0),
    falseBreakoutWatch: numberOf(getByPath(summary, 'falseBreakoutReasonDistribution.FALSE_BREAKOUT_WATCH'), 0),
    nextAction: 'wait trigger / observe 3D',
  };
}

export function executionSummaryFromAudit(raw: unknown): ExecutionSummary {
  const summary = recordOf(raw);
  return {
    entryReady: numberOf(summary?.entryReady, 0),
    liveBuyAllowed: numberOf(summary?.liveBuyAllowed, 0),
    liveBuyBlocked: numberOf(summary?.liveBuyBlocked, 0),
    shadowBuyAllowed: numberOf(summary?.shadowBuyAllowed, 0),
    observeOnly: numberOf(summary?.observeOnly, 0),
    blocked: numberOf(summary?.blocked, 0),
    topBlockReason: topKey(getByPath(summary, 'blockReasonDistribution'), 'none'),
    providerIssueConvertedToMarketSignal: numberOf(summary?.providerIssueConvertedToMarketSignalCount, 0),
    executionImpact: topKey(getByPath(summary, 'executionImpactDistribution'), 'NONE'),
    brokerOrderAllowed: numberOf(summary?.liveBuyAllowed, 0) > 0,
    nextAction: numberOf(summary?.liveBuyAllowed, 0) > 0 ? 'operator approval / execution policy review' : 'observe / shadow learning',
  };
}

/**
 * ADR-0527 Phase 2b — execution 표시 정본 read.
 * UnifiedExecutionPermissionAggregate(스캔-시점 persist, 실제 asOf 도출 — 더미 1970 재계산 0)를
 * ExecutionSummary(표시 형태)로 매핑한다. formatter 는 resolveFinalExecutionDecision 를 재실행하지 않는다.
 *
 * 명명 규율(ADR-0527 §Decision.2): aggregate 의 *Count/*Created(건수)를 read 한다 —
 * permission(boolean: shadowPermissionAllowed 등)은 per-candidate resolution 의 것이며 집계 표시에 쓰지 않는다.
 * 표시 필드 shadowBuyAllowed 는 aggregate.shadowOrderCreated(실제 shadow 흡수 건수)를 carry 한다(이름 충돌 방지: count 의미).
 * providerIssueConvertedToMarketSignal 은 불변식 #6 에 따라 항상 0(providerIssue 는 격리되어 market signal 로 변환되지 않음).
 * aggregate 부재 시 빈 요약(graceful — 기존 audit-absent 동작과 동일).
 */
export function executionSummaryFromUnifiedAggregate(raw: unknown): ExecutionSummary {
  const aggregate = recordOf(raw);
  const countOf = (field: string): number => numberOf(getByPath(aggregate, `${field}.value`), 0);
  const liveBuyAllowed = countOf('liveBuyAllowedCount');
  const liveBuyBlocked = countOf('liveBuyBlockedCount');
  const executionImpact = liveBuyAllowed > 0
    ? 'LIVE_ORDER_ALLOWED'
    : liveBuyBlocked > 0
      ? 'NEW_BUY_BLOCKED_ONLY'
      : 'NONE';
  return {
    entryReady: countOf('entryReadyCount'),
    liveBuyAllowed,
    liveBuyBlocked,
    // shadowBuyAllowed(표시) = aggregate.shadowOrderCreated(count) — per-candidate boolean 권한과 의미 분리.
    shadowBuyAllowed: countOf('shadowOrderCreated'),
    observeOnly: countOf('observeOnlyCount'),
    blocked: countOf('blockedCount'),
    topBlockReason: text(aggregate?.topBlockReason, 'none'),
    // 불변식 #6: providerIssue 는 격리(providerIssueIsolatedCount) — market signal 로 변환되지 않으므로 항상 0.
    providerIssueConvertedToMarketSignal: 0,
    executionImpact,
    brokerOrderAllowed: liveBuyAllowed > 0,
    nextAction: liveBuyAllowed > 0 ? 'operator approval / execution policy review' : 'observe / shadow learning',
  };
}
