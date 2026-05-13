/**
 * @responsibility ADR-0505 Gate1 Minimum Signal Forensic Audit SSOT — diagnostic-only.
 *
 * 사용자 명시 ADR-0502 → 실제 발급 ADR-0505 (INDEX SSOT 정합).
 * 충돌 그룹 0502a/b/c 이미 머지 완료 상태로 의미상 후속 ADR 신규 발급.
 *
 * 본 모듈은 ADR-0466 `buildMinimumSignalScoreTrace()` 결과를 *부검*한다.
 * 점수 기준 완화 / requiredScore 변경 / Gate1 survivor 강제 생성 / 실거래
 * 판단 / 주문 / KIS order path 모두 *영구 금지*. executionImpact: 'NONE'
 * literal type 강제 (TypeScript 컴파일 타임).
 *
 * 책임 분리 (ADR-0148 §"단일 책임"):
 *   - 본 SSOT — 부검 결과 분해 + 종목별 detail + 집계 (compute only, 영속 X)
 *   - 호출자 측 — `persistScanResults` 안 try/catch 격리 wiring (ADR-0500 패턴)
 *   - 별도 영속 — `appendGate1MinimumSignalForensicTrace()` (FIFO 200 + 7일 TTL)
 *
 * 외부 의존성 0건 (KIS / KRX / Yahoo / Naver outbound) — read-only consumer.
 */

import type {
  MinimumSignalScoreTrace,
  SignalScoreComponentTrace,
  SignalScoreComponentCode,
  SignalScoreComponentConfidence,
} from './minimumSignalScoreTrace.js';
import type {
  CandidateEntryTrace,
  SupplyConfluenceState,
  SupplyProviderHealthTrace,
} from './entryFilterDecomposition.js';
import type { SectorEnergyExecutionImpactResult } from '../../clients/sectorEnergyExecutionImpact.js';

/* ───────── ENV 우회 SSOT (ADR-0157 정확 비교) ───────── */

/**
 * ENV `GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED=true` (default OFF).
 *
 * ADR-0157 정확 비교 의무 — `'1'` / `'TRUE'` / `'yes'` 모두 거부.
 * `=== 'true'` 만 활성으로 인정.
 *
 * 활성 시 forensic audit builder 가 `undefined` 를 반환해 호출자 측 ScanSummary
 * 영속 자체 skip → ADR-0500 동작 100% 보존.
 */
export function isGate1MinimumSignalForensicAuditDisabled(): boolean {
  return process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED === 'true';
}

/* ───────── Schema SSOT (사용자 명시 직접 반영, literal types 강제) ───────── */

export type MissingPositiveSource =
  | 'WATCHLIST_UPSTREAM_SCORE_MISSING'
  | 'RELATIVE_STRENGTH_MISSING'
  | 'BREAKOUT_STRUCTURE_MISSING'
  | 'PRICE_MOMENTUM_MISSING'
  | 'TECHNICAL_TREND_MISSING'
  | 'VOLUME_LIQUIDITY_MISSING';

export type DominantFailureReason =
  | 'POSITIVE_SCORE_STARVATION'
  | 'WATCHLIST_SCORE_NOT_IMPORTED'
  | 'RELATIVE_STRENGTH_SOURCE_MISSING'
  | 'BREAKOUT_STRUCTURE_SOURCE_MISSING'
  | 'SUPPLY_PROVIDER_UNKNOWN_PENALTY'
  | 'INVESTOR_FLOW_UNKNOWN_PENALTY'
  | 'SECTOR_ENERGY_DIAGNOSTIC_PENALTY'
  | 'SCORE_CEILING_BELOW_THRESHOLD'
  | 'MIXED'
  | 'UNKNOWN';

export type SupplyScopeWarning =
  | 'NONE'
  | 'KIS_FLOW_SYMBOL_MISMATCH'
  | 'KIS_FLOW_SYMBOL_MISSING'
  | 'KIS_FLOW_SEMANTIC_UNAVAILABLE'
  | 'POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT';

export interface ComponentForensicDetail {
  weightedScore: number;
  maxScore: number;
  confidence: SignalScoreComponentConfidence;
  providerIssue: boolean;
  marketSignal: boolean;
  penaltyApplied: boolean;
  penaltyReason?: string;
  message: string;
}

export interface SupplyScopeAudit {
  /** 사용자 명시 핵심 불변식 — 절대 변경 금지. */
  expectedScope: 'SYMBOL_LEVEL_INVESTOR_FLOW';
  /** CandidateEntryTrace.symbol — symbol-level supply 검증의 기준 축. */
  candidateSymbol?: string | null;
  /** quote.symbol — quote payload 가 종목 단위인지 확인하는 보조 축. */
  quoteSymbol?: string | null;
  kisFlowSymbol?: string | null;
  /** candidate/quote/kisFlow symbol 이 모두 확인될 때만 true. */
  symbolMatched: boolean | null;
  foreignNetBuy: number | null;
  institutionalNetBuy: number | null;
  programNetBuy?: number | null;
  semanticAvailable: boolean;
  /** symbol 확인 실패 수급은 SHADOW_ONLY diagnostic 으로만 표기한다. */
  scoreUsage?: 'SHADOW_ONLY';
  warning: SupplyScopeWarning;
}

