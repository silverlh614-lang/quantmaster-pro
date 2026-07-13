// @responsibility Shadow Case Library view-model helpers.

import type {
  EngineMode,
  ShadowCaseItem,
  ShadowCaseSeverity,
  ShadowCaseStatus,
  ShadowCaseType,
} from '../types/shadowCase';

export const ALL_SHADOW_CASE_TYPES: ShadowCaseType[] = [
  'CASE_SUPPLY_UNSTABLE',
  'CASE_HOLIDAY',
  'CASE_LUNCH_BREAK',
  'CASE_SELL_ONLY',
  'CASE_SHADOW_ONLY',
  'CASE_KRX_DELAY',
  'CASE_KIS_500',
  'CASE_DART_DELAY',
  'CASE_YAHOO_STALE',
  'CASE_MACRO_RISK_OFF',
  'CASE_STRONG_BUY_BLOCKED',
  'CASE_BUYLIST_EMPTY',
  'CASE_WATCHLIST_REFRESHED_BUT_NO_EXECUTION',
  'CASE_DATA_MISSING',
  'CASE_PROVIDER_HEALTH_BAD',
  'CASE_MARKET_SIGNAL_NEUTRAL',
  'CASE_PROGRAM_TRADING_EMPTY',
  'CASE_SCAN_DIAGNOSTIC_SUPPRESSED',
  'CASE_UNKNOWN',
];

const ALL_SHADOW_CASE_STATUS: ShadowCaseStatus[] = ['OPEN', 'OUTCOME_PENDING', 'RESOLVED', 'IGNORED', 'NEEDS_REVIEW'];
const ALL_ENGINE_MODES: EngineMode[] = ['NORMAL', 'DEGRADED', 'SELL_ONLY', 'SHADOW_ONLY', 'OBSERVE_ONLY'];

const CASE_TYPE_LABELS: Record<ShadowCaseType, string> = {
  CASE_SUPPLY_UNSTABLE: 'Supply unstable',
  CASE_HOLIDAY: 'Market holiday observation',
  CASE_LUNCH_BREAK: 'Lunch break observation',
  CASE_SELL_ONLY: 'Sell-only blocked entry',
  CASE_SHADOW_ONLY: 'Shadow-only regime',
  CASE_KRX_DELAY: 'KRX delayed data',
  CASE_KIS_500: 'KIS provider 500',
  CASE_DART_DELAY: 'DART filing delay',
  CASE_YAHOO_STALE: 'Yahoo stale data',
  CASE_MACRO_RISK_OFF: 'Macro risk-off',
  CASE_STRONG_BUY_BLOCKED: 'Strong buy blocked',
  CASE_BUYLIST_EMPTY: 'Buy list empty',
  CASE_WATCHLIST_REFRESHED_BUT_NO_EXECUTION: 'Watchlist refreshed, no execution',
  CASE_DATA_MISSING: 'Data missing',
  CASE_PROVIDER_HEALTH_BAD: 'Provider health bad',
  CASE_MARKET_SIGNAL_NEUTRAL: 'Market signal neutral',
  CASE_PROGRAM_TRADING_EMPTY: 'Program trading empty',
  CASE_SCAN_DIAGNOSTIC_SUPPRESSED: 'Scan diagnostic suppressed',
  CASE_UNKNOWN: 'Unclassified case',
};

const CASE_TYPE_DESCRIPTIONS: Record<ShadowCaseType, string> = {
  CASE_SUPPLY_UNSTABLE: 'Supply data is unstable. Live decisioning may be constrained, while Shadow Learning should continue.',
  CASE_HOLIDAY: 'Market-holiday observation case. Watchlist state, virtual decisions, and follow-up tracking remain learning assets.',
  CASE_LUNCH_BREAK: 'Session break observation case. No live entry is implied, and the case can still preserve context.',
  CASE_SELL_ONLY: 'New buys are blocked by sell-only time or policy, while position management and Shadow decisions continue.',
  CASE_SHADOW_ONLY: 'The runtime is intentionally in Shadow-only mode. This is counterfactual learning data, not a live signal.',
  CASE_KRX_DELAY: 'KRX data is delayed. Treat this as data availability or provider timing before treating it as a market signal.',
  CASE_KIS_500: 'KIS API provider error. Do not interpret it as deterioration in market supply or demand.',
  CASE_DART_DELAY: 'DART provider delay. Separate provider timeliness from company or market signal interpretation.',
  CASE_YAHOO_STALE: 'Yahoo data is stale. Verify freshness before using derived market context.',
  CASE_MACRO_RISK_OFF: 'Macro risk-off condition blocked or constrained live action and should be reviewed with post-outcome evidence.',
  CASE_STRONG_BUY_BLOCKED: 'A buy signal existed but policy, data, or regime constraints blocked live action. Post-outcome tracking has high learning value.',
  CASE_BUYLIST_EMPTY: 'No candidate symbols were available. This can teach market condition or filter-strength behavior rather than indicating failure.',
  CASE_WATCHLIST_REFRESHED_BUT_NO_EXECUTION: 'The watchlist refreshed without live execution. Review whether policy, timing, or data gates created a learning case.',
  CASE_DATA_MISSING: 'Required data was missing. Confirm whether provider coverage, source freshness, or pipeline availability is the root cause.',
  CASE_PROVIDER_HEALTH_BAD: 'Provider health was degraded. Keep this separate from market-direction interpretation.',
  CASE_MARKET_SIGNAL_NEUTRAL: 'Market signal was neutral. Preserve the observation so later outcomes can calibrate neutrality thresholds.',
  CASE_PROGRAM_TRADING_EMPTY: 'Program-trading data is empty. Determine whether this is coverage/data availability or a true market information gap.',
  CASE_SCAN_DIAGNOSTIC_SUPPRESSED: 'Diagnostic scan output was suppressed for noise control. Shadow case recording should remain read-only and no-impact.',
  CASE_UNKNOWN: 'Unclassified Shadow case. Add source metadata before using it for precise operator diagnosis.',
};

