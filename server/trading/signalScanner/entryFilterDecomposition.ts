/**
 * @responsibility ADR-0464 Entry Filter Conservatism Decomposition.
 *
 * Diagnostic-only SSOT that decomposes why buy candidates did not become live
 * entries. It does not relax any gate, route orders, or mutate trading state.
 */
import type { MacroGateState, WaitDistribution, GatePassDistribution } from './scanDiagnostics.js';

export type ExecutionBlockScope = 'NONE' | 'STRONG_BUY_ONLY' | 'NEW_BUY_ONLY' | 'ALL_EXECUTION';

export type EntryBlockerCategory =
  | 'TIME_WINDOW'
  | 'OPERATOR_CONTROL'
  | 'MARKET_RISK'
  | 'PROVIDER_ISSUE'
  | 'SECTOR_ENERGY'
  | 'GATE1'
  | 'GATE2'
  | 'GATE3'
  | 'KELLY_SIZING'
  | 'POSITION_LIMIT'
  | 'WATCHLIST'
  | 'ORDER_ROUTE'
  | 'DATA_QUALITY'
  | 'UNKNOWN';

export type EntryBlockerSeverity = 'INFO' | 'SOFT_BLOCK' | 'HARD_BLOCK' | 'DIAGNOSTIC_ONLY';

export interface EntryBlocker {
  category: EntryBlockerCategory;
  code: string;
  severity: EntryBlockerSeverity;
  message: string;
  executionBlocking: boolean | ExecutionBlockScope;
  learningBlocking: boolean;
  expectedInRegime?: boolean;
}

export type CandidateEntryStage =
  | 'UNIVERSE'
  | 'WATCHLIST'
  | 'BEFORE_GATE1'
  | 'GATE1'
  | 'GATE2'
  | 'GATE3'
  | 'BEFORE_SIZING'
  | 'SIZING'
  | 'BEFORE_ORDER'
  | 'ORDER_BLOCKED'
  | 'ORDER_READY';

export interface CandidateEntryTrace {
  symbol: string;
  name?: string;
  stageReached: CandidateEntryStage;
  regime?: string;
  marketSession?: string;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  gate3Passed?: boolean;
  kellyRaw?: number;
  kellyAdjusted?: number;
  finalSize?: number;
  sectorBoost?: number;
  sectorEnergyState?: string;
  blockers: EntryBlocker[];
  wouldEnterIfNoTimeBlock?: boolean;
  wouldEnterIfNoOrderBlock?: boolean;
  wouldEnterIfSectorEnergyIgnored?: boolean;
  wouldEnterIfKellyMinApplied?: boolean;
  executionImpact: 'NONE' | 'PAPER_ONLY' | 'LIVE_READY';
}

export interface CounterfactualEntryTrace {
  timestamp: string;
  forDate: string;
  symbol: string;
  name?: string;
  hypotheticalEntryPrice?: number;
  hypotheticalStopLoss?: number;
  hypotheticalTarget?: number;
  wouldEnterReason: string[];
  actualBlockers: EntryBlocker[];
  executionImpact: 'NONE';
  trackingHorizonDays: number;
  source: 'ADR-0464_ENTRY_TRACE';
}

export interface FilterConservatismReport {
  date: string;
  regime: string;
  marketGreen: boolean;
  watchlistCount: number;
  entryCount: number;
  missedSignalCount: number;
  ghostOpenCount: number;
  filterTooConservativeScore: number;
  primaryConservativeFilters: { code: string; count: number; examples: string[] }[];
  recommendedAction:
    | 'NO_ACTION'
    | 'DIAGNOSTIC_ONLY'
    | 'REVIEW_THRESHOLDS'
    | 'LOWER_SOFT_FILTER_WEIGHT'
    | 'ADD_COUNTERFACTUAL_ONLY';
}