export type HydrationMissingReason =
  | 'CANDIDATE_TRACE_MISSING'
  | 'FIELD_MISSING'
  | 'QUOTE_MISSING'
  | 'SYMBOL_FEATURES_MISSING'
  | 'CONDITION_RESULTS_MISSING';

export interface FeatureHydrationAuditAdr0509 {
  rsAvailable: boolean;
  breakoutAvailable: boolean;
  rsMissingReasons: HydrationMissingReason[];
  breakoutMissingReasons: HydrationMissingReason[];
  missingFields: string[];
  candidateTraceHasQuote: boolean;
  candidateTraceHasSymbolFeatures: boolean;
  candidateTraceHasConditionResults: boolean;
}

export interface SectorEnergyForensicAudit {
  /** 사용자 명시 — defaultRegistry evaluator 에 sector_energy 직접 등록 없음. */
  registeredInEvaluateServerGateRegistry: false;
  /** 사용자 명시 — sectorBoost / promotion / minimumScore / STRONG_BUY gating layer. */
  layer: 'SECTOR_BOOST_PROMOTION_MINIMUM_SCORE_LAYER';
  leadershipScore?: number | null;
  sectorBoost?: number | null;
  leadershipConfidence?: string | null;
  sectorBoostAllowed?: boolean | null;
  strongBuyAllowed?: boolean | null;
  diagnosticStatus?: string | null;
  scoringImpact?: string | null;
  executionImpact?: string | null;
  /** 사용자 명시 — SectorEnergy 가 raw gate score 직접 영향 절대 금지 (literal type). */
  directRawGateScoreImpact: 0;
}

export interface WouldPassIfFlags {
  unknownNeutral: boolean;
  providerPenaltyRemoved: boolean;
  sectorPenaltyRemoved: boolean;
  softFailPenaltyRemoved: boolean;
  watchlistImportedPlus5: boolean;
  relativeStrengthRestoredPlus7: boolean;
  breakoutStructureRestoredPlus5: boolean;
  allPositiveSourcesRestored: boolean;
}

/** ADR-0505 종목별 forensic audit 결과. */
export interface Gate1MinimumSignalForensicAuditAdr0505 {
  symbol: string;
  name?: string;

  /** 100-scale minimum signal score 체계. raw evaluateServerGate score 와 분리. */
  scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE';
  requiredScore: number;
  actualScore: number;
  scoreGap: number;
  passed: boolean;

  positiveComponents: Record<string, ComponentForensicDetail>;
  penaltyComponents: Record<string, ComponentForensicDetail>;

  missingPositiveSources: MissingPositiveSource[];
  dominantFailureReason: DominantFailureReason;

  supplyScopeAudit: SupplyScopeAudit;
  hydrationAuditAdr0509?: FeatureHydrationAuditAdr0509;
  sectorEnergyAudit: SectorEnergyForensicAudit;

  wouldPassIf: WouldPassIfFlags;

  /** literal 강제 — TypeScript 컴파일 타임 invariant. */
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
}

/** ScanSummary 집계 — 종목별 audit 의 분포. */
export interface Gate1MinimumSignalForensicSummaryAdr0505 {
  totalCandidates: number;
  failedCandidates: number;
  requiredScoreAvg: number;
  actualScoreAvg: number;
  avgScoreGap: number;

  dominantFailureDistribution: Record<DominantFailureReason, number>;

  missingPositiveSourceCounts: {
    watchlistUpstreamMissing: number;
    relativeStrengthMissing: number;
    breakoutStructureMissing: number;
    priceMomentumMissing: number;
    technicalTrendMissing: number;
    volumeLiquidityMissing: number;
  };

  penaltyCounts: {
    supplyUnknownPenalty: number;
    investorFlowUnknownPenalty: number;
    sectorEnergyPenaltyOrBlocked: number;
    unknownDataPenalty: number;
    softFailPenalty: number;
    riskPenalty: number;
  };

  supplyScopeWarnings: Record<SupplyScopeWarning, number>;
  supplySymbolMatchedCount?: number;
  rsHydrationAvailableCount?: number;
  breakoutHydrationAvailableCount?: number;
  rsMissingReasonDistribution?: Record<HydrationMissingReason, number>;
  breakoutMissingReasonDistribution?: Record<HydrationMissingReason, number>;
  topHydrationMissingFields?: string[];
  candidateTraceHasQuote?: number;
  candidateTraceHasSymbolFeatures?: number;
  candidateTraceHasConditionResults?: number;
  sectorEnergyStrongBuyBlockedCount: number;
  sectorEnergyHardBlockCount: number;

  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
}

/* ───────── 컴포넌트 분류 정책 SSOT (사용자 명시 절대 변경 금지) ───────── */

const POSITIVE_COMPONENT_CODES: ReadonlySet<SignalScoreComponentCode> = new Set([
  'PRICE_MOMENTUM',
  'VOLUME_LIQUIDITY',
  'TECHNICAL_TREND',
  'RELATIVE_STRENGTH',
  'WATCHLIST_UPSTREAM_SCORE',
  'BREAKOUT_STRUCTURE',
  'SUPPLY_CONFLUENCE',
  'INVESTOR_FLOW',
  'SECTOR_ENERGY',
  'MARKET_REGIME',
  'NEWS_OR_CATALYST',
  'WATCHLIST_PRIORITY',
]);

