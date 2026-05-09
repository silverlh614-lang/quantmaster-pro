/**
 * @responsibility ADR-0480 Operator Action Router & Remediation Queue.
 *
 * Diagnostic-only SSOT that converts existing scan diagnostics into deduplicated,
 * prioritized operator guidance. It never mutates Gate thresholds, Kelly sizing,
 * provider promotion, or live execution state.
 */
import type { ScanSummary } from './scanDiagnostics.js';

export type OperatorActionPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type OperatorActionStatus = 'OPEN' | 'IN_PROGRESS' | 'OBSERVING' | 'RESOLVED' | 'BLOCKED';
export type OperatorActionCategory =
  | 'SUPPLY_PROVIDER'
  | 'INVESTOR_FLOW'
  | 'SECTOR_ENERGY'
  | 'GATE1'
  | 'POSITIVE_SOURCE'
  | 'FRESHNESS'
  | 'PENALTY_DEDUP'
  | 'LEDGER'
  | 'UI_OUTPUT'
  | 'UNKNOWN';

export type OperatorActionRootCause =
  | 'INVESTOR_FLOW_PROVIDER_UNWIRED'
  | 'NAVER_INVESTOR_TREND_EMPTY_OR_UNAVAILABLE'
  | 'SEMANTIC_NETBUY_MISSING'
  | 'SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE'
  | 'SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE'
  | 'SUPPLY_CACHE_EMPTY'
  | 'KIS_PROVIDER_MISMATCH'
  | 'FSS_SOURCE_STALE'
  | 'SUPPLY_SOURCE_REFRESH_RECOMMENDED'
  | 'CACHE_SOURCE_FRESHNESS_MISMATCH'
  | 'SECTOR_ENERGY_FALLBACK_ONLY'
  | 'SUPPLY_UNKNOWN_DUPLICATE_PENALTY'
  | 'POSITIVE_SOURCE_MISSING'
  | 'GATE1_NEAR_MISS_DATA_BLOCKED'
  | 'SCAN_BLOCKERS_TOO_VERBOSE'
  | 'DETAIL_TRACE_MISSING'
  | 'UNKNOWN_ROOT_CAUSE';

export interface OperatorActionSource {
  adr: string;
  sectionId?: string;
  code?: string;
  diagnosticKey: string;
  diagnosticValue?: string;
  severity: 'INFO' | 'DEGRADED' | 'BLOCKED' | 'DATA_UNAVAILABLE' | 'ERROR';
}

