// @responsibility ADR-0490 program trading data line; OBSERVE/SHADOW_ONLY diagnostics, no live execution.
import type { OperatorActionSource } from './operatorActionRouterAdr0480.js';
import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';

export type ProgramTradingProviderAdr0490 = 'KIS' | 'KRX' | 'CACHE' | 'INTERNAL_REPLAY' | 'UNKNOWN';
export type ProgramTradingScopeAdr0490 = 'STOCK' | 'MARKET' | 'SECTOR' | 'UNKNOWN';
export type ProgramTradingDataLineStatusAdr0490 =
  | 'NOT_STARTED'
  | 'PROBE_SKIPPED'
  | 'FETCH_OK'
  | 'NORMALIZED'
  | 'PARTIAL'
  | 'EMPTY'
  | 'STALE'
  | 'DATA_UNAVAILABLE'
  | 'ACCEPTED_EMPTY'
  | 'PROVIDER_MISMATCH'
  | 'PROVIDER_ERROR'
  | 'PARSE_ERROR'
  | 'NON_TRADING_DAY'
  | 'RATE_LIMITED'
  | 'UNKNOWN';
export type ProgramTradingSignalAdr0490 = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
export type ProgramTradingStageAdr0490 = 'OBSERVE' | 'SHADOW_ONLY';

type MarketAdr0490 = 'KOSPI' | 'KOSDAQ' | 'ALL' | 'UNKNOWN';
type RawUnitAdr0490 = 'KRW' | 'THOUSAND_KRW' | 'MILLION_KRW' | 'SHARES' | 'UNKNOWN';

export interface ProgramTradingRawInputAdr0490 {
  code?: string | null;
  market?: MarketAdr0490;
  provider: ProgramTradingProviderAdr0490;
  scope: ProgramTradingScopeAdr0490;
  sourceDate: string | null;
  collectedAt?: string | null;
  rawProgramNetBuy?: number | string | null;
  rawProgramBuyAmount?: number | string | null;
  rawProgramSellAmount?: number | string | null;
  rawArbitrageNetBuy?: number | string | null;
  rawNonArbitrageNetBuy?: number | string | null;
  unit?: RawUnitAdr0490;
  providerStatus?: string | null;
  sourceAgeTradingDays?: number | null;
  diagnostics?: string[];
}