function countByKey<T extends string>(keys: readonly T[], items: ShadowCaseItem[], selector: (item: ShadowCaseItem) => T): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const item of items) counts[selector(item)] += 1;
  return counts;
}

export function countShadowCasesByType(items: ShadowCaseItem[]): Record<ShadowCaseType, number> {
  return countByKey(ALL_SHADOW_CASE_TYPES, items, (item) => item.caseType);
}

export function countShadowCasesByStatus(items: ShadowCaseItem[]): Record<ShadowCaseStatus, number> {
  return countByKey(ALL_SHADOW_CASE_STATUS, items, (item) => item.status);
}

export function getOpenShadowCases(items: ShadowCaseItem[]): ShadowCaseItem[] {
  return items.filter((item) => item.status === 'OPEN' || item.status === 'NEEDS_REVIEW');
}

export function getOutcomePendingCases(items: ShadowCaseItem[]): ShadowCaseItem[] {
  return items.filter((item) => item.status === 'OUTCOME_PENDING' || item.postOutcome === 'PENDING');
}

export function getCasesWithExecutionImpactRisk(items: ShadowCaseItem[]): ShadowCaseItem[] {
  return items.filter((item) => item.executionImpact !== 'NONE');
}

export function deriveShadowLearningBanner(items: ShadowCaseItem[]): string | null {
  if (items.length === 0) return null;
  const impactRisk = getCasesWithExecutionImpactRisk(items).length;
  if (impactRisk > 0) return `Execution-impact risk detected in ${impactRisk} Shadow case(s). Review case metadata before interpretation.`;
  const activeBlockedModes = items.some((item) => item.engineMode === 'SELL_ONLY' || item.engineMode === 'SHADOW_ONLY' || item.engineMode === 'OBSERVE_ONLY');
  if (activeBlockedModes) return 'Shadow Learning is recording no-impact cases while live execution is constrained.';
  return 'Shadow Learning cases are recording with executionImpact=NONE.';
}

export function deriveShadowCaseSeverity(item: ShadowCaseItem): ShadowCaseSeverity {
  if (item.executionImpact === 'BLOCKING') return 'CRITICAL';
  if (item.executionImpact !== 'NONE') return 'ERROR';
  if (item.providerIssue && item.marketSignal) return 'WARN';
  if (item.dataHealth === 'MISSING' || item.dataHealth === 'STALE') return 'WARN';
  return 'INFO';
}

export function deriveShadowRecommendedAction(item: ShadowCaseItem): string {
  if (item.nextAction) return item.nextAction;
  if (item.executionImpact !== 'NONE') return 'Audit execution-impact metadata and confirm no live order coupling.';
  if (item.providerIssue && item.marketSignal) return 'Split provider fault metadata from market signal metadata.';
  if (item.providerIssue) return 'Check provider health and keep this separate from market interpretation.';
  if (item.marketSignal) return 'Track post-outcome and calibrate gate thresholds.';
  if (item.postOutcome === 'PENDING') return 'Wait for post-outcome tracking before changing policy.';
  return 'Observe and keep as counterfactual learning evidence.';
}

export function splitProviderIssueAndMarketSignal(items: ShadowCaseItem[]): {
  providerIssues: ShadowCaseItem[];
  marketSignals: ShadowCaseItem[];
  mixed: ShadowCaseItem[];
  unknown: ShadowCaseItem[];
} {
  return {
    providerIssues: items.filter((item) => item.providerIssue === true && item.marketSignal !== true),
    marketSignals: items.filter((item) => item.marketSignal === true && item.providerIssue !== true),
    mixed: items.filter((item) => item.providerIssue === true && item.marketSignal === true),
    unknown: items.filter((item) => item.providerIssue !== true && item.marketSignal !== true),
  };
}

export function formatShadowCaseTimestamp(value?: string): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function getShadowCaseTypeLabel(caseType: ShadowCaseType): string {
  return CASE_TYPE_LABELS[caseType];
}

export function getShadowCaseTypeDescription(caseType: ShadowCaseType): string {
  return CASE_TYPE_DESCRIPTIONS[caseType];
}
