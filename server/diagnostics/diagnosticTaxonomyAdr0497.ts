// @responsibility ADR-0497 Diagnostic taxonomy SSOT; pure diagnostic-only helpers, no live execution wiring.

type ExecutionImpactAdr0497 = 'NONE';

export interface DiagnosticOnlyPolicyAdr0497 {
  executionImpact: ExecutionImpactAdr0497;
  liveExecutionAllowed: false;
  rawPayloadPersistenceAllowed: false;
  gateMutationAllowed: false;
  orderPathAllowed: false;
  autoPromotionAllowed: false;
  strongBuyUnlockAllowed: false;
}

export const DIAGNOSTIC_ONLY_POLICY_ADR0497: DiagnosticOnlyPolicyAdr0497 = Object.freeze({
  executionImpact: 'NONE',
  liveExecutionAllowed: false,
  rawPayloadPersistenceAllowed: false,
  gateMutationAllowed: false,
  orderPathAllowed: false,
  autoPromotionAllowed: false,
  strongBuyUnlockAllowed: false,
});

export type DataConfidenceAdr0497 =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'UNKNOWN';

export type DataLineStatusAdr0497 =
  | 'NOT_CONFIGURED'
  | 'OBSERVING'
  | 'PARTIAL'
  | 'READY_FOR_SHADOW'
  | 'READY_FOR_ADVISORY'
  | 'BLOCKED'
  | 'DISABLED';

export type ProviderHealthStatusAdr0497 =
  | 'UP'
  | 'DOWN'
  | 'DELAYED'
  | 'RATE_LIMITED'
  | 'PARSE_ERROR'
  | 'EMPTY'
  | 'STALE'
  | 'UNKNOWN';

export type MarketSignalDirectionAdr0497 =
  | 'BULLISH'
  | 'BEARISH'
  | 'NEUTRAL'
  | 'MIXED'
  | 'UNKNOWN';

export interface ProviderMarketSeparationAdr0497 {
  providerHealth: ProviderHealthStatusAdr0497;
  providerIssue: boolean;
  marketSignal: MarketSignalDirectionAdr0497;
  isMarketSignalValid: boolean;
  reason: string;
}

const PROVIDER_ISSUE_REASON_ADR0497 = 'provider issue is diagnostic evidence, not a market signal';

function isKnownMarketSignalAdr0497(value: unknown): value is MarketSignalDirectionAdr0497 {
  return value === 'BULLISH'
    || value === 'BEARISH'
    || value === 'NEUTRAL'
    || value === 'MIXED'
    || value === 'UNKNOWN';
}

function isUpProviderAdr0497(providerHealth: ProviderHealthStatusAdr0497 | undefined): providerHealth is 'UP' {
  return providerHealth === 'UP';
}

export function classifyProviderMarketSeparationAdr0497(input: {
  providerHealth: ProviderHealthStatusAdr0497;
  requestedMarketSignal?: MarketSignalDirectionAdr0497 | null;
}): ProviderMarketSeparationAdr0497 {
  const providerHealth = input.providerHealth ?? 'UNKNOWN';
  const requestedMarketSignal = input.requestedMarketSignal;

  if (!isUpProviderAdr0497(providerHealth)) {
    return {
      providerHealth,
      providerIssue: true,
      marketSignal: 'UNKNOWN',
      isMarketSignalValid: false,
      reason: PROVIDER_ISSUE_REASON_ADR0497,
    };
  }

  if (!isKnownMarketSignalAdr0497(requestedMarketSignal) || requestedMarketSignal === 'UNKNOWN') {
    return {
      providerHealth,
      providerIssue: false,
      marketSignal: 'UNKNOWN',
      isMarketSignalValid: false,
      reason: 'provider is up but no valid market signal was supplied',
    };
  }

  return {
    providerHealth,
    providerIssue: false,
    marketSignal: requestedMarketSignal,
    isMarketSignalValid: true,
    reason: 'provider is up and requested market signal is preserved',
  };
}

type DataValueStateAdr0497 =
  | 'VALID_NUMBER'
  | 'ZERO'
  | 'NULL'
  | 'MISSING'
  | 'STALE'
  | 'PROVIDER_ERROR'
  | 'PARSE_ERROR';

export interface NormalizedDataValueAdr0497 {
  rawValuePresent: boolean;
  numericValue: number | null;
  valueState: DataValueStateAdr0497;
  missingReason?: string;
}

