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
  bearishThreshold: 35,
});

export type NormalSupplyPreviewMode = typeof NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE;
export type NormalSupplyPreviewFullMode = typeof NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE;
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
  foreignNetBuyAmount?: number;
  institutionNetBuyAmount?: number;
  programNetBuyAmount?: number;
  nonProgramNetBuyAmount?: number;
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
  semanticRowAvailable: number;
  rawInvestorRowAvailable: number;
  selectedCandidateCarriesSemanticRow: number;
  selectedCandidateCarriesActualRow: number;
}

export interface NormalSupplyPreviewSafety {
  providerIssueAsBearish: false;
  unknownPenaltyApplied: false;
  staleAsBearish: false;
  missingAsBearish: false;
  realOrderAllowed: false;
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
}

let lastNormalSupplyPreview: NormalSupplyPreview | null = null;

export function persistNormalSupplyPreview<T extends CandidateWithSupplyContext>(
  input: PersistNormalSupplyPreviewInput<T>,
): NormalSupplyPreview {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const previewCandidates = input.candidates
    .map(toPreviewCandidate)
    .filter((candidate): candidate is NormalSupplyPreviewCandidate => candidate !== null);
  const healthCounts = countHealth(previewCandidates);
  const signalCounts = countSignals(previewCandidates);
  const supplyInjection = input.supplyInjection ?? buildSupplyInjectionFromCandidates(previewCandidates);
  const signalSourceSplit = buildSignalSourceSplit(previewCandidates);
  const fieldAvailability = buildFieldAvailability(previewCandidates);
  const topCandidates = [...previewCandidates]
    .sort((a, b) => b.supplyScore - a.supplyScore || a.symbol.localeCompare(b.symbol))
    .slice(0, input.topN ?? 5);

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
    safety: {
      providerIssueAsBearish: false,
      unknownPenaltyApplied: false,
      staleAsBearish: false,
      missingAsBearish: false,
      realOrderAllowed: false,
    },
  };
  return lastNormalSupplyPreview;
}

export function getLastNormalSupplyPreview(): NormalSupplyPreview | null {
  return lastNormalSupplyPreview;
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
    preview.signalSourceSplit.bearishFromProviderIssue + preview.signalSourceSplit.bullishFromProviderIssue;
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
    contamination > 0 ? `  warning=PROVIDER_SIGNAL_CONTAMINATION count=${contamination}` : '',
    '',
    '📐 <b>Supply Score Threshold</b>',
    `  bullishThreshold: ${thresholds.bullishThreshold}`,
    `  bearishThreshold: ${thresholds.bearishThreshold}`,
    `  neutralRange: ${thresholds.bearishThreshold}~${thresholds.bullishThreshold - 1}`,
    `  topSupplyScore: ${top?.supplyScore ?? 'N/A'}`,
    `  topSignal: ${top?.supplySignal ?? 'N/A'}`,
    `  explanation: ${escapeHtmlText(buildThresholdExplanation(top))}`,
    '',
    '📊 <b>Signal Source Split</b>',
    `  bullishFromMarketSignal: ${preview.signalSourceSplit.bullishFromMarketSignal}`,
    `  bullishFromProviderIssue: ${preview.signalSourceSplit.bullishFromProviderIssue}`,
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

function toPreviewCandidate(candidate: CandidateWithSupplyContext): NormalSupplyPreviewCandidate | null {
  const symbol = normalizePreviewSymbol(candidate.symbol ?? candidate.code);
  if (!symbol) return null;
  const ctx = candidate.preflight?.supplyContext ?? candidate.supplyContext;
  const supplyContext = ctx ?? buildMissingContext(symbol);
  const trace = candidate.supplyProviderHealth ?? {};
  const health = normalizeHealth(supplyContext.supplyProviderHealth);
  const providerIssue = supplyContext.providerIssue === true;
  const marketSignal = supplyContext.marketSignal === true;
  const rawSignal = normalizeSignal(supplyContext.supplySignal);
  const signal = providerIssue && !marketSignal && (rawSignal === 'BULLISH' || rawSignal === 'BEARISH')
    ? 'UNUSABLE'
    : rawSignal;
  const reason = describeSupplyReason(supplyContext);
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
    supplyScore: deriveSupplyScore(supplyContext),
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
    programNetBuyAmount: supplyContext.programNetBuyAmount,
    nonProgramNetBuyAmount: supplyContext.nonProgramNetBuyAmount,
    fetchedAt: supplyContext.fetchedAt,
    rawStatus: supplyContext.rawStatus,
    semanticRowAvailable: hasSemanticRow(trace, health),
    rawInvestorRowAvailable: hasRawInvestorRow(trace, health),
    selectedCandidateCarriesSemanticRow: selectedCarriesSemanticRow(trace, health),
    selectedCandidateCarriesActualRow: selectedCarriesActualRow(trace, health),
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
  if (value === 'BULLISH' || value === 'NEUTRAL' || value === 'BEARISH' || value === 'UNUSABLE') return value;
  return 'UNUSABLE';
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
    bearishFromMarketSignal: 0,
    bearishFromProviderIssue: 0,
    neutralFromVerifiedData: 0,
    unusableFromDataQuality: 0,
  };
  for (const candidate of candidates) {
    if (candidate.supplySignal === 'BULLISH') {
      if (candidate.providerIssue) split.bullishFromProviderIssue += 1;
      else if (candidate.marketSignal) split.bullishFromMarketSignal += 1;
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

function buildFieldAvailability(candidates: NormalSupplyPreviewCandidate[]): NormalSupplyFieldAvailability {
  return {
    total: candidates.length,
    foreignNetBuyField: candidates.filter((candidate) => candidate.foreignNetBuyAmount !== undefined).length,
    institutionNetBuyField: candidates.filter((candidate) => candidate.institutionNetBuyAmount !== undefined).length,
    programNetBuyField: candidates.filter((candidate) => candidate.programNetBuyAmount !== undefined).length,
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
    `   reason=${escapeHtmlText(candidate.reason)}`,
    `   foreignNetBuy=${formatAmount(candidate.foreignNetBuyAmount)}`,
    `   institutionNetBuy=${formatAmount(candidate.institutionNetBuyAmount)}`,
    `   programNetBuy=${formatAmount(candidate.programNetBuyAmount)}`,
    `   providerIssue=${candidate.providerIssue}`,
    `   marketSignal=${candidate.marketSignal}`,
    `   dataStatus=${candidate.dataStatus}`,
    `   sourceProvider=${candidate.sourceProvider}`,
    `   confidence=${candidate.confidence}`,
    '   usedForLiveDecision=false',
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

function describeSupplyReason(ctx: PerSymbolSupplyContext): string {
  const health = normalizeHealth(ctx.supplyProviderHealth);
  const signal = normalizeSignal(ctx.supplySignal);
  if (ctx.providerIssue === true || health !== 'VERIFIED') {
    return `${health} provider gap (${ctx.rawStatus ?? 'n/a'})`;
  }
  const foreign = ctx.foreignNetBuyAmount ?? 0;
  const institution = ctx.institutionNetBuyAmount ?? 0;
  const program = ctx.programNetBuyAmount ?? 0;
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
