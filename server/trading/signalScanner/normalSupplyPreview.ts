// @responsibility Normal-mode supply diagnostic overlay under live-entry blocks.
import type {
  CandidateWithSupplyContext,
  PerSymbolSupplyContext,
  PerSymbolSupplyInjectionStats,
  SupplyProviderHealth,
  SupplySignal,
} from './injectPerSymbolSupplyContext.js';

export const NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE = 'NORMAL_SUPPLY_DIAGNOSTIC' as const;
export const NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE = 'NORMAL_SUPPLY_DIAGNOSTIC_FULL' as const;
export const NORMAL_SUPPLY_SCORE_THRESHOLDS = Object.freeze({
  bullishThreshold: 80,
  accumulatingThreshold: 70,
  bearishThreshold: 35,
});

export type NormalSupplyPreviewMode = typeof NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE;
export type NormalSupplyPreviewFullMode = typeof NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE;
export type ProgramFlowSignal = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN' | 'UNAVAILABLE';
export type ProgramFlowSourceProvider = 'KIS_API' | 'KRX_API' | 'CACHE' | 'SNAPSHOT' | 'NONE';
export type ActivePassiveConfluence =
  | 'ACTIVE_PASSIVE_CONFIRMED_BUY'
  | 'ACTIVE_BUYING_ONLY'
  | 'PASSIVE_BUYING_ONLY'
  | 'ACTIVE_PASSIVE_CONFIRMED_SELL'
  | 'ACTIVE_SELLING_ONLY'
  | 'PASSIVE_SELLING_ONLY'
  | 'MIXED_FLOW'
  | 'NEUTRAL_FLOW'
  | 'PROGRAM_FLOW_UNAVAILABLE';

export interface ProgramFlowDiagnostic {
  stockLevel: {
    available: boolean;
    netBuy?: number;
    buyAmount?: number;
    sellAmount?: number;
    netAmount?: number;
    signal: ProgramFlowSignal;
    sourceProvider?: ProgramFlowSourceProvider;
    providerIssue: boolean;
    marketSignal: boolean;
    reason?: string;
    diagnosticOnly: true;
    executionImpact: 'NONE';
  };
  marketLevel: {
    available: boolean;
    kospiNetBuy?: number;
    kosdaqNetBuy?: number;
    combinedNetBuy?: number;
    signal: ProgramFlowSignal;
    sourceProvider?: ProgramFlowSourceProvider;
    providerIssue: boolean;
    marketSignal: boolean;
    reason?: string;
    diagnosticOnly: true;
    executionImpact: 'NONE';
  };
}

export interface ProgramFlowDryRunDiagnostic {
  currentSupplyScore: number;
  withProgramFlowScore?: number;
  reason: string;
  appliedToLiveScore: false;
  diagnosticOnly: true;
  executionImpact: 'NONE';
}

export type NormalSupplyPreviewEngineMode =
  | 'NORMAL'
  | 'SELL_ONLY'
  | 'MACRO_LIVE_BLOCK'
  | 'PRE_FLIGHT_BLOCK'
  | 'HARD_BLOCK'
  | 'POSITION_FULL'
  | 'UNKNOWN'
  | string;

export interface NormalSupplyPreviewCandidate {
  symbol: string;
  name?: string;
  sourceProvider: PerSymbolSupplyContext['provider'];
  dataStatus: SupplyProviderHealth;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  supplyProviderHealth: SupplyProviderHealth;
  supplySignal: SupplySignal;
  providerIssue: boolean;
  marketSignal: boolean;
  executionImpact: 'NONE' | 'SCORE_CONFIDENCE_DOWN_ONLY' | 'NEW_BUY_BLOCKED_ONLY' | 'SELL_ONLY' | 'SHADOW_ONLY';
  supplyScore: number;
  summary: string;
  reason: string;
  invalidBearishReason?: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BEARISH';
  invalidBullishReason?: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BULLISH';
  usedForLiveDecision: false;
  strongBuyAllowed: false;
  watchlistPriorityBoost: number;
  shadowTracking: boolean;
  foreignNetBuyAmount?: number;
  institutionNetBuyAmount?: number;
  programNetBuyAmount?: number;
  nonProgramNetBuyAmount?: number;
  programFlow?: ProgramFlowDiagnostic;
  programFlowDryRun: ProgramFlowDryRunDiagnostic;
  activeFlow: string;
  passiveFlow: string;
  activePassiveConfluence: ActivePassiveConfluence;
  programMissingAsBearish: false;
  fetchedAt?: string;
  rawStatus?: string;
  semanticRowAvailable: boolean;
  rawInvestorRowAvailable: boolean;
  selectedCandidateCarriesSemanticRow: boolean;
  selectedCandidateCarriesActualRow: boolean;
}

export interface NormalSupplySignalSourceSplit {
  bullishFromMarketSignal: number;
  bullishFromProviderIssue: number;
  accumulatingFromMarketSignal: number;
  accumulatingFromProviderIssue: number;
  bearishFromMarketSignal: number;
  bearishFromProviderIssue: number;
  neutralFromVerifiedData: number;
  unusableFromDataQuality: number;
}

export interface NormalSupplyFieldAvailability {
  total: number;
  foreignNetBuyField: number;
  institutionNetBuyField: number;
  programNetBuyField: number;
  stockProgramNetBuyField: number;
  stockProgramAvailable: number;
  marketProgramAvailable: boolean;
  marketProgramSignal: ProgramFlowSignal;
  marketProgramSource: ProgramFlowSourceProvider;
  missingProgramFlowAsBearish: false;
  marketProgramProviderIssue: boolean;
  marketProgramMarketSignal: boolean;
  programPenaltyApplied: false;
  programFlowUsedForLiveDecision: false;
  passiveProxyUsedForLiveDecision: false;
  executionImpact: 'NONE';
  semanticRowAvailable: number;
  rawInvestorRowAvailable: number;
  selectedCandidateCarriesSemanticRow: number;
  selectedCandidateCarriesActualRow: number;
}

export type ActivePassiveConfluenceCounts = Record<ActivePassiveConfluence, number>;

export interface ProgramFlowDiagnosticsSummary {
  stockProgramRowsAvailable: number;
  total: number;
  marketProgramAvailable: boolean;
  marketProgramSignal: ProgramFlowSignal;
  marketProgramSource: ProgramFlowSourceProvider;
  marketProgramProviderIssue: boolean;
  marketProgramMarketSignal: boolean;
  reason: string;
  programMissingAsBearish: false;
  programPenaltyApplied: false;
  programFlowUsedForLiveDecision: false;
  providerCallsAdded: 0;
  passiveProxyUsedForLiveDecision: false;
  nextAction: 'WIRE_STOCK_AND_MARKET_PROGRAM_FLOW_FIELDS' | 'OBSERVE_PROGRAM_FLOW_PROXY';
  executionImpact: 'NONE';
}

export interface NormalSupplyPreviewSafety {
  providerIssueAsBearish: false;
  unknownPenaltyApplied: false;
  staleAsBearish: false;
  missingAsBearish: false;
  realOrderAllowed: false;
  accumulatingUsedForLiveDecision: false;
  accumulatingAllowsStrongBuy: false;
  accumulatingAllowsWatchlistBoost: true;
  accumulatingAllowsShadowTracking: true;
}

export interface NormalSupplyPreview {
  capturedAt: string;
  engineMode: NormalSupplyPreviewEngineMode;
  previewMode: NormalSupplyPreviewMode;
  source: 'PREFLIGHT_ABORT_DIAGNOSTIC' | 'RUNTIME_DIAGNOSTIC' | 'COMMAND';
  reason?: string;
  preflightDecision?: string;
  liveExecutionAllowed: false;
  realOrderAllowed: false;
  strongBuyAllowed: false;
  shadowObservableAllowed: true;
  executionImpact: 'NONE';
  candidateCount: number;
  supplyInjection: PerSymbolSupplyInjectionStats;
  healthCounts: Record<SupplyProviderHealth, number>;
  signalCounts: Record<SupplySignal, number>;
  candidates: NormalSupplyPreviewCandidate[];
  topCandidates: NormalSupplyPreviewCandidate[];
  signalSourceSplit: NormalSupplySignalSourceSplit;
  fieldAvailability: NormalSupplyFieldAvailability;
  activePassiveConfluenceCounts: ActivePassiveConfluenceCounts;
  programFlowDiagnostics: ProgramFlowDiagnosticsSummary;
  safety: NormalSupplyPreviewSafety;
}

export interface PersistNormalSupplyPreviewInput<T extends CandidateWithSupplyContext = CandidateWithSupplyContext> {
  engineMode: NormalSupplyPreviewEngineMode;
  source: NormalSupplyPreview['source'];
  candidates: T[];
  supplyInjection?: PerSymbolSupplyInjectionStats;
  reason?: string;
  preflightDecision?: string;
  capturedAt?: string;
  topN?: number;
  marketProgramFlow?: unknown;
}

