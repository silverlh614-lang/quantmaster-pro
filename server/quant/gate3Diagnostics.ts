// @responsibility Gate3 timing wiring/coverage diagnostics (diagnostic-only; no scoring impact).
import type { GateLayerName, ServerGateResult } from '../quantFilter.js';
import {
  evaluateGate3LastTrigger,
  type Gate3EntryPriceGuardDiagnostic,
  type Gate3ExecutionImpact,
  type Gate3LastTriggerEvaluation,
  type Gate3RrrCheckDiagnostic,
} from './gate3LastTrigger.js';

type GateEvaluatorOutput = NonNullable<ServerGateResult['outputs']>[number];
type Numeric = number | null;

export type Gate3WiringStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'CALCULATION_MISSING'
  | 'ERROR';

export type Gate3DataPath =
  | 'QUOTE_ONLY'
  | 'TECHNICAL'
  | 'INTRADAY'
  | 'VOLUME'
  | 'PRICE_STRUCTURE'
  | 'MIXED'
  | 'UNKNOWN';

export type Gate3CoverageStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'DEGRADED'
  | 'MISSING'
  | 'STALE'
  | 'CALCULATION_MISSING'
  | 'STAGE_NOT_FETCHED'
  | 'UNKNOWN';

export interface Gate3WiringDiagnostic {
  key: string;
  layer: 'gate3';
  status: Gate3WiringStatus;
  inputs: string[];
  quoteInputs: string[];
  technicalInputs: string[];
  intradayInputs: string[];
  volumeInputs: string[];
  priceStructureInputs: string[];
  missingInputs: string[];
  availableInputs: string[];
  requiredData: string[];
  missingRequiredData: string[];
  dataPath: Gate3DataPath;
  providerIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export interface Gate3SourceCoverage {
  conditionCount: number;
  quoteInputCount: number;
  technicalInputCount: number;
  intradayInputCount: number;
  volumeInputCount: number;
  priceStructureInputCount: number;
  requiredData: string[];
  missingInputs: string[];
  missingRequiredData: string[];
  providerIssues: string[];
  calculationIssues: string[];
  allDeclaredInputsAvailable: boolean;
  allRequiredDataAvailable: boolean;
  marketSignal: false;
  diagnosticOnly: true;
}

export interface Gate3VolumeTimingDiagnostic {
  status: Gate3CoverageStatus;
  volume: Numeric;
  avgVolume: Numeric;
  avgVolume20d: Numeric;
  volumeRatio: Numeric;
  tradingValue: Numeric;
  avgTradingValue20d: Numeric;
  tradingValueRatio: Numeric;
  dryUp: {
    available: boolean;
    status: 'PASS' | 'FAIL' | 'MISSING' | 'UNKNOWN';
    recentVolumeAvg3d: Numeric;
    avgVolume20d: Numeric;
    dryUpRatio: Numeric;
    reason: string | null;
  };
  vcp: {
    available: boolean;
    status: 'PASS' | 'FAIL' | 'MISSING' | 'UNKNOWN';
    bbWidth: Numeric;
    bbWidthPercentile: Numeric;
    atr14: Numeric;
    atrContraction: Numeric;
    rangeContraction: Numeric;
    contractionCount: Numeric;
    reason: string | null;
  };
  breakoutVolume: {
    available: boolean;
    status: 'PASS' | 'FAIL' | 'MISSING' | 'UNKNOWN';
    volumeRatio: Numeric;
    tradingValueRatio: Numeric;
    reason: string | null;
  };
  dataGranularity: 'INTRADAY' | 'DAILY' | 'MIXED' | 'UNKNOWN';
  source: 'KIS_OFFICIAL' | 'KIS_MINUTE_CHART' | 'QMP_INDICATORS' | 'YAHOO' | 'CACHE' | 'UNKNOWN';
  providerIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  missingFields: string[];
  notes: string[];
}

export interface Gate3ExternalDataCoverage {
  technicalIndicators: {
    required: true;
    available: boolean;
    provider: 'QMP_INDICATORS' | 'YAHOO' | 'KIS_CHART' | 'CACHE' | 'UNKNOWN';
    status: Gate3CoverageStatus;
    fields: Record<string, boolean>;
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
  };
  priceStructure: {
    required: true;
    available: boolean;
    provider: 'QMP_INDICATORS' | 'YAHOO' | 'KIS_CHART' | 'CACHE' | 'UNKNOWN';
    status: Gate3CoverageStatus;
    fields: Record<string, boolean>;
    values: {
      currentPrice: Numeric;
      priceFieldUsed: 'price' | 'currentPrice' | 'close' | 'UNKNOWN';
      high5d: Numeric;
      high20d: Numeric;
      high60d: Numeric;
      low20d: Numeric;
      low60d: Numeric;
      breakoutGapPct: Numeric;
      drawdownFromHigh60dPct: Numeric;
      range20dPct: Numeric;
      boxWidthPct: Numeric;
    };
    breakout: Gate3PriceStructureDiagnostic['breakout'];
    turtle: Gate3PriceStructureDiagnostic['turtle'];
    pullback: Gate3PriceStructureDiagnostic['pullback'];
    rangeStructure: Gate3PriceStructureDiagnostic['rangeStructure'];
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    missingFields: string[];
    notes: string[];
  };
  pullbackSupport: {
    required: false;
    available: boolean;
    status: Gate3PullbackDiagnostic['status'];
    fields: Record<string, boolean>;
    values: Record<string, Numeric>;
    swing: Gate3PullbackDiagnostic['swing'];
    movingAverageSupport: Gate3PullbackDiagnostic['movingAverageSupport'];
    fibonacci: Gate3PullbackDiagnostic['fibonacci'];
    boxRetest: Gate3PullbackDiagnostic['boxRetest'];
    pullbackQuality: Gate3PullbackDiagnostic['pullbackQuality'];
    supportReference: Gate3PullbackDiagnostic['supportReference'];
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    missingFields: string[];
    notes: string[];
  };
  volumeStructure: {
    required: true;
    available: boolean;
    provider: 'KIS_OFFICIAL' | 'QMP_QUOTE' | 'YAHOO' | 'CACHE' | 'UNKNOWN';
    status: Gate3CoverageStatus;
    fields: Record<string, boolean>;
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
  };
  intradayTiming: {
    required: false;
    available: boolean;
    provider: Gate3IntradayTimingDiagnostic['source'];
    status: Gate3CoverageStatus;
    dataMode: Gate3IntradayTimingDiagnostic['dataMode'];
    fields: Record<string, boolean>;
    values: Record<string, Numeric>;
    quoteFreshness: Gate3IntradayTimingDiagnostic['quoteFreshness'];
    lastTick: Gate3IntradayTimingDiagnostic['lastTick'];
    minuteChart: Gate3IntradayTimingDiagnostic['minuteChart'];
    volumeClock: Gate3IntradayTimingDiagnostic['volumeClock'];
    intradayMomentum: Gate3IntradayTimingDiagnostic['intradayMomentum'];
    sessionCompatibility: Gate3IntradayTimingDiagnostic['sessionCompatibility'];
    providerIssue: boolean;
    freshnessIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    missingFields: string[];
    notes: string[];
  };
  volumeTiming: {
    required: true;
    available: boolean;
    status: Gate3CoverageStatus;
    fields: Record<string, boolean>;
    values: Record<string, Numeric>;
    dryUp: Gate3VolumeTimingDiagnostic['dryUp'];
    vcp: Gate3VolumeTimingDiagnostic['vcp'];
    breakoutVolume: Gate3VolumeTimingDiagnostic['breakoutVolume'];
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    missingFields: string[];
    notes: string[];
  };
  falseBreakout: {
    required: false;
    available: boolean;
    status: Gate3FalseBreakoutDiagnostic['status'];
    fields: Record<string, boolean>;
    values: Record<string, Numeric>;
    falseBreakout: Gate3FalseBreakoutDiagnostic['falseBreakout'];
    divergence: Gate3FalseBreakoutDiagnostic['divergence'];
    exhaustion: Gate3FalseBreakoutDiagnostic['exhaustion'];
    retestQuality: Gate3FalseBreakoutDiagnostic['retestQuality'];
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    missingFields: string[];
    notes: string[];
  };
  lastTrigger: {
    required: true;
    available: boolean;
    status: Gate3LastTriggerEvaluation['status'];
    fired: boolean;
    reason: string;
    priceBreakout: Gate3LastTriggerEvaluation['priceBreakout'];
    volumeConfirmation: Gate3LastTriggerEvaluation['volumeConfirmation'];
    vcp: Gate3LastTriggerEvaluation['vcp'];
    rsi: Gate3LastTriggerEvaluation['rsi'];
    macd: Gate3LastTriggerEvaluation['macd'];
    falseBreakoutRisk: Gate3LastTriggerEvaluation['falseBreakoutRisk'];
    strongBuyAllowed: boolean;
    liveBuyAllowed: boolean;
    shadowObservableAllowed: boolean;
    counterfactualAllowed: boolean;
    executionReady: boolean;
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: Gate3ExecutionImpact;
    notes: string[];
  };
  entryPriceGuard: Gate3EntryPriceGuardDiagnostic;
  rrrCheck: Gate3RrrCheckDiagnostic;
  executionReadiness: {
    status: 'READY' | 'WAIT' | 'DATA_INCOMPLETE';
    liveBuyAllowed: boolean;
    shadowObservableAllowed: boolean;
    counterfactualAllowed: boolean;
    executionReady: boolean;
    executionImpact: Gate3ExecutionImpact;
    marketSignal: false;
    reason: string;
  };
  momentumIndicators: {
    required: true;
    available: boolean;
    status: Gate3CoverageStatus;
    fields: Record<string, boolean>;
    values: Record<string, Numeric>;
    rsi: Gate3MomentumDiagnostic['rsi'];
    macd: Gate3MomentumDiagnostic['macd'];
    shortMomentum: Gate3MomentumDiagnostic['shortMomentum'];
    overheat: Gate3MomentumDiagnostic['overheat'];
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
    executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
    missingFields: string[];
    notes: string[];
  };
}

export interface Gate3PullbackDiagnostic {
  status: Gate3CoverageStatus;
  currentPrice: Numeric;
  swing: {
    recentSwingHigh: Numeric;
    recentSwingLow: Numeric;
    high20d: Numeric;
    high60d: Numeric;
    low20d: Numeric;
    low60d: Numeric;
    available: boolean;
    status: 'VERIFIED' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  movingAverageSupport: {
    ma20: Numeric;
    ma60: Numeric;
    distanceToMa20Pct: Numeric;
    distanceToMa60Pct: Numeric;
    nearestSupport: 'MA20' | 'MA60' | 'NONE' | 'UNKNOWN';
    status: 'SUPPORT_NEAR' | 'EXTENDED' | 'BROKEN' | 'MISSING' | 'UNKNOWN';
    available: boolean;
    reason: string | null;
  };
  fibonacci: {
    fib382: Numeric;
    fib500: Numeric;
    fib618: Numeric;
    nearestFib: 'FIB_382' | 'FIB_500' | 'FIB_618' | 'NONE' | 'UNKNOWN';
    distanceToNearestFibPct: Numeric;
    status: 'SUPPORT_NEAR' | 'EXTENDED' | 'BROKEN' | 'MISSING' | 'UNKNOWN';
    available: boolean;
    reason: string | null;
  };
  boxRetest: {
    boxTop: Numeric;
    boxBottom: Numeric;
    distanceToBoxTopPct: Numeric;
    status: 'RETEST_NEAR' | 'ABOVE_BOX' | 'INSIDE_BOX' | 'BROKEN_BOX' | 'MISSING' | 'UNKNOWN';
    available: boolean;
    reason: string | null;
  };
  pullbackQuality: {
    drawdownFromHigh20dPct: Numeric;
    drawdownFromHigh60dPct: Numeric;
    pullbackPct: Numeric;
    status: 'HEALTHY_PULLBACK' | 'TOO_SHALLOW' | 'TOO_DEEP' | 'EXTENDED_CHASE' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  supportReference: 'MA20' | 'MA60' | 'FIB_382' | 'FIB_500' | 'FIB_618' | 'BOX_TOP' | 'SWING_LOW' | 'NONE' | 'UNKNOWN';
  source: 'QMP_INDICATORS' | 'YAHOO' | 'KIS_CHART' | 'CACHE' | 'UNKNOWN';
  providerIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  missingFields: string[];
  notes: string[];
}

export interface Gate3FalseBreakoutDiagnostic {
  status: 'VERIFIED' | 'PARTIAL' | 'WARN' | 'DEGRADED' | 'MISSING' | 'CALCULATION_MISSING' | 'UNKNOWN';
  falseBreakout: {
    status: 'LOW_RISK' | 'WATCH' | 'HIGH_RISK' | 'MISSING' | 'UNKNOWN';
    priceBreakoutConfirmed: boolean | null;
    volumeConfirmed: boolean | null;
    closeAboveBreakout: boolean | null;
    wickRejection: boolean | null;
    failedRetest: boolean | null;
    reason: string | null;
  };
  divergence: {
    status: 'NONE' | 'RSI_BEARISH' | 'MACD_BEARISH' | 'BOTH_BEARISH' | 'MISSING' | 'UNKNOWN';
    priceHigherHigh: boolean | null;
    rsiLowerHigh: boolean | null;
    macdLowerHigh: boolean | null;
    currentHigh: Numeric;
    previousHigh: Numeric;
    currentRsi: Numeric;
    previousPeakRsi: Numeric;
    currentMacdHist: Numeric;
    previousPeakMacdHist: Numeric;
    reason: string | null;
  };
  exhaustion: {
    status: 'NORMAL' | 'WATCH' | 'EXHAUSTED' | 'MISSING' | 'UNKNOWN';
    rsiOverheated: boolean | null;
    volumeClimax: boolean | null;
    extendedFromBreakout: boolean | null;
    extendedFromMa20: boolean | null;
    gapUpExhaustion: boolean | null;
    reason: string | null;
  };
  retestQuality: {
    status: 'GOOD' | 'WEAK' | 'FAILED' | 'MISSING' | 'UNKNOWN';
    boxTop: Numeric;
    currentPrice: Numeric;
    closePrice: Numeric;
    distanceToBoxTopPct: Numeric;
    retestHeld: boolean | null;
    reason: string | null;
  };
  source: 'QMP_INDICATORS' | 'YAHOO' | 'KIS_CHART' | 'KIS_MINUTE_CHART' | 'CACHE' | 'UNKNOWN';
  providerIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  missingFields: string[];
  notes: string[];
}

export interface Gate3IntradayTimingDiagnostic {
  status: Gate3CoverageStatus;
  dataMode: 'INTRADAY' | 'EOD_ONLY' | 'MIXED' | 'UNKNOWN';
  quoteFreshness: {
    lastQuoteAt: string | null;
    ageSec: Numeric;
    status: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  lastTick: {
    lastTickAt: string | null;
    ageSec: Numeric;
    price: Numeric;
    volume: Numeric;
    status: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  minuteChart: {
    available: boolean;
    barCount: Numeric;
    interval: '1m' | '3m' | '5m' | '10m' | 'UNKNOWN';
    latestBarAt: string | null;
    latestBarAgeSec: Numeric;
    status: 'VERIFIED' | 'STALE' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  volumeClock: {
    available: boolean;
    sessionProgressPct: Numeric;
    expectedVolumeByNow: Numeric;
    actualVolume: Numeric;
    volumePaceRatio: Numeric;
    status: 'AHEAD' | 'ON_PACE' | 'BEHIND' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  intradayMomentum: {
    openToNowReturn: Numeric;
    vwap: Numeric;
    priceVsVwapPct: Numeric;
    highIntraday: Numeric;
    lowIntraday: Numeric;
    intradayRangePct: Numeric;
    status: 'BULLISH' | 'NEUTRAL' | 'WEAK' | 'MISSING' | 'UNKNOWN';
    reason: string | null;
  };
  sessionCompatibility: {
    session: 'PREMARKET' | 'REGULAR' | 'SELL_ONLY' | 'LUNCH' | 'AFTERMARKET' | 'CLOSED' | 'HOLIDAY' | 'UNKNOWN';
    liveBuyAllowed: boolean | null;
    shadowAllowed: boolean | null;
    reason: string | null;
  };
  source: 'KIS_REALTIME' | 'KIS_MINUTE_CHART' | 'KIS_OFFICIAL' | 'QMP_CACHE' | 'YAHOO' | 'UNKNOWN';
  providerIssue: boolean;
  freshnessIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  missingFields: string[];
  notes: string[];
}

export interface Gate3MomentumDiagnostic {
  status: Gate3CoverageStatus;
  rsi: {
    rsi14: Numeric; rsi5dAgo: Numeric; rsiDelta5d: Numeric;
    status: 'BULLISH' | 'NEUTRAL' | 'OVERBOUGHT' | 'WEAK' | 'MISSING' | 'UNKNOWN';
    available: boolean; reason: string | null;
  };
  macd: {
    macdHistogram: Numeric; macd5dHistAgo: Numeric; macdHistDelta5d: Numeric;
    status: 'BULLISH' | 'IMPROVING' | 'WEAKENING' | 'BEARISH' | 'MISSING' | 'UNKNOWN';
    available: boolean; reason: string | null;
  };
  shortMomentum: {
    changePercent: Numeric; return5d: Numeric; return20d: Numeric; acceleration5dVs20d: Numeric;
    status: 'BULLISH' | 'NEUTRAL' | 'WEAK' | 'MISSING' | 'UNKNOWN';
    available: boolean; reason: string | null;
  };
  overheat: {
    status: 'NORMAL' | 'WATCH' | 'OVERHEATED' | 'MISSING' | 'UNKNOWN';
    rsiOverheated: boolean | null; priceExtensionOverheated: boolean | null; notes: string[];
  };
  source: 'QMP_INDICATORS' | 'YAHOO' | 'KIS_CHART' | 'CACHE' | 'UNKNOWN';
  providerIssue: boolean; calculationIssue: boolean; marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY'; missingFields: string[]; notes: string[];
}

export interface Gate3PriceStructureDiagnostic {
  status: Gate3CoverageStatus;
  currentPrice: Numeric;
  priceFieldUsed: 'price' | 'currentPrice' | 'close' | 'UNKNOWN';
  high5d: Numeric;
  high20d: Numeric;
  high60d: Numeric;
  low20d: Numeric;
  low60d: Numeric;
  breakout: {
    available: boolean;
    status: 'PASS' | 'FAIL' | 'MISSING' | 'UNKNOWN';
    breakoutType: 'HIGH_5D' | 'HIGH_20D' | 'HIGH_60D' | 'BOX_BREAKOUT' | 'NONE' | 'UNKNOWN';
    breakoutPrice: Numeric;
    breakoutGapPct: Numeric;
    reason: string | null;
  };
  turtle: {
    available: boolean;
    status: 'PASS' | 'FAIL' | 'MISSING' | 'UNKNOWN';
    period: 20 | 55 | 60 | null;
    thresholdPrice: Numeric;
    currentPrice: Numeric;
    distanceToBreakoutPct: Numeric;
    reason: string | null;
  };
  pullback: {
    available: boolean;
    status: 'PASS' | 'FAIL' | 'MISSING' | 'UNKNOWN';
    high60d: Numeric;
    currentPrice: Numeric;
    drawdownFromHigh60dPct: Numeric;
    drawdownFromHigh20dPct: Numeric;
    supportReference: 'MA20' | 'MA60' | 'FIB_382' | 'FIB_500' | 'FIB_618' | 'BOX_TOP' | 'UNKNOWN';
    reason: string | null;
  };
  rangeStructure: {
    available: boolean;
    status: 'COMPRESSED' | 'EXPANDED' | 'NORMAL' | 'MISSING' | 'UNKNOWN';
    range20dPct: Numeric;
    range60dPct: Numeric;
    boxTop: Numeric;
    boxBottom: Numeric;
    boxWidthPct: Numeric;
    reason: string | null;
  };
  source: 'QMP_INDICATORS' | 'YAHOO' | 'KIS_CHART' | 'KIS_OFFICIAL' | 'CACHE' | 'UNKNOWN';
  providerIssue: boolean;
  calculationIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';
  missingFields: string[];
  notes: string[];
}

const TECH = /(rsi|macd|bb|bollinger|atr|ma\d*|ichimoku)/i;
const INTRA = /(intraday|minute|realtime|volumeClock|lastTick)/i;
const VOL = /(volume|avgVolume|volumeRatio|dry|tradingValue)/i;
const PRICE = /(high\d+d|low\d+d|breakout|pullback|range|currentPrice|price$|swing|fib|box)/i;

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const asFinite = (value: unknown): Numeric => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const hasFinite = (source: Record<string, unknown>, key: string): boolean => asFinite(source[key]) != null;
const pctDistance = (value: Numeric, reference: Numeric): Numeric => value != null && reference != null && reference > 0 ? (value - reference) / reference : null;
const asRecord = (value: unknown): Record<string, unknown> => (value != null && typeof value === 'object' ? value as Record<string, unknown> : {});
const toIsoOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const ageSecFromNow = (now: Date, at: string | null): Numeric => {
  if (!at) return null;
  const time = new Date(at).getTime();
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / 1000));
};

function normalizeGate3Status(output: GateEvaluatorOutput): Gate3WiringStatus {
  const raw = output.output?.status
    ?? (output.output ? 'FIRED' : output.context?.hadRequiredData === false ? 'DATA_UNAVAILABLE' : 'THRESHOLD_NOT_MET');
  return ['FIRED', 'THRESHOLD_NOT_MET', 'DATA_UNAVAILABLE', 'PROVIDER_DEGRADED', 'ERROR'].includes(raw)
    ? raw as Gate3WiringStatus
    : 'THRESHOLD_NOT_MET';
}

export function buildGate3WiringDiagnostics(input: {
  outputs: NonNullable<ServerGateResult['outputs']>;
  layerMap: Record<string, GateLayerName>;
}): Gate3WiringDiagnostic[] {
  return input.outputs
    .filter(item => input.layerMap[item.key] === 'gate3')
    .map((item) => {
      const inputs = [...(item.inputs ?? [])];
      const quoteInputs = unique(item.context?.quoteInputs ?? inputs.filter(i => i.startsWith('quote.')));
      const technicalInputs = unique(inputs.filter(i => TECH.test(i)));
      const intradayInputs = unique(inputs.filter(i => INTRA.test(i)));
      const volumeInputs = unique(inputs.filter(i => VOL.test(i)));
      const priceStructureInputs = unique(inputs.filter(i => PRICE.test(i)));
      const missingInputs = unique([...(item.context?.missingInputs ?? [])]);
      const requiredData = unique([...(item.context?.requiredData ?? [])]);
      const mergedRequiredData = unique(requiredData);
      const missingRequiredData = mergedRequiredData.filter(key => item.context?.availableData?.[key] !== true);

      const domains = [quoteInputs, technicalInputs, intradayInputs, volumeInputs, priceStructureInputs]
        .filter(group => group.length > 0).length;
      const dataPath: Gate3DataPath = domains > 1 ? 'MIXED'
        : intradayInputs.length > 0 ? 'INTRADAY'
          : technicalInputs.length > 0 ? 'TECHNICAL'
            : volumeInputs.length > 0 ? 'VOLUME'
              : priceStructureInputs.length > 0 ? 'PRICE_STRUCTURE'
                : quoteInputs.length > 0 ? 'QUOTE_ONLY' : 'UNKNOWN';

      const status = normalizeGate3Status(item);
      return {
        key: item.key,
        layer: 'gate3',
        status,
        inputs,
        quoteInputs,
        technicalInputs,
        intradayInputs,
        volumeInputs,
        priceStructureInputs,
        missingInputs,
        availableInputs: inputs.filter(i => !missingInputs.includes(i)),
        requiredData: mergedRequiredData,
        missingRequiredData,
        dataPath,
        providerIssue: status === 'PROVIDER_DEGRADED' || missingRequiredData.length > 0,
        calculationIssue: missingInputs.some(i => TECH.test(i) || VOL.test(i)),
        marketSignal: false,
        diagnosticOnly: true,
      };
    });
}

export function normalizeGate3Momentum(input: {
  quote?: Record<string, unknown> | null;
  indicators?: Record<string, unknown> | null;
  priceStructure?: Gate3PriceStructureDiagnostic | null;
}): Gate3MomentumDiagnostic {
  const quote = input.quote ?? {};
  const indicators = input.indicators ?? {};
  const pick = (k: string): Numeric => asFinite(quote[k]) ?? asFinite(indicators[k]);
  const missingFields: string[] = [];
  const notes: string[] = [];
  const rsi14 = pick('rsi14'); const rsi5dAgo = pick('rsi5dAgo');
  const rsiDelta5d = rsi14 != null && rsi5dAgo != null ? rsi14 - rsi5dAgo : null;
  if (rsi14 == null) missingFields.push('rsi14');
  if (rsi5dAgo == null) missingFields.push('rsi5dAgo');
  const rsiStatus = rsi14 == null ? 'MISSING' : rsi14 >= 80 ? 'OVERBOUGHT' : rsi14 >= 55 ? 'BULLISH' : rsi14 >= 45 ? 'NEUTRAL' : 'WEAK';
  const macdHistogram = pick('macdHistogram'); const macd5dHistAgo = pick('macd5dHistAgo');
  const macdHistDelta5d = macdHistogram != null && macd5dHistAgo != null ? macdHistogram - macd5dHistAgo : null;
  if (macdHistogram == null) missingFields.push('macdHistogram');
  if (macd5dHistAgo == null) missingFields.push('macd5dHistAgo');
  const macdStatus = macdHistogram == null ? 'MISSING'
    : macdHistogram < 0 ? (macdHistDelta5d != null && macdHistDelta5d < 0 ? 'BEARISH' : 'WEAKENING')
      : (macdHistDelta5d != null && macdHistDelta5d > 0 ? 'IMPROVING' : 'BULLISH');
  const changePercent = pick('changePercent'); const return5d = pick('return5d'); const return20d = pick('return20d');
  const acceleration5dVs20d = return5d != null && return20d != null ? return5d - (return20d / 4) : null;
  if (changePercent == null) missingFields.push('changePercent');
  if (return5d == null) missingFields.push('return5d');
  if (return20d == null) missingFields.push('return20d');
  const smStatus = return5d == null ? 'MISSING' : return5d > 0 ? 'BULLISH' : return5d < 0 ? 'WEAK' : 'NEUTRAL';
  const breakoutGapPct = input.priceStructure?.breakout.breakoutGapPct ?? null;
  const rsiOverheated = rsi14 == null ? null : rsi14 >= 80;
  const priceExtensionOverheated = breakoutGapPct == null ? null : breakoutGapPct > 0.08;
  const overheatNotes: string[] = [];
  let overheat: Gate3MomentumDiagnostic['overheat']['status'] = 'NORMAL';
  if (rsi14 == null && breakoutGapPct == null) overheat = 'MISSING';
  else if (rsi14 != null && rsi14 >= 80 || priceExtensionOverheated) { overheat = 'OVERHEATED'; overheatNotes.push('RSI_OVERHEAT_DIAGNOSTIC_ONLY', 'MOMENTUM_OVERHEAT_DIAGNOSTIC_ONLY', 'DO_NOT_HARD_BLOCK_FROM_DIAGNOSTIC'); }
  else if (rsi14 != null && rsi14 >= 70) { overheat = 'WATCH'; overheatNotes.push('MOMENTUM_EXTENSION_WATCH'); }
  const status: Gate3CoverageStatus = missingFields.length === 0 ? 'VERIFIED' : missingFields.length <= 2 ? 'PARTIAL' : 'DEGRADED';
  notes.push(...overheatNotes);
  return {
    status,
    rsi: { rsi14, rsi5dAgo, rsiDelta5d, status: rsiStatus, available: rsi14 != null, reason: rsi14 == null ? 'INPUT_MISSING' : null },
    macd: { macdHistogram, macd5dHistAgo, macdHistDelta5d, status: macdStatus, available: macdHistogram != null, reason: macdHistogram == null ? 'INPUT_MISSING' : null },
    shortMomentum: { changePercent, return5d, return20d, acceleration5dVs20d, status: smStatus, available: return5d != null, reason: return5d == null ? 'INPUT_MISSING' : null },
    overheat: { status: overheat, rsiOverheated, priceExtensionOverheated, notes: unique(overheatNotes) },
    source: 'UNKNOWN', providerIssue: false, calculationIssue: missingFields.length > 0, marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY',
    missingFields: unique(missingFields), notes: unique(notes),
  };
}

export function buildGate3SourceCoverage(wiring: Gate3WiringDiagnostic[]): Gate3SourceCoverage {
  return {
    conditionCount: wiring.length,
    quoteInputCount: unique(wiring.flatMap(x => x.quoteInputs)).length,
    technicalInputCount: unique(wiring.flatMap(x => x.technicalInputs)).length,
    intradayInputCount: unique(wiring.flatMap(x => x.intradayInputs)).length,
    volumeInputCount: unique(wiring.flatMap(x => x.volumeInputs)).length,
    priceStructureInputCount: unique(wiring.flatMap(x => x.priceStructureInputs)).length,
    requiredData: unique(wiring.flatMap(x => x.requiredData)),
    missingInputs: unique(wiring.flatMap(x => x.missingInputs)),
    missingRequiredData: unique(wiring.flatMap(x => x.missingRequiredData)),
    providerIssues: unique(wiring.filter(x => x.providerIssue).map(x => x.key)),
    calculationIssues: unique(wiring.filter(x => x.calculationIssue).map(x => x.key)),
    allDeclaredInputsAvailable: wiring.every(x => x.missingInputs.length === 0),
    allRequiredDataAvailable: wiring.every(x => x.missingRequiredData.length === 0),
    marketSignal: false,
    diagnosticOnly: true,
  };
}

export function normalizeGate3VolumeTiming(input: {
  quote?: Record<string, unknown> | null;
  intraday?: Record<string, unknown> | null;
}): Gate3VolumeTimingDiagnostic {
  const quote = input.quote ?? {};
  const intraday = input.intraday ?? null;
  const notes: string[] = [];
  const missingFields: string[] = [];

  const volume = asFinite(quote.volume);
  const avgVolume = asFinite(quote.avgVolume);
  const avgVolume20d = asFinite(quote.avgVolume20d);
  const recentVolumeAvg3d = asFinite(quote.recentVolumeAvg3d);
  const currentPrice = asFinite(quote.currentPrice) ?? asFinite(quote.price);

  const avgVolumeBase = avgVolume ?? avgVolume20d;
  const volumeRatio = volume != null && avgVolumeBase != null && avgVolumeBase > 0 ? volume / avgVolumeBase : null;
  if (avgVolumeBase == null) missingFields.push('avgVolume');

  let tradingValue = asFinite(quote.tradingValue);
  if (tradingValue == null && volume != null && currentPrice != null) {
    tradingValue = volume * currentPrice;
    notes.push('FALLBACK_TRADING_VALUE_FROM_VOLUME_PRICE');
  }

  let avgTradingValue20d = asFinite(quote.avgTradingValue20d);
  if (avgTradingValue20d == null && avgVolume20d != null && currentPrice != null) {
    avgTradingValue20d = avgVolume20d * currentPrice;
    notes.push('FALLBACK_AVG_TRADING_VALUE20D_FROM_AVGVOLUME20D_PRICE');
  }

  const tradingValueRatio = tradingValue != null && avgTradingValue20d != null && avgTradingValue20d > 0
    ? tradingValue / avgTradingValue20d
    : null;

  const dryUpRatio = recentVolumeAvg3d != null && avgVolume20d != null && avgVolume20d > 0
    ? recentVolumeAvg3d / avgVolume20d
    : null;
  const dryUp: Gate3VolumeTimingDiagnostic['dryUp'] = dryUpRatio == null
    ? { available: false, status: 'MISSING', recentVolumeAvg3d, avgVolume20d, dryUpRatio, reason: 'INPUT_MISSING' }
    : { available: true, status: dryUpRatio <= 0.6 ? 'PASS' : 'FAIL', recentVolumeAvg3d, avgVolume20d, dryUpRatio, reason: null };

  const bbWidth = asFinite(quote.bbWidthCurrent) ?? asFinite(quote.bbWidth);
  const bbWidthPercentile = asFinite(quote.bbWidthPercentile);
  const atr14 = asFinite(quote.atr14) ?? asFinite(quote.atr);
  const atrContraction = asFinite(quote.atrContraction);
  const rangeContraction = asFinite(quote.rangeContraction);
  const contractionCount = asFinite(quote.contractionCount);
  const vcpMissing = [bbWidth, atr14, contractionCount].some(v => v == null);

  const vcp: Gate3VolumeTimingDiagnostic['vcp'] = vcpMissing
    ? { available: false, status: 'MISSING', bbWidth, bbWidthPercentile, atr14, atrContraction, rangeContraction, contractionCount, reason: 'INPUT_MISSING' }
    : { available: true, status: (bbWidth as number) <= 10 && (atr14 as number) > 0 ? 'PASS' : 'FAIL', bbWidth, bbWidthPercentile, atr14, atrContraction, rangeContraction, contractionCount, reason: null };

  const breakoutVolume: Gate3VolumeTimingDiagnostic['breakoutVolume'] = volumeRatio == null || tradingValueRatio == null
    ? { available: false, status: 'MISSING', volumeRatio, tradingValueRatio, reason: 'INPUT_MISSING' }
    : { available: true, status: volumeRatio >= 2 || tradingValueRatio >= 2 ? 'PASS' : 'FAIL', volumeRatio, tradingValueRatio, reason: null };

  const dataGranularity: Gate3VolumeTimingDiagnostic['dataGranularity'] = intraday
    ? (volume != null ? 'MIXED' : 'INTRADAY')
    : (volume != null ? 'DAILY' : 'UNKNOWN');
  if (!intraday && volume != null) notes.push('INTRADAY_NOT_FETCHED');

  if (vcpMissing) {
    if (bbWidth == null) missingFields.push('bbWidth');
    if (atr14 == null) missingFields.push('atr14');
    if (contractionCount == null) missingFields.push('contractionCount');
  }

  const status: Gate3CoverageStatus = missingFields.length > 0
    ? (vcp.status === 'MISSING' ? 'CALCULATION_MISSING' : 'DEGRADED')
    : (breakoutVolume.status === 'PASS' || dryUp.status === 'PASS' || vcp.status === 'PASS' ? 'VERIFIED' : 'PARTIAL');

  return { status, volume, avgVolume, avgVolume20d, volumeRatio, tradingValue, avgTradingValue20d, tradingValueRatio, dryUp, vcp, breakoutVolume, dataGranularity, source: 'UNKNOWN', providerIssue: false, calculationIssue: status === 'CALCULATION_MISSING', marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY', missingFields: unique(missingFields), notes: unique(notes) };
}

export function normalizeGate3IntradayTiming(input: {
  quote?: Record<string, unknown> | null;
  intraday?: Record<string, unknown> | null;
  minuteBars?: Record<string, unknown>[] | null;
  marketSession?: Record<string, unknown> | null;
  volumeTiming?: Gate3VolumeTimingDiagnostic | null;
  now?: Date;
  evaluationStage?: 'DISCOVERY_GATE' | 'REFRESHED_GATE' | 'ENTRY_RECHECK_GATE' | 'UNKNOWN';
}): Gate3IntradayTimingDiagnostic {
  const now = input.now ?? new Date();
  const quote = asRecord(input.quote);
  const intraday = asRecord(input.intraday);
  const marketSession = asRecord(input.marketSession);
  const minuteBars = Array.isArray(input.minuteBars) ? input.minuteBars : [];
  const missingFields: string[] = [];
  const notes: string[] = [];

  const quoteAt = toIsoOrNull(quote.asOf ?? quote.fetchedAt ?? quote.lastUpdatedAt);
  const quoteAgeSec = ageSecFromNow(now, quoteAt);
  const quoteFreshness: Gate3IntradayTimingDiagnostic['quoteFreshness'] = quoteAt == null
    ? { lastQuoteAt: null, ageSec: null, status: 'MISSING', reason: 'QUOTE_TIME_MISSING' }
    : quoteAgeSec != null && quoteAgeSec <= 30
      ? { lastQuoteAt: quoteAt, ageSec: quoteAgeSec, status: 'FRESH', reason: null }
      : { lastQuoteAt: quoteAt, ageSec: quoteAgeSec, status: 'STALE', reason: 'QUOTE_STALE' };

  const lastTickAt = toIsoOrNull(intraday.lastTickAt ?? quote.lastTickAt);
  const lastTickAgeSec = ageSecFromNow(now, lastTickAt);
  const lastTickPrice = asFinite(intraday.price ?? intraday.lastTickPrice ?? quote.lastTickPrice);
  const lastTickVolume = asFinite(intraday.volume ?? intraday.lastTickVolume ?? quote.lastTickVolume);
  const lastTick: Gate3IntradayTimingDiagnostic['lastTick'] = lastTickAt == null
    ? { lastTickAt: null, ageSec: null, price: lastTickPrice, volume: lastTickVolume, status: 'MISSING', reason: 'LAST_TICK_MISSING' }
    : lastTickAgeSec != null && lastTickAgeSec <= 30
      ? { lastTickAt, ageSec: lastTickAgeSec, price: lastTickPrice, volume: lastTickVolume, status: 'FRESH', reason: null }
      : { lastTickAt, ageSec: lastTickAgeSec, price: lastTickPrice, volume: lastTickVolume, status: 'STALE', reason: 'LAST_TICK_STALE_NOT_BEARISH' };

  const latestBar = minuteBars.length > 0 ? asRecord(minuteBars[minuteBars.length - 1]) : {};
  const latestBarAt = toIsoOrNull(latestBar.at ?? latestBar.timestamp ?? latestBar.time);
  const latestBarAgeSec = ageSecFromNow(now, latestBarAt);
  const minuteChart: Gate3IntradayTimingDiagnostic['minuteChart'] = minuteBars.length === 0
    ? { available: false, barCount: 0, interval: 'UNKNOWN', latestBarAt: null, latestBarAgeSec: null, status: 'MISSING', reason: 'MINUTE_BARS_MISSING' }
    : latestBarAgeSec != null && latestBarAgeSec <= 180
      ? { available: true, barCount: minuteBars.length, interval: '1m', latestBarAt, latestBarAgeSec, status: 'VERIFIED', reason: null }
      : { available: true, barCount: minuteBars.length, interval: '1m', latestBarAt, latestBarAgeSec, status: 'STALE', reason: 'MINUTE_BARS_STALE' };

  const sessionProgressPct = asFinite(intraday.sessionProgressPct ?? quote.sessionProgressPct);
  const expectedVolumeByNow = asFinite(intraday.expectedVolumeByNow ?? quote.expectedVolumeByNow);
  const actualVolume = asFinite(intraday.actualVolume ?? intraday.cumulativeVolume ?? quote.volume);
  const volumePaceRatio = expectedVolumeByNow != null && expectedVolumeByNow > 0 && actualVolume != null ? actualVolume / expectedVolumeByNow : null;
  const volumeClock: Gate3IntradayTimingDiagnostic['volumeClock'] = expectedVolumeByNow == null
    ? { available: false, sessionProgressPct, expectedVolumeByNow, actualVolume, volumePaceRatio: null, status: 'MISSING', reason: 'VOLUME_CLOCK_MISSING_NOT_VOLUME_WEAK' }
    : { available: true, sessionProgressPct, expectedVolumeByNow, actualVolume, volumePaceRatio, status: volumePaceRatio != null && volumePaceRatio >= 1.2 ? 'AHEAD' : volumePaceRatio != null && volumePaceRatio >= 0.8 ? 'ON_PACE' : 'BEHIND', reason: null };

  const currentPrice = asFinite(quote.currentPrice ?? quote.price);
  const dayOpen = asFinite(quote.dayOpen ?? intraday.open);
  const vwap = asFinite(intraday.vwap ?? quote.vwap);
  const highIntraday = asFinite(intraday.highIntraday ?? quote.high);
  const lowIntraday = asFinite(intraday.lowIntraday ?? quote.low);
  const openToNowReturn = currentPrice != null && dayOpen != null && dayOpen !== 0 ? (currentPrice - dayOpen) / dayOpen : null;
  const priceVsVwapPct = currentPrice != null && vwap != null && vwap !== 0 ? (currentPrice - vwap) / vwap : null;
  const intradayRangePct = highIntraday != null && lowIntraday != null && lowIntraday !== 0 ? (highIntraday - lowIntraday) / lowIntraday : null;
  const intradayMomentum: Gate3IntradayTimingDiagnostic['intradayMomentum'] = {
    openToNowReturn,
    vwap,
    priceVsVwapPct,
    highIntraday,
    lowIntraday,
    intradayRangePct,
    status: openToNowReturn == null && priceVsVwapPct == null ? 'MISSING' : (openToNowReturn ?? 0) > 0 || (priceVsVwapPct ?? 0) > 0 ? 'BULLISH' : 'WEAK',
    reason: openToNowReturn == null && priceVsVwapPct == null ? 'INTRADAY_MOMENTUM_INPUT_MISSING' : null,
  };

  const session = String(marketSession.session ?? 'UNKNOWN') as Gate3IntradayTimingDiagnostic['sessionCompatibility']['session'];
  const liveBuyAllowed = typeof marketSession.liveBuyAllowed === 'boolean' ? marketSession.liveBuyAllowed : null;
  const shadowAllowed = typeof marketSession.shadowAllowed === 'boolean' ? marketSession.shadowAllowed : null;
  const sessionCompatibility: Gate3IntradayTimingDiagnostic['sessionCompatibility'] = {
    session,
    liveBuyAllowed,
    shadowAllowed,
    reason: null,
  };

  const hasIntraday = minuteBars.length > 0 || lastTick.status !== 'MISSING';
  const hasEod = quoteAt != null;
  const dataMode: Gate3IntradayTimingDiagnostic['dataMode'] = hasIntraday && hasEod ? 'MIXED' : hasIntraday ? 'INTRADAY' : hasEod ? 'EOD_ONLY' : 'UNKNOWN';
  if (dataMode === 'EOD_ONLY') notes.push('INTRADAY_NOT_FETCHED_EOD_ONLY');
  if (lastTick.status === 'STALE') notes.push('LAST_TICK_STALE_NOT_BEARISH');
  if (volumeClock.status === 'MISSING') notes.push('VOLUME_CLOCK_MISSING_NOT_VOLUME_WEAK');
  notes.push('DO_NOT_HARD_BLOCK_FROM_INTRADAY_DIAGNOSTIC');
  if (quoteAt == null) missingFields.push('quoteAsOf');
  if (lastTickAt == null) missingFields.push('lastTickAt');
  if (minuteBars.length === 0) missingFields.push('minuteBars');

  const freshnessIssue = quoteFreshness.status === 'STALE' || lastTick.status === 'STALE' || minuteChart.status === 'STALE';
  const calculationIssue = volumeClock.status === 'MISSING' || intradayMomentum.status === 'MISSING';
  const status: Gate3CoverageStatus = dataMode === 'EOD_ONLY'
    ? 'STAGE_NOT_FETCHED'
    : freshnessIssue ? 'STALE'
      : missingFields.length > 0 ? 'PARTIAL' : 'VERIFIED';

  return {
    status,
    dataMode,
    quoteFreshness,
    lastTick,
    minuteChart,
    volumeClock,
    intradayMomentum,
    sessionCompatibility,
    source: minuteBars.length > 0 ? 'KIS_MINUTE_CHART' : lastTick.status !== 'MISSING' ? 'KIS_REALTIME' : quoteAt != null ? 'KIS_OFFICIAL' : 'UNKNOWN',
    providerIssue: false,
    freshnessIssue,
    calculationIssue,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    missingFields: unique(missingFields),
    notes: unique(notes),
  };
}

export function normalizeGate3PriceStructure(input: {
  quote?: Record<string, unknown> | null;
  indicators?: Record<string, unknown> | null;
  evaluationStage?: 'DISCOVERY_GATE' | 'REFRESHED_GATE' | 'ENTRY_RECHECK_GATE' | 'UNKNOWN';
}): Gate3PriceStructureDiagnostic {
  const quote = input.quote ?? {};
  const notes: string[] = [];
  const missingFields: string[] = [];
  const pickCurrent = (): { value: Numeric; field: Gate3PriceStructureDiagnostic['priceFieldUsed'] } => {
    const cp = asFinite(quote.currentPrice); if (cp != null) return { value: cp, field: 'currentPrice' };
    const p = asFinite(quote.price); if (p != null) { notes.push('PRICE_FALLBACK_USED'); return { value: p, field: 'price' }; }
    const c = asFinite(quote.close); if (c != null) { notes.push('CLOSE_FALLBACK_USED'); return { value: c, field: 'close' }; }
    return { value: null, field: 'UNKNOWN' };
  };
  const { value: currentPrice, field: priceFieldUsed } = pickCurrent();
  if (currentPrice == null) missingFields.push('currentPrice');
  const high5d = asFinite(quote.high5d);
  const high20d = asFinite(quote.high20d);
  const high60d = asFinite(quote.high60d);
  const low20d = asFinite(quote.low20d);
  const low60d = asFinite(quote.low60d);
  const boxTop = asFinite(quote.boxTop);
  const boxBottom = asFinite(quote.boxBottom);
  if (high20d == null) missingFields.push('high20d');
  if (high60d == null) missingFields.push('high60d');
  const pickBreakout = (): { breakoutType: Gate3PriceStructureDiagnostic['breakout']['breakoutType']; price: Numeric } => {
    if (high20d != null) return { breakoutType: 'HIGH_20D', price: high20d };
    if (high60d != null) return { breakoutType: 'HIGH_60D', price: high60d };
    if (high5d != null) return { breakoutType: 'HIGH_5D', price: high5d };
    if (boxTop != null) return { breakoutType: 'BOX_BREAKOUT', price: boxTop };
    return { breakoutType: 'UNKNOWN', price: null };
  };
  const breakoutBasis = pickBreakout();
  const breakoutGapPct = currentPrice != null && breakoutBasis.price != null && breakoutBasis.price > 0 ? (currentPrice - breakoutBasis.price) / breakoutBasis.price : null;
  const breakout: Gate3PriceStructureDiagnostic['breakout'] = breakoutGapPct == null
    ? { available: false, status: 'MISSING', breakoutType: breakoutBasis.breakoutType, breakoutPrice: breakoutBasis.price, breakoutGapPct, reason: 'INPUT_MISSING' }
    : { available: true, status: breakoutGapPct >= 0 ? 'PASS' : 'FAIL', breakoutType: breakoutBasis.breakoutType, breakoutPrice: breakoutBasis.price, breakoutGapPct, reason: null };
  if (breakoutGapPct != null && breakoutGapPct > 0.08) notes.push('BREAKOUT_EXTENDED_CHASE_RISK');
  const turtlePeriod: 20 | 55 | 60 | null = high20d != null ? 20 : high60d != null ? 60 : null;
  const turtleThreshold = turtlePeriod === 20 ? high20d : turtlePeriod === 60 ? high60d : null;
  const distanceToBreakoutPct = currentPrice != null && turtleThreshold != null && turtleThreshold > 0 ? (currentPrice - turtleThreshold) / turtleThreshold : null;
  const turtle: Gate3PriceStructureDiagnostic['turtle'] = distanceToBreakoutPct == null
    ? { available: false, status: 'MISSING', period: turtlePeriod, thresholdPrice: turtleThreshold, currentPrice, distanceToBreakoutPct, reason: 'INPUT_MISSING' }
    : { available: true, status: distanceToBreakoutPct >= 0 ? 'PASS' : 'FAIL', period: turtlePeriod, thresholdPrice: turtleThreshold, currentPrice, distanceToBreakoutPct, reason: null };
  const drawdownFromHigh60dPct = currentPrice != null && high60d != null && high60d > 0 ? (currentPrice - high60d) / high60d : null;
  const drawdownFromHigh20dPct = currentPrice != null && high20d != null && high20d > 0 ? (currentPrice - high20d) / high20d : null;
  const pullback: Gate3PriceStructureDiagnostic['pullback'] = drawdownFromHigh60dPct == null && drawdownFromHigh20dPct == null
    ? { available: false, status: 'MISSING', high60d, currentPrice, drawdownFromHigh60dPct, drawdownFromHigh20dPct, supportReference: 'UNKNOWN', reason: 'INPUT_MISSING' }
    : { available: true, status: 'PASS', high60d, currentPrice, drawdownFromHigh60dPct, drawdownFromHigh20dPct, supportReference: 'UNKNOWN', reason: null };
  const range20dPct = high20d != null && low20d != null && low20d > 0 ? (high20d - low20d) / low20d : null;
  const range60dPct = high60d != null && low60d != null && low60d > 0 ? (high60d - low60d) / low60d : null;
  const boxWidthPct = boxTop != null && boxBottom != null && boxBottom > 0 ? (boxTop - boxBottom) / boxBottom : null;
  const rangeStructure: Gate3PriceStructureDiagnostic['rangeStructure'] = range20dPct == null && range60dPct == null
    ? { available: false, status: 'MISSING', range20dPct, range60dPct, boxTop, boxBottom, boxWidthPct, reason: 'INPUT_MISSING' }
    : { available: true, status: 'NORMAL', range20dPct, range60dPct, boxTop, boxBottom, boxWidthPct, reason: null };
  const status: Gate3CoverageStatus = missingFields.length === 0 ? 'VERIFIED' : currentPrice == null ? 'DEGRADED' : 'PARTIAL';
  return { status, currentPrice, priceFieldUsed, high5d, high20d, high60d, low20d, low60d, breakout, turtle, pullback, rangeStructure, source: 'UNKNOWN', providerIssue: false, calculationIssue: missingFields.length > 0, marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY', missingFields: unique(missingFields), notes: unique(notes) };
}

export function normalizeGate3Pullback(input: {
  quote?: Record<string, unknown> | null;
  priceStructure?: Gate3PriceStructureDiagnostic | null;
  indicators?: Record<string, unknown> | null;
  evaluationStage?: 'DISCOVERY_GATE' | 'REFRESHED_GATE' | 'ENTRY_RECHECK_GATE' | 'UNKNOWN';
}): Gate3PullbackDiagnostic {
  const quote = input.quote ?? {};
  const indicators = input.indicators ?? {};
  const priceStructure = input.priceStructure ?? normalizeGate3PriceStructure({ quote, indicators });
  const pick = (key: string): Numeric => asFinite(quote[key]) ?? asFinite(indicators[key]);
  const notes: string[] = ['DO_NOT_HARD_BLOCK_FROM_DIAGNOSTIC'];
  const missingFields: string[] = [];

  const currentPrice = priceStructure.currentPrice ?? pick('currentPrice') ?? pick('price') ?? pick('close');
  const high20d = priceStructure.high20d ?? pick('high20d');
  const high60d = priceStructure.high60d ?? pick('high60d');
  const low20d = priceStructure.low20d ?? pick('low20d');
  const low60d = priceStructure.low60d ?? pick('low60d');
  const explicitSwingHigh = pick('recentSwingHigh') ?? pick('swingHigh');
  const explicitSwingLow = pick('recentSwingLow') ?? pick('swingLow');
  const recentSwingHigh = explicitSwingHigh ?? high20d ?? high60d;
  const recentSwingLow = explicitSwingLow ?? low20d ?? low60d;
  const ma20 = pick('ma20');
  const ma60 = pick('ma60');
  const boxTop = priceStructure.rangeStructure.boxTop ?? pick('boxTop');
  const boxBottom = priceStructure.rangeStructure.boxBottom ?? pick('boxBottom');

  if (currentPrice == null) missingFields.push('currentPrice');
  if (high20d == null) missingFields.push('high20d');
  if (high60d == null) missingFields.push('high60d');
  if (low20d == null) missingFields.push('low20d');
  if (low60d == null) missingFields.push('low60d');
  if (recentSwingHigh == null) missingFields.push('recentSwingHigh');
  if (recentSwingLow == null) missingFields.push('recentSwingLow');
  if (ma20 == null) missingFields.push('ma20');
  if (ma60 == null) missingFields.push('ma60');
  if (boxTop == null) missingFields.push('boxTop');
  if (boxBottom == null) missingFields.push('boxBottom');

  const swingAvailable = recentSwingHigh != null && recentSwingLow != null;
  const swingStatus: Gate3PullbackDiagnostic['swing']['status'] = swingAvailable ? (explicitSwingHigh != null && explicitSwingLow != null ? 'VERIFIED' : 'PARTIAL') : (recentSwingHigh == null && recentSwingLow == null ? 'MISSING' : 'PARTIAL');
  const distanceToMa20Pct = pctDistance(currentPrice, ma20);
  const distanceToMa60Pct = pctDistance(currentPrice, ma60);
  const maCandidates = [{ key: 'MA20' as const, distance: distanceToMa20Pct }, { key: 'MA60' as const, distance: distanceToMa60Pct }].filter(item => item.distance != null);
  const nearestMa = maCandidates.sort((a, b) => Math.abs(a.distance!) - Math.abs(b.distance!)).at(0);
  const nearestSupport = nearestMa?.key ?? (ma20 == null && ma60 == null ? 'UNKNOWN' : 'NONE');
  const nearestMaDistance = nearestMa?.distance ?? null;
  const maStatus: Gate3PullbackDiagnostic['movingAverageSupport']['status'] = nearestMaDistance == null ? 'MISSING' : nearestMaDistance < -0.03 ? 'BROKEN' : Math.abs(nearestMaDistance) <= 0.03 ? 'SUPPORT_NEAR' : 'EXTENDED';
  if (maStatus === 'MISSING') notes.push('MA_INPUT_MISSING_NOT_TREND_BROKEN');

  const swingRange = recentSwingHigh != null && recentSwingLow != null ? recentSwingHigh - recentSwingLow : null;
  const canCalculateFib = recentSwingHigh != null && recentSwingLow != null && swingRange != null && swingRange > 0;
  const fib382 = canCalculateFib ? recentSwingHigh! - swingRange! * 0.382 : null;
  const fib500 = canCalculateFib ? recentSwingHigh! - swingRange! * 0.5 : null;
  const fib618 = canCalculateFib ? recentSwingHigh! - swingRange! * 0.618 : null;
  const fibCandidates = [{ key: 'FIB_382' as const, value: fib382 }, { key: 'FIB_500' as const, value: fib500 }, { key: 'FIB_618' as const, value: fib618 }].filter(item => item.value != null && currentPrice != null);
  const nearestFibCandidate = fibCandidates.map(item => ({ key: item.key, value: item.value, distance: pctDistance(currentPrice, item.value) })).sort((a, b) => Math.abs(a.distance!) - Math.abs(b.distance!)).at(0);
  const nearestFib = nearestFibCandidate?.key ?? (canCalculateFib ? 'NONE' : 'UNKNOWN');
  const distanceToNearestFibPct = nearestFibCandidate?.distance ?? null;
  const fibStatus: Gate3PullbackDiagnostic['fibonacci']['status'] = distanceToNearestFibPct == null ? 'MISSING' : distanceToNearestFibPct < -0.03 ? 'BROKEN' : Math.abs(distanceToNearestFibPct) <= 0.03 ? 'SUPPORT_NEAR' : 'EXTENDED';
  if (fibStatus === 'MISSING') notes.push('FIB_INPUT_MISSING_NOT_FAIL');
  if (fibStatus === 'SUPPORT_NEAR') notes.push('FIB_SUPPORT_NEAR_DIAGNOSTIC_ONLY');

  const distanceToBoxTopPct = pctDistance(currentPrice, boxTop);
  const boxStatus: Gate3PullbackDiagnostic['boxRetest']['status'] = distanceToBoxTopPct == null ? 'MISSING' : distanceToBoxTopPct >= 0 && distanceToBoxTopPct <= 0.03 ? 'RETEST_NEAR' : distanceToBoxTopPct > 0.03 ? 'ABOVE_BOX' : boxBottom != null && currentPrice != null && currentPrice < boxBottom ? 'BROKEN_BOX' : 'INSIDE_BOX';
  if (boxStatus === 'MISSING') notes.push('BOX_RETEST_INPUT_MISSING_NOT_FAIL');

  const drawdownFromHigh20dPct = priceStructure.pullback.drawdownFromHigh20dPct ?? pctDistance(currentPrice, high20d);
  const drawdownFromHigh60dPct = priceStructure.pullback.drawdownFromHigh60dPct ?? pctDistance(currentPrice, high60d);
  const pullbackReferenceHigh = explicitSwingHigh ?? high20d ?? high60d;
  const pullbackPct = pctDistance(currentPrice, pullbackReferenceHigh);
  const pullbackQualityStatus: Gate3PullbackDiagnostic['pullbackQuality']['status'] = pullbackPct == null ? 'MISSING' : pullbackPct > 0.08 ? 'EXTENDED_CHASE' : pullbackPct > -0.02 ? 'TOO_SHALLOW' : pullbackPct >= -0.15 ? 'HEALTHY_PULLBACK' : 'TOO_DEEP';
  if (pullbackQualityStatus === 'MISSING') notes.push('PULLBACK_INPUT_MISSING_NOT_FAIL');
  if (pullbackQualityStatus === 'EXTENDED_CHASE') notes.push('EXTENDED_CHASE_DIAGNOSTIC_ONLY');
  if (pullbackQualityStatus === 'TOO_DEEP') notes.push('TOO_DEEP_PULLBACK_DIAGNOSTIC_ONLY');

  const supportReference: Gate3PullbackDiagnostic['supportReference'] = maStatus === 'SUPPORT_NEAR' && nearestSupport !== 'NONE' && nearestSupport !== 'UNKNOWN'
    ? nearestSupport
    : fibStatus === 'SUPPORT_NEAR' && nearestFib !== 'NONE' && nearestFib !== 'UNKNOWN'
      ? nearestFib
      : boxStatus === 'RETEST_NEAR' ? 'BOX_TOP'
        : recentSwingLow != null && currentPrice != null && Math.abs(pctDistance(currentPrice, recentSwingLow) ?? Infinity) <= 0.03 ? 'SWING_LOW'
          : 'NONE';
  if (supportReference === 'NONE') notes.push('SUPPORT_REFERENCE_UNKNOWN');

  const subStatuses = [swingStatus, maStatus, fibStatus, boxStatus, pullbackQualityStatus] as string[];
  const allMissing = subStatuses.every(status => status === 'MISSING' || status === 'UNKNOWN');
  const degraded = currentPrice == null || swingStatus === 'MISSING' || pullbackQualityStatus === 'MISSING';
  const status: Gate3CoverageStatus = allMissing ? 'MISSING' : degraded ? 'DEGRADED' : missingFields.length > 0 ? 'PARTIAL' : 'VERIFIED';

  return {
    status,
    currentPrice,
    swing: { recentSwingHigh, recentSwingLow, high20d, high60d, low20d, low60d, available: swingAvailable, status: swingStatus, reason: swingAvailable ? null : 'INPUT_MISSING' },
    movingAverageSupport: { ma20, ma60, distanceToMa20Pct, distanceToMa60Pct, nearestSupport, status: maStatus, available: maStatus !== 'MISSING', reason: maStatus === 'MISSING' ? 'INPUT_MISSING' : null },
    fibonacci: { fib382, fib500, fib618, nearestFib, distanceToNearestFibPct, status: fibStatus, available: fibStatus !== 'MISSING', reason: fibStatus === 'MISSING' ? 'INPUT_MISSING' : null },
    boxRetest: { boxTop, boxBottom, distanceToBoxTopPct, status: boxStatus, available: boxStatus !== 'MISSING', reason: boxStatus === 'MISSING' ? 'INPUT_MISSING' : null },
    pullbackQuality: { drawdownFromHigh20dPct, drawdownFromHigh60dPct, pullbackPct, status: pullbackQualityStatus, reason: pullbackQualityStatus === 'MISSING' ? 'INPUT_MISSING' : null },
    supportReference,
    source: 'UNKNOWN', providerIssue: false, calculationIssue: missingFields.length > 0, marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY', missingFields: unique(missingFields), notes: unique(notes),
  };
}

export function normalizeGate3FalseBreakout(input: {
  quote?: Record<string, unknown> | null;
  priceStructure?: Gate3PriceStructureDiagnostic | null;
  volumeTiming?: Gate3VolumeTimingDiagnostic | null;
  momentumIndicators?: { rsi14?: Numeric; macdHistogram?: Numeric } | null;
  pullbackSupport?: { ma20?: Numeric; boxTop?: Numeric } | null;
  previousPeaks?: { previousHigh?: Numeric; previousPeakRsi?: Numeric; previousPeakMacdHist?: Numeric } | null;
}): Gate3FalseBreakoutDiagnostic {
  const quote = input.quote ?? {};
  const priceStructure = input.priceStructure ?? normalizeGate3PriceStructure({ quote });
  const volumeTiming = input.volumeTiming ?? normalizeGate3VolumeTiming({ quote });
  const notes: string[] = ['DO_NOT_HARD_BLOCK_FROM_DIAGNOSTIC'];
  const missingFields: string[] = [];
  const currentPrice = priceStructure.currentPrice ?? asFinite(quote.currentPrice) ?? asFinite(quote.price) ?? asFinite(quote.close);
  const closePrice = asFinite(quote.close) ?? currentPrice;
  const highPrice = asFinite(quote.highPrice) ?? asFinite(quote.high) ?? asFinite(quote.dayHigh);
  const breakoutPrice = priceStructure.breakout.breakoutPrice ?? asFinite(quote.breakoutPrice) ?? asFinite(quote.high20d);
  const breakoutGapPct = priceStructure.breakout.breakoutGapPct ?? asFinite(quote.breakoutGapPct);
  const boxTop = input.pullbackSupport?.boxTop ?? priceStructure.rangeStructure.boxTop ?? asFinite(quote.boxTop);
  const ma20 = input.pullbackSupport?.ma20 ?? asFinite(quote.ma20);
  const rsi14 = input.momentumIndicators?.rsi14 ?? asFinite(quote.rsi14);
  const macdHistogram = input.momentumIndicators?.macdHistogram ?? asFinite(quote.macdHistogram);
  const volumeRatio = volumeTiming.volumeRatio ?? asFinite(quote.volumeRatio);
  const priceBreakoutConfirmed = breakoutPrice == null ? null : priceStructure.breakout.status === 'PASS';
  const volumeConfirmed = volumeTiming.breakoutVolume.status === 'MISSING' ? null : volumeTiming.breakoutVolume.status === 'PASS';
  const closeAboveBreakout = closePrice != null && breakoutPrice != null ? closePrice > breakoutPrice : null;
  const wickRejection = highPrice != null && closePrice != null && highPrice > 0 ? ((highPrice - closePrice) / highPrice) >= 0.03 : null;
  const failedRetest = currentPrice != null && (boxTop ?? breakoutPrice) != null ? currentPrice < (boxTop ?? breakoutPrice)! : null;
  const fbStatus: Gate3FalseBreakoutDiagnostic['falseBreakout']['status'] = breakoutPrice == null ? 'MISSING' : priceBreakoutConfirmed && volumeConfirmed && closeAboveBreakout !== false && failedRetest !== true ? 'LOW_RISK' : priceBreakoutConfirmed && (volumeConfirmed === false || closeAboveBreakout === false || failedRetest === true) ? 'HIGH_RISK' : 'WATCH';
  if (fbStatus !== 'LOW_RISK' && fbStatus !== 'MISSING') notes.push('FALSE_BREAKOUT_WATCH_DIAGNOSTIC_ONLY');

  const previousHigh = input.previousPeaks?.previousHigh ?? asFinite(quote.previousHigh);
  const previousPeakRsi = input.previousPeaks?.previousPeakRsi ?? asFinite(quote.previousPeakRsi);
  const previousPeakMacdHist = input.previousPeaks?.previousPeakMacdHist ?? asFinite(quote.previousPeakMacdHist);
  const currentHigh = highPrice ?? currentPrice;
  const priceHigherHigh = currentHigh != null && previousHigh != null ? currentHigh > previousHigh : null;
  const rsiLowerHigh = rsi14 != null && previousPeakRsi != null ? rsi14 < previousPeakRsi : null;
  const macdLowerHigh = macdHistogram != null && previousPeakMacdHist != null ? macdHistogram < previousPeakMacdHist : null;
  let divStatus: Gate3FalseBreakoutDiagnostic['divergence']['status'] = 'UNKNOWN';
  if (previousPeakRsi == null && previousPeakMacdHist == null) divStatus = 'MISSING';
  else if (priceHigherHigh && rsiLowerHigh && macdLowerHigh) divStatus = 'BOTH_BEARISH';
  else if (priceHigherHigh && rsiLowerHigh) divStatus = 'RSI_BEARISH';
  else if (priceHigherHigh && macdLowerHigh) divStatus = 'MACD_BEARISH';
  else if (priceHigherHigh != null) divStatus = 'NONE';
  if (divStatus === 'RSI_BEARISH' || divStatus === 'BOTH_BEARISH') notes.push('RSI_DIVERGENCE_DIAGNOSTIC_ONLY');
  if (divStatus === 'MACD_BEARISH' || divStatus === 'BOTH_BEARISH') notes.push('MACD_DIVERGENCE_DIAGNOSTIC_ONLY');

  const rsiOverheated = rsi14 != null ? rsi14 >= 80 : null;
  const volumeClimax = volumeRatio != null && breakoutGapPct != null ? (volumeRatio >= 3 && breakoutGapPct >= 0.04) : null;
  const extendedFromBreakout = breakoutGapPct != null ? breakoutGapPct >= 0.06 : null;
  const extendedFromMa20 = currentPrice != null && ma20 != null && ma20 > 0 ? ((currentPrice - ma20) / ma20) >= 0.1 : null;
  const gapUpPct = asFinite(quote.gapUpPct);
  const gapUpExhaustion = gapUpPct != null && wickRejection != null ? (gapUpPct >= 0.03 && wickRejection) : null;
  const exhausted = [rsiOverheated, volumeClimax, extendedFromBreakout, extendedFromMa20, gapUpExhaustion].filter(v => v === true).length;
  const exStatus: Gate3FalseBreakoutDiagnostic['exhaustion']['status'] = rsi14 == null && volumeRatio == null && breakoutGapPct == null ? 'MISSING' : exhausted >= 2 ? 'EXHAUSTED' : exhausted === 1 ? 'WATCH' : 'NORMAL';
  if (exStatus === 'EXHAUSTED' || exStatus === 'WATCH') notes.push('EXHAUSTION_RISK_DIAGNOSTIC_ONLY');

  const refTop = boxTop ?? breakoutPrice;
  const distPct = currentPrice != null && refTop != null && refTop > 0 ? (currentPrice - refTop) / refTop : null;
  const retestHeld = distPct != null ? distPct >= 0 : null;
  const rtStatus: Gate3FalseBreakoutDiagnostic['retestQuality']['status'] = refTop == null || currentPrice == null ? 'MISSING' : distPct! < -0.01 ? 'FAILED' : distPct! < 0 ? 'WEAK' : 'GOOD';

  const missingCandidates: Array<[string, Numeric]> = [['currentPrice', currentPrice], ['breakoutPrice', breakoutPrice], ['volumeRatio', volumeRatio], ['highPrice', highPrice], ['rsi14', rsi14], ['macdHistogram', macdHistogram], ['previousHigh', previousHigh], ['previousPeakRsi', previousPeakRsi], ['previousPeakMacdHist', previousPeakMacdHist], ['boxTop', boxTop], ['ma20', ma20]];
  for (const [field, value] of missingCandidates) {
    if (value == null) missingFields.push(field);
  }

  const subStatuses = [fbStatus, divStatus, exStatus, rtStatus] as string[];
  const allMissing = subStatuses.every(status => status === 'MISSING');
  const anyMissing = subStatuses.includes('MISSING') || missingFields.length > 0;
  const hasWarning = fbStatus === 'HIGH_RISK' || divStatus.includes('BEARISH') || exStatus === 'EXHAUSTED';
  const status: Gate3FalseBreakoutDiagnostic['status'] = allMissing ? 'MISSING' : hasWarning ? 'WARN' : anyMissing ? 'PARTIAL' : 'VERIFIED';

  return {
    status,
    falseBreakout: { status: fbStatus, priceBreakoutConfirmed, volumeConfirmed, closeAboveBreakout, wickRejection, failedRetest, reason: null },
    divergence: { status: divStatus, priceHigherHigh, rsiLowerHigh, macdLowerHigh, currentHigh, previousHigh, currentRsi: rsi14, previousPeakRsi, currentMacdHist: macdHistogram, previousPeakMacdHist, reason: null },
    exhaustion: { status: exStatus, rsiOverheated, volumeClimax, extendedFromBreakout, extendedFromMa20, gapUpExhaustion, reason: null },
    retestQuality: { status: rtStatus, boxTop: refTop, currentPrice, closePrice, distanceToBoxTopPct: distPct, retestHeld, reason: null },
    source: 'UNKNOWN', providerIssue: false, calculationIssue: missingFields.length > 0, marketSignal: false, executionImpact: 'DIAGNOSTIC_ONLY', missingFields: unique(missingFields), notes: unique(notes),
  };
}

export function buildGate3ExternalDataCoverage(quote: Record<string, unknown>): Gate3ExternalDataCoverage {
  const resolveStatus = (fields: Record<string, boolean>, required: boolean): { available: boolean; status: Gate3CoverageStatus } => {
    const values = Object.values(fields);
    if (values.every(Boolean)) return { available: true, status: 'VERIFIED' };
    if (values.every(v => !v)) return { available: false, status: required ? 'MISSING' : 'STAGE_NOT_FETCHED' };
    return { available: false, status: 'CALCULATION_MISSING' };
  };

  const technicalFields = {
    rsi14: hasFinite(quote, 'rsi14'),
    rsi5dAgo: hasFinite(quote, 'rsi5dAgo'),
    macdHistogram: hasFinite(quote, 'macdHistogram'),
    macd5dHistAgo: hasFinite(quote, 'macd5dHistAgo'),
    bbWidth: hasFinite(quote, 'bbWidthCurrent') || hasFinite(quote, 'bbWidth'),
    atr14: hasFinite(quote, 'atr14') || hasFinite(quote, 'atr'),
    ma5: hasFinite(quote, 'ma5'),
    ma20: hasFinite(quote, 'ma20'),
    ma60: hasFinite(quote, 'ma60'),
  };
  const priceDiag = normalizeGate3PriceStructure({ quote });
  const pullbackDiag = normalizeGate3Pullback({ quote, priceStructure: priceDiag, indicators: quote });
  const momentumDiag = normalizeGate3Momentum({ quote, indicators: quote, priceStructure: priceDiag });
  const volumeTiming = normalizeGate3VolumeTiming({ quote });
  const intradayTiming = normalizeGate3IntradayTiming({
    quote,
    intraday: asRecord(quote.intraday),
    minuteBars: Array.isArray(quote.minuteBars) ? quote.minuteBars as Record<string, unknown>[] : null,
    marketSession: asRecord(quote.marketSession),
    volumeTiming,
  });
  const priceFields = {
    currentPrice: hasFinite(quote, 'currentPrice'),
    price: hasFinite(quote, 'price'),
    close: hasFinite(quote, 'close'),
    high5d: hasFinite(quote, 'high5d'),
    high20d: hasFinite(quote, 'high20d'),
    high60d: hasFinite(quote, 'high60d'),
    low20d: hasFinite(quote, 'low20d'),
    low60d: hasFinite(quote, 'low60d'),
    boxTop: hasFinite(quote, 'boxTop'),
    boxBottom: hasFinite(quote, 'boxBottom'),
    range20dPct: priceDiag.rangeStructure.range20dPct != null,
    range60dPct: priceDiag.rangeStructure.range60dPct != null,
  };
  const volumeFields = {
    volume: hasFinite(quote, 'volume'),
    avgVolume: hasFinite(quote, 'avgVolume'),
    avgVolume20d: hasFinite(quote, 'avgVolume20d'),
    volumeRatio: hasFinite(quote, 'volumeRatio'),
    tradingValue: hasFinite(quote, 'tradingValue'),
  };
  const intradayFields = {
    quoteAsOf: intradayTiming.quoteFreshness.lastQuoteAt != null,
    lastQuoteAt: intradayTiming.quoteFreshness.lastQuoteAt != null,
    lastTickAt: intradayTiming.lastTick.lastTickAt != null,
    lastTickPrice: intradayTiming.lastTick.price != null,
    lastTickVolume: intradayTiming.lastTick.volume != null,
    minuteBars: (intradayTiming.minuteChart.barCount ?? 0) > 0,
    latestBarAt: intradayTiming.minuteChart.latestBarAt != null,
    sessionProgressPct: intradayTiming.volumeClock.sessionProgressPct != null,
    expectedVolumeByNow: intradayTiming.volumeClock.expectedVolumeByNow != null,
    actualVolume: intradayTiming.volumeClock.actualVolume != null,
    volumePaceRatio: intradayTiming.volumeClock.volumePaceRatio != null,
    vwap: intradayTiming.intradayMomentum.vwap != null,
    priceVsVwapPct: intradayTiming.intradayMomentum.priceVsVwapPct != null,
  };

  const technicalState = resolveStatus(technicalFields, true);
  const volumeState = resolveStatus(volumeFields, true);
  const volumeTimingFields = {
    volume: volumeTiming.volume != null,
    avgVolume: volumeTiming.avgVolume != null,
    avgVolume20d: volumeTiming.avgVolume20d != null,
    volumeRatio: volumeTiming.volumeRatio != null,
    tradingValue: volumeTiming.tradingValue != null,
    avgTradingValue20d: volumeTiming.avgTradingValue20d != null,
    tradingValueRatio: volumeTiming.tradingValueRatio != null,
    recentVolumeAvg3d: volumeTiming.dryUp.recentVolumeAvg3d != null,
    dryUpRatio: volumeTiming.dryUp.dryUpRatio != null,
    bbWidth: volumeTiming.vcp.bbWidth != null,
    bbWidthPercentile: volumeTiming.vcp.bbWidthPercentile != null,
    atr14: volumeTiming.vcp.atr14 != null,
    atrContraction: volumeTiming.vcp.atrContraction != null,
    rangeContraction: volumeTiming.vcp.rangeContraction != null,
    contractionCount: volumeTiming.vcp.contractionCount != null,
  };
  const falseBreakoutDiag = normalizeGate3FalseBreakout({
    quote,
    priceStructure: priceDiag,
    volumeTiming,
    momentumIndicators: { rsi14: momentumDiag.rsi.rsi14, macdHistogram: momentumDiag.macd.macdHistogram },
    pullbackSupport: { ma20: pullbackDiag.movingAverageSupport.ma20, boxTop: pullbackDiag.boxRetest.boxTop },
  });
  const lastTriggerDiag = evaluateGate3LastTrigger({
    quote: {
      ...quote,
      currentPrice: priceDiag.currentPrice ?? quote.currentPrice ?? quote.price,
      falseBreakoutRisk: falseBreakoutDiag.falseBreakout.status,
    },
  });
  const executionReadinessStatus = lastTriggerDiag.fired
    ? 'READY'
    : lastTriggerDiag.status === 'DATA_UNAVAILABLE' || lastTriggerDiag.entryPriceGuard.priceFreshness === 'MISSING'
      ? 'DATA_INCOMPLETE'
      : 'WAIT';

  return {
    technicalIndicators: { required: true, available: technicalState.available, provider: 'UNKNOWN', status: technicalState.status, fields: technicalFields, providerIssue: false, calculationIssue: technicalState.status === 'CALCULATION_MISSING' || technicalState.status === 'MISSING', marketSignal: false },
    priceStructure: {
      required: true,
      available: priceDiag.status === 'VERIFIED' || priceDiag.status === 'PARTIAL',
      provider: 'UNKNOWN',
      status: priceDiag.status,
      fields: priceFields,
      values: { currentPrice: priceDiag.currentPrice, priceFieldUsed: priceDiag.priceFieldUsed, high5d: priceDiag.high5d, high20d: priceDiag.high20d, high60d: priceDiag.high60d, low20d: priceDiag.low20d, low60d: priceDiag.low60d, breakoutGapPct: priceDiag.breakout.breakoutGapPct, drawdownFromHigh60dPct: priceDiag.pullback.drawdownFromHigh60dPct, range20dPct: priceDiag.rangeStructure.range20dPct, boxWidthPct: priceDiag.rangeStructure.boxWidthPct },
      breakout: priceDiag.breakout,
      turtle: priceDiag.turtle,
      pullback: priceDiag.pullback,
      rangeStructure: priceDiag.rangeStructure,
      providerIssue: false,
      calculationIssue: priceDiag.calculationIssue,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      missingFields: priceDiag.missingFields,
      notes: priceDiag.notes,
    },
    pullbackSupport: {
      required: false,
      available: pullbackDiag.status !== 'MISSING',
      status: pullbackDiag.status,
      fields: { currentPrice: pullbackDiag.currentPrice != null, recentSwingHigh: pullbackDiag.swing.recentSwingHigh != null, recentSwingLow: pullbackDiag.swing.recentSwingLow != null, high20d: pullbackDiag.swing.high20d != null, high60d: pullbackDiag.swing.high60d != null, low20d: pullbackDiag.swing.low20d != null, low60d: pullbackDiag.swing.low60d != null, ma20: pullbackDiag.movingAverageSupport.ma20 != null, ma60: pullbackDiag.movingAverageSupport.ma60 != null, fib382: pullbackDiag.fibonacci.fib382 != null, fib500: pullbackDiag.fibonacci.fib500 != null, fib618: pullbackDiag.fibonacci.fib618 != null, boxTop: pullbackDiag.boxRetest.boxTop != null, boxBottom: pullbackDiag.boxRetest.boxBottom != null, supportReference: pullbackDiag.supportReference !== 'NONE' && pullbackDiag.supportReference !== 'UNKNOWN' },
      values: { currentPrice: pullbackDiag.currentPrice, recentSwingHigh: pullbackDiag.swing.recentSwingHigh, recentSwingLow: pullbackDiag.swing.recentSwingLow, high20d: pullbackDiag.swing.high20d, high60d: pullbackDiag.swing.high60d, low20d: pullbackDiag.swing.low20d, low60d: pullbackDiag.swing.low60d, ma20: pullbackDiag.movingAverageSupport.ma20, ma60: pullbackDiag.movingAverageSupport.ma60, fib382: pullbackDiag.fibonacci.fib382, fib500: pullbackDiag.fibonacci.fib500, fib618: pullbackDiag.fibonacci.fib618, drawdownFromHigh20dPct: pullbackDiag.pullbackQuality.drawdownFromHigh20dPct, drawdownFromHigh60dPct: pullbackDiag.pullbackQuality.drawdownFromHigh60dPct, pullbackPct: pullbackDiag.pullbackQuality.pullbackPct },
      swing: pullbackDiag.swing,
      movingAverageSupport: pullbackDiag.movingAverageSupport,
      fibonacci: pullbackDiag.fibonacci,
      boxRetest: pullbackDiag.boxRetest,
      pullbackQuality: pullbackDiag.pullbackQuality,
      supportReference: pullbackDiag.supportReference,
      providerIssue: pullbackDiag.providerIssue,
      calculationIssue: pullbackDiag.calculationIssue,
      marketSignal: false,
      executionImpact: pullbackDiag.executionImpact,
      missingFields: pullbackDiag.missingFields,
      notes: pullbackDiag.notes,
    },
    volumeStructure: { required: true, available: volumeState.available, provider: 'UNKNOWN', status: volumeState.status, fields: volumeFields, providerIssue: false, calculationIssue: volumeState.status === 'CALCULATION_MISSING' || volumeState.status === 'MISSING', marketSignal: false },
    intradayTiming: {
      required: false,
      available: intradayTiming.status === 'VERIFIED' || intradayTiming.status === 'PARTIAL' || intradayTiming.status === 'STALE',
      provider: intradayTiming.source,
      status: intradayTiming.status,
      dataMode: intradayTiming.dataMode,
      fields: intradayFields,
      values: { quoteAgeSec: intradayTiming.quoteFreshness.ageSec, lastTickAgeSec: intradayTiming.lastTick.ageSec, minuteBarCount: intradayTiming.minuteChart.barCount, latestBarAgeSec: intradayTiming.minuteChart.latestBarAgeSec, sessionProgressPct: intradayTiming.volumeClock.sessionProgressPct, expectedVolumeByNow: intradayTiming.volumeClock.expectedVolumeByNow, actualVolume: intradayTiming.volumeClock.actualVolume, volumePaceRatio: intradayTiming.volumeClock.volumePaceRatio, openToNowReturn: intradayTiming.intradayMomentum.openToNowReturn, priceVsVwapPct: intradayTiming.intradayMomentum.priceVsVwapPct },
      quoteFreshness: intradayTiming.quoteFreshness,
      lastTick: intradayTiming.lastTick,
      minuteChart: intradayTiming.minuteChart,
      volumeClock: intradayTiming.volumeClock,
      intradayMomentum: intradayTiming.intradayMomentum,
      sessionCompatibility: intradayTiming.sessionCompatibility,
      providerIssue: intradayTiming.providerIssue,
      freshnessIssue: intradayTiming.freshnessIssue,
      calculationIssue: intradayTiming.calculationIssue,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      missingFields: intradayTiming.missingFields,
      notes: intradayTiming.notes,
    },
    volumeTiming: {
      required: true,
      available: volumeTiming.status === 'VERIFIED' || volumeTiming.status === 'PARTIAL',
      status: volumeTiming.status,
      fields: volumeTimingFields,
      values: { volume: volumeTiming.volume, avgVolume: volumeTiming.avgVolume, avgVolume20d: volumeTiming.avgVolume20d, volumeRatio: volumeTiming.volumeRatio, tradingValue: volumeTiming.tradingValue, avgTradingValue20d: volumeTiming.avgTradingValue20d, tradingValueRatio: volumeTiming.tradingValueRatio, dryUpRatio: volumeTiming.dryUp.dryUpRatio, bbWidth: volumeTiming.vcp.bbWidth, atr14: volumeTiming.vcp.atr14, contractionCount: volumeTiming.vcp.contractionCount },
      dryUp: volumeTiming.dryUp,
      vcp: volumeTiming.vcp,
      breakoutVolume: volumeTiming.breakoutVolume,
      providerIssue: false,
      calculationIssue: volumeTiming.calculationIssue,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      missingFields: volumeTiming.missingFields,
      notes: volumeTiming.notes,
    },
    falseBreakout: {
      required: false,
      available: falseBreakoutDiag.status !== 'MISSING',
      status: falseBreakoutDiag.status,
      fields: { currentPrice: falseBreakoutDiag.retestQuality.currentPrice != null, closePrice: falseBreakoutDiag.retestQuality.closePrice != null, highPrice: falseBreakoutDiag.divergence.currentHigh != null, breakoutPrice: priceDiag.breakout.breakoutPrice != null, breakoutGapPct: priceDiag.breakout.breakoutGapPct != null, volumeRatio: volumeTiming.volumeRatio != null, tradingValueRatio: volumeTiming.tradingValueRatio != null, rsi14: falseBreakoutDiag.divergence.currentRsi != null, macdHistogram: falseBreakoutDiag.divergence.currentMacdHist != null, previousHigh: falseBreakoutDiag.divergence.previousHigh != null, previousPeakRsi: falseBreakoutDiag.divergence.previousPeakRsi != null, previousPeakMacdHist: falseBreakoutDiag.divergence.previousPeakMacdHist != null, boxTop: falseBreakoutDiag.retestQuality.boxTop != null, ma20: pullbackDiag.movingAverageSupport.ma20 != null },
      values: { currentPrice: falseBreakoutDiag.retestQuality.currentPrice, closePrice: falseBreakoutDiag.retestQuality.closePrice, highPrice: falseBreakoutDiag.divergence.currentHigh, breakoutPrice: priceDiag.breakout.breakoutPrice, breakoutGapPct: priceDiag.breakout.breakoutGapPct, volumeRatio: volumeTiming.volumeRatio, tradingValueRatio: volumeTiming.tradingValueRatio, rsi14: falseBreakoutDiag.divergence.currentRsi, macdHistogram: falseBreakoutDiag.divergence.currentMacdHist, previousHigh: falseBreakoutDiag.divergence.previousHigh, previousPeakRsi: falseBreakoutDiag.divergence.previousPeakRsi, previousPeakMacdHist: falseBreakoutDiag.divergence.previousPeakMacdHist, boxTop: falseBreakoutDiag.retestQuality.boxTop, ma20: pullbackDiag.movingAverageSupport.ma20 },
      falseBreakout: falseBreakoutDiag.falseBreakout,
      divergence: falseBreakoutDiag.divergence,
      exhaustion: falseBreakoutDiag.exhaustion,
      retestQuality: falseBreakoutDiag.retestQuality,
      providerIssue: false,
      calculationIssue: falseBreakoutDiag.calculationIssue,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      missingFields: falseBreakoutDiag.missingFields,
      notes: falseBreakoutDiag.notes,
    },
    lastTrigger: {
      required: true,
      available: lastTriggerDiag.status !== 'DATA_UNAVAILABLE',
      status: lastTriggerDiag.status,
      fired: lastTriggerDiag.fired,
      reason: lastTriggerDiag.reason,
      priceBreakout: lastTriggerDiag.priceBreakout,
      volumeConfirmation: lastTriggerDiag.volumeConfirmation,
      vcp: lastTriggerDiag.vcp,
      rsi: lastTriggerDiag.rsi,
      macd: lastTriggerDiag.macd,
      falseBreakoutRisk: lastTriggerDiag.falseBreakoutRisk,
      strongBuyAllowed: lastTriggerDiag.strongBuyAllowed,
      liveBuyAllowed: lastTriggerDiag.liveBuyAllowed,
      shadowObservableAllowed: lastTriggerDiag.shadowObservableAllowed,
      counterfactualAllowed: lastTriggerDiag.counterfactualAllowed,
      executionReady: lastTriggerDiag.executionReady,
      providerIssue: false,
      calculationIssue: lastTriggerDiag.status === 'DATA_UNAVAILABLE',
      marketSignal: false,
      executionImpact: lastTriggerDiag.executionImpact,
      notes: lastTriggerDiag.notes,
    },
    entryPriceGuard: lastTriggerDiag.entryPriceGuard,
    rrrCheck: lastTriggerDiag.rrrCheck,
    executionReadiness: {
      status: executionReadinessStatus,
      liveBuyAllowed: lastTriggerDiag.liveBuyAllowed,
      shadowObservableAllowed: lastTriggerDiag.shadowObservableAllowed,
      counterfactualAllowed: lastTriggerDiag.counterfactualAllowed,
      executionReady: lastTriggerDiag.executionReady,
      executionImpact: lastTriggerDiag.executionImpact,
      marketSignal: false,
      reason: lastTriggerDiag.reason,
    },
    momentumIndicators: {
      required: true,
      available: momentumDiag.status === 'VERIFIED' || momentumDiag.status === 'PARTIAL',
      status: momentumDiag.status,
      fields: { rsi14: momentumDiag.rsi.rsi14 != null, rsi5dAgo: momentumDiag.rsi.rsi5dAgo != null, rsiDelta5d: momentumDiag.rsi.rsiDelta5d != null, macdHistogram: momentumDiag.macd.macdHistogram != null, macd5dHistAgo: momentumDiag.macd.macd5dHistAgo != null, macdHistDelta5d: momentumDiag.macd.macdHistDelta5d != null, changePercent: momentumDiag.shortMomentum.changePercent != null, return5d: momentumDiag.shortMomentum.return5d != null, return20d: momentumDiag.shortMomentum.return20d != null, acceleration5dVs20d: momentumDiag.shortMomentum.acceleration5dVs20d != null },
      values: { rsi14: momentumDiag.rsi.rsi14, rsi5dAgo: momentumDiag.rsi.rsi5dAgo, rsiDelta5d: momentumDiag.rsi.rsiDelta5d, macdHistogram: momentumDiag.macd.macdHistogram, macd5dHistAgo: momentumDiag.macd.macd5dHistAgo, macdHistDelta5d: momentumDiag.macd.macdHistDelta5d, changePercent: momentumDiag.shortMomentum.changePercent, return5d: momentumDiag.shortMomentum.return5d, return20d: momentumDiag.shortMomentum.return20d, acceleration5dVs20d: momentumDiag.shortMomentum.acceleration5dVs20d },
      rsi: momentumDiag.rsi,
      macd: momentumDiag.macd,
      shortMomentum: momentumDiag.shortMomentum,
      overheat: momentumDiag.overheat,
      providerIssue: false,
      calculationIssue: momentumDiag.calculationIssue,
      marketSignal: false,
      executionImpact: 'DIAGNOSTIC_ONLY',
      missingFields: momentumDiag.missingFields,
      notes: momentumDiag.notes,
    },
  };
}
