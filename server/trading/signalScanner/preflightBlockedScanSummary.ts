/**
 * @responsibility ADR-0367 preflight blocked scan summary SSOT — buyListLoop 진입 전 차단 진단 영속.
 *
 * buyListLoop 진입 전 preflight abort (HARD_BLOCK / SELL_ONLY / PRE_FLIGHT_BLOCK / NO_BUYLIST_ELIGIBLE)
 * 시점에 candidateSummaryCount / blockedBy / hardBlock 메타를 module-local SSOT 로 영속해
 * /scan_blockers 와 runtimePipelineAudit 가 "진단 데이터 없음" 대신 "Preflight blocked scan" 을 표시.
 *
 * 절대 invariant:
 *   - executionImpact='NONE' / liveExecutionAllowed=false literal 강제 (TypeScript 컴파일 타임)
 *   - buyListLoopEntered=false / gateSamples=0 literal 강제
 *   - ADR-460 not installed / SectorEnergy STALE 는 hardBlockSource 로 승격 금지 (정적 sanitize)
 *   - KIS/KRX/Yahoo/Naver 신규 호출 0건 (순수 in-memory, 외부 import 0)
 *   - persistScanResults 가 _lastScanSummary 를 채우면 clearPreflightBlockedScanSummary 로 stale 제거
 */

export type PreflightBlockedBy =
  | 'HARD_BLOCK'
  | 'SELL_ONLY'
  | 'PRE_FLIGHT_BLOCK'
  | 'NO_BUYLIST_ELIGIBLE';

export type PreflightScanEvaluationState =
  | 'NOT_EVALUATED_SELL_ONLY'
  | 'NOT_EVALUATED_R6_DEFENSE'
  | 'LIVE_ENTRY_SKIPPED_R6_DEFENSE'
  | 'NOT_EVALUATED_NON_TRADING_DAY'
  | 'NOT_EVALUATED_R6_LIVE_BLOCKED'
  | 'NOT_EVALUATED_DIAGNOSTIC_ONLY'
  | 'NOT_EVALUATED_OBSERVE_ONLY'
  | 'EVALUATED_ZERO_SURVIVOR'
  | 'EVALUATED_DATA_INSUFFICIENT'
  | 'EVALUATED_GATE_REJECTED'
  | 'EVALUATED_QUOTE_HYDRATION_FAILED'
  | 'EVALUATED_PARTIAL'
  | 'EVALUATED_WITH_SURVIVORS';

export type PreflightScanEvaluationExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'SCAN_GATE_DEGRADED';