let lastNormalSupplyPreview: NormalSupplyPreview | null = null;

export function persistNormalSupplyPreview<T extends CandidateWithSupplyContext>(
  input: PersistNormalSupplyPreviewInput<T>,
): NormalSupplyPreview {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  console.info(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_FLOW_WIRING_START] ` +
      `candidateCount=${input.candidates.length} previewMode=${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE} ` +
      `providerCallsAdded=0 executionImpact=NONE`,
  );
  const marketProgramFlow = normalizeMarketProgramFlow(input.marketProgramFlow);
  const previewCandidates = input.candidates
    .map((candidate) => toPreviewCandidate(candidate, marketProgramFlow))
    .filter((candidate): candidate is NormalSupplyPreviewCandidate => candidate !== null);
  const healthCounts = countHealth(previewCandidates);
  const signalCounts = countSignals(previewCandidates);
  const supplyInjection = input.supplyInjection ?? buildSupplyInjectionFromCandidates(previewCandidates);
  const signalSourceSplit = buildSignalSourceSplit(previewCandidates);
  const fieldAvailability = buildFieldAvailability(previewCandidates);
  const topCandidates = [...previewCandidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, input.topN ?? 5);
  const activePassiveConfluenceCounts = buildActivePassiveConfluenceCounts(previewCandidates);
  const programFlowDiagnostics = buildProgramFlowDiagnostics(previewCandidates, marketProgramFlow);

  lastNormalSupplyPreview = {
    capturedAt,
    engineMode: input.engineMode,
    previewMode: NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE,
    source: input.source,
    reason: input.reason,
    preflightDecision: input.preflightDecision,
    liveExecutionAllowed: false,
    realOrderAllowed: false,
    strongBuyAllowed: false,
    shadowObservableAllowed: true,
    executionImpact: 'NONE',
    candidateCount: previewCandidates.length,
    supplyInjection,
    healthCounts,
    signalCounts,
    candidates: previewCandidates,
    topCandidates,
    signalSourceSplit,
    fieldAvailability,
    activePassiveConfluenceCounts,
    programFlowDiagnostics,
    safety: {
      providerIssueAsBearish: false,
      unknownPenaltyApplied: false,
      staleAsBearish: false,
      missingAsBearish: false,
      realOrderAllowed: false,
      accumulatingUsedForLiveDecision: false,
      accumulatingAllowsStrongBuy: false,
      accumulatingAllowsWatchlistBoost: true,
      accumulatingAllowsShadowTracking: true,
    },
  };
  logSupplySignalTierRefinement(lastNormalSupplyPreview);
  logProgramFlowDiagnostics(lastNormalSupplyPreview);
  return lastNormalSupplyPreview;
}

export function getLastNormalSupplyPreview(): NormalSupplyPreview | null {
  return lastNormalSupplyPreview;
}

function logSupplySignalTierRefinement(preview: NormalSupplyPreview): void {
  console.info(
    `[SUPPLY_SIGNAL_TIER_REFINEMENT] ` +
      `candidateCount=${preview.candidateCount} bullish=${preview.signalCounts.BULLISH} ` +
      `accumulating=${preview.signalCounts.ACCUMULATING} neutral=${preview.signalCounts.NEUTRAL} ` +
      `bearish=${preview.signalCounts.BEARISH} unusable=${preview.signalCounts.UNUSABLE} ` +
      `accumulatingUsedForLiveDecision=false executionImpact=NONE`,
  );
  for (const candidate of preview.candidates) {
    if (candidate.supplySignal !== 'ACCUMULATING') continue;
    console.info(
      `[SUPPLY_ACCUMULATING_DETECTED] ` +
        `symbol=${candidate.symbol} name=${candidate.name ?? 'n/a'} supplyScore=${candidate.supplyScore} ` +
        `foreignNetBuy=${candidate.foreignNetBuyAmount ?? 'N/A'} ` +
        `institutionNetBuy=${candidate.institutionNetBuyAmount ?? 'N/A'} ` +
        `reason=FOREIGN_AND_INSTITUTION_NET_BUY_BUT_BELOW_BULLISH_THRESHOLD ` +
        `usedForLiveDecision=false shadowTracking=true executionImpact=NONE`,
    );
  }
}

const CONFLUENCE_LABELS: ActivePassiveConfluence[] = [
  'ACTIVE_PASSIVE_CONFIRMED_BUY',
  'ACTIVE_BUYING_ONLY',
  'PASSIVE_BUYING_ONLY',
  'ACTIVE_PASSIVE_CONFIRMED_SELL',
  'ACTIVE_SELLING_ONLY',
  'PASSIVE_SELLING_ONLY',
  'MIXED_FLOW',
  'NEUTRAL_FLOW',
  'PROGRAM_FLOW_UNAVAILABLE',
];

const PROGRAM_FLOW_NOT_AVAILABLE_STOCK: ProgramFlowDiagnostic['stockLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};

const PROGRAM_FLOW_NOT_AVAILABLE_MARKET: ProgramFlowDiagnostic['marketLevel'] = {
  available: false,
  signal: 'UNAVAILABLE',
  sourceProvider: 'NONE',
  providerIssue: false,
  marketSignal: false,
  reason: 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
  diagnosticOnly: true,
  executionImpact: 'NONE',
};

function logProgramFlowDiagnostics(preview: NormalSupplyPreview): void {
  const stockProgramAvailable = preview.fieldAvailability.stockProgramAvailable;
  const marketProgramAvailable = preview.fieldAvailability.marketProgramAvailable;
  console.info(
    `[NORMAL_SUPPLY_PREVIEW_PROGRAM_FLOW_WIRING_DONE] ` +
      `candidateCount=${preview.candidateCount} stockProgramAvailable=${stockProgramAvailable} ` +
      `marketProgramAvailable=${marketProgramAvailable} marketProgramSignal=${preview.fieldAvailability.marketProgramSignal} ` +
      `activePassiveConfluenceComputed=true programMissingAsBearish=false programPenaltyApplied=false ` +
      `passiveProxyUsedForLiveDecision=false providerCallsAdded=0 executionImpact=NONE`,
  );
  const contamination = preview.candidates.filter((candidate) =>
    candidate.programFlow?.stockLevel.available === false && candidate.supplySignal === 'BEARISH' && !candidate.marketSignal,
  ).length;
  if (contamination > 0) {
    console.warn(
      `[NORMAL_SUPPLY_PREVIEW_PROGRAM_FLOW_CONTAMINATION] ` +
        `reason=PROGRAM_MISSING_WAS_TREATED_AS_BEARISH affected=${contamination} executionImpact=NONE severity=warn`,
    );
  }
}

function buildActivePassiveConfluenceCounts(candidates: NormalSupplyPreviewCandidate[]): ActivePassiveConfluenceCounts {
  const counts = Object.fromEntries(CONFLUENCE_LABELS.map((label) => [label, 0])) as ActivePassiveConfluenceCounts;
  for (const candidate of candidates) counts[candidate.activePassiveConfluence] += 1;
  return counts;
}

function buildProgramFlowDiagnostics(
  candidates: NormalSupplyPreviewCandidate[],
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
): ProgramFlowDiagnosticsSummary {
  const stockProgramRowsAvailable = candidates.filter((candidate) => candidate.programFlow?.stockLevel.available).length;
  const marketProgramAvailable = marketProgramFlow.available;
  let reason = 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE';
  if (marketProgramFlow.providerIssue) reason = 'PROGRAM_PROVIDER_ISSUE_DIAGNOSTIC_ONLY';
  else if (marketProgramAvailable && stockProgramRowsAvailable === 0) reason = 'STOCK_PROGRAM_FLOW_MISSING_MARKET_PROGRAM_AVAILABLE';
  else if (!marketProgramAvailable && stockProgramRowsAvailable > 0) reason = 'STOCK_PROGRAM_AVAILABLE_MARKET_PROGRAM_MISSING';
  else if (marketProgramAvailable && stockProgramRowsAvailable > 0) reason = 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY';
  return {
    stockProgramRowsAvailable,
    total: candidates.length,
    marketProgramAvailable,
    marketProgramSignal: marketProgramFlow.signal,
    marketProgramSource: marketProgramFlow.sourceProvider ?? 'NONE',
    marketProgramProviderIssue: marketProgramFlow.providerIssue,
    marketProgramMarketSignal: marketProgramFlow.marketSignal,
    reason,
    programMissingAsBearish: false,
    programPenaltyApplied: false,
    programFlowUsedForLiveDecision: false,
    providerCallsAdded: 0,
    passiveProxyUsedForLiveDecision: false,
    nextAction: reason === 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY'
      ? 'OBSERVE_PROGRAM_FLOW_PROXY'
      : 'WIRE_STOCK_AND_MARKET_PROGRAM_FLOW_FIELDS',
    executionImpact: 'NONE',
  };
}

export function deriveNormalSupplyPreviewEngineMode(input: {
  sellOnly?: boolean;
  blockedBy?: string;
  preflightDecision?: string;
  macroGateState?: {
    regime?: string;
    sellOnlyMode?: boolean;
    diagnosticLiveEntryBlocked?: boolean;
    liveEntryBlockedReason?: string;
    bearDefenseMode?: boolean;
    vixGatingActive?: boolean;
    fomcPhase?: string;
  } | null;
  liveEntryBlockedReason?: string;
}): NormalSupplyPreviewEngineMode {
  const decision = `${input.preflightDecision ?? ''} ${input.blockedBy ?? ''}`.toUpperCase();
  const liveBlockReason = `${input.liveEntryBlockedReason ?? input.macroGateState?.liveEntryBlockedReason ?? ''}`.toUpperCase();
  const macroRegime = `${input.macroGateState?.regime ?? ''}`.toUpperCase();
  const regimeDiagnosticLiveBlocked =
    input.macroGateState?.diagnosticLiveEntryBlocked === true &&
    (macroRegime === 'R4_NEUTRAL' || macroRegime === 'R5_CAUTION');
  if (input.sellOnly || input.macroGateState?.sellOnlyMode || decision.includes('SELL_ONLY')) return 'SELL_ONLY';
  if (decision.includes('POSITION_FULL') || liveBlockReason.includes('POSITION_FULL')) return 'POSITION_FULL';
  if (
    liveBlockReason.includes('R4_NEUTRAL') ||
    liveBlockReason.includes('R5_CAUTION') ||
    liveBlockReason.includes('R6_DEFENSE') ||
    liveBlockReason.includes('VIX_BLOCK') ||
    liveBlockReason.includes('FOMC_BLOCK') ||
    regimeDiagnosticLiveBlocked ||
    input.macroGateState?.bearDefenseMode ||
    input.macroGateState?.vixGatingActive ||
    input.macroGateState?.fomcPhase === 'DAY'
  ) {
    return 'MACRO_LIVE_BLOCK';
  }
  if (decision.includes('HARD_BLOCK')) return 'HARD_BLOCK';
  if (decision.trim().length > 0) return 'PRE_FLIGHT_BLOCK';
  return 'NORMAL';
}

export function formatNormalSupplyPreviewSection(
  preview: NormalSupplyPreview | null | undefined,
  options: { maxTopCandidates?: number } = {},
): string | null {
  if (!preview) return null;
  const maxTop = options.maxTopCandidates ?? 5;
  const lines: string[] = [];
  lines.push('🧪 <b>Normal Supply Preview under SELL_ONLY (ADR-0518)</b>');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`mode: ${preview.engineMode}`);
  lines.push(`previewMode: ${preview.previewMode}`);
  lines.push(`source: ${preview.source}`);
  if (preview.reason) lines.push(`reason: ${preview.reason}`);
  if (preview.preflightDecision) lines.push(`preflightDecision: ${preview.preflightDecision}`);
  lines.push(`liveExecutionAllowed: ${preview.liveExecutionAllowed}`);
  lines.push(`realOrderAllowed: ${preview.realOrderAllowed}`);
  lines.push(`strongBuyAllowed: ${preview.strongBuyAllowed}`);
  lines.push(`shadowObservableAllowed: ${preview.shadowObservableAllowed}`);
  lines.push(`executionImpact: ${preview.executionImpact}`);
  lines.push('');
  lines.push(`정상모드 기준 후보 수: ${preview.candidateCount}`);
  lines.push('수급 주입 상태:');
  lines.push(`  VERIFIED: ${preview.healthCounts.VERIFIED}`);
  lines.push(`  DEGRADED: ${preview.healthCounts.DEGRADED}`);
  lines.push(`  STALE: ${preview.healthCounts.STALE}`);
  lines.push(`  MISSING: ${preview.healthCounts.MISSING}`);
  lines.push(`  UNKNOWN: ${preview.healthCounts.UNKNOWN}`);
  lines.push(`  routerConnected: ${preview.supplyInjection.routerConnected}`);
  lines.push(`  gateContextConnected: ${preview.supplyInjection.gateContextConnected}`);
  lines.push('');
  lines.push('정상모드 기준 수급 판정:');
  lines.push(`  BULLISH: ${preview.signalCounts.BULLISH}`);
  lines.push(`  ACCUMULATING: ${preview.signalCounts.ACCUMULATING}`);
  lines.push(`  NEUTRAL: ${preview.signalCounts.NEUTRAL}`);
  lines.push(`  BEARISH: ${preview.signalCounts.BEARISH}`);
  lines.push(`  UNUSABLE: ${preview.signalCounts.UNUSABLE}`);
  lines.push('');
  lines.push('상위 수급 후보:');
  if (preview.topCandidates.length === 0) {
    lines.push('  none');
  } else {
    preview.topCandidates.slice(0, maxTop).forEach((candidate, index) => {
      const name = candidate.name ? ` ${candidate.name}` : '';
      lines.push(
        `${index + 1}. ${candidate.symbol}${name} / ${candidate.summary} / supplyScore ${candidate.supplyScore}`,
      );
    });
  }
  lines.push('');
  lines.push('주의:');
  lines.push('SELL_ONLY 또는 macro live block 상태에서는 신규 매수는 차단됩니다.');
  lines.push('본 결과는 정상모드 기준 수급 진단이며 주문 영향 없습니다.');
  return lines.join('\n');
}

export function formatNormalSupplyPreviewFullSections(
  preview: NormalSupplyPreview | null | undefined,
  options: { maxTopCandidates?: number; maxChars?: number } = {},
): string[] {
  if (!preview) return [formatNormalSupplyPreviewMissingSection()];
  const sections = buildNormalSupplyPreviewFullSections(preview, options);
  return paginateNormalSupplyPreviewSections(sections, options.maxChars ?? 3500);
}

export function buildNormalSupplyPreviewFullSections(
  preview: NormalSupplyPreview,
  options: { maxTopCandidates?: number } = {},
): string[] {
  const thresholds = NORMAL_SUPPLY_SCORE_THRESHOLDS;
  const top = preview.topCandidates[0];
  const contamination =
    preview.signalSourceSplit.bearishFromProviderIssue +
    preview.signalSourceSplit.bullishFromProviderIssue +
    preview.signalSourceSplit.accumulatingFromProviderIssue;
  const sections: string[] = [];

  sections.push([
    '🧪 <b>Normal Supply Preview FULL under SELL_ONLY (ADR-0518)</b>',
    '━━━━━━━━━━━━━━━━',
    `mode: ${escapeHtmlText(preview.engineMode)}`,
    `previewMode: ${NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE}`,
    `source: ${escapeHtmlText(preview.source)}`,
    preview.reason ? `reason: ${escapeHtmlText(preview.reason)}` : '',
    preview.preflightDecision ? `preflightDecision: ${escapeHtmlText(preview.preflightDecision)}` : '',
    `liveExecutionAllowed=${preview.liveExecutionAllowed}`,
    `realOrderAllowed=${preview.realOrderAllowed}`,
    `strongBuyAllowed=${preview.strongBuyAllowed}`,
    `shadowObservableAllowed=${preview.shadowObservableAllowed}`,
    `executionImpact=${preview.executionImpact}`,
    '',
    `candidateCount=${preview.candidateCount}`,
    `routerConnected=${preview.supplyInjection.routerConnected}`,
    `gateContextConnected=${preview.supplyInjection.gateContextConnected}`,
    '',
    'Injection:',
    `  VERIFIED=${preview.healthCounts.VERIFIED}`,
    `  DEGRADED=${preview.healthCounts.DEGRADED}`,
    `  STALE=${preview.healthCounts.STALE}`,
    `  MISSING=${preview.healthCounts.MISSING}`,
    `  UNKNOWN=${preview.healthCounts.UNKNOWN}`,
    '',
    'Signal:',
    `  BULLISH=${preview.signalCounts.BULLISH}`,
    `  ACCUMULATING=${preview.signalCounts.ACCUMULATING}`,
    `  NEUTRAL=${preview.signalCounts.NEUTRAL}`,
    `  BEARISH=${preview.signalCounts.BEARISH}`,
    `  UNUSABLE=${preview.signalCounts.UNUSABLE}`,
    '',
    'Safety:',
    `  providerIssueAsBearish=${preview.safety.providerIssueAsBearish}`,
    `  unknownPenaltyApplied=${preview.safety.unknownPenaltyApplied}`,
    `  staleAsBearish=${preview.safety.staleAsBearish}`,
    `  missingAsBearish=${preview.safety.missingAsBearish}`,
    `  realOrderAllowed=${preview.safety.realOrderAllowed}`,
    `  accumulatingUsedForLiveDecision=${preview.safety.accumulatingUsedForLiveDecision}`,
    `  accumulatingAllowsStrongBuy=${preview.safety.accumulatingAllowsStrongBuy}`,
    `  accumulatingAllowsWatchlistBoost=${preview.safety.accumulatingAllowsWatchlistBoost}`,
    `  accumulatingAllowsShadowTracking=${preview.safety.accumulatingAllowsShadowTracking}`,
    `  executionImpact=${preview.executionImpact}`,
    contamination > 0 ? `  warning=PROVIDER_SIGNAL_CONTAMINATION count=${contamination}` : '',
    '',
    '📐 <b>Supply Score Threshold</b>',
    `  bullishThreshold: ${thresholds.bullishThreshold}`,
    `  accumulatingRange: ${thresholds.accumulatingThreshold}~${thresholds.bullishThreshold - 1}`,
    `  bearishThreshold: ${thresholds.bearishThreshold}`,
    `  neutralRange: ${thresholds.bearishThreshold}~${thresholds.accumulatingThreshold - 1}`,
    `  topSupplyScore: ${top?.supplyScore ?? 'N/A'}`,
    `  topSignal: ${top?.supplySignal ?? 'N/A'}`,
    `  explanation: ${escapeHtmlText(buildThresholdExplanation(top))}`,
    '',
    '📊 <b>Program Passive Proxy Availability</b> (Program Flow Availability)',
    formatAvailabilityLine('stockProgramNetBuyField', preview.fieldAvailability.stockProgramNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramAvailable', preview.fieldAvailability.stockProgramAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('programNetBuyField', preview.fieldAvailability.programNetBuyField, preview.fieldAvailability.total),
    `  marketProgramAvailable: ${preview.fieldAvailability.marketProgramAvailable}`,
    `  marketProgramSignal: ${preview.fieldAvailability.marketProgramSignal}`,
    `  marketProgramSource: ${preview.fieldAvailability.marketProgramSource}`,
    `  marketProgramProviderIssue: ${preview.fieldAvailability.marketProgramProviderIssue}`,
    `  marketProgramMarketSignal: ${preview.fieldAvailability.marketProgramMarketSignal}`,
    `  missingProgramFlowAsBearish=${preview.fieldAvailability.missingProgramFlowAsBearish}`,
    `  programPenaltyApplied=${preview.fieldAvailability.programPenaltyApplied}`,
    `  programFlowUsedForLiveDecision=${preview.fieldAvailability.programFlowUsedForLiveDecision}`,
    `  passiveProxyUsedForLiveDecision=${preview.fieldAvailability.passiveProxyUsedForLiveDecision}`,
    `  executionImpact=${preview.fieldAvailability.executionImpact}`,
    '',
    '🔀 <b>Active/Passive Proxy Confluence</b> (Active/Passive Confluence)',
    ...CONFLUENCE_LABELS.map((label) => `  ${label}: ${preview.activePassiveConfluenceCounts[label]}`),
    '',
    '📊 <b>Signal Source Split</b>',
    `  bullishFromMarketSignal: ${preview.signalSourceSplit.bullishFromMarketSignal}`,
    `  bullishFromProviderIssue: ${preview.signalSourceSplit.bullishFromProviderIssue}`,
    `  accumulatingFromMarketSignal: ${preview.signalSourceSplit.accumulatingFromMarketSignal}`,
    `  accumulatingFromProviderIssue: ${preview.signalSourceSplit.accumulatingFromProviderIssue}`,
    `  bearishFromMarketSignal: ${preview.signalSourceSplit.bearishFromMarketSignal}`,
    `  bearishFromProviderIssue: ${preview.signalSourceSplit.bearishFromProviderIssue}`,
    `  neutralFromVerifiedData: ${preview.signalSourceSplit.neutralFromVerifiedData}`,
    `  unusableFromDataQuality: ${preview.signalSourceSplit.unusableFromDataQuality}`,
    '  note: providerIssue is not a directional market signal.',
  ].filter(Boolean).join('\n'));

  const maxTop = options.maxTopCandidates ?? 10;
  const topCandidates = [...preview.candidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, maxTop);
  sections.push([
    '📈 <b>Top Supply Candidates</b>',
    topCandidates.length === 0 ? 'none' : topCandidates.map((candidate, index) =>
      formatFullCandidateDetail(candidate, index + 1, {
        includeThreshold: true,
        includeInvalidWarning: true,
      }),
    ).join('\n\n'),
  ].join('\n'));

  const bearish = preview.candidates
    .filter((candidate) => candidate.supplySignal === 'BEARISH')
    .sort((a, b) => a.supplyScore - b.supplyScore || a.symbol.localeCompare(b.symbol));
  sections.push([
    `📉 <b>BEARISH Supply Candidates ${bearish.length}</b>`,
    bearish.length === 0 ? 'none' : bearish.map((candidate, index) =>
      formatFullCandidateDetail(candidate, index + 1, {
        includeThreshold: false,
        includeInvalidWarning: true,
      }),
    ).join('\n\n'),
  ].join('\n'));

  const unknownOrUnusable = preview.candidates
    .filter((candidate) =>
      candidate.supplySignal === 'UNUSABLE' ||
      candidate.supplyProviderHealth === 'UNKNOWN' ||
      candidate.supplyProviderHealth === 'MISSING' ||
      candidate.supplyProviderHealth === 'STALE',
    )
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  sections.push([
    '🔌 <b>Supply Field Availability</b>',
    formatAvailabilityLine('foreignNetBuyField', preview.fieldAvailability.foreignNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('institutionNetBuyField', preview.fieldAvailability.institutionNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('programNetBuyField', preview.fieldAvailability.programNetBuyField, preview.fieldAvailability.total),
    formatAvailabilityLine('stockProgramAvailable', preview.fieldAvailability.stockProgramAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('semanticRowAvailable', preview.fieldAvailability.semanticRowAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('rawInvestorRowAvailable', preview.fieldAvailability.rawInvestorRowAvailable, preview.fieldAvailability.total),
    formatAvailabilityLine('selectedCandidateCarriesSemanticRow', preview.fieldAvailability.selectedCandidateCarriesSemanticRow, preview.fieldAvailability.total),
    formatAvailabilityLine('selectedCandidateCarriesActualRow', preview.fieldAvailability.selectedCandidateCarriesActualRow, preview.fieldAvailability.total),
    '',
    '⚪ <b>UNUSABLE / UNKNOWN Supply Rows</b>',
    `count=${unknownOrUnusable.length}`,
    unknownOrUnusable.length === 0 ? '' : unknownOrUnusable.map((candidate, index) =>
      formatUnknownCandidateDetail(candidate, index + 1),
    ).join('\n\n'),
    '',
    'Diagnostics:',
    '  usedForLiveDecision=false',
    '  penaltyApplied=false',
    '  unknownPenaltyApplied=false',
    '  providerCallsAdded=0',
    '  executionImpact=NONE',
  ].filter((line) => line !== '').join('\n'));

  sections.push([
    '⚪ <b>Program Passive Proxy Diagnostics</b> (Program Flow Diagnostics)',
    formatAvailabilityLine('stockProgramRowsAvailable', preview.programFlowDiagnostics.stockProgramRowsAvailable, preview.programFlowDiagnostics.total),
    `  marketProgramAvailable: ${preview.programFlowDiagnostics.marketProgramAvailable}`,
    `  marketProgramSignal: ${preview.programFlowDiagnostics.marketProgramSignal}`,
    `  marketProgramSource: ${preview.programFlowDiagnostics.marketProgramSource}`,
    `  marketProgramProviderIssue: ${preview.programFlowDiagnostics.marketProgramProviderIssue}`,
    `  marketProgramMarketSignal: ${preview.programFlowDiagnostics.marketProgramMarketSignal}`,
    `  reason: ${preview.programFlowDiagnostics.reason}`,
    `  programMissingAsBearish=${preview.programFlowDiagnostics.programMissingAsBearish}`,
    `  programPenaltyApplied=${preview.programFlowDiagnostics.programPenaltyApplied}`,
    `  programFlowUsedForLiveDecision=${preview.programFlowDiagnostics.programFlowUsedForLiveDecision}`,
    `  passiveProxyUsedForLiveDecision=${preview.programFlowDiagnostics.passiveProxyUsedForLiveDecision}`,
    `  providerCallsAdded=${preview.programFlowDiagnostics.providerCallsAdded}`,
    `  nextAction: ${preview.programFlowDiagnostics.nextAction}`,
    `  executionImpact=${preview.programFlowDiagnostics.executionImpact}`,
  ].join('\n'));

  return sections;
}

function paginateNormalSupplyPreviewSections(sections: string[], maxChars: number): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  const pushCurrent = () => {
    if (current.length === 0) return;
    pages.push(current.join('\n\n'));
    current = [];
    currentLength = 0;
  };

  for (const section of sections.flatMap((item) => splitOversizedSectionByLine(item, maxChars))) {
    const nextLength = currentLength + (current.length > 0 ? 2 : 0) + section.length;
    if (current.length > 0 && nextLength > maxChars) pushCurrent();
    current.push(section);
    currentLength += (current.length > 1 ? 2 : 0) + section.length;
  }
  pushCurrent();

  const total = Math.max(1, pages.length);
  return pages.map((body, index) => [
    `🔬 [normal_supply_preview full mode] Page ${index + 1}/${total}`,
    '━━━━━━━━━━━━━━━━',
    body,
  ].join('\n'));
}

function splitOversizedSectionByLine(section: string, maxChars: number): string[] {
  if (section.length <= maxChars) return [section];
  const blocks = section.split('\n\n');
  if (blocks.length > 1) return splitOversizedSectionByBlock(blocks, maxChars);
  const chunks: string[] = [];
  let lines: string[] = [];
  let length = 0;
  for (const line of section.split('\n')) {
    const nextLength = length + (lines.length > 0 ? 1 : 0) + line.length;
    if (lines.length > 0 && nextLength > maxChars) {
      chunks.push(lines.join('\n'));
      lines = [];
      length = 0;
    }
    if (line.length > maxChars) {
      if (lines.length > 0) {
        chunks.push(lines.join('\n'));
        lines = [];
        length = 0;
      }
      chunks.push(...splitLongLine(line, maxChars));
      continue;
    }
    lines.push(line);
    length += (lines.length > 1 ? 1 : 0) + line.length;
  }
  if (lines.length > 0) chunks.push(lines.join('\n'));
  return chunks;
}

function splitOversizedSectionByBlock(blocks: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join('\n\n'));
    current = [];
    length = 0;
  };
  for (const block of blocks) {
    if (block.length > maxChars) {
      flush();
      chunks.push(...splitOversizedSectionByLine(block, maxChars));
      continue;
    }
    const nextLength = length + (current.length > 0 ? 2 : 0) + block.length;
    if (current.length > 0 && nextLength > maxChars) flush();
    current.push(block);
    length += (current.length > 1 ? 2 : 0) + block.length;
  }
  flush();
  return chunks;
}

function splitLongLine(line: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxChars) {
    chunks.push(line.slice(index, index + maxChars));
  }
  return chunks;
}

export function formatNormalSupplyPreviewMissingSection(error?: string): string {
  return [
    '🧪 <b>Normal Supply Preview under SELL_ONLY (ADR-0518)</b>',
    '━━━━━━━━━━━━━━━━',
    'status: NOT_COLLECTED',
    `previewMode: ${NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE}`,
    'liveExecutionAllowed: false',
    'realOrderAllowed: false',
    'shadowObservableAllowed: true',
    'executionImpact: NONE',
    ...(error ? [`error: ${error}`] : []),
    'nextAction: run /normal_supply_preview or wait for next diagnostic scan',
  ].join('\n');
}

export function __resetNormalSupplyPreviewForTests(): void {
  lastNormalSupplyPreview = null;
}

function toPreviewCandidate(
  candidate: CandidateWithSupplyContext,
  marketProgramFlow: ProgramFlowDiagnostic['marketLevel'],
): NormalSupplyPreviewCandidate | null {
  const symbol = normalizePreviewSymbol(candidate.symbol ?? candidate.code);
  if (!symbol) return null;
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  const supplyContext = ctx ?? buildMissingContext(symbol);
  const trace = candidate.supplyProviderHealth ?? {};
  const health = normalizeHealth(supplyContext.supplyProviderHealth);
  const providerIssue = supplyContext.providerIssue === true;
  const marketSignal = supplyContext.marketSignal === true;
  const supplyScore = deriveSupplyScore(supplyContext);
  const signal = classifySupplySignal({
    supplyScore,
    dataStatus: health,
    providerIssue,
    marketSignal,
    foreignNetBuy: supplyContext.foreignNetBuyAmount,
    institutionNetBuy: supplyContext.institutionNetBuyAmount,
  });
  const stockProgramFlow = extractStockProgramFlow(candidate, supplyContext);
  const programFlow: ProgramFlowDiagnostic = { stockLevel: stockProgramFlow, marketLevel: marketProgramFlow };
  const passiveProxySignal = selectPassiveProxySignal(stockProgramFlow, marketProgramFlow);
  const activePassiveConfluence = classifyActivePassiveConfluence({
    foreignNetBuy: supplyContext.foreignNetBuyAmount,
    institutionNetBuy: supplyContext.institutionNetBuyAmount,
    passiveProxySignal,
  });
  const reason = describeSupplyReason(supplyContext, signal, supplyScore);
  return {
    symbol,
    name: typeof (candidate as { name?: unknown }).name === 'string' ? (candidate as { name: string }).name : undefined,
    sourceProvider: supplyContext.provider,
    dataStatus: health,
    confidence: deriveConfidence(supplyContext),
    supplyProviderHealth: health,
    supplySignal: signal,
    providerIssue,
    marketSignal,
    executionImpact: supplyContext.executionImpact,
    supplyScore,
    summary: summarizeSupplyContext(supplyContext),
    reason,
    ...(signal === 'BEARISH' && providerIssue
      ? { invalidBearishReason: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BEARISH' as const }
      : {}),
    ...(signal === 'BULLISH' && providerIssue
      ? { invalidBullishReason: 'PROVIDER_ISSUE_SHOULD_NOT_BE_BULLISH' as const }
      : {}),
    foreignNetBuyAmount: supplyContext.foreignNetBuyAmount,
    institutionNetBuyAmount: supplyContext.institutionNetBuyAmount,
    programNetBuyAmount: stockProgramFlow.netBuy ?? supplyContext.programNetBuyAmount,
    nonProgramNetBuyAmount: supplyContext.nonProgramNetBuyAmount,
    programFlow,
    programFlowDryRun: {
      currentSupplyScore: supplyScore,
      reason: stockProgramFlow.available ? 'PROGRAM_FLOW_DIAGNOSTIC_ONLY' : 'PROGRAM_FLOW_UNAVAILABLE',
      appliedToLiveScore: false,
      diagnosticOnly: true,
      executionImpact: 'NONE',
    },
    activeFlow: describeActiveFlow(supplyContext.foreignNetBuyAmount, supplyContext.institutionNetBuyAmount),
    passiveFlow: describeProgramSignal(passiveProxySignal),
    activePassiveConfluence,
    programMissingAsBearish: false,
    fetchedAt: supplyContext.fetchedAt,
    rawStatus: supplyContext.rawStatus,
    semanticRowAvailable: hasSemanticRow(trace, health),
    rawInvestorRowAvailable: hasRawInvestorRow(trace, health),
    selectedCandidateCarriesSemanticRow: selectedCarriesSemanticRow(trace, health),
    selectedCandidateCarriesActualRow: selectedCarriesActualRow(trace, health),
    usedForLiveDecision: false,
    strongBuyAllowed: false,
    watchlistPriorityBoost: signal === 'ACCUMULATING' ? 1 : 0,
    shadowTracking: signal === 'ACCUMULATING',
  };
}

function normalizePreviewSymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

function buildMissingContext(symbol: string): PerSymbolSupplyContext {
  return {
    symbol,
    provider: 'NONE',
    supplyProviderHealth: 'MISSING',
    supplySignal: 'UNUSABLE',
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'SCORE_CONFIDENCE_DOWN_ONLY',
    rawStatus: 'SUPPLY_CONTEXT_NOT_INJECTED',
  };
}

function normalizeHealth(value: unknown): SupplyProviderHealth {
  if (value === 'VERIFIED' || value === 'DEGRADED' || value === 'STALE' || value === 'MISSING') return value;
  return 'UNKNOWN';
}

function normalizeSignal(value: unknown): SupplySignal {
  if (
    value === 'BULLISH' ||
    value === 'ACCUMULATING' ||
    value === 'NEUTRAL' ||
    value === 'BEARISH' ||
    value === 'UNUSABLE'
  ) {
    return value;
  }
  return 'UNUSABLE';
}

export function classifySupplySignal(input: {
  supplyScore: number;
  dataStatus: SupplyProviderHealth;
  providerIssue: boolean;
  marketSignal: boolean;
  foreignNetBuy?: number | null;
  institutionNetBuy?: number | null;
}): SupplySignal {
  const {
    supplyScore,
    dataStatus,
    providerIssue,
    marketSignal,
    foreignNetBuy,
    institutionNetBuy,
  } = input;

  if (dataStatus !== 'VERIFIED') return 'UNUSABLE';
  if (providerIssue) return 'UNUSABLE';
  if (!marketSignal) return 'NEUTRAL';
  if (foreignNetBuy == null || institutionNetBuy == null) return 'UNUSABLE';
  if (supplyScore >= NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold) return 'BULLISH';
  if (supplyScore >= NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold) return 'ACCUMULATING';
  if (supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bearishThreshold) return 'BEARISH';
  return 'NEUTRAL';
}

function countHealth(candidates: NormalSupplyPreviewCandidate[]): Record<SupplyProviderHealth, number> {
  const counts: Record<SupplyProviderHealth, number> = {
    VERIFIED: 0,
    DEGRADED: 0,
    STALE: 0,
    MISSING: 0,
    UNKNOWN: 0,
  };
  for (const candidate of candidates) counts[candidate.supplyProviderHealth] += 1;
  return counts;
}

function countSignals(candidates: NormalSupplyPreviewCandidate[]): Record<SupplySignal, number> {
  const counts: Record<SupplySignal, number> = {
    BULLISH: 0,
    ACCUMULATING: 0,
    NEUTRAL: 0,
    BEARISH: 0,
    UNUSABLE: 0,
  };
  for (const candidate of candidates) counts[candidate.supplySignal] += 1;
  return counts;
}

function buildSignalSourceSplit(candidates: NormalSupplyPreviewCandidate[]): NormalSupplySignalSourceSplit {
  const split: NormalSupplySignalSourceSplit = {
    bullishFromMarketSignal: 0,
    bullishFromProviderIssue: 0,
    accumulatingFromMarketSignal: 0,
    accumulatingFromProviderIssue: 0,
    bearishFromMarketSignal: 0,
    bearishFromProviderIssue: 0,
    neutralFromVerifiedData: 0,
    unusableFromDataQuality: 0,
  };
  for (const candidate of candidates) {
    if (candidate.supplySignal === 'BULLISH') {
      if (candidate.providerIssue) split.bullishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bullishFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'ACCUMULATING') {
      if (candidate.providerIssue) split.accumulatingFromProviderIssue += 1;
      else if (candidate.marketSignal) split.accumulatingFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'BEARISH') {
      if (candidate.providerIssue) split.bearishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bearishFromMarketSignal += 1;
    } else if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyProviderHealth === 'VERIFIED') {
      split.neutralFromVerifiedData += 1;
    } else if (
      candidate.supplySignal === 'UNUSABLE' ||
      candidate.supplyProviderHealth === 'MISSING' ||
      candidate.supplyProviderHealth === 'STALE' ||
      candidate.supplyProviderHealth === 'UNKNOWN'
    ) {
      split.unusableFromDataQuality += 1;
    }
  }
  return split;
}

function normalizeMarketProgramFlow(value: unknown): ProgramFlowDiagnostic['marketLevel'] {
  const root = asRecord(value);
  if (!root) return { ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET };
  const records = flattenProgramRecords(root);
  const kospiNetBuy = firstNumberFromRecords(records, ['kospiNetBuy', 'kospiProgramNetBuy', 'kospiProgramNetBuyAmount']);
  const kosdaqNetBuy = firstNumberFromRecords(records, ['kosdaqNetBuy', 'kosdaqProgramNetBuy', 'kosdaqProgramNetBuyAmount']);
  const combined = firstNumberFromRecords(records, [
    'combinedNetBuy',
    'combinedProgramNetBuy',
    'marketProgramNetBuy',
    'marketProgramNetAmount',
    'programMarketNetBuy',
    'programNetBuy',
    'programNetBuyAmount',
    'programNetAmount',
    'program_net_buy',
    'program_net_amount',
  ]);
  const buyAmount = firstNumberFromRecords(records, ['programBuyAmount', 'marketProgramBuyAmount', 'buyAmount', 'programBuy']);
  const sellAmount = firstNumberFromRecords(records, ['programSellAmount', 'marketProgramSellAmount', 'sellAmount', 'programSell']);
  const providerIssue = records.some((record) => record.providerIssue === true);
  const sourceProvider = normalizeProgramSource(firstValueFromRecords(records, ['sourceProvider', 'provider', 'programSource', 'source']));
  const explicitSignal = normalizeProgramFlowSignal(firstValueFromRecords(records, ['programMarketSignal', 'marketProgramSignal', 'signal']));
  const status = stringValue(firstValueFromRecords(records, ['stockProgramStatus', 'marketProgramStatus', 'status']));
  const derivedCombined = combined
    ?? (kospiNetBuy !== undefined || kosdaqNetBuy !== undefined ? (kospiNetBuy ?? 0) + (kosdaqNetBuy ?? 0) : undefined)
    ?? (buyAmount !== undefined && sellAmount !== undefined ? buyAmount - sellAmount : undefined);
  if (derivedCombined === undefined) {
    const unavailableByStatus = status ? /UNAVAILABLE|MISSING|UNSUPPORTED|EMPTY|NONE/i.test(status) : false;
    return {
      ...PROGRAM_FLOW_NOT_AVAILABLE_MARKET,
      sourceProvider,
      providerIssue,
      marketSignal: false,
      signal: providerIssue ? 'UNKNOWN' : explicitSignal ?? (unavailableByStatus ? 'UNAVAILABLE' : 'UNAVAILABLE'),
      reason: stringValue(firstValueFromRecords(records, ['reason'])) ?? 'PROGRAM_FLOW_NOT_WIRED_OR_NOT_AVAILABLE',
    };
  }
  const signal = providerIssue ? 'UNKNOWN' : explicitSignal ?? signalFromNetBuy(derivedCombined);
  return {
    available: true,
    ...(kospiNetBuy !== undefined ? { kospiNetBuy } : {}),
    ...(kosdaqNetBuy !== undefined ? { kosdaqNetBuy } : {}),
    combinedNetBuy: derivedCombined,
    signal,
    sourceProvider,
    providerIssue,
    marketSignal: !providerIssue && signal !== 'UNKNOWN' && signal !== 'UNAVAILABLE',
    reason: 'MARKET_PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
    diagnosticOnly: true,
    executionImpact: 'NONE',
  };
}

function extractStockProgramFlow(
  candidate: CandidateWithSupplyContext,
  supplyContext: PerSymbolSupplyContext,
): ProgramFlowDiagnostic['stockLevel'] {
  const records = candidateProgramRecords(candidate, supplyContext);
  for (const record of records) {
    const buyAmount = firstNumber(record, ['programBuyAmount', 'stockProgramBuyAmount', 'programBuy', 'programBuyAmt', 'buyAmount', 'buy']);
    const sellAmount = firstNumber(record, ['programSellAmount', 'stockProgramSellAmount', 'programSell', 'programSellAmt', 'sellAmount', 'sell']);
    const netAmount = firstNumber(record, ['programNetAmount', 'stockProgramNetAmount', 'prgmNetAmount', 'program_net_amount', 'netAmount', 'programNetBuyAmount']);
    const directNetBuy = firstNumber(record, ['programNetBuy', 'stockProgramNetBuy', 'prgmNetBuy', 'program_net_buy']);
    const netBuy = buyAmount !== undefined && sellAmount !== undefined
      ? buyAmount - sellAmount
      : netAmount ?? directNetBuy;
    if (netBuy === undefined) continue;
    return {
      available: true,
      netBuy,
      ...(buyAmount !== undefined ? { buyAmount } : {}),
      ...(sellAmount !== undefined ? { sellAmount } : {}),
      ...(netAmount !== undefined ? { netAmount } : {}),
      signal: record.providerIssue === true ? 'UNKNOWN' : signalFromNetBuy(netBuy),
      sourceProvider: normalizeProgramSource(record.sourceProvider ?? record.provider ?? supplyContext.provider),
      providerIssue: Boolean(record.providerIssue),
      marketSignal: record.providerIssue !== true,
      reason: 'STOCK_PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
      diagnosticOnly: true,
      executionImpact: 'NONE',
    };
  }
  return { ...PROGRAM_FLOW_NOT_AVAILABLE_STOCK };
}

function candidateProgramRecords(candidate: CandidateWithSupplyContext, supplyContext: PerSymbolSupplyContext): Record<string, unknown>[] {
  const maybeCandidate = candidate as Record<string, unknown>;
  const records: Record<string, unknown>[] = [];
  for (const item of [
    supplyContext,
    candidate.preflight?.supplyContext,
    candidate.gateContext?.supplyContext,
    candidate.scoringContext?.supplyContext,
    candidate.supplyContext,
    maybeCandidate.programFlow,
    maybeCandidate.stockProgramFlow,
    maybeCandidate.programTrading,
    maybeCandidate.programDiagnostic,
    maybeCandidate.supplyDiagnostic,
    maybeCandidate.preflight,
    maybeCandidate.gateContext,
    maybeCandidate.scoringContext,
    maybeCandidate,
  ]) {
    const record = asRecord(item);
    if (record) records.push(record);
  }
  return records;
}

function classifyActivePassiveConfluence(input: {
  foreignNetBuy?: number;
  institutionNetBuy?: number;
  passiveProxySignal: ProgramFlowSignal;
}): ActivePassiveConfluence {
  const active = activeDirection(input.foreignNetBuy, input.institutionNetBuy);
  const passive = input.passiveProxySignal === 'BULLISH'
    ? 'BUY'
    : input.passiveProxySignal === 'BEARISH' ? 'SELL'
      : input.passiveProxySignal === 'NEUTRAL' ? 'NEUTRAL' : 'UNAVAILABLE';
  if (active === 'BUY' && passive === 'BUY') return 'ACTIVE_PASSIVE_CONFIRMED_BUY';
  if (active === 'SELL' && passive === 'SELL') return 'ACTIVE_PASSIVE_CONFIRMED_SELL';
  if (active === 'BUY' && passive === 'UNAVAILABLE') return 'ACTIVE_BUYING_ONLY';
  if (active === 'SELL' && passive === 'UNAVAILABLE') return 'ACTIVE_SELLING_ONLY';
  if (active === 'NEUTRAL' && passive === 'BUY') return 'PASSIVE_BUYING_ONLY';
  if (active === 'NEUTRAL' && passive === 'SELL') return 'PASSIVE_SELLING_ONLY';
  if ((active === 'BUY' && passive === 'SELL') || (active === 'SELL' && passive === 'BUY')) return 'MIXED_FLOW';
  if (passive === 'UNAVAILABLE') return 'PROGRAM_FLOW_UNAVAILABLE';
  return 'NEUTRAL_FLOW';
}

function activeDirection(foreign?: number, institution?: number): 'BUY' | 'SELL' | 'NEUTRAL' {
  if (foreign !== undefined && institution !== undefined && foreign > 0 && institution > 0) return 'BUY';
  if (foreign !== undefined && institution !== undefined && foreign < 0 && institution < 0) return 'SELL';
  return 'NEUTRAL';
}

function describeActiveFlow(foreign?: number, institution?: number): string {
  const active = activeDirection(foreign, institution);
  if (active === 'BUY') return '외인+기관 동반 순매수';
  if (active === 'SELL') return '외인+기관 동반 순매도';
  if ((foreign ?? 0) > 0) return '외인 순매수 우위';
  if ((institution ?? 0) > 0) return '기관 순매수 우위';
  return 'NEUTRAL_FLOW';
}

function selectPassiveProxySignal(
  stockLevel: ProgramFlowDiagnostic['stockLevel'],
  marketLevel: ProgramFlowDiagnostic['marketLevel'],
): ProgramFlowSignal {
  if (stockLevel.available && stockLevel.marketSignal) return stockLevel.signal;
  if (marketLevel.available && marketLevel.marketSignal) return marketLevel.signal;
  if (stockLevel.providerIssue || marketLevel.providerIssue) return 'UNKNOWN';
  return 'UNAVAILABLE';
}

function describeProgramSignal(signal: ProgramFlowSignal): string {
  if (signal === 'BULLISH') return 'PROGRAM_PASSIVE_PROXY_BUY';
  if (signal === 'BEARISH') return 'PROGRAM_PASSIVE_PROXY_SELL';
  if (signal === 'NEUTRAL') return 'PROGRAM_PASSIVE_PROXY_NEUTRAL';
  if (signal === 'UNKNOWN') return 'PROGRAM_FLOW_UNKNOWN';
  return 'PROGRAM_FLOW_UNAVAILABLE';
}

function signalFromNetBuy(value: number): ProgramFlowSignal {
  if (value > 0) return 'BULLISH';
  if (value < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function flattenProgramRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  const records = [record];
  for (const key of ['programTrading', 'scoring', 'diagnostic', 'summary', 'marketProgram', 'programMarket']) {
    const nested = asRecord(record[key]);
    if (nested) records.push(nested);
  }
  return records;
}

function firstValueFromRecords(records: Record<string, unknown>[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
  }
  return undefined;
}

function firstNumberFromRecords(records: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const record of records) {
    const value = firstNumber(record, keys);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const parsed = parseFiniteNumber(record[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized || normalized.toUpperCase() === 'N/A') return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeProgramFlowSignal(value: unknown): ProgramFlowSignal | undefined {
  if (value === 'BULLISH' || value === 'NEUTRAL' || value === 'BEARISH' || value === 'UNKNOWN' || value === 'UNAVAILABLE') {
    return value;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeProgramSource(value: unknown): ProgramFlowSourceProvider {
  if (value === 'KIS_API') return 'KIS_API';
  if (value === 'KRX_API' || value === 'KRX' || value === 'KRX_INVESTOR_FLOW') return 'KRX_API';
  if (value === 'CACHE') return 'CACHE';
  if (value === 'SNAPSHOT') return 'SNAPSHOT';
  return 'NONE';
}

function buildFieldAvailability(candidates: NormalSupplyPreviewCandidate[]): NormalSupplyFieldAvailability {
  const marketProgram = candidates.find((candidate) => candidate.programFlow?.marketLevel)?.programFlow?.marketLevel
    ?? PROGRAM_FLOW_NOT_AVAILABLE_MARKET;
  const stockProgramAvailable = candidates.filter((candidate) => candidate.programFlow?.stockLevel.available).length;
  return {
    total: candidates.length,
    foreignNetBuyField: candidates.filter((candidate) => candidate.foreignNetBuyAmount !== undefined).length,
    institutionNetBuyField: candidates.filter((candidate) => candidate.institutionNetBuyAmount !== undefined).length,
    programNetBuyField: stockProgramAvailable,
    stockProgramNetBuyField: candidates.filter((candidate) => candidate.programFlow?.stockLevel.netBuy !== undefined).length,
    stockProgramAvailable,
    marketProgramAvailable: marketProgram.available,
    marketProgramSignal: marketProgram.signal,
    marketProgramSource: marketProgram.sourceProvider ?? 'NONE',
    missingProgramFlowAsBearish: false,
    marketProgramProviderIssue: marketProgram.providerIssue,
    marketProgramMarketSignal: marketProgram.marketSignal,
    programPenaltyApplied: false,
    programFlowUsedForLiveDecision: false,
    passiveProxyUsedForLiveDecision: false,
    executionImpact: 'NONE',
    semanticRowAvailable: candidates.filter((candidate) => candidate.semanticRowAvailable).length,
    rawInvestorRowAvailable: candidates.filter((candidate) => candidate.rawInvestorRowAvailable).length,
    selectedCandidateCarriesSemanticRow: candidates.filter((candidate) => candidate.selectedCandidateCarriesSemanticRow).length,
    selectedCandidateCarriesActualRow: candidates.filter((candidate) => candidate.selectedCandidateCarriesActualRow).length,
  };
}

function buildSupplyInjectionFromCandidates(candidates: NormalSupplyPreviewCandidate[]): PerSymbolSupplyInjectionStats {
  const health = countHealth(candidates);
  return {
    totalCandidates: candidates.length,
    requestedSymbols: candidates.length,
    receivedResults: candidates.length,
    injected: health.VERIFIED,
    verified: health.VERIFIED,
    degraded: health.DEGRADED,
    stale: health.STALE,
    missing: health.MISSING,
    unknown: health.UNKNOWN,
    routerConnected: candidates.length > 0,
    gateContextConnected: candidates.length > 0,
  };
}

function deriveSupplyScore(ctx: PerSymbolSupplyContext): number {
  let score = 50;
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (health === 'VERIFIED') score += 10;
  if (health === 'DEGRADED') score -= 5;
  if (health === 'STALE') score -= 10;
  if (health === 'MISSING') score -= 15;
  if (health === 'UNKNOWN') score -= 20;
  if (signal === 'BULLISH') score += 20;
  if (signal === 'NEUTRAL') score += 5;
  if (signal === 'BEARISH') score -= 20;
  if (signal === 'UNUSABLE') score -= 15;
  score += signedAmountScore(ctx.foreignNetBuyAmount, 6);
  score += signedAmountScore(ctx.institutionNetBuyAmount, 6);
  score += signedAmountScore(ctx.programNetBuyAmount, 4);
  score += signedAmountScore(ctx.nonProgramNetBuyAmount, 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function deriveConfidence(ctx: PerSymbolSupplyContext): NormalSupplyPreviewCandidate['confidence'] {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  if (health === 'VERIFIED' && ctx.providerIssue !== true) return 'HIGH';
  if (health === 'DEGRADED' || health === 'STALE') return 'MEDIUM';
  if (health === 'MISSING') return 'LOW';
  return 'UNKNOWN';
}

function hasSemanticRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.semanticRow ||
      trace.semanticInvestorRow ||
      trace.supplySemanticRow ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

function hasRawInvestorRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.actualInvestorRow ||
      trace.diagnosticActualInvestorRow ||
      trace.normalizedInvestorRow ||
      (trace.actualInvestorFlowRows?.length ?? 0) > 0 ||
      trace.actualInvestorFlowCarried === true ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

function selectedCarriesSemanticRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(trace.semanticRow || trace.semanticInvestorRow || trace.supplySemanticRow || trace.materialized === true || health === 'VERIFIED');
}

function selectedCarriesActualRow(
  trace: CandidateWithSupplyContext['supplyProviderHealth'],
  health: SupplyProviderHealth,
): boolean {
  if (!trace) return health === 'VERIFIED';
  return Boolean(
    trace.actualInvestorFlowCarried === true ||
      trace.actualInvestorRow ||
      (trace.actualInvestorFlowRows?.length ?? 0) > 0 ||
      trace.materialized === true ||
      health === 'VERIFIED',
  );
}

function signedAmountScore(value: number | undefined, weight: number): number {
  if (value === undefined || value === 0) return 0;
  return value > 0 ? weight : -weight;
}

function formatFullCandidateDetail(
  candidate: NormalSupplyPreviewCandidate,
  rank: number,
  options: { includeThreshold: boolean; includeInvalidWarning: boolean },
): string {
  const name = candidate.name ? ` ${escapeHtmlText(candidate.name)}` : '';
  const lines = [
    `${rank}. ${candidate.symbol}${name}`,
    `   signal=${candidate.supplySignal} / supplyScore=${candidate.supplyScore}`,
    ...(options.includeThreshold
      ? [`   bullishThreshold=${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}`]
      : []),
    ...(candidate.supplySignal === 'ACCUMULATING'
      ? [`   accumulatingRange=${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}~${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}`]
      : []),
    `   reason=${escapeHtmlText(candidate.reason)}`,
    `   activeFlow=${escapeHtmlText(candidate.activeFlow)}`,
    `   passiveFlow=${candidate.passiveFlow}`,
    `   confluence=${candidate.activePassiveConfluence}`,
    `   programFlow: stockLevel=${candidate.programFlow?.stockLevel.signal ?? 'UNAVAILABLE'} / marketLevel=${candidate.programFlow?.marketLevel.signal ?? 'UNAVAILABLE'}`,
    `   foreignNetBuy=${formatAmount(candidate.foreignNetBuyAmount)}`,
    `   institutionNetBuy=${formatAmount(candidate.institutionNetBuyAmount)}`,
    `   stockProgramNetBuy=${formatAmount(candidate.programFlow?.stockLevel.netBuy)}`,
    `   marketProgramSignal=${candidate.programFlow?.marketLevel.signal ?? 'UNAVAILABLE'}`,
    `   programNetBuy=${formatAmount(candidate.programNetBuyAmount)}`,
    `   programMissingAsBearish=${candidate.programMissingAsBearish}`,
    '   programPenaltyApplied=false',
    '   passiveProxyUsedForLiveDecision=false',
    `   providerIssue=${candidate.providerIssue}`,
    `   marketSignal=${candidate.marketSignal}`,
    `   dataStatus=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    `   confidence=${candidate.confidence}`,
    `   watchlistPriorityBoost=${candidate.watchlistPriorityBoost}`,
    `   shadowTracking=${candidate.shadowTracking}`,
    `   programFlowDryRun=appliedToLiveScore:${candidate.programFlowDryRun.appliedToLiveScore}/reason:${candidate.programFlowDryRun.reason}`,
    '   usedForLiveDecision=false',
    '   strongBuyAllowed=false',
    '   executionImpact=NONE',
  ];
  if (options.includeInvalidWarning && candidate.invalidBearishReason) {
    lines.push(`   ⚠️ invalidBearishReason=${candidate.invalidBearishReason}`);
  }
  if (options.includeInvalidWarning && candidate.invalidBullishReason) {
    lines.push(`   ⚠️ invalidBullishReason=${candidate.invalidBullishReason}`);
  }
  return lines.join('\n');
}

