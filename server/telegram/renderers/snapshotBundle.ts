// @responsibility ADR-0523 Telegram Gate/Execution/Learning snapshot bundle contracts and compact extraction helpers.

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
  const bundle: SnapshotBundle = {
    sourceSnapshotId: resolveSourceSnapshotId(summary),
    asOf,
    marketSession,
    engineMode,
    effectiveRegime,
    executionImpact: text(overrides.executionImpact ?? getByPath(gate3, 'executionImpact') ?? 'NONE', 'NONE'),
    shadowLearning: boolOf(overrides.shadowLearning ?? true, true),
    gate1,
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