const PENALTY_COMPONENT_CODES: ReadonlySet<SignalScoreComponentCode> = new Set([
  'MACRO_RISK',
  'DATA_QUALITY',
  'SESSION_STATUS',
  'RISK_PENALTY',
  'UNKNOWN_DATA_PENALTY',
  'SOFT_FAIL_PENALTY',
]);

const MISSING_CONFIDENCE: ReadonlySet<SignalScoreComponentConfidence> = new Set([
  'MISSING',
  'UNKNOWN',
  'DIAGNOSTIC_ONLY',
]);

/* ───────── 입력 schema ───────── */

export interface BuildGate1MinimumSignalForensicInput {
  trace: MinimumSignalScoreTrace;
  candidate?: CandidateEntryTrace;
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  supplyConfluence?: SupplyConfluenceState;
  kisFlow?: {
    symbol?: string | null;
    foreignNetBuy?: number | null;
    institutionalNetBuy?: number | null;
    programNetBuy?: number | null;
    semanticAvailable?: boolean;
  };
  quoteSymbol?: string | null;
  sectorEnergyImpact?: SectorEnergyExecutionImpactResult;
}

/* ───────── 핵심 SSOT — buildGate1MinimumSignalForensicAuditAdr0505 ───────── */

/**
 * 종목별 forensic audit 생성.
 *
 * 호출자 측 invariant — 본 함수가 throw 하지 않도록 호출자가 try/catch 격리.
 * ENV 우회 활성 시 호출자는 본 함수를 호출하지 *않아야* 한다 (호출자 책임).
 * 본 함수 자체는 항상 동작.
 */