export interface ProgramTradingSampleAdr0490 {
  code: string | null;
  market: MarketAdr0490;
  provider: ProgramTradingProviderAdr0490;
  scope: ProgramTradingScopeAdr0490;
  sourceDate: string | null;
  collectedAt: string;
  programNetBuy: number | null;
  programBuyAmount: number | null;
  programSellAmount: number | null;
  arbitrageNetBuy: number | null;
  nonArbitrageNetBuy: number | null;
  unit: 'KRW' | 'SHARES' | 'UNKNOWN';
  status: ProgramTradingDataLineStatusAdr0490;
  signal: ProgramTradingSignalAdr0490;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  freshness: { sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN'; sourceAgeTradingDays: number | null };
  coverage: {
    programNetBuyAvailable: boolean;
    buySellAvailable: boolean;
    arbitrageAvailable: boolean;
    nonArbitrageAvailable: boolean;
    fieldsAvailable: number;
    fieldsTotal: number;
  };
  quality: {
    parseOk: boolean;
    unitNormalized: boolean;
    hasMinimumFields: boolean;
    isProviderIssue: boolean;
    isMarketSignal: boolean;
  };
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: ProgramTradingStageAdr0490;
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface ProgramTradingDataLineReportAdr0490 {
  generatedAt: string;
  code: string | null;
  stage: ProgramTradingStageAdr0490;
  samples: ProgramTradingSampleAdr0490[];
  selectedStockSample: ProgramTradingSampleAdr0490 | null;
  selectedMarketSample: ProgramTradingSampleAdr0490 | null;
  providerAttempts: {
    provider: ProgramTradingProviderAdr0490;
    scope: ProgramTradingScopeAdr0490;
    attempted: boolean;
    status: ProgramTradingDataLineStatusAdr0490;
    diagnostics: string[];
  }[];
  overallStatus: ProgramTradingDataLineStatusAdr0490;
  sampleAcquired: boolean;
  coverageRatio: number;
  topGaps: string[];
  recommendedNextActions: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: ProgramTradingStageAdr0490;
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildProgramTradingDataLineReportInputAdr0490 {
  generatedAt?: string;
  code?: string | null;
  stage?: ProgramTradingStageAdr0490;
  rawInputs?: readonly ProgramTradingRawInputAdr0490[];
  providerAttempts?: readonly ProgramTradingDataLineReportAdr0490['providerAttempts'][number][];
  throwForTest?: boolean;
}

const POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  operatorApprovalRequired: true as const,
};
const STALE_THRESHOLD_TRADING_DAYS_ADR0490 = 1;
const NET_BUY_SIGNAL_THRESHOLD_ADR0490 = 0;
const PROVIDER_ISSUE_STATUSES = new Set<ProgramTradingDataLineStatusAdr0490>([
  'DATA_UNAVAILABLE', 'PROVIDER_MISMATCH', 'PROVIDER_ERROR', 'PARSE_ERROR', 'NON_TRADING_DAY', 'RATE_LIMITED', 'UNKNOWN', 'NOT_STARTED', 'PROBE_SKIPPED',
]);

function parseNumeric(value: number | string | null | undefined): { value: number | null; ok: boolean; provided: boolean } {
  if (value === null || value === undefined || value === '') return { value: null, ok: true, provided: false };
  if (typeof value === 'number') return Number.isFinite(value) ? { value, ok: true, provided: true } : { value: null, ok: false, provided: true };
  const normalized = value.replace(/[,_\s]/g, '');
  if (normalized === '') return { value: null, ok: true, provided: false };
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? { value: parsed, ok: true, provided: true } : { value: null, ok: false, provided: true };
}

function normalizeUnit(value: number | null, unit: RawUnitAdr0490): { value: number | null; unit: 'KRW' | 'SHARES' | 'UNKNOWN'; normalized: boolean } {
  if (value === null) return { value: null, unit: unit === 'SHARES' ? 'SHARES' : unit === 'UNKNOWN' ? 'UNKNOWN' : 'KRW', normalized: unit !== 'UNKNOWN' };
  if (unit === 'THOUSAND_KRW') return { value: value * 1_000, unit: 'KRW', normalized: true };
  if (unit === 'MILLION_KRW') return { value: value * 1_000_000, unit: 'KRW', normalized: true };
  if (unit === 'SHARES') return { value, unit: 'SHARES', normalized: true };
  if (unit === 'KRW') return { value, unit: 'KRW', normalized: true };
  return { value, unit: 'UNKNOWN', normalized: false };
}

function statusFromProviderStatus(status: string): ProgramTradingDataLineStatusAdr0490 | null {
  const upper = status.toUpperCase();
  if (upper.includes('RATE_LIMIT')) return 'RATE_LIMITED';
  if (upper.includes('NON_TRADING')) return 'NON_TRADING_DAY';
  if (upper.includes('MISMATCH')) return 'PROVIDER_MISMATCH';
  if (upper.includes('PROVIDER_ERROR') || upper === 'ERROR') return 'PROVIDER_ERROR';
  if (upper.includes('ACCEPTED_EMPTY')) return 'ACCEPTED_EMPTY';
  if (upper.includes('DATA_UNAVAILABLE')) return 'DATA_UNAVAILABLE';
  if (upper.includes('EMPTY')) return 'EMPTY';
  if (upper.includes('STALE')) return 'STALE';
  if (upper.includes('FETCH_OK')) return 'FETCH_OK';
  return null;
}

function freshness(sourceDate: string | null, age: number | null | undefined): ProgramTradingSampleAdr0490['freshness'] {
  if (!sourceDate) return { sourceState: 'MISSING', sourceAgeTradingDays: age ?? null };
  if (typeof age === 'number' && Number.isFinite(age) && age > STALE_THRESHOLD_TRADING_DAYS_ADR0490) return { sourceState: 'STALE', sourceAgeTradingDays: age };
  return { sourceState: 'FRESH', sourceAgeTradingDays: age ?? 0 };
}

function signalFor(status: ProgramTradingDataLineStatusAdr0490, confidence: ProgramTradingSampleAdr0490['confidence'], net: number | null): ProgramTradingSignalAdr0490 {
  if (!['NORMALIZED', 'PARTIAL'].includes(status)) return 'UNKNOWN';
  if (!['HIGH', 'MEDIUM'].includes(confidence) || net === null) return 'UNKNOWN';
  if (net > NET_BUY_SIGNAL_THRESHOLD_ADR0490) return 'BULLISH';
  if (net < -NET_BUY_SIGNAL_THRESHOLD_ADR0490) return 'BEARISH';
  return 'NEUTRAL';
}

function statusRank(status: ProgramTradingDataLineStatusAdr0490): number {
  const ranks: Record<ProgramTradingDataLineStatusAdr0490, number> = {
    NORMALIZED: 100, FETCH_OK: 90, PARTIAL: 80, ACCEPTED_EMPTY: 60, EMPTY: 50, STALE: 45, DATA_UNAVAILABLE: 30,
    PROVIDER_MISMATCH: 25, PROVIDER_ERROR: 20, PARSE_ERROR: 20, NON_TRADING_DAY: 15, RATE_LIMITED: 15,
    PROBE_SKIPPED: 10, NOT_STARTED: 5, UNKNOWN: 0,
  };
  return ranks[status];
}

function isUsable(sample: ProgramTradingSampleAdr0490): boolean {
  return sample.status === 'NORMALIZED' || (sample.status === 'PARTIAL' && sample.quality.hasMinimumFields && sample.programNetBuy !== null && !sample.quality.isProviderIssue);
}

export function normalizeProgramTradingSampleAdr0490(input: ProgramTradingRawInputAdr0490): ProgramTradingSampleAdr0490 {
  const unit = input.unit ?? 'UNKNOWN';
  const rawValues = [input.rawProgramNetBuy, input.rawProgramBuyAmount, input.rawProgramSellAmount, input.rawArbitrageNetBuy, input.rawNonArbitrageNetBuy].map(parseNumeric);
  const parseOk = rawValues.every((item) => item.ok);
  const [netRaw, buyRaw, sellRaw, arbRaw, nonArbRaw] = rawValues.map((item) => item.value);
  const normalizedNet = normalizeUnit(netRaw, unit);
  const normalizedBuy = normalizeUnit(buyRaw, unit);
  const normalizedSell = normalizeUnit(sellRaw, unit);
  const normalizedArb = normalizeUnit(arbRaw, unit);
  const normalizedNonArb = normalizeUnit(nonArbRaw, unit);
  const programBuyAmount = normalizedBuy.value;
  const programSellAmount = normalizedSell.value;
  const derivedNet = programBuyAmount !== null && programSellAmount !== null ? programBuyAmount - programSellAmount : null;
  const programNetBuy = normalizedNet.value ?? derivedNet;
  const outputUnit = normalizedNet.unit === 'UNKNOWN' && (normalizedBuy.unit !== 'UNKNOWN' || normalizedSell.unit !== 'UNKNOWN') ? normalizedBuy.unit : normalizedNet.unit;
  const unitNormalized = [normalizedNet, normalizedBuy, normalizedSell, normalizedArb, normalizedNonArb].every((item, index) => !rawValues[index]?.provided || item.normalized);
  const fields = [programNetBuy, programBuyAmount, programSellAmount, normalizedArb.value, normalizedNonArb.value];
  const fieldsAvailable = fields.filter((value) => value !== null).length;
  const buySellAvailable = programBuyAmount !== null && programSellAmount !== null;
  const hasMinimumFields = programNetBuy !== null || buySellAvailable;
  const sourceFreshness = freshness(input.sourceDate, input.sourceAgeTradingDays);
  const providerStatus = statusFromProviderStatus(input.providerStatus ?? '');
  let status: ProgramTradingDataLineStatusAdr0490;
  if (providerStatus && ['ACCEPTED_EMPTY', 'DATA_UNAVAILABLE', 'PROVIDER_MISMATCH', 'PROVIDER_ERROR', 'NON_TRADING_DAY', 'RATE_LIMITED'].includes(providerStatus)) status = providerStatus;
  else if (!parseOk) status = 'PARSE_ERROR';
  else if (fieldsAvailable === 0) status = providerStatus === 'FETCH_OK' ? 'ACCEPTED_EMPTY' : 'EMPTY';
  else if (sourceFreshness.sourceState === 'STALE') status = 'STALE';
  else if (hasMinimumFields && unitNormalized && sourceFreshness.sourceState === 'FRESH') status = 'NORMALIZED';
  else if (hasMinimumFields || fieldsAvailable > 0) status = 'PARTIAL';
  else status = providerStatus ?? 'UNKNOWN';
  const providerIssue = PROVIDER_ISSUE_STATUSES.has(status);
  const confidence: ProgramTradingSampleAdr0490['confidence'] = providerIssue || status === 'EMPTY' || status === 'ACCEPTED_EMPTY'
    ? 'NONE'
    : status === 'STALE' || !unitNormalized
      ? 'LOW'
      : status === 'NORMALIZED'
        ? 'HIGH'
        : 'MEDIUM';
  const signal = signalFor(status, confidence, programNetBuy);
  return {
    code: input.code ?? null,
    market: input.market ?? 'UNKNOWN',
    provider: input.provider,
    scope: input.scope,
    sourceDate: input.sourceDate,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    programNetBuy,
    programBuyAmount,
    programSellAmount,
    arbitrageNetBuy: normalizedArb.value,
    nonArbitrageNetBuy: normalizedNonArb.value,
    unit: outputUnit,
    status,
    signal,
    confidence,
    freshness: sourceFreshness,
    coverage: {
      programNetBuyAvailable: programNetBuy !== null,
      buySellAvailable,
      arbitrageAvailable: normalizedArb.value !== null,
      nonArbitrageAvailable: normalizedNonArb.value !== null,
      fieldsAvailable,
      fieldsTotal: 5,
    },
    quality: { parseOk, unitNormalized, hasMinimumFields, isProviderIssue: providerIssue, isMarketSignal: !providerIssue && signal !== 'UNKNOWN' },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: input.scope === 'STOCK' ? 'SHADOW_ONLY' : 'OBSERVE',
    operatorApprovalRequired: true,
    diagnostics: [
      ...(input.diagnostics ?? []),
      `providerStatus=${input.providerStatus ?? 'UNKNOWN'}`,
      'ADR-0490 sample is diagnostic-only; accepted empty/provider issue is not bearish.',
    ],
  };
}

function bestSample(samples: ProgramTradingSampleAdr0490[], scope: ProgramTradingScopeAdr0490): ProgramTradingSampleAdr0490 | null {
  const priority: Record<ProgramTradingProviderAdr0490, number> = { KIS: 5, KRX: 4, CACHE: 3, INTERNAL_REPLAY: 2, UNKNOWN: 0 };
  return [...samples]
    .filter((sample) => sample.scope === scope && isUsable(sample))
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || priority[b.provider] - priority[a.provider])[0] ?? null;
}

function overallStatus(samples: ProgramTradingSampleAdr0490[]): ProgramTradingDataLineStatusAdr0490 {
  if (samples.length === 0) return 'DATA_UNAVAILABLE';
  return [...samples].sort((a, b) => statusRank(b.status) - statusRank(a.status))[0]?.status ?? 'UNKNOWN';
}

function gaps(report: Pick<ProgramTradingDataLineReportAdr0490, 'samples' | 'selectedStockSample' | 'selectedMarketSample'>): string[] {
  const out: string[] = [];
  if (!report.selectedStockSample) out.push('PROGRAM_TRADING_SAMPLE_ACQUISITION_NEEDED');
  if (report.samples.some((sample) => sample.status === 'ACCEPTED_EMPTY')) out.push('PROGRAM_TRADING_ACCEPTED_EMPTY_OBSERVATION');
  if (report.samples.some((sample) => sample.status === 'PROVIDER_MISMATCH')) out.push('PROGRAM_TRADING_PROVIDER_CAPABILITY_MISMATCH');
  if (report.samples.some((sample) => sample.status === 'STALE')) out.push('PROGRAM_TRADING_CACHE_STALE');
  return Array.from(new Set(out)).slice(0, 5);
}

function actionForGap(gap: string): string {
  const map: Record<string, string> = {
    PROGRAM_TRADING_SAMPLE_ACQUISITION_NEEDED: 'verify KIS/KRX program trading source or previous-day cache key',
    PROGRAM_TRADING_ACCEPTED_EMPTY_OBSERVATION: 'confirm session/date behavior and previous trading day fallback',
    PROGRAM_TRADING_PROVIDER_CAPABILITY_MISMATCH: 'verify provider scope capability before probing again',
    PROGRAM_TRADING_CACHE_STALE: 'refresh previous trading-day program trading cache',
  };
  return map[gap] ?? 'continue OBSERVE diagnostics';
}

export function buildProgramTradingDataLineReportAdr0490(input: BuildProgramTradingDataLineReportInputAdr0490 = {}): ProgramTradingDataLineReportAdr0490 {
  try {
    if (input.throwForTest) throw new Error('ADR-0490 test failure');
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const samples = (input.rawInputs ?? []).map((raw) => normalizeProgramTradingSampleAdr0490({ ...raw, collectedAt: raw.collectedAt ?? generatedAt }));
    const selectedStockSample = bestSample(samples, 'STOCK');
    const selectedMarketSample = bestSample(samples, 'MARKET');
    const sampleAcquired = Boolean(selectedStockSample || selectedMarketSample);
    const status = overallStatus(samples);
    const providerAttempts = input.providerAttempts ? [...input.providerAttempts] : samples.map((sample) => ({ provider: sample.provider, scope: sample.scope, attempted: true, status: sample.status, diagnostics: sample.diagnostics }));
    const partial = { samples, selectedStockSample, selectedMarketSample };
    const topGaps = gaps(partial);
    return {
      generatedAt,
      code: input.code ?? selectedStockSample?.code ?? null,
      stage: input.stage ?? 'SHADOW_ONLY',
      samples,
      selectedStockSample,
      selectedMarketSample,
      providerAttempts,
      overallStatus: status,
      sampleAcquired,
      coverageRatio: samples.length > 0 ? Math.round((samples.filter(isUsable).length / samples.length) * 1000) / 1000 : 0,
      topGaps,
      recommendedNextActions: topGaps.map(actionForGap),
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: input.stage ?? 'SHADOW_ONLY',
      operatorApprovalRequired: true,
      diagnostics: [
        'ADR-0490 creates an OBSERVE/SHADOW_ONLY program trading data line only.',
        'Program trading data is not a live Gate input and does not promote supply readiness by itself.',
        'Provider issues, stale data, accepted empty, and UNKNOWN are not bearish.',
      ],
    };
  } catch (error) {
    return {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      code: input.code ?? null,
      stage: input.stage ?? 'OBSERVE',
      samples: [],
      selectedStockSample: null,
      selectedMarketSample: null,
      providerAttempts: input.providerAttempts ? [...input.providerAttempts] : [],
      overallStatus: 'PROVIDER_ERROR',
      sampleAcquired: false,
      coverageRatio: 0,
      topGaps: ['PROGRAM_TRADING_SAMPLE_ACQUISITION_NEEDED'],
      recommendedNextActions: ['verify KIS/KRX program trading source or previous-day cache key'],
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: input.stage ?? 'OBSERVE',
      operatorApprovalRequired: true,
      diagnostics: ['ADR-0490 provider/probe failure isolated.', error instanceof Error ? error.message : String(error)],
    };
  }
}

export const safeBuildProgramTradingDataLineReportAdr0490 = buildProgramTradingDataLineReportAdr0490;

export function collectOperatorActionSourcesFromProgramTradingAdr0490(report: ProgramTradingDataLineReportAdr0490 | null | undefined): OperatorActionSource[] {
  if (!report) return [];
  if (report.sampleAcquired && report.topGaps.length === 0) {
    return [{ adr: '0490', sectionId: 'program_trading_data_line', code: 'PROGRAM_TRADING_SAMPLE_OBSERVING', diagnosticKey: 'PROGRAM_TRADING_SAMPLE_OBSERVING', diagnosticValue: `status=${report.overallStatus}`, severity: 'INFO' }];
  }
  return report.topGaps.map((gap) => ({ adr: '0490', sectionId: 'program_trading_data_line', code: gap, diagnosticKey: gap, diagnosticValue: `status=${report.overallStatus}`, severity: gap.includes('MISMATCH') ? 'DATA_UNAVAILABLE' : 'DEGRADED' }));
}

export function buildProgramTradingObservationRowAdr0490(report: ProgramTradingDataLineReportAdr0490): Partial<Gate1DryRunObservationRow> & Record<string, unknown> {
  const stock = report.selectedStockSample;
  const market = report.selectedMarketSample;
  const selected = stock ?? market;
  return {
    id: `adr0490-${report.generatedAt}-${report.code ?? 'ALL'}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180),
    createdAt: report.generatedAt,
    forDate: report.generatedAt.slice(0, 10),
    source: 'ADR_0490_PROGRAM_TRADING_DATA_LINE' as Gate1DryRunObservationRow['source'],
    symbol: report.code ?? selected?.code ?? 'PROGRAM_TRADING',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY',
    dryRunScenario: 'PROGRAM_TRADING_DATA_LINE_ADR0490',
    requiredScore: 70,
    providerIssue: !report.sampleAcquired,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    observationType: 'PROGRAM_TRADING_DATA_LINE_ADR0490' as Gate1DryRunObservationRow['observationType'],
    code: report.code,
    market: selected?.market ?? 'UNKNOWN',
    selectedStockProvider: stock?.provider ?? 'NONE',
    selectedMarketProvider: market?.provider ?? 'NONE',
    overallStatus: report.overallStatus,
    sampleAcquired: report.sampleAcquired,
    stockSampleStatus: stock?.status ?? 'NONE',
    marketSampleStatus: market?.status ?? 'NONE',
    programNetBuy: selected?.programNetBuy ?? null,
    unit: selected?.unit ?? 'UNKNOWN',
    routeSignal: selected?.signal ?? 'UNKNOWN',
    signal: selected?.signal ?? 'UNKNOWN',
    confidence: selected?.confidence ?? 'NONE',
    sourceDate: selected?.sourceDate ?? null,
    sourceAgeTradingDays: selected?.freshness.sourceAgeTradingDays ?? null,
    providerAttempts: report.providerAttempts,
    topGaps: report.topGaps,
    recommendedNextActions: report.recommendedNextActions,
    status: 'OBSERVING',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: report.policyPromotionMode,
  };
}

export function formatProgramTradingCompactAdr0490(report: ProgramTradingDataLineReportAdr0490 | null | undefined): string | null {
  if (!report) return null;
  const stock = report.selectedStockSample?.provider ?? 'NONE';
  const market = report.selectedMarketSample?.provider ?? report.samples.find((sample) => sample.scope === 'MARKET')?.status ?? 'NONE';
  if (report.overallStatus === 'NON_TRADING_DAY') return `📊 ADR-0490 ProgramTrading: NON_TRADING_DAY | impact=${report.executionImpact}\n   action: recheck during trading session`;
  const signal = report.sampleAcquired ? ` | signal=${report.selectedStockSample?.signal ?? report.selectedMarketSample?.signal ?? 'UNKNOWN'}` : '';
  const line = `📊 ADR-0490 ProgramTrading: ${report.overallStatus} | stock=${stock} | market=${market}${signal} | impact=${report.executionImpact}`;
  const action = report.recommendedNextActions[0];
  return action ? `${line}\n   action: ${action}` : line;
}

export function formatProgramTradingDetailAdr0490(report: ProgramTradingDataLineReportAdr0490): string {
  return [
    '📊 ADR-0490 KRX/KIS Program Trading Data Line',
    `status=${report.overallStatus} sampleAcquired=${report.sampleAcquired} coverage=${report.coverageRatio} executionImpact=${report.executionImpact} liveExecutionAllowed=${report.liveExecutionAllowed} policyPromotionMode=${report.policyPromotionMode}`,
    `selectedStock=${report.selectedStockSample ? `${report.selectedStockSample.provider}/${report.selectedStockSample.status}/${report.selectedStockSample.signal}` : 'NONE'}`,
    `selectedMarket=${report.selectedMarketSample ? `${report.selectedMarketSample.provider}/${report.selectedMarketSample.status}/${report.selectedMarketSample.signal}` : 'NONE'}`,
    'providerAttempts:',
    ...report.providerAttempts.map((attempt) => `- ${attempt.provider}/${attempt.scope}: attempted=${attempt.attempted} status=${attempt.status} diagnostics=${attempt.diagnostics.join(',') || 'none'}`),
    'samples:',
    ...report.samples.map((sample) => `- ${sample.provider}/${sample.scope}/${sample.code ?? sample.market}: status=${sample.status} net=${sample.programNetBuy ?? 'null'} unit=${sample.unit} confidence=${sample.confidence} signal=${sample.signal} freshness=${sample.freshness.sourceState}/${sample.freshness.sourceAgeTradingDays ?? 'NA'} coverage=${sample.coverage.fieldsAvailable}/${sample.coverage.fieldsTotal}`),
    `topGaps=${report.topGaps.join(',') || 'none'}`,
    `recommendedNextActions=${report.recommendedNextActions.join(' | ') || 'continue observation'}`,
    'guardrails: OBSERVE/SHADOW_ONLY only; no live Gate/Kelly/KIS order changes; UNKNOWN remains UNKNOWN; ACCEPTED_EMPTY/provider issues are not bearish; promotion requires future ADR/operator approval.',
  ].join('\n');
}

export interface ProgramTradingDetailRegistryEntryAdr0490 {
  adr: '0490';
  sectionId: 'program_trading_data_line';
  commandHint: '/supply_health_detail';
  scanBlockersDetailHint: '/scan_blockers_detail program_trading_data_line';
  adrTraceHint: '/adr_trace 0490';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  render: () => string;
}

export function getProgramTradingDetailRegistryEntryAdr0490(report: ProgramTradingDataLineReportAdr0490): ProgramTradingDetailRegistryEntryAdr0490 {
  return { adr: '0490', sectionId: 'program_trading_data_line', commandHint: '/supply_health_detail', scanBlockersDetailHint: '/scan_blockers_detail program_trading_data_line', adrTraceHint: '/adr_trace 0490', executionImpact: 'NONE', liveExecutionAllowed: false, render: () => formatProgramTradingDetailAdr0490(report) };
}

export function formatRuntimePipelineProgramTradingEvidenceLineAdr0490(report: ProgramTradingDataLineReportAdr0490 | null | undefined): string {
  if (!report) return 'ADR-0490 status=missing diagnosticOnly=true executionImpact=NONE';
  return `ADR-0490 status=${report.overallStatus} stock=${report.selectedStockSample?.provider ?? 'NONE'} market=${report.selectedMarketSample?.provider ?? report.samples.find((sample) => sample.scope === 'MARKET')?.status ?? 'NONE'} diagnosticOnly=true executionImpact=${report.executionImpact}`;
}