function formatUnknownCandidateDetail(candidate: NormalSupplyPreviewCandidate, rank: number): string {
  const name = candidate.name ? ` ${escapeHtmlText(candidate.name)}` : '';
  return [
    `${rank}. ${candidate.symbol}${name}`,
    `   reason=${escapeHtmlText(candidate.reason)}`,
    `   providerIssue=${candidate.providerIssue}`,
    '   marketSignal=false',
    `   status=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    '   executionImpact=NONE',
    '   penaltyApplied=false',
  ].join('\n');
}

function formatAvailabilityLine(label: string, value: number, total: number): string {
  return `  ${label}: ${value}/${total}`;
}

function formatAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  return Math.trunc(value).toLocaleString('en-US');
}

function buildThresholdExplanation(candidate: NormalSupplyPreviewCandidate | undefined): string {
  if (!candidate) return 'No candidate rows are available for threshold explanation.';
  if (candidate.supplySignal === 'ACCUMULATING') {
    return `supplyScore ${candidate.supplyScore} is below bullishThreshold ${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold} and inside accumulatingRange ${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}-${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}; quiet accumulation candidate, not a live buy signal.`;
  }
  if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold) {
    return `supplyScore ${candidate.supplyScore} is below accumulatingRange ${NORMAL_SUPPLY_SCORE_THRESHOLDS.accumulatingThreshold}-${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold - 1}; classified as NEUTRAL.`;
  }
  if (candidate.supplySignal === 'NEUTRAL' && candidate.supplyScore < NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold) {
    return `supplyScore ${candidate.supplyScore}은 ${candidate.reason} 기준이나 bullishThreshold ${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold} 미만이므로 NEUTRAL로 분류됩니다.`;
  }
  if (candidate.supplySignal === 'BULLISH') {
    return `supplyScore ${candidate.supplyScore}이며 현재 수급 신호가 BULLISH입니다.`;
  }
  if (candidate.supplySignal === 'BEARISH') {
    return `supplyScore ${candidate.supplyScore}이며 marketSignal=${candidate.marketSignal} 기준 BEARISH입니다. providerIssue는 bearish로 해석하지 않습니다.`;
  }
  return `supplyScore ${candidate.supplyScore}이며 dataStatus=${candidate.dataStatus}입니다. UNKNOWN/MISSING/STALE은 bearish penalty로 변환하지 않습니다.`;
}

function describeSupplyReason(ctx: PerSymbolSupplyContext, classifiedSignal?: SupplySignal, supplyScore?: number): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = classifiedSignal ?? normalizeSignal(ctx.supplySignal);
  if (ctx.providerIssue === true || health !== 'VERIFIED') {
    return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  }
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
  if (signal === 'ACCUMULATING' && foreign > 0 && institution > 0) {
    return `foreign+institution net buy but below bullish threshold (${supplyScore ?? 'n/a'}/${NORMAL_SUPPLY_SCORE_THRESHOLDS.bullishThreshold}) - ACCUMULATING quiet observation candidate`;
  }
  if (signal === 'ACCUMULATING') {
    return `VERIFIED supply data shows accumulation (${supplyScore ?? 'n/a'}) - diagnostic/shadow only, not used for live decision`;
  }
  if (signal === 'BEARISH' && foreign < 0 && institution < 0) return '외국인+기관 동반 순매도';
  if (signal === 'BULLISH' && foreign > 0 && institution > 0 && program > 0) return '외국인+기관+프로그램 동반 순매수';
  if (signal === 'NEUTRAL' && foreign > 0 && institution > 0) return '외인+기관 동반 순매수이나 bullish threshold 미달';
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (foreign < 0 && institution < 0) return '외국인+기관 동반 순매도';
  if (foreign > 0) return '외국인 순매수 우위';
  if (institution > 0) return '기관 순매수 우위';
  if (program > 0) return '프로그램 순매수 우위';
  return `${signal} supply`;
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function summarizeSupplyContext(ctx: PerSymbolSupplyContext): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (health !== 'VERIFIED') return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
  if (foreign > 0 && institution > 0) return '외인+기관 동반 순매수';
  if (institution > 0 && program > 0) return '기관+프로그램 순매수';
  if (foreign > 0) return '외인 순매수 우위';
  if (institution > 0) return '기관 순매수 우위';
  if (signal === 'BEARISH') return '외인/기관 수급 약세';
  return `${signal} supply`;
}