function normalizedValueAdr0497(input: {
  rawValuePresent: boolean;
  numericValue: number | null;
  valueState: DataValueStateAdr0497;
  missingReason?: string;
}): NormalizedDataValueAdr0497 {
  return input.missingReason
    ? input
    : {
      rawValuePresent: input.rawValuePresent,
      numericValue: input.numericValue,
      valueState: input.valueState,
    };
}

export function normalizeDataValueAdr0497(input: {
  value?: unknown;
  fieldPresent?: boolean;
  stale?: boolean;
  providerError?: boolean;
  parseError?: boolean;
  missingReason?: string;
}): NormalizedDataValueAdr0497 {
  const rawValuePresent = input.fieldPresent !== false && input.value !== undefined;
  const missingReason = input.missingReason;

  if (input.providerError) return normalizedValueAdr0497({ rawValuePresent, numericValue: null, valueState: 'PROVIDER_ERROR', missingReason });
  if (input.parseError) return normalizedValueAdr0497({ rawValuePresent, numericValue: null, valueState: 'PARSE_ERROR', missingReason });
  if (input.stale) return normalizedValueAdr0497({ rawValuePresent, numericValue: null, valueState: 'STALE', missingReason });
  if (input.fieldPresent === false) return normalizedValueAdr0497({ rawValuePresent: false, numericValue: null, valueState: 'MISSING', missingReason });
  if (input.value === null) return normalizedValueAdr0497({ rawValuePresent: true, numericValue: null, valueState: 'NULL', missingReason });
  if (input.value === undefined) return normalizedValueAdr0497({ rawValuePresent: false, numericValue: null, valueState: 'MISSING', missingReason });

  if (typeof input.value === 'number') {
    if (!Number.isFinite(input.value)) return normalizedValueAdr0497({ rawValuePresent: true, numericValue: null, valueState: 'PARSE_ERROR', missingReason });
    return normalizedValueAdr0497({ rawValuePresent: true, numericValue: input.value, valueState: input.value === 0 ? 'ZERO' : 'VALID_NUMBER', missingReason });
  }

  if (typeof input.value === 'string') {
    const normalized = input.value.trim().replace(/,/g, '');
    const parsed = Number(normalized);
    if (normalized.length === 0 || !Number.isFinite(parsed)) {
      return normalizedValueAdr0497({ rawValuePresent: true, numericValue: null, valueState: 'PARSE_ERROR', missingReason });
    }
    return normalizedValueAdr0497({ rawValuePresent: true, numericValue: parsed, valueState: parsed === 0 ? 'ZERO' : 'VALID_NUMBER', missingReason });
  }

  return normalizedValueAdr0497({ rawValuePresent: true, numericValue: null, valueState: 'PARSE_ERROR', missingReason });
}

export type PromotionReadinessStatusAdr0497 =
  | 'NOT_EVALUATED'
  | 'READY'
  | 'BLOCKED'
  | 'INSUFFICIENT_HISTORY'
  | 'INSUFFICIENT_COVERAGE'
  | 'PROVIDER_UNSTABLE'
  | 'CORE_BLOCKED'
  | 'UNKNOWN';

export type GateFailureCauseAdr0497 =
  | 'DATA_MISSING'
  | 'DATA_STALE'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_EMPTY'
  | 'MARKET_SESSION_BLOCK'
  | 'SELL_ONLY_BLOCK'
  | 'MACRO_RISK_OFF'
  | 'SECTOR_ENERGY_UNOBSERVABLE'
  | 'SUPPLY_CONFLUENCE_UNAVAILABLE'
  | 'THRESHOLD_TOO_STRICT'
  | 'SIGNAL_CONFLICT'
  | 'INSUFFICIENT_POSITIVE_SCORE'
  | 'RISK_PENALTY_DOMINANT'
  | 'SIZING_BLOCK'
  | 'UNKNOWN';

export interface GateFailureAttributionEntryAdr0497 {
  timestamp: string;
  scanId: string;
  symbol?: string;
  gateName: string;
  failureCause: GateFailureCauseAdr0497;
  providerHealth?: ProviderHealthStatusAdr0497;
  dataConfidence?: DataConfidenceAdr0497;
  marketSignal?: MarketSignalDirectionAdr0497;
  promotionReadiness?: PromotionReadinessStatusAdr0497;
  engineMode?: string;
  marketSession?: string;
  executionImpact: 'NONE' | 'BLOCKED' | 'DOWNGRADED';
  shadowLearningTag: string;
}