export interface KellySizingTrace {
  symbol: string;
  kellyRaw: number;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier: number;
  riskMultiplier: number;
  finalKelly: number;
  minPositionThreshold: number;
  finalPositionSize: number;
  blockedBySizing: boolean;
  reason?: string;
}

export interface WatchlistHealthReport {
  count: number;
  refreshedAt?: string;
  ageMinutes?: number;
  isStale: boolean;
  source: string;
  candidatesFromUniverse: number;
  candidatesAfterPreFilter: number;
  reasonIfEmpty?: string;
}

export interface EntryDecisionLedgerRow {
  timestamp: string;
  forDate: string;
  symbol: string;
  name?: string;
  regime: string;
  marketSession: string;
  stageReached: string;
  finalDecision:
    | 'ENTER_READY'
    | 'BLOCKED_BY_TIME'
    | 'BLOCKED_BY_GATE'
    | 'BLOCKED_BY_SIZING'
    | 'BLOCKED_BY_ORDER_ROUTE'
    | 'DIAGNOSTIC_ONLY'
    | 'NO_SIGNAL';
  blockers: EntryBlocker[];
  wouldEnterIfNoTimeBlock: boolean;
  wouldEnterIfNoOrderBlock: boolean;
  counterfactualRecorded: boolean;
  executionImpact: 'NONE' | 'PAPER_ONLY' | 'LIVE_READY';
}

export interface EntryFilterDecomposition {
  universeCandidates: number;
  watchlistCandidates: number;
  tracedCandidates: number;
  entryReady: number;
  blockedBeforeGate1: number;
  blockedByTimeWindow: number;
  blockedByGate1: number;
  blockedByGate2: number;
  blockedByGate3: number;
  blockedByKellySizing: number;
  blockedBySectorEnergyOnly: number;
  providerIssueDowngraded: number;
  blockedByOrderRoute: number;
  learningBlocked: number;
  counterfactualRecorded: number;
  counterfactualReady: number;
  ledgerRowsCreated: number;
  wouldEnterIfNoTimeBlock: number;
  wouldEnterIfNoOrderBlock: number;
  wouldEnterIfSectorEnergyIgnored: number;
  wouldEnterIfKellyMinApplied: number;
  topBlockers: { code: string; count: number }[];
  candidateTraces: CandidateEntryTrace[];
  counterfactualTraces: CounterfactualEntryTrace[];
  ledgerRows: EntryDecisionLedgerRow[];
  kellySizingTraces: KellySizingTrace[];
  watchlistHealth: WatchlistHealthReport;
  filterConservatismReport?: FilterConservatismReport;
}

export interface CandidateSnapshot {
  symbol: string;
  name?: string;
  stageReached?: CandidateEntryStage;
  gateScore?: number;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  gate3Passed?: boolean;
  sectorBoost?: number;
  sectorEnergyState?: string;
}

interface BuildDecompositionInput {
  now: Date;
  universeCandidates: number;
  watchlistCandidates: number;
  entries: number;
  waitDistribution?: WaitDistribution;
  gatePassDistribution?: GatePassDistribution;
  macroGateState?: MacroGateState;
  candidateSnapshots?: CandidateSnapshot[];
  counterfactualRecordedToday?: number;
  sectorEnergyQuality?: string;
  ghostOpenCount?: number;
  filterTooConservativeScore?: number;
  watchlistRefreshedAt?: string;
  watchlistSource?: string;
}

export function blocker(input: Omit<EntryBlocker, 'learningBlocking'> & { learningBlocking?: boolean }): EntryBlocker {
  return { ...input, learningBlocking: input.learningBlocking ?? false };
}

function addBlockersRoundRobin(
  traces: CandidateEntryTrace[],
  count: number,
  make: (idx: number) => EntryBlocker,
  stage: CandidateEntryStage,
  gatePatch?: Partial<CandidateEntryTrace>,
): void {
  if (traces.length === 0) return;
  for (let i = 0; i < Math.min(count, traces.length); i += 1) {
    const trace = traces[i % traces.length];
    trace.blockers.push(make(i));
    trace.stageReached = stage;
    Object.assign(trace, gatePatch ?? {});
  }
}

