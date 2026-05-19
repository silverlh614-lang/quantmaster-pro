// @responsibility Gate3 timing wiring/coverage diagnostics (diagnostic-only; no scoring impact).
import type { GateLayerName, ServerGateResult } from '../quantFilter.js';

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
    providerIssue: boolean;
    calculationIssue: boolean;
    marketSignal: false;
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
    provider: 'KIS_MINUTE_CHART' | 'KIS_REALTIME' | 'QMP_CACHE' | 'UNKNOWN';
    status: Gate3CoverageStatus;
    fields: Record<string, boolean>;
    providerIssue: boolean;
    marketSignal: false;
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
}

const TECH = /(rsi|macd|bb|bollinger|atr|ma\d*|ichimoku)/i;
const INTRA = /(intraday|minute|realtime|volumeClock|lastTick)/i;
const VOL = /(volume|avgVolume|volumeRatio|dry|tradingValue)/i;
const PRICE = /(high\d+d|low\d+d|breakout|pullback|range|currentPrice|price$)/i;

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const asFinite = (value: unknown): Numeric => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const hasFinite = (source: Record<string, unknown>, key: string): boolean => asFinite(source[key]) != null;

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
      const missingRequiredData = requiredData.filter(key => item.context?.availableData?.[key] !== true);

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
        requiredData,
        missingRequiredData,
        dataPath,
        providerIssue: status === 'PROVIDER_DEGRADED' || missingRequiredData.length > 0,
        calculationIssue: missingInputs.some(i => TECH.test(i) || VOL.test(i)),
        marketSignal: false,
        diagnosticOnly: true,
      };
    });
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
    ? {
      available: false,
      status: 'MISSING',
      bbWidth,
      bbWidthPercentile,
      atr14,
      atrContraction,
      rangeContraction,
      contractionCount,
      reason: 'INPUT_MISSING',
    }
    : {
      available: true,
      status: (bbWidth as number) <= 10 && (atr14 as number) > 0 ? 'PASS' : 'FAIL',
      bbWidth,
      bbWidthPercentile,
      atr14,
      atrContraction,
      rangeContraction,
      contractionCount,
      reason: null,
    };

  const breakoutVolume: Gate3VolumeTimingDiagnostic['breakoutVolume'] = volumeRatio == null || tradingValueRatio == null
    ? { available: false, status: 'MISSING', volumeRatio, tradingValueRatio, reason: 'INPUT_MISSING' }
    : {
      available: true,
      status: volumeRatio >= 2 || tradingValueRatio >= 2 ? 'PASS' : 'FAIL',
      volumeRatio,
      tradingValueRatio,
      reason: null,
    };

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

  return {
    status,
    volume,
    avgVolume,
    avgVolume20d,
    volumeRatio,
    tradingValue,
    avgTradingValue20d,
    tradingValueRatio,
    dryUp,
    vcp,
    breakoutVolume,
    dataGranularity,
    source: 'UNKNOWN',
    providerIssue: false,
    calculationIssue: status === 'CALCULATION_MISSING',
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    missingFields: unique(missingFields),
    notes: unique(notes),
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
  const priceFields = {
    high5d: hasFinite(quote, 'high5d'),
    high20d: hasFinite(quote, 'high20d'),
    high60d: hasFinite(quote, 'high60d'),
    low20d: hasFinite(quote, 'low20d'),
    low60d: hasFinite(quote, 'low60d'),
    currentPrice: hasFinite(quote, 'currentPrice') || hasFinite(quote, 'price'),
  };
  const volumeFields = {
    volume: hasFinite(quote, 'volume'),
    avgVolume: hasFinite(quote, 'avgVolume'),
    avgVolume20d: hasFinite(quote, 'avgVolume20d'),
    volumeRatio: hasFinite(quote, 'volumeRatio'),
    tradingValue: hasFinite(quote, 'tradingValue'),
  };
  const intradayFields = {
    intradayVolume: hasFinite(quote, 'intradayVolume'),
    intradayVolumeRatio: hasFinite(quote, 'intradayVolumeRatio'),
    volumeClock: quote.volumeClock != null,
    lastTickAt: quote.lastTickAt != null,
  };

  const technicalState = resolveStatus(technicalFields, true);
  const priceState = resolveStatus(priceFields, true);
  const volumeState = resolveStatus(volumeFields, true);
  const intradayState = resolveStatus(intradayFields, false);

  const volumeTiming = normalizeGate3VolumeTiming({ quote });
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

  return {
    technicalIndicators: {
      required: true,
      available: technicalState.available,
      provider: 'UNKNOWN',
      status: technicalState.status,
      fields: technicalFields,
      providerIssue: false,
      calculationIssue: technicalState.status === 'CALCULATION_MISSING' || technicalState.status === 'MISSING',
      marketSignal: false,
    },
    priceStructure: {
      required: true,
      available: priceState.available,
      provider: 'UNKNOWN',
      status: priceState.status,
      fields: priceFields,
      providerIssue: false,
      calculationIssue: priceState.status === 'CALCULATION_MISSING' || priceState.status === 'MISSING',
      marketSignal: false,
    },
    volumeStructure: {
      required: true,
      available: volumeState.available,
      provider: 'UNKNOWN',
      status: volumeState.status,
      fields: volumeFields,
      providerIssue: false,
      calculationIssue: volumeState.status === 'CALCULATION_MISSING' || volumeState.status === 'MISSING',
      marketSignal: false,
    },
    intradayTiming: {
      required: false,
      available: intradayState.available,
      provider: 'UNKNOWN',
      status: intradayState.status,
      fields: intradayFields,
      providerIssue: false,
      marketSignal: false,
    },
    volumeTiming: {
      required: true,
      available: volumeTiming.status === 'VERIFIED' || volumeTiming.status === 'PARTIAL',
      status: volumeTiming.status,
      fields: volumeTimingFields,
      values: {
        volume: volumeTiming.volume,
        avgVolume: volumeTiming.avgVolume,
        avgVolume20d: volumeTiming.avgVolume20d,
        volumeRatio: volumeTiming.volumeRatio,
        tradingValue: volumeTiming.tradingValue,
        avgTradingValue20d: volumeTiming.avgTradingValue20d,
        tradingValueRatio: volumeTiming.tradingValueRatio,
        dryUpRatio: volumeTiming.dryUp.dryUpRatio,
        bbWidth: volumeTiming.vcp.bbWidth,
        atr14: volumeTiming.vcp.atr14,
        contractionCount: volumeTiming.vcp.contractionCount,
      },
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
  };
}