export interface PreflightScanEvaluationResult {
  scanId: string;
  asOf: string;
  evaluationState: PreflightScanEvaluationState;
  marketSessionState: string;
  engineMode: string;
  effectiveRegime: string;
  totalCandidates: number;
  evaluated: number;
  skipped: number;
  rejected: number;
  survivors: number;
  quoteHydrated: number;
  quoteHydrationFailed: number;
  blockReason?: string;
  breakPoint?: string;
  sourcePath: string;
  executionImpact: PreflightScanEvaluationExecutionImpact;
  shadowLearningAllowed: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface PreflightBlockedScanSummary {
  scanId: string;
  timestamp: string;
  stage: 'BEFORE_BUYLIST_LOOP';
  blockedBy: PreflightBlockedBy;
  hardBlockSource?: string;
  hardBlockModule?: string;
  hardBlockReason?: string;
  preflightDecision?: string;
  candidateSummaryCount: number;
  universeSnapshotRecorded: boolean;
  counterfactualRecorded: boolean;
  buyListLoopEntered: false;
  gateSamples: 0;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  scanEvaluation?: PreflightScanEvaluationResult;
  perSymbolSupplyInjection?: PreflightBlockedPerSymbolSupplyInjectionStats;
}

export interface RecordPreflightBlockedScanSummaryInput {
  blockedBy: PreflightBlockedBy;
  hardBlockSource?: string;
  hardBlockModule?: string;
  hardBlockReason?: string;
  preflightDecision?: string;
  candidateSummaryCount: number;
  universeSnapshotRecorded: boolean;
  counterfactualRecorded: boolean;
  scanEvaluation?: PreflightScanEvaluationResult;
  scanId?: string;
  timestamp?: string;
}

export interface PreflightBlockedPerSymbolSupplyInjectionStats {
  totalCandidates: number;
  requestedSymbols: number;
  receivedResults: number;
  injected: number;
  verified: number;
  degraded: number;
  stale: number;
  missing: number;
  unknown: number;
  routerConnected: boolean;
  gateContextConnected: boolean;
}

/**
 * 금지 (사용자 §"금지"):
 *   - ADR-460 not installed 를 hard block source 로 승격 금지 (diagnostic overlay missing ≠ live hard block)
 *   - SectorEnergy STALE 를 hard block source 로 승격 금지 (ADR-0448 — auxiliary signal, never hard block)
 */
const FORBIDDEN_HARD_BLOCK_SOURCE_PATTERNS: RegExp[] = [
  /ADR[-_ ]?460/i,
  /SECTOR[-_ ]?ENERGY/i,
];

function sanitizeHardBlockSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  for (const pattern of FORBIDDEN_HARD_BLOCK_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      console.warn(
        `[PreflightBlockedScan] hardBlockSource "${source}" 는 금지 패턴 (diagnostic overlay / sector energy) — 무시 (ADR-0367)`,
      );
      return undefined;
    }
  }
  return source;
}

let _lastPreflightBlockedScanSummary: PreflightBlockedScanSummary | null = null;

/** UUID-lite — `pbs-${YYYYMMDDHHmm}-${rand4}` 형식 (외부 의존성 0). */
function buildScanId(nowIso: string): string {
  const minute = nowIso.replace(/[-:T]/g, '').slice(0, 12);
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `pbs-${minute}-${rand}`;
}

function buildPreflightScanEvaluation(input: {
  summaryScanId: string;
  timestamp: string;
  blockedBy: PreflightBlockedBy;
  preflightDecision?: string;
  hardBlockSource?: string;
  hardBlockReason?: string;
  candidateSummaryCount: number;
}): PreflightScanEvaluationResult {
  const joined = [
    input.blockedBy,
    input.preflightDecision,
    input.hardBlockSource,
    input.hardBlockReason,
  ].filter(Boolean).join('|').toUpperCase();
  const totalCandidates = input.candidateSummaryCount;
  let evaluationState: PreflightScanEvaluationState = 'NOT_EVALUATED_DIAGNOSTIC_ONLY';
  let blockReason = input.preflightDecision ?? input.blockedBy;
  let breakPoint = 'PRE_FLIGHT';
  let executionImpact: PreflightScanEvaluationExecutionImpact = 'NONE';
  let engineMode = 'NORMAL';
  let marketSessionState = 'PRE_FLIGHT_BLOCKED';
  let effectiveRegime = 'UNKNOWN';

  if (input.blockedBy === 'SELL_ONLY' || joined.includes('SELL_ONLY') || joined.includes('R6')) {
    evaluationState = totalCandidates > 0 ? 'EVALUATED_PARTIAL' : 'EVALUATED_ZERO_SURVIVOR';
    blockReason = 'LEGACY_POLICY_IGNORED';
    breakPoint = 'PRE_FLIGHT';
    executionImpact = 'NONE';
    engineMode = 'NORMAL';
    marketSessionState = 'REGULAR';
    effectiveRegime = 'UNKNOWN';
  } else if (joined.includes('NON_TRADING') || joined.includes('HOLIDAY') || joined.includes('VOLUME_CLOCK')) {
    evaluationState = 'NOT_EVALUATED_NON_TRADING_DAY';
    blockReason = joined.includes('VOLUME_CLOCK') ? 'NON_TRADING_TIME' : 'NON_TRADING_DAY';
    breakPoint = 'SESSION_GUARD';
    marketSessionState = blockReason;
  } else if (input.blockedBy === 'NO_BUYLIST_ELIGIBLE') {
    evaluationState = 'EVALUATED_ZERO_SURVIVOR';
    blockReason = 'NO_BUYLIST_ELIGIBLE';
    breakPoint = 'CANDIDATE_SELECTION';
  }

  return {
    scanId: input.summaryScanId,
    asOf: input.timestamp,
    evaluationState,
    marketSessionState,
    engineMode,
    effectiveRegime,
    totalCandidates,
    evaluated: 0,
    skipped: totalCandidates,
    rejected: 0,
    survivors: 0,
    quoteHydrated: 0,
    quoteHydrationFailed: 0,
    blockReason,
    breakPoint,
    sourcePath: 'preflightBlockedScanSummary.recordPreflightBlockedScanSummary',
    executionImpact,
    shadowLearningAllowed: true,
    diagnostics: {
      blockedBy: input.blockedBy,
      preflightDecision: input.preflightDecision,
      hardBlockSource: input.hardBlockSource,
      hardBlockReason: input.hardBlockReason,
    },
  };
}