export interface OperatorActionItem {
  id: string;
  rootCause: OperatorActionRootCause;
  category: OperatorActionCategory;
  priority: OperatorActionPriority;
  status: OperatorActionStatus;
  title: string;
  summary: string;
  recommendedAction: string;
  relatedAdrs: string[];
  sources: OperatorActionSource[];
  evidenceCount: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  expectedImpact: {
    scanBlockerReduction: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
    gate1SurvivorPotential: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
    liveExecutionImpact: 'NONE';
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  detailHint?: string;
}

export interface OperatorActionQueueReport {
  generatedAt: string;
  totalActions: number;
  openActions: number;
  topActions: OperatorActionItem[];
  allActions: OperatorActionItem[];
  dedupedRootCauses: OperatorActionRootCause[];
  suppressedDuplicates: number;
  summaryLines: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
}

export interface BuildOperatorActionQueueInput {
  generatedAt?: string;
  sources?: OperatorActionSource[];
}

interface OperatorActionDefinition {
  rootCause: OperatorActionRootCause;
  category: OperatorActionCategory;
  title: string;
  summary: string;
  recommendedAction: string;
  relatedAdrs: string[];
  basePriority: OperatorActionPriority;
  expectedImpact: OperatorActionItem['expectedImpact'];
  detailHint: string;
}

const PRIORITY_RANK: Record<OperatorActionPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

const ACTION_DEFINITIONS: Record<OperatorActionRootCause, OperatorActionDefinition> = {
  INVESTOR_FLOW_PROVIDER_UNWIRED: {
    rootCause: 'INVESTOR_FLOW_PROVIDER_UNWIRED',
    category: 'INVESTOR_FLOW',
    title: 'InvestorFlow provider unwired',
    summary: 'Investor-flow semantic provider is unavailable or selectedProvider=NONE.',
    recommendedAction: 'Wire NAVER investor trend collector and route it through ADR-0477 InvestorFlowProviderRouter.',
    relatedAdrs: ['0465', '0466', '0469', '0473', '0476', '0477'],
    basePriority: 'P1',
    expectedImpact: { scanBlockerReduction: 'HIGH', gate1SurvivorPotential: 'MEDIUM', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 investor-flow-provider-unwired',
  },
  NAVER_INVESTOR_TREND_EMPTY_OR_UNAVAILABLE: {
    rootCause: 'NAVER_INVESTOR_TREND_EMPTY_OR_UNAVAILABLE',
    category: 'INVESTOR_FLOW',
    title: 'NAVER investor trend empty/unavailable',
    summary: 'ADR-0481 collector is wired but NAVER investor trend data is empty, unavailable, stale, or diagnostic-only.',
    recommendedAction: 'Verify NAVER data source availability or fallback semantic sample retention; keep UNKNOWN out of bullish/bearish scoring.',
    relatedAdrs: ['0473', '0476', '0477', '0481'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0481',
  },
  SEMANTIC_NETBUY_MISSING: {
    rootCause: 'SEMANTIC_NETBUY_MISSING',
    category: 'INVESTOR_FLOW',
    title: 'Semantic net-buy missing',
    summary: 'Provider-specific investor-flow payload is not normalized into semantic net-buy fields.',
    recommendedAction: 'Implement semantic net-buy normalizer for foreignNetBuy, institutionNetBuy, programNetBuy, confidence, status, and signal.',
    relatedAdrs: ['0475', '0477'],
    basePriority: 'P1',
    expectedImpact: { scanBlockerReduction: 'HIGH', gate1SurvivorPotential: 'MEDIUM', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 semantic-netbuy-missing',
  },
  SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE: {
    rootCause: 'SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE',
    category: 'INVESTOR_FLOW',
    title: 'Semantic net-buy sample unavailable',
    summary: 'ADR-0482 normalizer is installed but no usable semantic net-buy sample is selectable.',
    recommendedAction: 'Verify provider data coverage or fallback cache semantic sample retention.',
    relatedAdrs: ['0477', '0481', '0482'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0482 semantic-netbuy-sample-unavailable',
  },
  SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE: {
    rootCause: 'SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE',
    category: 'INVESTOR_FLOW',
    title: 'Semantic net-buy parse/unit issue',
    summary: 'ADR-0482 normalizer detected parse errors or unit normalization issues.',
    recommendedAction: 'Fix provider field parsing or unit metadata before using semantic net-buy as a dry-run positive source.',
    relatedAdrs: ['0477', '0482'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0482 semantic-netbuy-parse-or-unit-issue',
  },
  SUPPLY_CACHE_EMPTY: {
    rootCause: 'SUPPLY_CACHE_EMPTY',
    category: 'SUPPLY_PROVIDER',
    title: 'Supply cache empty',
    summary: 'No usable semantic supply sample exists in current or previous trading-day cache.',
    recommendedAction: 'Add/verify previous trading-day semantic sample retention and fallback cache population.',
    relatedAdrs: ['0465', '0473', '0477'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'MEDIUM', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 supply-cache-empty',
  },
  KIS_PROVIDER_MISMATCH: {
    rootCause: 'KIS_PROVIDER_MISMATCH',
    category: 'SUPPLY_PROVIDER',
    title: 'KIS provider role mismatch',
    summary: 'KIS is being reported in the investor-flow route without semantic investor-flow capability.',
    recommendedAction: 'Keep KIS out of semantic investor_flow route unless capability explicitly supports it; document KIS as program/market-program provider.',
    relatedAdrs: ['0477'],
    basePriority: 'P3',
    expectedImpact: { scanBlockerReduction: 'LOW', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 kis-provider-mismatch',
  },
  SUPPLY_SOURCE_REFRESH_RECOMMENDED: {
    rootCause: 'SUPPLY_SOURCE_REFRESH_RECOMMENDED',
    category: 'FRESHNESS',
    title: 'Supply source refresh recommended',
    summary: 'ADR-0483 identified stale, missing, or unavailable supply source data that should be refreshed in diagnostic/dry-run mode.',
    recommendedAction: 'Run/verify diagnostic refresh for stale supply sources; keep stale data out of bearish scoring.',
    relatedAdrs: ['0473', '0476', '0477', '0482', '0483'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0483 supply-source-refresh-recommended',
  },
  CACHE_SOURCE_FRESHNESS_MISMATCH: {
    rootCause: 'CACHE_SOURCE_FRESHNESS_MISMATCH',
    category: 'FRESHNESS',
    title: 'Cache/source freshness mismatch',
    summary: 'Cache is fresh but the underlying supply source date is stale.',
    recommendedAction: 'Split cache and source clocks; refresh stale source.',
    relatedAdrs: ['0473', '0477', '0483'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0483 cache-source-freshness-mismatch',
  },
  FSS_SOURCE_STALE: {
    rootCause: 'FSS_SOURCE_STALE',
    category: 'FRESHNESS',
    title: 'FSS source stale',
    summary: 'FSS Passive/Active or short/credit source freshness is stale even when cache may be fresh.',
    recommendedAction: 'Split cache freshness and source freshness; add/verify stale refresh job for FSS/short/credit sources.',
    relatedAdrs: ['0477'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 fss-source-stale',
  },
  SECTOR_ENERGY_FALLBACK_ONLY: {
    rootCause: 'SECTOR_ENERGY_FALLBACK_ONLY',
    category: 'SECTOR_ENERGY',
    title: 'SectorEnergy fallback only',
    summary: 'SectorEnergy quality is degraded, fallback-mounted, or coverage recovery is incomplete.',
    recommendedAction: 'Verify SectorEnergy quality diagnostic producer and coverage recovery path.',
    relatedAdrs: ['0462', '0474'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 sector-energy-fallback-only',
  },
  SUPPLY_UNKNOWN_DUPLICATE_PENALTY: {
    rootCause: 'SUPPLY_UNKNOWN_DUPLICATE_PENALTY',
    category: 'PENALTY_DEDUP',
    title: 'Supply UNKNOWN duplicate penalty',
    summary: 'Provider-unknown supply diagnostics are duplicated across multiple penalty groups.',
    recommendedAction: 'Confirm provider-unknown penalty dedup is active; keep verified bearish supply separate from provider unknown.',
    relatedAdrs: ['0466', '0469'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'MEDIUM', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 supply-unknown-duplicate-penalty',
  },
  POSITIVE_SOURCE_MISSING: {
    rootCause: 'POSITIVE_SOURCE_MISSING',
    category: 'POSITIVE_SOURCE',
    title: 'Positive source missing',
    summary: 'Gate1 dry-run found no positive source resolver for otherwise plausible candidates.',
    recommendedAction: 'Use ADR-0475 dry-run to identify which positive source resolver is missing; do not promote live without observation.',
    relatedAdrs: ['0475', '0476'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'MEDIUM', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 positive-source-missing',
  },
  GATE1_NEAR_MISS_DATA_BLOCKED: {
    rootCause: 'GATE1_NEAR_MISS_DATA_BLOCKED',
    category: 'GATE1',
    title: 'Gate1 near-miss data blocked',
    summary: 'Gate1 near-miss or observation-ledger rows exist but unavailable data still blocks classification.',
    recommendedAction: 'Review ADR-0476 3/5/10d observation outcomes before changing any Gate classification.',
    relatedAdrs: ['0476'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'MEDIUM', gate1SurvivorPotential: 'MEDIUM', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 gate1-near-miss-data-blocked',
  },
  SCAN_BLOCKERS_TOO_VERBOSE: {
    rootCause: 'SCAN_BLOCKERS_TOO_VERBOSE',
    category: 'UI_OUTPUT',
    title: 'Scan blockers too verbose',
    summary: 'Default /scan_blockers output exceeds compact budget or repeats raw guardrail diagnostics.',
    recommendedAction: 'Route section through ADR-0478 compact output and ADR-0479 detail registry.',
    relatedAdrs: ['0478', '0479'],
    basePriority: 'P3',
    expectedImpact: { scanBlockerReduction: 'LOW', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/scan_blockers_detail operator-actions',
  },
  DETAIL_TRACE_MISSING: {
    rootCause: 'DETAIL_TRACE_MISSING',
    category: 'UI_OUTPUT',
    title: 'Detail trace missing',
    summary: 'A compact diagnostic exists without a corresponding ADR-0479 detail/raw trace.',
    recommendedAction: 'Register the compact section in ADR-0479 detail registry or expose it via /adr_trace.',
    relatedAdrs: ['0479'],
    basePriority: 'P2',
    expectedImpact: { scanBlockerReduction: 'LOW', gate1SurvivorPotential: 'LOW', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 detail-trace-missing',
  },
  UNKNOWN_ROOT_CAUSE: {
    rootCause: 'UNKNOWN_ROOT_CAUSE',
    category: 'UNKNOWN',
    title: 'Unknown diagnostic root cause',
    summary: 'A diagnostic source could not be mapped to a known ADR-0480 root cause.',
    recommendedAction: 'Review raw ADR-0479 detail output and add an ADR-0480 mapping if repeated.',
    relatedAdrs: ['0479', '0480'],
    basePriority: 'P3',
    expectedImpact: { scanBlockerReduction: 'UNKNOWN', gate1SurvivorPotential: 'UNKNOWN', liveExecutionImpact: 'NONE' },
    detailHint: '/adr_trace 0480 unknown-root-cause',
  },
};

function diagnosticText(source: OperatorActionSource): string {
  return [source.adr, source.sectionId, source.code, source.diagnosticKey, source.diagnosticValue, source.severity]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toUpperCase();
}

function includesAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function rootCauseForSource(source: OperatorActionSource): OperatorActionRootCause | null {
  const text = diagnosticText(source);
  if (includesAny(text, ['NOT_WIRED', 'SELECTEDPROVIDER=NONE', 'SELECTED_PROVIDER=NONE', 'PROVIDER=NONE', 'COVERAGE=0/5', 'INVESTOR_FLOW DATA_UNAVAILABLE', 'SEMANTIC PROVIDER NOT AVAILABLE'])) {
    return 'INVESTOR_FLOW_PROVIDER_UNWIRED';
  }
  if (includesAny(text, ['ADR-0481', 'NAVER_INVESTOR_TREND']) && includesAny(text, ['DATA_UNAVAILABLE', 'EMPTY', 'STALE', 'PARSE_ERROR', 'PROVIDER_ERROR', 'WIRED'])) {
    return 'NAVER_INVESTOR_TREND_EMPTY_OR_UNAVAILABLE';
  }
  if (includesAny(text, ['ADR-0482', 'SEMANTIC_NETBUY_NORMALIZER', 'SEMANTICNETBUY NORMALIZER'])) {
    if (includesAny(text, ['PARSE_ERROR', 'UNIT', 'UNITNORMALIZED=FALSE', 'UNIT_MISMATCH'])) return 'SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE';
    if (includesAny(text, ['SELECTED=NONE', 'SELECTEDSAMPLE=NULL', 'DATA_UNAVAILABLE', 'EMPTY', 'PROVIDER_ERROR'])) return 'SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE';
  }
  if (includesAny(text, ['SEMANTIC NET-BUY', 'SEMANTIC_NETBUY', 'SEMANTICNETBUY=NULL', 'NORMALIZED NET-BUY', 'NETBUY NORMALIZER', 'MISSING NORMALIZED NET'])) {
    return 'SEMANTIC_NETBUY_MISSING';
  }
  if (includesAny(text, ['CACHE_EMPTY', 'FALLBACK MISSING', 'NO USABLE CACHED SEMANTIC SAMPLE', 'PREVIOUS TRADING DAY FALLBACK MISSING'])) {
    return 'SUPPLY_CACHE_EMPTY';
  }
  if (includesAny(text, ['PROVIDER_MISMATCH', 'KIS IS TRIED FOR INVESTOR_FLOW', 'KIS_API PROVIDER_MISMATCH'])) {
    return 'KIS_PROVIDER_MISMATCH';
  }
  if (includesAny(text, ['ADR-0483', 'SUPPLYFRESHNESS', 'SUPPLY_SOURCE_FRESHNESS'])) {
    if (includesAny(text, ['CACHE FRESH, SOURCE STALE', 'CACHE=FRESH SOURCE=STALE', 'CACHESTATE=FRESH SOURCESTATE=STALE'])) return 'CACHE_SOURCE_FRESHNESS_MISMATCH';
    if (includesAny(text, ['REFRESH', 'STALE', 'DATA_UNAVAILABLE', 'MISSING'])) return 'SUPPLY_SOURCE_REFRESH_RECOMMENDED';
  }
  if (includesAny(text, ['FSS PASSIVE', 'FSS ACTIVE', 'FSS_SOURCE_STALE', 'SHORT/CREDIT SOURCE', 'SOURCE STALE', 'CACHE FRESH BUT SOURCE STALE'])) {
    return 'FSS_SOURCE_STALE';
  }
  if (includesAny(text, ['SECTORENERGY FALLBACK', 'FALLBACK MOUNTED', 'SECTORENERGY QUALITY DIAGNOSTIC ABSENT', 'COVERAGE DEGRADED', 'SECTOR_ENERGY_DEGRADED'])) {
    return 'SECTOR_ENERGY_FALLBACK_ONLY';
  }
  if (includesAny(text, ['SUPPLY_UNKNOWN DUPLICATE', 'DUPLICATE GROUP', 'ADR-0469 DEDUP ACTIVE', 'PENALTY DEDUP', 'UNKNOWN_DATA_PENALTY'])) {
    return 'SUPPLY_UNKNOWN_DUPLICATE_PENALTY';
  }
  if (includesAny(text, ['POSITIVE SOURCE CANDIDATES=0', 'POSITIVE_SOURCE_MISSING', 'OTHER_POSITIVE', 'MISSING WATCHLIST UPSTREAM SCORE', 'INVESTOR FLOW POSITIVE SOURCE'])) {
    return 'POSITIVE_SOURCE_MISSING';
  }
  if (includesAny(text, ['DATA_BLOCKED_NEAR_MISS', 'NEAR-MISS', 'NEAR_MISS', 'OBSERVATION ROW', 'OBSERVATIONLEDGER'])) {
    return 'GATE1_NEAR_MISS_DATA_BLOCKED';
  }
  if (includesAny(text, ['LINE COUNT OVER BUDGET', 'TOO_VERBOSE', 'RAW ADR BLOCKS', 'REPEATED GUARDRAIL'])) {
    return 'SCAN_BLOCKERS_TOO_VERBOSE';
  }
  if (includesAny(text, ['DETAIL TRACE MISSING', 'DETAIL_TRACE_MISSING', 'NO DETAIL REGISTRY', 'ADR_TRACE MISSING'])) {
    return 'DETAIL_TRACE_MISSING';
  }
  return null;
}

function priorityFor(rootCause: OperatorActionRootCause, sources: OperatorActionSource[]): OperatorActionPriority {
  const hasP0Risk = sources.some((source) => includesAny(diagnosticText(source), ['COMMAND_FAILURE', 'FORMATTER_CRASH', 'ENGINE_LIVENESS', 'SHADOW_LEARNING_STOPPED', 'LIVE_EXECUTION_IMPACT']));
  if (hasP0Risk) return 'P0';
  if (rootCause === 'KIS_PROVIDER_MISMATCH') {
    const repeatedNoise = sources.length >= 3 || sources.some((source) => includesAny(diagnosticText(source), ['REPEATED_NOISE', 'NOISE_HIGH']));
    return repeatedNoise ? 'P2' : 'P3';
  }
  return ACTION_DEFINITIONS[rootCause].basePriority;
}

function confidenceFor(evidenceCount: number): OperatorActionItem['confidence'] {
  if (evidenceCount >= 3) return 'HIGH';
  if (evidenceCount >= 2) return 'MEDIUM';
  return 'LOW';
}

function uniqueSortedAdrs(defaultAdrs: string[], sources: OperatorActionSource[]): string[] {
  const out = new Set(defaultAdrs);
  for (const source of sources) out.add(source.adr.replace(/^ADR-?/i, '').padStart(4, '0'));
  return Array.from(out).sort();
}

function buildItem(rootCause: OperatorActionRootCause, sources: OperatorActionSource[]): OperatorActionItem {
  const definition = ACTION_DEFINITIONS[rootCause];
  const priority = priorityFor(rootCause, sources);
  return {
    id: `ADR-0480:${rootCause}`,
    rootCause,
    category: definition.category,
    priority,
    status: 'OPEN',
    title: definition.title,
    summary: definition.summary,
    recommendedAction: definition.recommendedAction,
    relatedAdrs: uniqueSortedAdrs(definition.relatedAdrs, sources),
    sources,
    evidenceCount: sources.length,
    confidence: confidenceFor(sources.length),
    expectedImpact: definition.expectedImpact,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    detailHint: definition.detailHint,
  };
}

function formatRelated(adrs: string[], max = 3): string {
  return adrs.slice(0, max).map((adr) => adr.replace(/^0+/, '')).join('/');
}

function compactActionLine(item: OperatorActionItem): string {
  const shortAction = item.rootCause === 'INVESTOR_FLOW_PROVIDER_UNWIRED'
    ? 'NAVER collector wiring'
    : item.rootCause === 'NAVER_INVESTOR_TREND_EMPTY_OR_UNAVAILABLE'
      ? 'verify data/fallback retention'
      : item.rootCause === 'SEMANTIC_NETBUY_MISSING'
        ? 'implement normalizer'
        : item.rootCause === 'SEMANTIC_NETBUY_SAMPLE_UNAVAILABLE'
          ? 'verify coverage/fallback sample'
          : item.rootCause === 'SEMANTIC_NETBUY_PARSE_OR_UNIT_ISSUE'
            ? 'fix parser/unit metadata'
            : item.rootCause === 'SUPPLY_SOURCE_REFRESH_RECOMMENDED'
              ? 'refresh stale source'
              : item.rootCause === 'CACHE_SOURCE_FRESHNESS_MISMATCH'
                ? 'split cache/source clocks'
                : item.rootCause === 'FSS_SOURCE_STALE'
                  ? 'refresh stale source / split freshness'
                  : item.recommendedAction.split(';')[0];
  return `${item.priority} ${item.title} → ${shortAction} | related=${formatRelated(item.relatedAdrs)} | impact=${item.executionImpact}`;
}

export function buildOperatorActionQueueAdr0480(input: BuildOperatorActionQueueInput = {}): OperatorActionQueueReport {
  const grouped = new Map<OperatorActionRootCause, OperatorActionSource[]>();
  let matchedEvidenceCount = 0;
  for (const source of input.sources ?? []) {
    const rootCause = rootCauseForSource(source);
    if (!rootCause) continue;
    matchedEvidenceCount += 1;
    const current = grouped.get(rootCause) ?? [];
    current.push(source);
    grouped.set(rootCause, current);
  }
  const allActions = Array.from(grouped.entries())
    .map(([rootCause, sources]) => buildItem(rootCause, sources))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.evidenceCount - a.evidenceCount || a.rootCause.localeCompare(b.rootCause));
  const topActions = allActions.slice(0, 3);
  const summaryLines = topActions.length > 0
    ? topActions.map(compactActionLine)
    : ['No open P0/P1 actions. Continue observation.'];
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totalActions: allActions.length,
    openActions: allActions.filter((action) => action.status === 'OPEN').length,
    topActions,
    allActions,
    dedupedRootCauses: allActions.map((action) => action.rootCause),
    suppressedDuplicates: Math.max(0, matchedEvidenceCount - allActions.length),
    summaryLines,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
  };
}

export function collectOperatorActionSourcesFromScanSummaryAdr0480(summary: ScanSummary | null): OperatorActionSource[] {
  if (!summary) return [];
  const sources: OperatorActionSource[] = [];
  if ((summary.candidates > 0 || summary.gateMisses > 0) && summary.entries === 0 && (summary.waitDistribution?.dataHold ?? 0) > 0) {
    sources.push({ adr: '0465', sectionId: 'scan_blockers', code: 'SUPPLY_DATA_UNAVAILABLE', diagnosticKey: 'investor_flow', diagnosticValue: 'DATA_UNAVAILABLE', severity: 'DATA_UNAVAILABLE' });
  }
  const sectorQuality = summary.sectorEnergyQuality;
  if (sectorQuality && sectorQuality !== 'OK' && sectorQuality !== 'PARTIAL') {
    sources.push({ adr: '0474', sectionId: 'sector_energy', code: 'SECTOR_ENERGY_DEGRADED', diagnosticKey: 'SectorEnergy', diagnosticValue: sectorQuality, severity: 'DEGRADED' });
  }
  const sectorDiag = summary.sectorEnergyQualityDiagnostic as { fallbackUsed?: string; dataQuality?: string; indexCodeCoverage?: number } | undefined;
  if (sectorDiag?.fallbackUsed && sectorDiag.fallbackUsed !== 'NONE') {
    sources.push({ adr: '0474', sectionId: 'sector_energy', code: 'FALLBACK_MOUNTED', diagnosticKey: 'fallbackUsed', diagnosticValue: sectorDiag.fallbackUsed, severity: 'DEGRADED' });
  }
  if ((summary.gateScoreCandidateBuckets?.totalNearMissLike ?? 0) > 0) {
    sources.push({ adr: '0476', sectionId: 'gate1_observation_ledger', code: 'DATA_BLOCKED_NEAR_MISS', diagnosticKey: 'nearMissRows', diagnosticValue: String(summary.gateScoreCandidateBuckets?.totalNearMissLike ?? 0), severity: 'DEGRADED' });
  }
  if ((summary.gateScoreHealth?.unavailableTop ?? []).some((item) => item.condition.toUpperCase().includes('POSITIVE'))) {
    sources.push({ adr: '0475', sectionId: 'positive_source', code: 'POSITIVE_SOURCE_MISSING', diagnosticKey: 'positiveSource', diagnosticValue: 'unavailableTop', severity: 'DATA_UNAVAILABLE' });
  }
  return sources;
}

export function formatOperatorActionCompactSectionAdr0480(report: OperatorActionQueueReport): string {
  return ['🛠 <b>Top Operator Actions</b>', ...report.summaryLines.map((line) => `- ${line}`)].join('\n');
}

export function formatOperatorActionDetailAdr0480(report: OperatorActionQueueReport): string {
  const counts: Record<OperatorActionPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const action of report.allActions) counts[action.priority] += 1;
  const lines = [
    '🛠 <b>Operator Action Queue (ADR-0480)</b>',
    `- P0: ${counts.P0}`,
    `- P1: ${counts.P1}`,
    `- P2: ${counts.P2}`,
    `- P3: ${counts.P3}`,
    `- suppressedDuplicates: ${report.suppressedDuplicates}`,
    `- executionImpact: ${report.executionImpact}`,
    `- liveExecutionAllowed: ${report.liveExecutionAllowed}`,
  ];
  if (report.allActions.length === 0) {
    lines.push('', 'Top actions:', '1. No open P0/P1 actions. Continue observation.');
    return lines.join('\n');
  }
  lines.push('', 'Top actions:');
  report.allActions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.priority} ${action.rootCause}`);
    lines.push(`   status: ${action.status}`);
    lines.push(`   category: ${action.category}`);
    lines.push(`   action: ${action.recommendedAction}`);
    lines.push(`   related: ${action.relatedAdrs.map((adr) => `ADR-${adr}`).join(', ')}`);
    lines.push(`   confidence: ${action.confidence}`);
    lines.push(`   expected: scanBlockerReduction=${action.expectedImpact.scanBlockerReduction}, gate1SurvivorPotential=${action.expectedImpact.gate1SurvivorPotential}, liveExecutionImpact=${action.expectedImpact.liveExecutionImpact}`);
    lines.push('   evidence:');
    action.sources.forEach((source) => {
      lines.push(`   - ADR-${source.adr.replace(/^ADR-?/i, '').padStart(4, '0')} ${source.diagnosticKey}=${source.diagnosticValue ?? source.code ?? source.severity}`);
    });
    lines.push(`   guardrails: executionImpact=${action.executionImpact}, liveExecutionAllowed=${action.liveExecutionAllowed}, policyPromotionMode=${action.policyPromotionMode}, operatorApprovalRequired=${action.operatorApprovalRequired}`);
  });
  return lines.join('\n');
}

export function safeBuildOperatorActionQueueAdr0480(input: BuildOperatorActionQueueInput = {}): OperatorActionQueueReport {
  try {
    return buildOperatorActionQueueAdr0480(input);
  } catch (error) {
    console.warn('[ADR-0480] operator action router failed; returning empty diagnostic queue:', error);
    return buildOperatorActionQueueAdr0480({ generatedAt: input.generatedAt, sources: [] });
  }
}

export function safeFormatOperatorActionCompactSectionAdr0480(report: OperatorActionQueueReport | null | undefined): string {
  try {
    return formatOperatorActionCompactSectionAdr0480(report ?? buildOperatorActionQueueAdr0480());
  } catch (error) {
    console.warn('[ADR-0480] compact formatter failed:', error);
    return '🛠 <b>Top Operator Actions</b>\n- No open P0/P1 actions. Continue observation.';
  }
}

export interface OperatorActionDetailRegistryEntryAdr0480 {
  adr: '0480';
  sectionId: 'operator_actions';
  commandHint: '/operator_actions';
  scanBlockersDetailHint: '/scan_blockers_detail operator_actions';
  adrTraceHint: '/adr_trace 0480';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getOperatorActionDetailRegistryEntryAdr0480(report: OperatorActionQueueReport): OperatorActionDetailRegistryEntryAdr0480 {
  return {
    adr: '0480',
    sectionId: 'operator_actions',
    commandHint: '/operator_actions',
    scanBlockersDetailHint: '/scan_blockers_detail operator_actions',
    adrTraceHint: '/adr_trace 0480',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    render: () => formatOperatorActionDetailAdr0480(report),
  };
}

export function formatRuntimePipelineDiagnosticEvidenceLineAdr0480(report: OperatorActionQueueReport): string {
  return `ADR-0480 actionQueueEvidence=${report.allActions.reduce((sum, action) => sum + action.evidenceCount, 0)} diagnosticOnly=true rolloutInstalled=false executionImpact=${report.executionImpact}`;
}