function hasExecutionBlocker(trace: CandidateEntryTrace, category?: EntryBlockerCategory): boolean {
  return trace.blockers.some((b) => {
    const scope = b.executionBlocking;
    const blocks = scope === true || scope === 'NEW_BUY_ONLY' || scope === 'ALL_EXECUTION';
    return blocks && (category === undefined || b.category === category);
  });
}

function nonTimeHardBlocked(trace: CandidateEntryTrace): boolean {
  return trace.blockers.some((b) => {
    if (b.category === 'TIME_WINDOW') return false;
    const scope = b.executionBlocking;
    return scope === true || scope === 'NEW_BUY_ONLY' || scope === 'ALL_EXECUTION';
  });
}

function isRiskOff(regime: string): boolean {
  return ['CRISIS', 'RISK_OFF', 'R6_DEFENSE', 'R5_CAUTION'].includes(regime);
}

function isGreenish(regime: string): boolean {
  return ['GREEN', 'R1_TURBO', 'R2_BULL', 'R3_EARLY', 'FOMC_NORMAL'].includes(regime);
}

export function createKellySizingTrace(input: {
  symbol: string;
  kellyRaw: number;
  regimeMultiplier: number;
  fomcMultiplier: number;
  sectorMultiplier?: number;
  riskMultiplier?: number;
  minPositionThreshold?: number;
  finalPositionSize?: number;
}): KellySizingTrace {
  const sectorMultiplier = input.sectorMultiplier ?? 1;
  const riskMultiplier = input.riskMultiplier ?? 1;
  const finalKelly = input.kellyRaw * input.regimeMultiplier * input.fomcMultiplier * sectorMultiplier * riskMultiplier;
  const minPositionThreshold = input.minPositionThreshold ?? 0.01;
  const finalPositionSize = input.finalPositionSize ?? finalKelly;
  const blockedBySizing = finalKelly < minPositionThreshold || finalPositionSize <= 0;
  return {
    symbol: input.symbol,
    kellyRaw: input.kellyRaw,
    regimeMultiplier: input.regimeMultiplier,
    fomcMultiplier: input.fomcMultiplier,
    sectorMultiplier,
    riskMultiplier,
    finalKelly,
    minPositionThreshold,
    finalPositionSize,
    blockedBySizing,
    reason: blockedBySizing ? 'KELLY_ADJUSTED_TOO_LOW' : undefined,
  };
}