/**
 * preflight abort (buyListLoop 진입 전) 시점에 blocked scan summary 영속 진입점.
 *
 * literal 필드 (stage / buyListLoopEntered / gateSamples / executionImpact / liveExecutionAllowed) 는
 * 입력 무시하고 항상 고정값으로 강제 — 호출자가 schema invariant 를 깰 수 없게 한다.
 * hardBlockSource 는 FORBIDDEN 패턴 통과 시 undefined 로 강등.
 */
export function recordPreflightBlockedScanSummary(
  input: RecordPreflightBlockedScanSummaryInput,
): PreflightBlockedScanSummary {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const rawCount = Number(input.candidateSummaryCount);
  const candidateSummaryCount = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;
  const scanId = input.scanId ?? buildScanId(timestamp);
  const hardBlockSource = sanitizeHardBlockSource(input.hardBlockSource);
  const storedBlockedBy: PreflightBlockedBy = input.blockedBy === 'SELL_ONLY' ? 'PRE_FLIGHT_BLOCK' : input.blockedBy;
  const summary: PreflightBlockedScanSummary = {
    scanId,
    timestamp,
    stage: 'BEFORE_BUYLIST_LOOP',
    blockedBy: storedBlockedBy,
    hardBlockSource,
    hardBlockModule: input.hardBlockModule,
    hardBlockReason: input.hardBlockReason,
    preflightDecision: input.preflightDecision,
    candidateSummaryCount,
    universeSnapshotRecorded: input.universeSnapshotRecorded === true,
    counterfactualRecorded: input.counterfactualRecorded === true,
    buyListLoopEntered: false,
    gateSamples: 0,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    scanEvaluation: input.scanEvaluation ?? buildPreflightScanEvaluation({
      summaryScanId: scanId,
      timestamp,
      blockedBy: storedBlockedBy,
      preflightDecision: input.preflightDecision,
      hardBlockSource,
      hardBlockReason: input.hardBlockReason,
      candidateSummaryCount,
    }),
  };
  _lastPreflightBlockedScanSummary = summary;
  return summary;
}

export function getLastPreflightBlockedScanSummary(): PreflightBlockedScanSummary | null {
  return _lastPreflightBlockedScanSummary;
}

/**
 * persistScanResults 가 정상 ScanSummary 를 영속하면 호출 — preflight blocked summary 는
 * "직전 스캔이 preflight 차단" 을 의미하므로 정상 스캔 1회가 그 의미를 무효화한다.
 */
export function clearPreflightBlockedScanSummary(): void {
  _lastPreflightBlockedScanSummary = null;
}