export function buildGateFailureAttributionEntryAdr0497(
  input: Partial<Omit<GateFailureAttributionEntryAdr0497, 'timestamp'>> & { timestamp?: string } = {},
): GateFailureAttributionEntryAdr0497 {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    scanId: input.scanId ?? 'UNKNOWN_SCAN',
    ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    gateName: input.gateName ?? 'UNKNOWN_GATE',
    failureCause: input.failureCause ?? 'UNKNOWN',
    ...(input.providerHealth === undefined ? {} : { providerHealth: input.providerHealth }),
    ...(input.dataConfidence === undefined ? {} : { dataConfidence: input.dataConfidence }),
    ...(input.marketSignal === undefined ? {} : { marketSignal: input.marketSignal }),
    ...(input.promotionReadiness === undefined ? {} : { promotionReadiness: input.promotionReadiness }),
    ...(input.engineMode === undefined ? {} : { engineMode: input.engineMode }),
    ...(input.marketSession === undefined ? {} : { marketSession: input.marketSession }),
    executionImpact: input.executionImpact ?? 'NONE',
    shadowLearningTag: input.shadowLearningTag ?? 'ADR-0497_DIAGNOSTIC_ONLY',
  };
}

export interface FreshDataStatusViewModelAdr0497 {
  dataLineId: string;
  domain:
    | 'SECTOR_ENERGY'
    | 'INVESTOR_FLOW'
    | 'PROGRAM_TRADING'
    | 'SNAPSHOT'
    | 'SCHEDULER'
    | 'PROMOTION_AUDIT'
    | 'UNKNOWN';
  providerHealth: ProviderHealthStatusAdr0497;
  providerDisplay?: string;
  dataConfidence: DataConfidenceAdr0497;
  marketSignal: MarketSignalDirectionAdr0497;
  dataLineStatus: DataLineStatusAdr0497;
  promotionReadiness: PromotionReadinessStatusAdr0497;
  executionImpact: ExecutionImpactAdr0497;
  operatorMessage: string;
  blockers: string[];
  warnings: string[];
}

export function buildFreshDataStatusViewModelAdr0497(input: Partial<FreshDataStatusViewModelAdr0497> & {
  dataLineId: string;
}): FreshDataStatusViewModelAdr0497 {
  const providerHealth = input.providerHealth ?? 'UNKNOWN';
  const dataLineStatus = input.dataLineStatus ?? 'OBSERVING';
  const marketSignal = providerHealth === 'UP' ? (input.marketSignal ?? 'UNKNOWN') : 'UNKNOWN';
  const warnings = [...(input.warnings ?? [])];
  if (providerHealth !== 'UP' && !warnings.includes(PROVIDER_ISSUE_REASON_ADR0497)) {
    warnings.push(PROVIDER_ISSUE_REASON_ADR0497);
  }

  return {
    dataLineId: input.dataLineId,
    domain: input.domain ?? 'UNKNOWN',
    providerHealth,
    ...(input.providerDisplay === undefined ? {} : { providerDisplay: input.providerDisplay }),
    dataConfidence: input.dataConfidence ?? 'UNKNOWN',
    marketSignal,
    dataLineStatus,
    promotionReadiness: input.promotionReadiness ?? 'NOT_EVALUATED',
    executionImpact: 'NONE',
    operatorMessage: input.operatorMessage ?? `ADR-0497 ${input.dataLineId} status=${dataLineStatus} provider=${providerHealth}`,
    blockers: [...(input.blockers ?? [])],
    warnings,
  };
}

export function formatFreshDataStatusCompactAdr0497(viewModel: FreshDataStatusViewModelAdr0497): string {
  return `ADR-0497 Taxonomy: ${viewModel.domain}/${viewModel.dataLineId} provider=${viewModel.providerDisplay ?? viewModel.providerHealth} confidence=${viewModel.dataConfidence} signal=${viewModel.marketSignal} impact=${viewModel.executionImpact}`;
}

export function formatGateFailureAttributionCompactAdr0497(entry: GateFailureAttributionEntryAdr0497): string {
  const provider = entry.providerHealth ?? 'UNKNOWN';
  const confidence = entry.dataConfidence ?? 'UNKNOWN';
  return `GateFailure ADR-0497: ${entry.gateName} ${entry.failureCause} provider=${provider} confidence=${confidence} impact=${entry.executionImpact}`;
}