export function buildEntryFilterDecomposition(input: BuildDecompositionInput): EntryFilterDecomposition {
  const nowIso = input.now.toISOString();
  const forDate = nowIso.slice(0, 10);
  const regime = input.macroGateState?.regime ?? 'UNKNOWN';
  const marketSession = input.macroGateState?.sellOnlyMode ? 'SELL_ONLY' : 'NORMAL';
  const wd = input.waitDistribution;
  const gp = input.gatePassDistribution;
  const candidateSnapshots = input.candidateSnapshots ?? [];
  const fallbackCount = input.watchlistCandidates;
  const traces: CandidateEntryTrace[] = (candidateSnapshots.length > 0
    ? candidateSnapshots
    : Array.from({ length: fallbackCount }, (_, i): CandidateSnapshot => ({ symbol: `WATCHLIST_${i + 1}` })))
    .map((c): CandidateEntryTrace => ({
      symbol: c.symbol,
      name: c.name,
      stageReached: c.stageReached ?? 'WATCHLIST',
      regime,
      marketSession,
      gate1Passed: c.gate1Passed,
      gate2Passed: c.gate2Passed,
      gate3Passed: c.gate3Passed,
      sectorBoost: c.sectorBoost,
      sectorEnergyState: c.sectorEnergyState ?? input.sectorEnergyQuality,
      blockers: [],
      executionImpact: 'NONE',
    }));

  if (traces.length === 0 && input.universeCandidates > 0) {
    traces.push({
      symbol: 'UNIVERSE_SUMMARY',
      stageReached: 'UNIVERSE',
      regime,
      marketSession,
      blockers: [blocker({
        category: 'WATCHLIST',
        code: 'WATCHLIST_EMPTY_OR_STALE',
        severity: 'SOFT_BLOCK',
        message: 'Universe candidates existed but watchlist/pre-filter produced no candidate rows.',
        executionBlocking: 'NEW_BUY_ONLY',
      })],
      executionImpact: 'NONE',
    });
  }

  if (input.macroGateState?.sellOnlyMode) {
    for (const trace of traces) {
      trace.blockers.push(blocker({
        category: 'TIME_WINDOW',
        code: 'SELL_ONLY_TIME_WINDOW',
        severity: 'HARD_BLOCK',
        message: 'SELL_ONLY market session blocks new live buy execution only.',
        executionBlocking: 'NEW_BUY_ONLY',
        expectedInRegime: true,
      }));
    }
  }

  if (input.macroGateState && !input.macroGateState.autoTradeEnabled) {
    for (const trace of traces) {
      trace.blockers.push(blocker({
        category: 'OPERATOR_CONTROL',
        code: 'AUTOTRADE_DISABLED',
        severity: 'HARD_BLOCK',
        message: 'Operator control disabled automated live buys.',
        executionBlocking: 'NEW_BUY_ONLY',
      }));
    }
  }

  if (input.macroGateState?.emergencyStop) {
    for (const trace of traces) {
      trace.blockers.push(blocker({
        category: 'MARKET_RISK',
        code: 'EMERGENCY_STOP',
        severity: 'HARD_BLOCK',
        message: 'Emergency stop blocks live execution; learning remains available.',
        executionBlocking: 'ALL_EXECUTION',
      }));
    }
  }

  const gate1Fail = Math.max(0, (wd?.gateFail ?? 0) || Math.max(0, input.watchlistCandidates - (gp?.gate1Pass ?? input.watchlistCandidates)));
  addBlockersRoundRobin(traces, gate1Fail, () => blocker({
    category: 'GATE1',
    code: 'GATE1_FAIL',
    severity: 'SOFT_BLOCK',
    message: 'Candidate failed Gate1 or live revalidation.',
    executionBlocking: 'NEW_BUY_ONLY',
  }), 'GATE1', { gate1Passed: false });

  const gate2Fail = Math.max(0, (gp?.gate1Pass ?? 0) - (gp?.gate2Pass ?? 0));
  addBlockersRoundRobin(traces.slice(gate1Fail), gate2Fail, () => blocker({
    category: 'GATE2',
    code: 'GATE2_FAIL',
    severity: 'SOFT_BLOCK',
    message: 'Candidate survived Gate1 but failed Gate2 leadership/timing confirmation.',
    executionBlocking: 'NEW_BUY_ONLY',
  }), 'GATE2', { gate1Passed: true, gate2Passed: false });

  const gate3Fail = Math.max(0, (gp?.gate2Pass ?? 0) - (gp?.gate3Pass ?? 0));
  addBlockersRoundRobin(traces.slice(gate1Fail + gate2Fail), gate3Fail, () => blocker({
    category: 'GATE3',
    code: 'GATE3_FAIL',
    severity: 'SOFT_BLOCK',
    message: 'Candidate survived Gate2 but failed final trigger/Gate3 confirmation.',
    executionBlocking: 'NEW_BUY_ONLY',
  }), 'GATE3', { gate1Passed: true, gate2Passed: true, gate3Passed: false });

  const sizingFail = wd?.sizingBlocked ?? 0;
  addBlockersRoundRobin(traces.slice(gate1Fail + gate2Fail + gate3Fail), sizingFail, () => blocker({
    category: 'KELLY_SIZING',
    code: 'KELLY_ADJUSTED_TOO_LOW',
    severity: 'SOFT_BLOCK',
    message: 'Kelly-adjusted position size fell below the minimum tradable position threshold.',
    executionBlocking: 'NEW_BUY_ONLY',
  }), 'SIZING');

  if (input.sectorEnergyQuality === 'DEGRADED' || input.sectorEnergyQuality === 'STALE' || input.sectorEnergyQuality === 'FAILED') {
    const sectorCount = Math.max(0, Math.min(3, traces.length));
    addBlockersRoundRobin(traces, sectorCount, () => blocker({
      category: 'SECTOR_ENERGY',
      code: 'SECTOR_ENERGY_DIAGNOSTIC_ONLY',
      severity: 'DIAGNOSTIC_ONLY',
      message: 'SectorEnergy is diagnostic/degraded; STRONG_BUY may be blocked, general BUY/counterfactual is preserved.',
      executionBlocking: 'STRONG_BUY_ONLY',
    }), 'WATCHLIST');
  }

  const kellyTrace = createKellySizingTrace({
    symbol: 'SCAN_MULTIPLIER',
    kellyRaw: 1,
    regimeMultiplier: input.macroGateState?.kellyMultiplierFromRegime ?? 1,
    fomcMultiplier: input.macroGateState?.fomcKellyMultiplier ?? 1,
    sectorMultiplier: 1,
    riskMultiplier: input.macroGateState?.finalKellyMultiplier !== undefined
      ? input.macroGateState.finalKellyMultiplier / Math.max(0.000001, (input.macroGateState.kellyMultiplierFromRegime || 1) * (input.macroGateState.fomcKellyMultiplier || 1))
      : 1,
    minPositionThreshold: 0.01,
    finalPositionSize: input.macroGateState?.finalKellyMultiplier ?? 1,
  });

  for (const trace of traces) {
    const onlyTimeBlocked = hasExecutionBlocker(trace, 'TIME_WINDOW') && !nonTimeHardBlocked(trace);
    trace.wouldEnterIfNoTimeBlock = onlyTimeBlocked || (!hasExecutionBlocker(trace, 'TIME_WINDOW') && !nonTimeHardBlocked(trace));
    trace.wouldEnterIfNoOrderBlock = !trace.blockers.some((b) => b.category === 'ORDER_ROUTE' || b.category === 'OPERATOR_CONTROL');
    trace.wouldEnterIfSectorEnergyIgnored = !trace.blockers.some((b) => b.category !== 'SECTOR_ENERGY' && b.category !== 'TIME_WINDOW' && (b.executionBlocking === true || b.executionBlocking === 'NEW_BUY_ONLY' || b.executionBlocking === 'ALL_EXECUTION'));
    trace.wouldEnterIfKellyMinApplied = !trace.blockers.some((b) => b.category !== 'KELLY_SIZING' && b.category !== 'TIME_WINDOW' && (b.executionBlocking === true || b.executionBlocking === 'NEW_BUY_ONLY' || b.executionBlocking === 'ALL_EXECUTION'));
    if (trace.wouldEnterIfNoTimeBlock && hasExecutionBlocker(trace, 'TIME_WINDOW')) trace.stageReached = 'ORDER_BLOCKED';
    if (input.entries > 0 && !hasExecutionBlocker(trace)) trace.executionImpact = 'LIVE_READY';
  }

  const counterfactualTraces = traces
    .filter((trace) => trace.wouldEnterIfNoTimeBlock || hasExecutionBlocker(trace, 'TIME_WINDOW'))
    .map((trace): CounterfactualEntryTrace => ({
      timestamp: nowIso,
      forDate,
      symbol: trace.symbol,
      name: trace.name,
      wouldEnterReason: trace.wouldEnterIfNoTimeBlock
        ? ['WOULD_ENTER_IF_NO_TIME_BLOCK']
        : ['ACTUAL_BLOCKERS_RECORDED_FOR_LEARNING'],
      actualBlockers: trace.blockers,
      executionImpact: 'NONE',
      trackingHorizonDays: 20,
      source: 'ADR-0464_ENTRY_TRACE',
    }));

  const ledgerRows = traces.map((trace): EntryDecisionLedgerRow => {
    let finalDecision: EntryDecisionLedgerRow['finalDecision'] = 'NO_SIGNAL';
    if (!hasExecutionBlocker(trace) && input.entries > 0) finalDecision = 'ENTER_READY';
    else if (hasExecutionBlocker(trace, 'TIME_WINDOW')) finalDecision = 'BLOCKED_BY_TIME';
    else if (trace.blockers.some((b) => b.category === 'KELLY_SIZING')) finalDecision = 'BLOCKED_BY_SIZING';
    else if (trace.blockers.some((b) => b.category === 'ORDER_ROUTE' || b.category === 'OPERATOR_CONTROL')) finalDecision = 'BLOCKED_BY_ORDER_ROUTE';
    else if (trace.blockers.some((b) => b.category === 'GATE1' || b.category === 'GATE2' || b.category === 'GATE3')) finalDecision = 'BLOCKED_BY_GATE';
    else if (trace.blockers.some((b) => b.severity === 'DIAGNOSTIC_ONLY')) finalDecision = 'DIAGNOSTIC_ONLY';
    return {
      timestamp: nowIso,
      forDate,
      symbol: trace.symbol,
      name: trace.name,
      regime,
      marketSession,
      stageReached: trace.stageReached,
      finalDecision,
      blockers: trace.blockers,
      wouldEnterIfNoTimeBlock: trace.wouldEnterIfNoTimeBlock ?? false,
      wouldEnterIfNoOrderBlock: trace.wouldEnterIfNoOrderBlock ?? false,
      counterfactualRecorded: counterfactualTraces.some((cf) => cf.symbol === trace.symbol),
      executionImpact: trace.executionImpact,
    };
  });

  const topMap = new Map<string, number>();
  for (const trace of traces) for (const b of trace.blockers) topMap.set(b.code, (topMap.get(b.code) ?? 0) + 1);
  const topBlockers = Array.from(topMap.entries()).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const providerIssueDowngraded = traces.filter((t) => t.blockers.some((b) => b.category === 'PROVIDER_ISSUE')).length;
  const blockedBySectorEnergyOnly = traces.filter((t) => t.blockers.some((b) => b.category === 'SECTOR_ENERGY') && !nonTimeHardBlocked(t)).length;
  const learningBlocked = traces.filter((t) => t.blockers.some((b) => b.learningBlocking)).length;
  const watchlistAge = input.watchlistRefreshedAt ? Math.max(0, Math.round((input.now.getTime() - Date.parse(input.watchlistRefreshedAt)) / 60000)) : undefined;
  const watchlistHealth: WatchlistHealthReport = {
    count: input.watchlistCandidates,
    refreshedAt: input.watchlistRefreshedAt,
    ageMinutes: watchlistAge,
    isStale: watchlistAge !== undefined ? watchlistAge > 60 : false,
    source: input.watchlistSource ?? 'signalScanner',
    candidatesFromUniverse: input.universeCandidates,
    candidatesAfterPreFilter: input.watchlistCandidates,
    reasonIfEmpty: input.watchlistCandidates === 0
      ? (watchlistAge !== undefined && watchlistAge > 60 ? 'STALE' : 'EMPTY_AFTER_PREFILTER')
      : undefined,
  };

  const conservativeFilters = topBlockers
    .map(({ code, count }) => ({ code: mapConservativeCode(code), count, examples: traces.filter((t) => t.blockers.some((b) => b.code === code)).slice(0, 3).map((t) => t.symbol) }))
    .filter((x) => x.code !== null) as { code: string; count: number; examples: string[] }[];
  const marketGreen = isGreenish(regime) && !isRiskOff(regime);
  const shouldReportConservatism = marketGreen && input.watchlistCandidates > 0 && input.entries === 0;
  const filterConservatismReport = shouldReportConservatism ? {
    date: forDate,
    regime,
    marketGreen,
    watchlistCount: input.watchlistCandidates,
    entryCount: input.entries,
    missedSignalCount: input.watchlistCandidates - input.entries,
    ghostOpenCount: input.ghostOpenCount ?? 0,
    filterTooConservativeScore: input.filterTooConservativeScore ?? Math.min(1, (input.watchlistCandidates - input.entries) / Math.max(1, input.watchlistCandidates)),
    primaryConservativeFilters: conservativeFilters,
    recommendedAction: 'DIAGNOSTIC_ONLY' as const,
  } satisfies FilterConservatismReport : undefined;

  return {
    universeCandidates: input.universeCandidates,
    watchlistCandidates: input.watchlistCandidates,
    tracedCandidates: traces.length,
    entryReady: input.entries,
    blockedBeforeGate1: Math.max(0, input.watchlistCandidates - (gp?.gate1Pass ?? 0)),
    blockedByTimeWindow: traces.filter((t) => t.blockers.some((b) => b.code === 'SELL_ONLY_TIME_WINDOW')).length,
    blockedByGate1: traces.filter((t) => t.blockers.some((b) => b.category === 'GATE1')).length,
    blockedByGate2: traces.filter((t) => t.blockers.some((b) => b.category === 'GATE2')).length,
    blockedByGate3: traces.filter((t) => t.blockers.some((b) => b.category === 'GATE3')).length,
    blockedByKellySizing: traces.filter((t) => t.blockers.some((b) => b.category === 'KELLY_SIZING')).length,
    blockedBySectorEnergyOnly,
    providerIssueDowngraded,
    blockedByOrderRoute: traces.filter((t) => t.blockers.some((b) => b.category === 'ORDER_ROUTE' || b.category === 'OPERATOR_CONTROL')).length,
    learningBlocked,
    counterfactualRecorded: Math.max(input.counterfactualRecordedToday ?? 0, counterfactualTraces.length),
    counterfactualReady: counterfactualTraces.filter((t) => t.wouldEnterReason.includes('WOULD_ENTER_IF_NO_TIME_BLOCK')).length,
    ledgerRowsCreated: ledgerRows.length,
    wouldEnterIfNoTimeBlock: traces.filter((t) => t.wouldEnterIfNoTimeBlock).length,
    wouldEnterIfNoOrderBlock: traces.filter((t) => t.wouldEnterIfNoOrderBlock).length,
    wouldEnterIfSectorEnergyIgnored: traces.filter((t) => t.wouldEnterIfSectorEnergyIgnored).length,
    wouldEnterIfKellyMinApplied: traces.filter((t) => t.wouldEnterIfKellyMinApplied).length,
    topBlockers,
    candidateTraces: traces,
    counterfactualTraces,
    ledgerRows,
    kellySizingTraces: [kellyTrace],
    watchlistHealth,
    ...(filterConservatismReport ? { filterConservatismReport } : {}),
  };
}