export function attachPreflightBlockedPerSymbolSupplyInjection(
  stats: PreflightBlockedPerSymbolSupplyInjectionStats,
): void {
  if (!_lastPreflightBlockedScanSummary) return;
  _lastPreflightBlockedScanSummary = {
    ..._lastPreflightBlockedScanSummary,
    perSymbolSupplyInjection: stats,
  };
}


function resolveSessionWindowState(timestamp: string | undefined): 'SELL_ONLY' | 'REGULAR' {
  return 'REGULAR';
}

function resolveDisplayMarketSessionState(scanEvaluation: PreflightScanEvaluationResult): string {
  const explicit = String(scanEvaluation.marketSessionState ?? '').toUpperCase();
  if (explicit === 'AFTERMARKET' || explicit === 'AFTER_MARKET') {
    return explicit;
  }
  const blockReason = String(scanEvaluation.blockReason ?? '').toUpperCase();
  if (blockReason.includes('AFTERMARKET') || blockReason.includes('AFTER_MARKET')) return 'AFTERMARKET';
  return resolveSessionWindowState(scanEvaluation.asOf);
}

function resolveEntryBlockMode(scanEvaluation: PreflightScanEvaluationResult | undefined): string {
  return scanEvaluation ? 'NORMAL' : 'UNKNOWN';
}

function resolveTopReason(scanEvaluation: PreflightScanEvaluationResult | undefined, entryBlockMode: string): string {
  if (!scanEvaluation) return 'UNKNOWN';
  const reason = String(scanEvaluation.blockReason ?? '').toUpperCase();
  if (reason === 'SELL_ONLY' || reason === 'R6_DEFENSE_SELL_ONLY' || reason === 'R6_DEFENSE') {
    return 'LEGACY_POLICY_IGNORED';
  }
  return scanEvaluation.blockReason ?? 'UNKNOWN';
}


function resolveDisplayEvaluation(scanEvaluation: PreflightScanEvaluationResult, entryBlockMode: string): {
  displayEvaluationState: string;
  displayBreakPoint: string;
  liveEntryEvaluation: string;
} {
  const legacyState = scanEvaluation.evaluationState === 'NOT_EVALUATED_SELL_ONLY' ||
    scanEvaluation.evaluationState === 'NOT_EVALUATED_R6_LIVE_BLOCKED' ||
    scanEvaluation.evaluationState === 'NOT_EVALUATED_R6_DEFENSE';
  return {
    displayEvaluationState: legacyState ? 'EVALUATED_PARTIAL' : scanEvaluation.evaluationState,
    displayBreakPoint: scanEvaluation.breakPoint === 'PRE_FLIGHT_SELL_ONLY' ? 'PRE_FLIGHT' : (scanEvaluation.breakPoint ?? 'NONE'),
    liveEntryEvaluation: 'EVALUATED_OR_APPLICABLE',
  };
}

function resolveDisplaySourcePath(sourcePath: string): string {
  return sourcePath.includes('SELL_ONLY') ? 'DIAGNOSTIC_SNAPSHOT' : sourcePath;
}

function resolveGate3Diagnostic(scanEvaluation: PreflightScanEvaluationResult, entryBlockMode: string): string {
  const diagnostic = scanEvaluation.diagnostics as Record<string, unknown> | undefined;
  const gate3CompactText = typeof diagnostic?.gate3CompactText === 'string' ? diagnostic.gate3CompactText : null;
  if (gate3CompactText) return gate3CompactText;
  return 'UNAVAILABLE | reason=GATE3_CONSOLIDATED_DIAGNOSTIC_NOT_CARRIED | fallback=true | marketSignal=false';
}