export function buildGate1MinimumSignalForensicAuditAdr0505(
  input: BuildGate1MinimumSignalForensicInput,
): Gate1MinimumSignalForensicAuditAdr0505 {
  const { trace, candidate, supplyProviderHealth, kisFlow, quoteSymbol, sectorEnergyImpact } = input;

  // 1) 컴포넌트 분류 — positive vs penalty
  const positiveComponents: Record<string, ComponentForensicDetail> = {};
  const penaltyComponents: Record<string, ComponentForensicDetail> = {};
  const missingPositiveSources: MissingPositiveSource[] = [];

  for (const c of trace.components ?? []) {
    const detail: ComponentForensicDetail = {
      weightedScore: c.weightedScore ?? 0,
      maxScore: c.maxScore ?? 0,
      confidence: c.confidence,
      providerIssue: Boolean(c.providerIssue),
      marketSignal: Boolean(c.marketSignal),
      penaltyApplied: Boolean(c.penaltyApplied),
      penaltyReason: c.penaltyReason,
      message: c.message ?? '',
    };

    const isPositive = POSITIVE_COMPONENT_CODES.has(c.code);
    const isExplicitPenalty = PENALTY_COMPONENT_CODES.has(c.code);

    // penaltyApplied=true 또는 weightedScore<0 또는 explicit penalty code → penaltyComponents
    if (isExplicitPenalty || (c.weightedScore ?? 0) < 0 || detail.penaltyApplied) {
      penaltyComponents[c.code] = detail;
    } else if (isPositive) {
      positiveComponents[c.code] = detail;

      // missing positive source 분류 — weightedScore=0 + MISSING/UNKNOWN/DIAGNOSTIC_ONLY confidence
      if ((c.weightedScore ?? 0) === 0 && MISSING_CONFIDENCE.has(c.confidence)) {
        const missingCode = mapToMissingPositiveSource(c.code);
        if (missingCode) missingPositiveSources.push(missingCode);
      }
    }
  }

  // 2) dominantFailureReason 결정 트리
  const dominantFailureReason = computeDominantFailureReason({
    trace,
    missingPositiveSources,
    penaltyComponents,
  });

  // 3) supplyScopeAudit
  const supplyScopeAudit = buildSupplyScopeAudit({
    trace,
    candidate,
    supplyProviderHealth,
    kisFlow,
    quoteSymbol,
  });

  // 4) ADR-0509 hydration audit — diagnostic-only, scoring 영향 0
  const hydrationAuditAdr0509 = buildFeatureHydrationAuditAdr0509(candidate);

  // 5) sectorEnergyAudit
  const sectorEnergyAudit = buildSectorEnergyAudit({ candidate, sectorEnergyImpact });

  // 6) wouldPassIf flags
  const wouldPassIf = computeWouldPassIf({ trace, missingPositiveSources });

  return {
    symbol: trace.symbol,
    name: trace.name,
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: trace.requiredScore,
    actualScore: trace.actualScore,
    scoreGap: trace.scoreGap,
    passed: trace.passed,
    positiveComponents,
    penaltyComponents,
    missingPositiveSources,
    dominantFailureReason,
    supplyScopeAudit,
    hydrationAuditAdr0509,
    sectorEnergyAudit,
    wouldPassIf,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

/* ───────── 분류 헬퍼 SSOT ───────── */

function mapToMissingPositiveSource(code: SignalScoreComponentCode): MissingPositiveSource | null {
  switch (code) {
    case 'WATCHLIST_UPSTREAM_SCORE':
      return 'WATCHLIST_UPSTREAM_SCORE_MISSING';
    case 'RELATIVE_STRENGTH':
      return 'RELATIVE_STRENGTH_MISSING';
    case 'BREAKOUT_STRUCTURE':
      return 'BREAKOUT_STRUCTURE_MISSING';
    case 'PRICE_MOMENTUM':
      return 'PRICE_MOMENTUM_MISSING';
    case 'TECHNICAL_TREND':
      return 'TECHNICAL_TREND_MISSING';
    case 'VOLUME_LIQUIDITY':
      return 'VOLUME_LIQUIDITY_MISSING';
    default:
      return null;
  }
}

function computeDominantFailureReason(input: {
  trace: MinimumSignalScoreTrace;
  missingPositiveSources: MissingPositiveSource[];
  penaltyComponents: Record<string, ComponentForensicDetail>;
}): DominantFailureReason {
  const { trace, missingPositiveSources, penaltyComponents } = input;

  if (trace.passed) return 'UNKNOWN'; // 통과 케이스 — 부검 부적합

  const core3Missing =
    missingPositiveSources.includes('WATCHLIST_UPSTREAM_SCORE_MISSING') &&
    missingPositiveSources.includes('RELATIVE_STRENGTH_MISSING') &&
    missingPositiveSources.includes('BREAKOUT_STRUCTURE_MISSING');

  if (core3Missing) return 'POSITIVE_SCORE_STARVATION';

  // 단일 missing 우세
  if (missingPositiveSources.length === 1) {
    const only = missingPositiveSources[0];
    if (only === 'WATCHLIST_UPSTREAM_SCORE_MISSING') return 'WATCHLIST_SCORE_NOT_IMPORTED';
    if (only === 'RELATIVE_STRENGTH_MISSING') return 'RELATIVE_STRENGTH_SOURCE_MISSING';
    if (only === 'BREAKOUT_STRUCTURE_MISSING') return 'BREAKOUT_STRUCTURE_SOURCE_MISSING';
  }

  // penalty 우세
  const supply = penaltyComponents['SUPPLY_CONFLUENCE'];
  if (supply && supply.weightedScore < 0) return 'SUPPLY_PROVIDER_UNKNOWN_PENALTY';

  const investor = penaltyComponents['INVESTOR_FLOW'];
  if (investor && investor.weightedScore < 0) return 'INVESTOR_FLOW_UNKNOWN_PENALTY';

  const sector = penaltyComponents['SECTOR_ENERGY'];
  if (sector && (sector.weightedScore < 0 || sector.penaltyApplied)) {
    return 'SECTOR_ENERGY_DIAGNOSTIC_PENALTY';
  }

  // ceiling 미달
  const totalPossibleCeiling = trace.positiveScoreTotal + trace.penaltyTotal;
  if (totalPossibleCeiling < trace.requiredScore && missingPositiveSources.length === 0) {
    return 'SCORE_CEILING_BELOW_THRESHOLD';
  }

  // 복합
  if (missingPositiveSources.length >= 2 || Object.keys(penaltyComponents).length >= 2) {
    return 'MIXED';
  }

  return 'UNKNOWN';
}

/* ───────── supplyScopeAudit SSOT ───────── */

function buildSupplyScopeAudit(input: {
  trace: MinimumSignalScoreTrace;
  candidate?: CandidateEntryTrace;
  supplyProviderHealth?: Partial<SupplyProviderHealthTrace>;
  kisFlow?: BuildGate1MinimumSignalForensicInput['kisFlow'];
  quoteSymbol?: string | null;
}): SupplyScopeAudit {
  const { trace, candidate, kisFlow, quoteSymbol, supplyProviderHealth } = input;

  const kisSymbol = normalizeSymbol(kisFlow?.symbol ?? null);
  const candidateSymbol = normalizeSymbol(candidate?.symbol ?? trace.symbol ?? null);
  const quoteObject = candidate?.quote && typeof candidate.quote === 'object'
    ? (candidate.quote as Record<string, unknown>)
    : undefined;
  const qSymbol = normalizeSymbol(quoteSymbol ?? (quoteObject?.symbol as string | null | undefined) ?? null);
  const traceSymbol = normalizeSymbol(trace.symbol);

  const foreignNetBuy = kisFlow?.foreignNetBuy ?? null;
  const institutionalNetBuy = kisFlow?.institutionalNetBuy ?? null;
  const programNetBuy = kisFlow?.programNetBuy ?? null;
  const semanticAvailable = kisFlow?.semanticAvailable === true;

  // symbolMatched 판정 — 둘 다 있고 일치 시 true / 둘 다 있고 불일치 시 false / 그 외 null
  let symbolMatched: boolean | null = null;
  const expectedSymbol = candidateSymbol ?? qSymbol ?? traceSymbol;
  if (kisSymbol && expectedSymbol) {
    symbolMatched = kisSymbol === expectedSymbol && (!qSymbol || qSymbol === expectedSymbol);
  }

  // warning 우선순위 결정 트리 (사용자 명시 절대 변경 금지)
  let warning: SupplyScopeWarning = 'NONE';

  if (!kisSymbol) {
    warning = 'KIS_FLOW_SYMBOL_MISSING';
  } else if (symbolMatched === false) {
    warning = 'KIS_FLOW_SYMBOL_MISMATCH';
  } else if (kisFlow !== undefined && !semanticAvailable) {
    warning = 'KIS_FLOW_SEMANTIC_UNAVAILABLE';
  }

  // POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT — providerName / providerTried 에
  // 'MARKET_WIDE' 또는 'AGGREGATE' 키워드 검출 시
  const providerSignals: string[] = [];
  if (supplyProviderHealth?.providerName) providerSignals.push(supplyProviderHealth.providerName);
  if (supplyProviderHealth?.selectedInvestorFlowProvider) {
    providerSignals.push(supplyProviderHealth.selectedInvestorFlowProvider);
  }
  if (supplyProviderHealth?.providerTried) {
    providerSignals.push(...supplyProviderHealth.providerTried);
  }
  const hasMarketWideSignal = providerSignals.some((s) => {
    const lower = (s ?? '').toLowerCase();
    return lower.includes('market_wide') || lower.includes('market-wide') || lower.includes('aggregate');
  });
  if (hasMarketWideSignal && warning === 'NONE') {
    warning = 'POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT';
  }

  return {
    expectedScope: 'SYMBOL_LEVEL_INVESTOR_FLOW',
    candidateSymbol,
    quoteSymbol: qSymbol,
    kisFlowSymbol: kisSymbol,
    symbolMatched,
    foreignNetBuy,
    institutionalNetBuy,
    programNetBuy,
    semanticAvailable,
    scoreUsage: 'SHADOW_ONLY',
    warning,
  };
}


function normalizeSymbol(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

const RS_HYDRATION_FIELDS = [
  'return20d',
  'return5d',
  'kospi20dReturn',
  'relativeReturn20d',
  'marketRelativeReturn',
  'rsRankPct',
  'relativeStrengthScore',
] as const;

const BREAKOUT_HYDRATION_FIELDS = [
  'price',
  'high5d',
  'high20d',
  'high60',
  'volume',
  'avgVolume',
  'breakout_momentum',
  'turtle_high',
  'volume_breakout',
  'volume_surge',
  'vcp',
  'trend_acceleration',
  'breakoutSignals',
  'conditionResults',
  'conditionKeys',
] as const;

function hasHydrationField(candidate: CandidateEntryTrace, field: string): boolean {
  const record = candidate as unknown as Record<string, unknown>;
  const direct = record[field];
  if (direct !== undefined && direct !== null) return true;
  const quote = record.quote;
  if (quote && typeof quote === 'object' && (quote as Record<string, unknown>)[field] != null) return true;
  const symbolFeatures = record.symbolFeatures;
  if (symbolFeatures && typeof symbolFeatures === 'object' && (symbolFeatures as Record<string, unknown>)[field] != null) {
    return true;
  }
  const macroState = record.macroState;
  if (macroState && typeof macroState === 'object' && (macroState as Record<string, unknown>)[field] != null) return true;
  return false;
}

function buildFeatureHydrationAuditAdr0509(
  candidate: CandidateEntryTrace | undefined,
): FeatureHydrationAuditAdr0509 {
  if (!candidate) {
    return {
      rsAvailable: false,
      breakoutAvailable: false,
      rsMissingReasons: ['CANDIDATE_TRACE_MISSING'],
      breakoutMissingReasons: ['CANDIDATE_TRACE_MISSING'],
      missingFields: [...RS_HYDRATION_FIELDS, ...BREAKOUT_HYDRATION_FIELDS],
      candidateTraceHasQuote: false,
      candidateTraceHasSymbolFeatures: false,
      candidateTraceHasConditionResults: false,
    };
  }
  const record = candidate as unknown as Record<string, unknown>;
  const candidateTraceHasQuote = Boolean(record.quote && typeof record.quote === 'object');
  const candidateTraceHasSymbolFeatures = Boolean(record.symbolFeatures && typeof record.symbolFeatures === 'object');
  const candidateTraceHasConditionResults = Boolean(record.conditionResults && typeof record.conditionResults === 'object');
  const missingFields = [
    ...RS_HYDRATION_FIELDS.filter((field) => !hasHydrationField(candidate, field)),
    ...BREAKOUT_HYDRATION_FIELDS.filter((field) => !hasHydrationField(candidate, field)),
  ];
  const rsAvailable = RS_HYDRATION_FIELDS.some((field) => hasHydrationField(candidate, field));
  const breakoutAvailable = BREAKOUT_HYDRATION_FIELDS.some((field) => hasHydrationField(candidate, field));
  const rsMissingReasons: HydrationMissingReason[] = [];
  const breakoutMissingReasons: HydrationMissingReason[] = [];
  if (!rsAvailable) rsMissingReasons.push('FIELD_MISSING');
  if (!candidateTraceHasQuote) rsMissingReasons.push('QUOTE_MISSING');
  if (!candidateTraceHasSymbolFeatures) rsMissingReasons.push('SYMBOL_FEATURES_MISSING');
  if (!breakoutAvailable) breakoutMissingReasons.push('FIELD_MISSING');
  if (!candidateTraceHasConditionResults) breakoutMissingReasons.push('CONDITION_RESULTS_MISSING');
  if (!candidateTraceHasSymbolFeatures) breakoutMissingReasons.push('SYMBOL_FEATURES_MISSING');
  return {
    rsAvailable,
    breakoutAvailable,
    rsMissingReasons,
    breakoutMissingReasons,
    missingFields,
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
  };
}

const EMPTY_HYDRATION_REASON_DISTRIBUTION: Record<HydrationMissingReason, number> = {
  CANDIDATE_TRACE_MISSING: 0,
  FIELD_MISSING: 0,
  QUOTE_MISSING: 0,
  SYMBOL_FEATURES_MISSING: 0,
  CONDITION_RESULTS_MISSING: 0,
};

/* ───────── sectorEnergyAudit SSOT ───────── */

function buildSectorEnergyAudit(input: {
  candidate?: CandidateEntryTrace;
  sectorEnergyImpact?: SectorEnergyExecutionImpactResult;
}): SectorEnergyForensicAudit {
  const { candidate, sectorEnergyImpact } = input;

  return {
    registeredInEvaluateServerGateRegistry: false,
    layer: 'SECTOR_BOOST_PROMOTION_MINIMUM_SCORE_LAYER',
    leadershipScore: null, // ADR-0399 + ADR-0423 별도 SSOT
    sectorBoost: typeof candidate?.sectorBoost === 'number' ? candidate.sectorBoost : null,
    leadershipConfidence: null,
    sectorBoostAllowed: sectorEnergyImpact?.sectorBoostAllowed ?? null,
    strongBuyAllowed: sectorEnergyImpact?.strongBuyAllowed ?? null,
    diagnosticStatus: sectorEnergyImpact?.diagnosticStatus ?? candidate?.sectorEnergyState ?? null,
    scoringImpact: sectorEnergyImpact?.scoringImpact ?? null,
    executionImpact: sectorEnergyImpact?.executionImpact ?? null,
    directRawGateScoreImpact: 0,
  };
}

/* ───────── wouldPassIf SSOT ───────── */

function computeWouldPassIf(input: {
  trace: MinimumSignalScoreTrace;
  missingPositiveSources: MissingPositiveSource[];
}): WouldPassIfFlags {
  const { trace, missingPositiveSources } = input;

  return {
    unknownNeutral: Boolean(trace.wouldPassIfUnknownNeutral),
    providerPenaltyRemoved: Boolean(trace.wouldPassIfProviderPenaltyRemoved),
    sectorPenaltyRemoved: Boolean(trace.wouldPassIfSectorPenaltyRemoved),
    softFailPenaltyRemoved: Boolean(trace.wouldPassIfSoftFailPenaltyRemoved),
    // 단순 가설 — 점수 gap 이 5 이내였으면 watchlist +5 로 통과
    watchlistImportedPlus5:
      missingPositiveSources.includes('WATCHLIST_UPSTREAM_SCORE_MISSING') && trace.scoreGap >= -5,
    relativeStrengthRestoredPlus7:
      missingPositiveSources.includes('RELATIVE_STRENGTH_MISSING') && trace.scoreGap >= -7,
    breakoutStructureRestoredPlus5:
      missingPositiveSources.includes('BREAKOUT_STRUCTURE_MISSING') && trace.scoreGap >= -5,
    // 모든 missing source 복원 시 통과 가설 — 단순 합산
    allPositiveSourcesRestored:
      missingPositiveSources.length > 0 &&
      missingPositiveSources.length * 5 + trace.actualScore >= trace.requiredScore,
  };
}

/* ───────── 집계 SSOT — buildGate1MinimumSignalForensicSummaryAdr0505 ───────── */

const EMPTY_DOMINANT_DISTRIBUTION: Record<DominantFailureReason, number> = {
  POSITIVE_SCORE_STARVATION: 0,
  WATCHLIST_SCORE_NOT_IMPORTED: 0,
  RELATIVE_STRENGTH_SOURCE_MISSING: 0,
  BREAKOUT_STRUCTURE_SOURCE_MISSING: 0,
  SUPPLY_PROVIDER_UNKNOWN_PENALTY: 0,
  INVESTOR_FLOW_UNKNOWN_PENALTY: 0,
  SECTOR_ENERGY_DIAGNOSTIC_PENALTY: 0,
  SCORE_CEILING_BELOW_THRESHOLD: 0,
  MIXED: 0,
  UNKNOWN: 0,
};

const EMPTY_SUPPLY_SCOPE_WARNINGS: Record<SupplyScopeWarning, number> = {
  NONE: 0,
  KIS_FLOW_SYMBOL_MISMATCH: 0,
  KIS_FLOW_SYMBOL_MISSING: 0,
  KIS_FLOW_SEMANTIC_UNAVAILABLE: 0,
  POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT: 0,
};

export function buildGate1MinimumSignalForensicSummaryAdr0505(
  audits: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>,
): Gate1MinimumSignalForensicSummaryAdr0505 {
  const totalCandidates = audits.length;
  const failed = audits.filter((a) => !a.passed);
  const failedCandidates = failed.length;

  // 평균 계산 — 0건 시 0 fallback (NaN 차단)
  const requiredScoreAvg =
    totalCandidates > 0
      ? audits.reduce((sum, a) => sum + a.requiredScore, 0) / totalCandidates
      : 0;
  const actualScoreAvg =
    totalCandidates > 0 ? audits.reduce((sum, a) => sum + a.actualScore, 0) / totalCandidates : 0;
  const avgScoreGap =
    totalCandidates > 0 ? audits.reduce((sum, a) => sum + a.scoreGap, 0) / totalCandidates : 0;

  // 분포 집계 (failed only)
  const dominantFailureDistribution = { ...EMPTY_DOMINANT_DISTRIBUTION };
  for (const a of failed) {
    dominantFailureDistribution[a.dominantFailureReason] += 1;
  }

  const missingPositiveSourceCounts = {
    watchlistUpstreamMissing: 0,
    relativeStrengthMissing: 0,
    breakoutStructureMissing: 0,
    priceMomentumMissing: 0,
    technicalTrendMissing: 0,
    volumeLiquidityMissing: 0,
  };
  for (const a of failed) {
    for (const m of a.missingPositiveSources) {
      switch (m) {
        case 'WATCHLIST_UPSTREAM_SCORE_MISSING':
          missingPositiveSourceCounts.watchlistUpstreamMissing += 1;
          break;
        case 'RELATIVE_STRENGTH_MISSING':
          missingPositiveSourceCounts.relativeStrengthMissing += 1;
          break;
        case 'BREAKOUT_STRUCTURE_MISSING':
          missingPositiveSourceCounts.breakoutStructureMissing += 1;
          break;
        case 'PRICE_MOMENTUM_MISSING':
          missingPositiveSourceCounts.priceMomentumMissing += 1;
          break;
        case 'TECHNICAL_TREND_MISSING':
          missingPositiveSourceCounts.technicalTrendMissing += 1;
          break;
        case 'VOLUME_LIQUIDITY_MISSING':
          missingPositiveSourceCounts.volumeLiquidityMissing += 1;
          break;
      }
    }
  }

  const penaltyCounts = {
    supplyUnknownPenalty: 0,
    investorFlowUnknownPenalty: 0,
    sectorEnergyPenaltyOrBlocked: 0,
    unknownDataPenalty: 0,
    softFailPenalty: 0,
    riskPenalty: 0,
  };
  for (const a of failed) {
    if (a.penaltyComponents['SUPPLY_CONFLUENCE']?.weightedScore < 0) penaltyCounts.supplyUnknownPenalty += 1;
    if (a.penaltyComponents['INVESTOR_FLOW']?.weightedScore < 0) penaltyCounts.investorFlowUnknownPenalty += 1;
    if (
      a.penaltyComponents['SECTOR_ENERGY']?.weightedScore < 0 ||
      a.sectorEnergyAudit.strongBuyAllowed === false
    ) {
      penaltyCounts.sectorEnergyPenaltyOrBlocked += 1;
    }
    if (a.penaltyComponents['UNKNOWN_DATA_PENALTY']) penaltyCounts.unknownDataPenalty += 1;
    if (a.penaltyComponents['SOFT_FAIL_PENALTY']) penaltyCounts.softFailPenalty += 1;
    if (a.penaltyComponents['RISK_PENALTY']) penaltyCounts.riskPenalty += 1;
  }

  const supplyScopeWarnings = { ...EMPTY_SUPPLY_SCOPE_WARNINGS };
  let supplySymbolMatchedCount = 0;
  let rsHydrationAvailableCount = 0;
  let breakoutHydrationAvailableCount = 0;
  const rsMissingReasonDistribution = { ...EMPTY_HYDRATION_REASON_DISTRIBUTION };
  const breakoutMissingReasonDistribution = { ...EMPTY_HYDRATION_REASON_DISTRIBUTION };
  const hydrationMissingFieldCounts: Record<string, number> = {};
  let candidateTraceHasQuote = 0;
  let candidateTraceHasSymbolFeatures = 0;
  let candidateTraceHasConditionResults = 0;
  let sectorEnergyStrongBuyBlockedCount = 0;
  let sectorEnergyHardBlockCount = 0;

  for (const a of failed) {
    supplyScopeWarnings[a.supplyScopeAudit.warning] += 1;
    if (a.supplyScopeAudit.symbolMatched === true) supplySymbolMatchedCount += 1;
    if (a.hydrationAuditAdr0509?.rsAvailable) rsHydrationAvailableCount += 1;
    if (a.hydrationAuditAdr0509?.breakoutAvailable) breakoutHydrationAvailableCount += 1;
    for (const reason of a.hydrationAuditAdr0509?.rsMissingReasons ?? []) rsMissingReasonDistribution[reason] += 1;
    for (const reason of a.hydrationAuditAdr0509?.breakoutMissingReasons ?? []) breakoutMissingReasonDistribution[reason] += 1;
    for (const field of a.hydrationAuditAdr0509?.missingFields ?? []) {
      hydrationMissingFieldCounts[field] = (hydrationMissingFieldCounts[field] ?? 0) + 1;
    }
    if (a.hydrationAuditAdr0509?.candidateTraceHasQuote) candidateTraceHasQuote += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasSymbolFeatures) candidateTraceHasSymbolFeatures += 1;
    if (a.hydrationAuditAdr0509?.candidateTraceHasConditionResults) candidateTraceHasConditionResults += 1;
    if (a.sectorEnergyAudit.strongBuyAllowed === false) sectorEnergyStrongBuyBlockedCount += 1;
    // 사용자 명시 — SectorEnergy hardBlock 절대 금지. 본 카운터는 *항상* 0 이어야 함.
    if (a.sectorEnergyAudit.executionImpact === 'HARD_BLOCK') {
      sectorEnergyHardBlockCount += 1;
    }
  }

  return {
    totalCandidates,
    failedCandidates,
    requiredScoreAvg: round1(requiredScoreAvg),
    actualScoreAvg: round1(actualScoreAvg),
    avgScoreGap: round1(avgScoreGap),
    dominantFailureDistribution,
    missingPositiveSourceCounts,
    penaltyCounts,
    supplyScopeWarnings,
    supplySymbolMatchedCount,
    rsHydrationAvailableCount,
    breakoutHydrationAvailableCount,
    rsMissingReasonDistribution,
    breakoutMissingReasonDistribution,
    topHydrationMissingFields: Object.entries(hydrationMissingFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([field]) => field),
    candidateTraceHasQuote,
    candidateTraceHasSymbolFeatures,
    candidateTraceHasConditionResults,
    sectorEnergyStrongBuyBlockedCount,
    sectorEnergyHardBlockCount,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

/* ───────── /scan_blockers compact section formatter SSOT ───────── */

/**
 * Telegram-safe compact line — 사용자 명시 형식 정확 정합.
 * 4000-char budget (ADR-0478) 차원에서 12~14 줄 한도 의무.
 * 빈 entries 시 null 반환 (잡음 차단).
 */
export function formatGate1MinimumSignalForensicSection(
  summary: Gate1MinimumSignalForensicSummaryAdr0505 | undefined,
): string | null {
  if (!summary || summary.totalCandidates === 0) return null;

  const lines: string[] = [];
  lines.push('🧬 Gate1 Minimum Signal Forensic (ADR-0505)');
  lines.push(`- candidates=${summary.totalCandidates} failed=${summary.failedCandidates}`);
  lines.push(
    `- requiredAvg=${summary.requiredScoreAvg.toFixed(1)} actualAvg=${summary.actualScoreAvg.toFixed(1)} gap=${summary.avgScoreGap.toFixed(1)}`,
  );

  // dominant — failed > 0 일 때만 표시
  if (summary.failedCandidates > 0) {
    const dominant = pickTopDominant(summary.dominantFailureDistribution);
    if (dominant) lines.push(`- dominant=${dominant}`);
  }

  // missing — 1개 이상일 때만 표시
  const m = summary.missingPositiveSourceCounts;
  const missingParts: string[] = [];
  if (m.watchlistUpstreamMissing > 0) missingParts.push(`watchlist=${m.watchlistUpstreamMissing}`);
  if (m.relativeStrengthMissing > 0) missingParts.push(`rs=${m.relativeStrengthMissing}`);
  if (m.breakoutStructureMissing > 0) missingParts.push(`breakout=${m.breakoutStructureMissing}`);
  if (missingParts.length > 0) lines.push(`- missing: ${missingParts.join(' ')}`);

  // penalties — 1개 이상일 때만 표시
  const p = summary.penaltyCounts;
  const penaltyParts: string[] = [];
  if (p.supplyUnknownPenalty > 0) penaltyParts.push(`supplyUnknown=${p.supplyUnknownPenalty}`);
  if (p.investorFlowUnknownPenalty > 0) penaltyParts.push(`investorUnknown=${p.investorFlowUnknownPenalty}`);
  if (p.sectorEnergyPenaltyOrBlocked > 0) penaltyParts.push(`sectorBlocked=${p.sectorEnergyPenaltyOrBlocked}`);
  if (penaltyParts.length > 0) lines.push(`- penalties: ${penaltyParts.join(' ')}`);

  // supplyScopeWarnings — 1개 이상일 때만 표시
  const w = summary.supplyScopeWarnings;
  const warnParts: string[] = [];
  if (w.KIS_FLOW_SYMBOL_MISSING > 0) warnParts.push(`symbolMissing=${w.KIS_FLOW_SYMBOL_MISSING}`);
  if (w.KIS_FLOW_SYMBOL_MISMATCH > 0) warnParts.push(`mismatch=${w.KIS_FLOW_SYMBOL_MISMATCH}`);
  if (w.KIS_FLOW_SEMANTIC_UNAVAILABLE > 0) warnParts.push(`semanticUnavailable=${w.KIS_FLOW_SEMANTIC_UNAVAILABLE}`);
  if (w.POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT > 0) {
    warnParts.push(`marketWide=${w.POSSIBLE_MARKET_WIDE_FLOW_IN_SYMBOL_SLOT}`);
  }
  if (warnParts.length > 0) lines.push(`- supplyScopeWarnings: ${warnParts.join(' ')}`);

  lines.push(`- rsHydration: ${summary.rsHydrationAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- breakoutHydration: ${summary.breakoutHydrationAvailableCount ?? 0}/${summary.totalCandidates}`);
  lines.push(`- supplySymbolMatched: ${summary.supplySymbolMatchedCount ?? 0}/${summary.totalCandidates}`);
  const topHydrationMissingFields = summary.topHydrationMissingFields ?? [];
  if (topHydrationMissingFields.length > 0) {
    lines.push(`- topMissingFields: ${topHydrationMissingFields.slice(0, 4).join(', ')}`);
  }
  lines.push('- nextAction: WIRE_SYMBOL_LEVEL_SUPPLY_AND_FEATURE_HYDRATION');

  // SectorEnergy — 강제 노출 (운영자 인지 의무)
  lines.push(
    `- SectorEnergy: boost=0 strongBuyBlocked=${summary.sectorEnergyStrongBuyBlockedCount} hardBlock=${summary.sectorEnergyHardBlockCount}`,
  );
  lines.push('- executionImpact=NONE live=false');

  return lines.join('\n');
}

/* ───────── 보조 헬퍼 ───────── */

function pickTopDominant(distribution: Record<DominantFailureReason, number>): DominantFailureReason | null {
  let top: DominantFailureReason | null = null;
  let topCount = 0;
  for (const [k, v] of Object.entries(distribution)) {
    if (v > topCount) {
      topCount = v;
      top = k as DominantFailureReason;
    }
  }
  return top;
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