function mapConservativeCode(code: string): string | null {
  switch (code) {
    case 'GATE1_FAIL': return 'GATE1_TOO_STRICT';
    case 'GATE2_FAIL': return 'GATE2_TOO_STRICT';
    case 'SECTOR_ENERGY_DIAGNOSTIC_ONLY': return 'SECTOR_ENERGY_STRONG_BUY_BLOCK_ONLY';
    case 'KELLY_ADJUSTED_TOO_LOW': return 'KELLY_MULTIPLIER_TOO_LOW';
    case 'SELL_ONLY_TIME_WINDOW': return 'SELL_ONLY_MASKING_ENTRY_SIGNAL';
    case 'WATCHLIST_EMPTY_OR_STALE': return 'WATCHLIST_EMPTY_OR_STALE';
    case 'AUTOTRADE_DISABLED': return 'ORDER_ROUTE_BLOCKED_BY_OPERATOR';
    default: return null;
  }
}

export function formatEntryFilterDecompositionSection(d?: EntryFilterDecomposition): string | null {
  if (!d) return null;
  const lines: string[] = [];
  lines.push('📊 <b>Entry Filter Decomposition (ADR-0464)</b>');
  const sample = d.candidateTraces[0];
  lines.push(`• regime: ${sample?.regime ?? 'UNKNOWN'}`);
  lines.push(`• marketSession: ${sample?.marketSession ?? 'UNKNOWN'}`);
  lines.push(`• universeCandidates: ${d.universeCandidates}`);
  lines.push(`• watchlistCandidates: ${d.watchlistCandidates}`);
  lines.push(`• tracedCandidates: ${d.tracedCandidates}`);
  lines.push(`• entryReady: ${d.entryReady}`);
  lines.push(`• counterfactualReady: ${d.counterfactualReady}`);
  lines.push(`• ledgerRowsCreated: ${d.ledgerRowsCreated}`);
  lines.push('');
  lines.push('차단 분포:');
  lines.push(`1. SELL_ONLY_TIME_WINDOW: ${d.blockedByTimeWindow}`);
  lines.push(`2. GATE1_FAIL: ${d.blockedByGate1}`);
  lines.push(`3. GATE2_FAIL: ${d.blockedByGate2}`);
  lines.push(`4. GATE3_FAIL: ${d.blockedByGate3}`);
  lines.push(`5. KELLY_ADJUSTED_TOO_LOW: ${d.blockedByKellySizing}`);
  lines.push(`6. SECTOR_ENERGY_DIAGNOSTIC_ONLY: ${d.blockedBySectorEnergyOnly}`);
  lines.push(`7. ORDER_ROUTE_OPERATOR_BLOCK: ${d.blockedByOrderRoute}`);
  lines.push(`8. PROVIDER_ISSUE_DOWNGRADED: ${d.providerIssueDowngraded}`);
  lines.push(`9. learningBlocked: ${d.learningBlocked}`);
  lines.push(`10. counterfactualRecorded: ${d.counterfactualRecorded}`);
  if (d.topBlockers.length > 0) {
    lines.push('');
    lines.push('TOP blockers:');
    d.topBlockers.slice(0, 5).forEach((b, idx) => lines.push(`${idx + 1}. ${b.code}: ${b.count}`));
  }
  lines.push('');
  lines.push('마스킹 해제 분석:');
  lines.push(`• wouldEnterIfNoTimeBlock: ${d.wouldEnterIfNoTimeBlock}`);
  lines.push(`• wouldEnterIfNoOrderBlock: ${d.wouldEnterIfNoOrderBlock}`);
  lines.push(`• wouldEnterIfSectorEnergyIgnored: ${d.wouldEnterIfSectorEnergyIgnored}`);
  lines.push(`• wouldEnterIfKellyMinApplied: ${d.wouldEnterIfKellyMinApplied}`);
  if (d.kellySizingTraces[0]) {
    const k = d.kellySizingTraces[0];
    lines.push('');
    lines.push('Kelly/Sizing zero 분해:');
    lines.push(`• regime ×${k.regimeMultiplier.toFixed(2)} / FOMC ×${k.fomcMultiplier.toFixed(2)} / sector ×${k.sectorMultiplier.toFixed(2)} / risk ×${k.riskMultiplier.toFixed(2)} → finalKelly ${k.finalKelly.toFixed(4)}`);
  }
  if (d.filterConservatismReport) {
    lines.push('');
    lines.push('판정:');
    lines.push(`• FILTER_TOO_CONSERVATIVE 후보: ${d.filterConservatismReport.primaryConservativeFilters.map((f) => f.code).slice(0, 3).join(' / ') || 'DIAGNOSTIC_ONLY'}`);
    lines.push('• threshold 변경 전 counterfactual 결과 확인 권장');
  }
  return lines.join('\n');
}