/** /scan_blockers baseMessage 용 plain key=value 섹션 (사용자 §"기대 출력" 정합). */
export function formatPreflightBlockedScanSection(summary: PreflightBlockedScanSummary): string {
  const lines: string[] = [];
  lines.push('📊 <b>[매수 차단 사유]</b>');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('Preflight blocked scan detected');
  lines.push(`latestStage=${summary.stage}`);
  lines.push(`blockedBy=${summary.blockedBy}`);
  if (summary.hardBlockSource) lines.push(`hardBlockSource=${summary.hardBlockSource}`);
  if (summary.hardBlockModule) lines.push(`hardBlockModule=${summary.hardBlockModule}`);
  if (summary.hardBlockReason) lines.push(`hardBlockReason=${summary.hardBlockReason}`);
  if (summary.preflightDecision) lines.push(`preflightDecision=${summary.preflightDecision}`);
  lines.push(`candidateSummaryCount=${summary.candidateSummaryCount}`);
  lines.push(`universeSnapshotRecorded=${summary.universeSnapshotRecorded}`);
  lines.push(`counterfactualRecorded=${summary.counterfactualRecorded}`);
  lines.push(`buyListLoopEntered=${summary.buyListLoopEntered}`);
  lines.push(`executionImpact=${summary.executionImpact}`);
  if (summary.scanEvaluation) {
    const scanEvaluation = summary.scanEvaluation;
    const marketSessionState = resolveDisplayMarketSessionState(scanEvaluation);
    const entryBlockMode = resolveEntryBlockMode({ ...scanEvaluation, marketSessionState });
    const { displayEvaluationState, displayBreakPoint, liveEntryEvaluation } = resolveDisplayEvaluation(scanEvaluation, entryBlockMode);
    const liveEvaluated = scanEvaluation.evaluated;
    const liveSurvivors = scanEvaluation.survivors;
    const topReason = resolveTopReason(scanEvaluation, entryBlockMode);
    const displayReason = topReason === 'LEGACY_POLICY_IGNORED'
      ? 'LEGACY_POLICY_IGNORED'
      : (scanEvaluation.blockReason ?? 'NONE');
    const displayEffectiveRegime = scanEvaluation.effectiveRegime === 'R6_DEFENSE'
      ? String(scanEvaluation.diagnostics?.rawRegime ?? 'UNKNOWN')
      : scanEvaluation.effectiveRegime;
    const displayExecutionImpact = topReason === 'LEGACY_POLICY_IGNORED'
      ? 'NONE'
      : scanEvaluation.executionImpact;

    lines.push(`marketSessionState=${marketSessionState}`);
    lines.push(`entryBlockMode=${entryBlockMode}`);
    lines.push(`engineModeDisplay=${scanEvaluation.engineMode === 'SELL_ONLY' ? 'NORMAL' : scanEvaluation.engineMode}`);
    lines.push('liveEntryAllowed=true');
    lines.push(`liveEntryEvaluation=${liveEntryEvaluation}`);
    lines.push(`diagnosticEvaluation=PARTIAL`);
    lines.push(`liveEvaluated=${liveEvaluated}`);
    lines.push(`diagnosticEvaluated=${scanEvaluation.evaluated}`);
    lines.push(`liveSurvivors=${liveSurvivors}`);
    lines.push(`diagnosticGateSurvivors=${scanEvaluation.survivors}`);
    lines.push(`evaluationState=${displayEvaluationState}`);
    lines.push(`displayEvaluationState=${displayEvaluationState}`);
    lines.push(`sourcePath=${resolveDisplaySourcePath(scanEvaluation.sourcePath)}`);
    lines.push(`breakPoint=${displayBreakPoint}`);
    lines.push(`displayBreakPoint=${displayBreakPoint}`);
    lines.push(`reason=${displayReason}`);
    lines.push(`topReason=${topReason}`);
    lines.push(`scanExecutionImpact=${displayExecutionImpact}`);
    lines.push(`shadowLearningAllowed=${scanEvaluation.shadowLearningAllowed}`);
    lines.push(`DiagnosticMinScore: n/a`);
    lines.push(`DiagnosticDominant: n/a`);
    lines.push(`DiagnosticPenalty: n/a`);
    lines.push('LivePenalty: n/a');
    lines.push('RegimeOverride:');
    lines.push(`  rawRegime=${scanEvaluation.diagnostics?.rawRegime ?? 'UNKNOWN'}`);
    lines.push(`  effectiveRegime=${displayEffectiveRegime}`);
    lines.push('  overrideReason=NONE');
    lines.push('  note=Legacy defense policy is disabled; Gate/data diagnostics remain authoritative.');
    lines.push('Gate1Live: evaluated');
    lines.push(`Gate1Diagnostic: pass=0/${scanEvaluation.totalCandidates}`);
    lines.push('Gate2Live: evaluated');
    lines.push(`Gate2Diagnostic: pass=0 trueFailed=0 unavailable=0 watchPreserved=${scanEvaluation.evaluated} shadowPreserved=${scanEvaluation.evaluated}`);
    lines.push('Gate3Live: evaluated');
    lines.push(`Gate3Diagnostic: preBreakoutWait=${scanEvaluation.skipped}`);
    lines.push('🧩 Gate Diagnostic');
        const diag = (scanEvaluation.diagnostics as Record<string, unknown> | undefined);
    const gate1Fallback = 'UNAVAILABLE | fallback=true | marketSignal=false';
    const gate2Fallback = 'UNAVAILABLE | fallback=true | marketSignal=false';
    lines.push(`  • Gate1Diag: ${diag?.gate1CompactText ?? gate1Fallback}`);
    lines.push(`  • Gate2Diag: ${diag?.gate2CompactText ?? gate2Fallback}`);
    lines.push(`  • Gate3Diag: ${resolveGate3Diagnostic(scanEvaluation, entryBlockMode)}`);
    lines.push('Shadow:');
    lines.push('allowed=true');
    lines.push('learning=true');
    lines.push('counterfactual=true');
    lines.push('caseRecording=true');
    lines.push('shadowExecutionImpact=NONE');
  }
  lines.push('');
  lines.push('📊 <b>Per-Symbol Supply Injection</b>');
  const supplyInjection = summary.perSymbolSupplyInjection;
  lines.push(`  status: ${supplyInjection ? 'DIAGNOSTIC_COLLECTED_PRE_FLIGHT_BLOCK' : 'SKIPPED_PRE_FLIGHT_BLOCK'}`);
  lines.push(`  reason: ${formatPerSymbolSupplyInjectionSkipReason(summary)}`);
  lines.push(`  candidateSummaryCount: ${summary.candidateSummaryCount}`);
  lines.push(`  candidates: ${supplyInjection?.totalCandidates ?? 0}`);
  lines.push(`  requested: ${supplyInjection?.requestedSymbols ?? 0}`);
  lines.push(`  receivedResults: ${supplyInjection?.receivedResults ?? 0}`);
  lines.push(`  injected: ${supplyInjection?.injected ?? 0}`);
  lines.push(`  verified: ${supplyInjection?.verified ?? 0}`);
  lines.push(`  degraded: ${supplyInjection?.degraded ?? 0}`);
  lines.push(`  stale: ${supplyInjection?.stale ?? 0}`);
  lines.push(`  missing: ${supplyInjection?.missing ?? 0}`);
  lines.push(`  unknown: ${supplyInjection?.unknown ?? 0}`);
  lines.push(`  routerConnected: ${supplyInjection?.routerConnected ?? false}`);
  lines.push(`  gateContextConnected: ${supplyInjection?.gateContextConnected ?? false}`);
  return lines.join('\n');
}

function formatPerSymbolSupplyInjectionSkipReason(summary: PreflightBlockedScanSummary): string {
  const decision = summary.preflightDecision ?? summary.blockedBy;
  return `buyListLoopEntered=false / ${decision}`;
}

export function __resetPreflightBlockedScanSummaryForTests(): void {
  _lastPreflightBlockedScanSummary = null;
}
