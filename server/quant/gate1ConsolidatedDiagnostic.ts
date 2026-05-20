// @responsibility Gate1 consolidated diagnostic renderer; diagnostic output only.

import type { GateLayerSummary } from '../quantFilter.js';

export type Gate1ConsolidatedHealth =
  | 'OK'
  | 'WARN'
  | 'DEGRADED'
  | 'BLOCKED_LIVE_ONLY'
  | 'UNKNOWN';

export type Gate1OperatorAction =
  | 'NONE'
  | 'CHECK_QUOTE_PROVIDER'
  | 'CHECK_STOCK_MASTER'
  | 'CHECK_LIQUIDITY'
  | 'CHECK_SESSION_POLICY'
  | 'CHECK_SHADOW_KERNEL'
  | 'REVIEW_GATE1_INPUTS';

export type Gate1ConsolidatedExecutionImpact =
  | 'NONE'
  | 'DIAGNOSTIC_ONLY'
  | 'LIVE_BUY_BLOCKED_ONLY';

export interface Gate1ConsolidatedDiagnosticSections {
  wiring: string[];
  quote: string[];
  tradability: string[];
  liquidity: string[];
  session: string[];
  shadow: string[];
}

export interface Gate1ConsolidatedDiagnostic {
  health: Gate1ConsolidatedHealth;
  summary: string;
  primaryIssue: string | null;
  operatorAction: Gate1OperatorAction;
  liveBuyAllowed: boolean | null;
  shadowAllowed: boolean | null;
  caseRecordingAllowed: boolean | null;
  marketSignal: false;
  providerIssue: boolean;
  executionImpact: Gate1ConsolidatedExecutionImpact;
  sections: Gate1ConsolidatedDiagnosticSections;
  compactText: string;
  telegramText: string;
}

type Gate1Bucket = GateLayerSummary['gate1'];

const EMPTY_SECTIONS: Gate1ConsolidatedDiagnosticSections = {
  wiring: [],
  quote: [],
  tradability: [],
  liquidity: [],
  session: [],
  shadow: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function boolText(value: boolean | null): string {
  if (value == null) return 'unknown';
  return value ? 'true' : 'false';
}

function onOff(value: boolean | null): string {
  if (value == null) return 'UNKNOWN';
  return value ? 'ON' : 'OFF';
}

function compactList(values: string[], fallback = 'none'): string {
  if (values.length === 0) return fallback;
  if (values.length <= 4) return values.join(',');
  return `${values.slice(0, 4).join(',')}+${values.length - 4}`;
}

function formatKrw(value: unknown): string {
  const n = numberOrNull(value);
  if (n == null) return 'unknown';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B KRW`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M KRW`;
  return `${Math.round(n).toLocaleString('en-US')} KRW`;
}

function hasQuoteProviderDegradation(quoteCoverage: Record<string, unknown>, quoteFreshness: Record<string, unknown>): boolean {
  const confidence = stringOrNull(quoteCoverage.confidence);
  const freshness = stringOrNull(quoteFreshness.status);
  return confidence === 'MISSING'
    || confidence === 'DEGRADED'
    || freshness === 'MISSING'
    || freshness === 'STALE';
}

function isTradabilityBlocked(status: string | null): boolean {
  return status === 'HALTED'
    || status === 'SUSPENDED'
    || status === 'DELISTING'
    || status === 'LIQUIDATION';
}

function isTradabilityAdvisory(status: string | null): boolean {
  return status === 'MANAGEMENT'
    || status === 'WARNING'
    || status === 'DANGER';
}

function isLiquidityWeak(status: string | null): boolean {
  return status === 'THIN'
    || status === 'SPIKE_ONLY'
    || status === 'FAIL';
}

function buildSections(gate1: Gate1Bucket): Gate1ConsolidatedDiagnosticSections {
  const sourceCoverage = asRecord(gate1.sourceCoverage);
  const survival = asRecord(gate1.survival);
  const quoteFreshness = asRecord(survival.quoteFreshness);
  const quoteCoverage = asRecord(survival.kisOfficialQuoteCoverage);
  const tradability = asRecord(survival.tradability);
  const liquidity = asRecord(survival.liquidityFloor);
  const session = asRecord(survival.marketSessionCompatibility);
  const shadow = asRecord(survival.shadowEligibility);
  const checks = asRecord(liquidity.checks);

  const missingInputs = stringList(sourceCoverage.missingInputs);
  const missingExternalData = stringList(sourceCoverage.missingExternalData);
  const missingQuoteFields = stringList(quoteCoverage.missingFields);
  const presentQuoteFields = stringList(quoteCoverage.presentFields);
  const shadowBlockers = stringList(shadow.blockers);
  const shadowDegradedReasons = stringList(shadow.degradedReasons);

  return {
    wiring: [
      `inputs=${sourceCoverage.allDeclaredInputsAvailable === true ? 'OK' : 'MISSING'}`,
      `conditionCount=${numberOrNull(sourceCoverage.conditionCount) ?? 0}`,
      `quoteInputCount=${numberOrNull(sourceCoverage.quoteInputCount) ?? 0}`,
      `missingInputs=${compactList(missingInputs)}`,
      `missingExternalData=${compactList(missingExternalData)}`,
    ],
    quote: [
      `coverage=${stringOrNull(quoteCoverage.source) ?? 'UNKNOWN'} ${stringOrNull(quoteCoverage.confidence) ?? 'UNKNOWN'}`,
      `providerStatus=${stringOrNull(quoteCoverage.providerStatus) ?? 'UNKNOWN'}`,
      `freshness=${stringOrNull(quoteFreshness.status) ?? 'UNKNOWN'}`,
      `missingFields=${compactList(missingQuoteFields)}`,
      `presentFields=${presentQuoteFields.length}`,
      `endpoint=${stringOrNull(quoteCoverage.endpoint) ?? 'UNKNOWN'}`,
      `trId=${stringOrNull(quoteCoverage.trId) ?? 'UNKNOWN'}`,
    ],
    tradability: [
      `status=${stringOrNull(tradability.status) ?? 'UNKNOWN'}`,
      `market=${stringOrNull(tradability.market) ?? 'UNKNOWN'}`,
      `stockType=${stringOrNull(tradability.stockType) ?? 'UNKNOWN'}`,
      `source=${stringOrNull(tradability.source) ?? 'UNKNOWN'}`,
      `sourceStatus=${stringOrNull(tradability.sourceStatus) ?? 'UNKNOWN'}`,
      `reason=${stringOrNull(tradability.reason) ?? 'none'}`,
      `marketSignal=false`,
    ],
    liquidity: [
      `status=${stringOrNull(liquidity.status) ?? 'UNKNOWN'}`,
      `volume=${numberOrNull(liquidity.volume)?.toLocaleString('en-US') ?? 'unknown'}`,
      `tradingValue=${formatKrw(liquidity.tradingValue)}`,
      `avgVolume20d=${numberOrNull(liquidity.avgVolume20d)?.toLocaleString('en-US') ?? 'unknown'}`,
      `avgTradingValue20d=${formatKrw(liquidity.avgTradingValue20d)}`,
      `checks=volume:${boolText(boolOrNull(checks.volumePass))},value:${boolText(boolOrNull(checks.tradingValuePass))},avgVol:${boolText(boolOrNull(checks.avgVolumePass))},avgValue:${boolText(boolOrNull(checks.avgTradingValuePass))}`,
      `marketSignal=false`,
    ],
    session: [
      `session=${stringOrNull(session.session) ?? 'UNKNOWN'}`,
      `engineMode=${stringOrNull(session.engineMode) ?? 'UNKNOWN'}`,
      `liveBuyAllowed=${boolText(boolOrNull(session.liveBuyAllowed))}`,
      `liveSellAllowed=${boolText(boolOrNull(session.liveSellAllowed))}`,
      `shadowAllowed=${boolText(boolOrNull(session.shadowAllowed))}`,
      `observeAllowed=${boolText(boolOrNull(session.observeAllowed))}`,
      `caseRecordingAllowed=${boolText(boolOrNull(session.caseRecordingAllowed))}`,
      `matchedWindow=${stringOrNull(asRecord(session.sellOnlyWindow).matchedWindow) ?? 'none'}`,
      `reason=${stringOrNull(session.reason) ?? 'none'}`,
      `marketSignal=false`,
      `executionImpact=${stringOrNull(session.executionImpact) ?? 'DIAGNOSTIC_ONLY'}`,
    ],
    shadow: [
      `mode=${stringOrNull(shadow.mode) ?? 'UNKNOWN'}`,
      `allowed=${boolText(boolOrNull(shadow.allowed))}`,
      `shadowScan=${boolText(boolOrNull(shadow.shadowScanAllowed))}`,
      `shadowSignal=${boolText(boolOrNull(shadow.shadowSignalAllowed))}`,
      `paperOrder=${boolText(boolOrNull(shadow.paperOrderAllowed))}`,
      `virtualFill=${boolText(boolOrNull(shadow.virtualFillAllowed))}`,
      `caseRecording=${boolText(boolOrNull(shadow.caseRecordingAllowed))}`,
      `blockers=${compactList(shadowBlockers)}`,
      `degradedReasons=${compactList(shadowDegradedReasons)}`,
      `shadowExecutionImpact=${stringOrNull(shadow.shadowExecutionImpact) ?? 'NONE'}`,
    ],
  };
}

function buildSummary(health: Gate1ConsolidatedHealth, primaryIssue: string | null): string {
  if (health === 'OK') return 'Gate1 diagnostics OK; inputs, quote, survival, and shadow lanes are available.';
  if (health === 'BLOCKED_LIVE_ONLY') return 'Gate1 live buy is diagnostically blocked while shadow lanes remain available.';
  if (primaryIssue) return `Gate1 diagnostic issue: ${primaryIssue}.`;
  if (health === 'WARN') return 'Gate1 diagnostics have advisory warnings; scoring and shadow learning are unchanged.';
  if (health === 'DEGRADED') return 'Gate1 diagnostics are degraded; check data wiring before interpreting failures.';
  return 'Gate1 consolidated diagnostic is incomplete.';
}

function buildCompactText(input: {
  health: Gate1ConsolidatedHealth;
  primaryIssue: string | null;
  operatorAction: Gate1OperatorAction;
  inputsOk: boolean | null;
  quoteConfidence: string;
  quoteMissingFields: string[];
  tradabilityStatus: string;
  liquidityStatus: string;
  sessionName: string;
  shadowMode: string;
  shadowAllowed: boolean | null;
}): string {
  const healthLabel = input.health === 'BLOCKED_LIVE_ONLY' ? 'LIVE_BLOCKED_ONLY' : input.health;
  if (input.health === 'DEGRADED' && input.primaryIssue === 'QUOTE_COVERAGE_DEGRADED') {
    return [
      `Gate1: ${healthLabel}`,
      `issue=${input.primaryIssue}`,
      `missing=${compactList(input.quoteMissingFields)}`,
      `shadow=${input.shadowMode}`,
      `action=${input.operatorAction}`,
    ].join(' | ');
  }
  return [
    `Gate1: ${healthLabel}`,
    `inputs=${input.inputsOk === true ? 'OK' : input.inputsOk === false ? 'MISSING' : 'UNKNOWN'}`,
    `quote=${input.quoteConfidence}`,
    `tradable=${input.tradabilityStatus}`,
    `liquidity=${input.liquidityStatus}`,
    `session=${input.sessionName}`,
    `shadow=${input.health === 'BLOCKED_LIVE_ONLY' && input.shadowAllowed ? 'ON' : input.shadowMode}`,
    ...(input.primaryIssue ? [`issue=${input.primaryIssue}`] : []),
    ...(input.operatorAction !== 'NONE' ? [`action=${input.operatorAction}`] : []),
  ].join(' | ');
}

function buildTelegramText(input: {
  health: Gate1ConsolidatedHealth;
  primaryIssue: string | null;
  operatorAction: Gate1OperatorAction;
  quoteSource: string;
  quoteConfidence: string;
  quoteMissingFields: string[];
  tradabilityStatus: string;
  market: string;
  stockType: string;
  liquidityStatus: string;
  tradingValue: unknown;
  sessionName: string;
  liveBuyAllowed: boolean | null;
  shadowMode: string;
  shadowScanAllowed: boolean | null;
  shadowSignalAllowed: boolean | null;
  paperOrderAllowed: boolean | null;
  caseRecordingAllowed: boolean | null;
  executionImpact: Gate1ConsolidatedExecutionImpact;
}): string {
  const lines = [
    'Gate1 Wiring',
    `Status: ${input.health}${input.shadowMode ? ` / shadow=${input.shadowMode}` : ''}`,
    `Issue: ${input.primaryIssue ?? 'none'} | action=${input.operatorAction}`,
    `Quote: ${input.quoteSource} ${input.quoteConfidence}${input.quoteMissingFields.length > 0 ? ` missing=${compactList(input.quoteMissingFields)}` : ''}`,
    `Tradability: ${input.tradabilityStatus} / ${input.market} / ${input.stockType}`,
    `Liquidity: ${input.liquidityStatus} / tradingValue=${formatKrw(input.tradingValue)}`,
    `Session: ${input.sessionName} | Live: buy=${boolText(input.liveBuyAllowed)} | Shadow: scan=${boolText(input.shadowScanAllowed)} signal=${boolText(input.shadowSignalAllowed)} paper=${boolText(input.paperOrderAllowed)} case=${onOff(input.caseRecordingAllowed)}`,
    `marketSignal=false | executionImpact=${input.executionImpact}`,
  ];
  return lines.slice(0, 8).join('\n');
}

function unknownDiagnostic(): Gate1ConsolidatedDiagnostic {
  return {
    health: 'UNKNOWN',
    summary: buildSummary('UNKNOWN', null),
    primaryIssue: null,
    operatorAction: 'REVIEW_GATE1_INPUTS',
    liveBuyAllowed: null,
    shadowAllowed: null,
    caseRecordingAllowed: null,
    marketSignal: false,
    providerIssue: true,
    executionImpact: 'DIAGNOSTIC_ONLY',
    sections: { ...EMPTY_SECTIONS },
    compactText: 'Gate1: UNKNOWN | inputs=UNKNOWN | quote=UNKNOWN | shadow=UNKNOWN | action=REVIEW_GATE1_INPUTS',
    telegramText: [
      'Gate1 Wiring',
      'Status: UNKNOWN',
      'Issue: diagnostic_missing | action=REVIEW_GATE1_INPUTS',
      'marketSignal=false | executionImpact=DIAGNOSTIC_ONLY',
    ].join('\n'),
  };
}

export function buildGate1ConsolidatedDiagnostic(input: {
  gate1: Gate1Bucket | null | undefined;
}): Gate1ConsolidatedDiagnostic {
  const gate1 = input.gate1;
  if (!gate1?.sourceCoverage || !gate1.survival) return unknownDiagnostic();

  const sourceCoverage = gate1.sourceCoverage;
  const survival = gate1.survival;
  const quoteFreshness = asRecord(survival.quoteFreshness);
  const quoteCoverage = asRecord(survival.kisOfficialQuoteCoverage);
  const tradability = asRecord(survival.tradability);
  const liquidity = asRecord(survival.liquidityFloor);
  const session = asRecord(survival.marketSessionCompatibility);
  const shadow = asRecord(survival.shadowEligibility);

  const inputsOk = sourceCoverage.allDeclaredInputsAvailable === true && sourceCoverage.allExternalDataAvailable === true;
  const quoteConfidence = stringOrNull(quoteCoverage.confidence) ?? 'UNKNOWN';
  const quoteSource = stringOrNull(quoteCoverage.source) ?? 'UNKNOWN';
  const quoteMissingFields = stringList(quoteCoverage.missingFields);
  const tradabilityStatus = stringOrNull(tradability.status) ?? 'UNKNOWN';
  const liquidityStatus = stringOrNull(liquidity.status) ?? 'UNKNOWN';
  const sessionName = stringOrNull(session.session) ?? 'UNKNOWN';
  const shadowMode = stringOrNull(shadow.mode) ?? 'UNKNOWN';
  const liveBuyAllowed = boolOrNull(session.liveBuyAllowed);
  const shadowAllowed = boolOrNull(shadow.allowed) ?? boolOrNull(session.shadowAllowed);
  const caseRecordingAllowed = boolOrNull(shadow.caseRecordingAllowed);
  const quoteProviderDegraded = hasQuoteProviderDegradation(quoteCoverage, quoteFreshness);
  const quoteDegradedWithoutMissingFields = quoteProviderDegraded
    && quoteMissingFields.length === 0
    && quoteConfidence !== 'MISSING';

  let health: Gate1ConsolidatedHealth = 'OK';
  let primaryIssue: string | null = null;
  let operatorAction: Gate1OperatorAction = 'NONE';

  if (shadowMode === 'DISABLED_UNEXPECTED') {
    health = 'DEGRADED';
    primaryIssue = 'SHADOW_DISABLED_UNEXPECTED';
    operatorAction = 'CHECK_SHADOW_KERNEL';
  } else if (liveBuyAllowed === false && shadowAllowed === true && quoteDegradedWithoutMissingFields) {
    health = 'BLOCKED_LIVE_ONLY';
    primaryIssue = 'LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED';
    operatorAction = 'CHECK_SESSION_POLICY';
  } else if (quoteProviderDegraded) {
    health = 'DEGRADED';
    primaryIssue = 'QUOTE_COVERAGE_DEGRADED';
    operatorAction = 'CHECK_QUOTE_PROVIDER';
  } else if (!inputsOk) {
    health = 'DEGRADED';
    primaryIssue = 'GATE1_INPUT_MISSING';
    operatorAction = 'REVIEW_GATE1_INPUTS';
  } else if (isTradabilityBlocked(tradabilityStatus)) {
    health = shadowAllowed === true ? 'BLOCKED_LIVE_ONLY' : 'DEGRADED';
    primaryIssue = 'TRADABILITY_BLOCKED';
    operatorAction = 'CHECK_STOCK_MASTER';
  } else if (liveBuyAllowed === false && shadowAllowed === true) {
    health = 'BLOCKED_LIVE_ONLY';
    primaryIssue = 'LIVE_BUY_BLOCKED_BUT_SHADOW_ALLOWED';
    operatorAction = 'CHECK_SESSION_POLICY';
  } else if (tradabilityStatus === 'UNKNOWN') {
    health = 'WARN';
    primaryIssue = 'TRADABILITY_UNKNOWN';
    operatorAction = 'CHECK_STOCK_MASTER';
  } else if (isTradabilityAdvisory(tradabilityStatus)) {
    health = 'WARN';
    primaryIssue = 'TRADABILITY_REVIEW_REQUIRED';
    operatorAction = 'CHECK_STOCK_MASTER';
  } else if (isLiquidityWeak(liquidityStatus)) {
    health = 'WARN';
    primaryIssue = 'LIQUIDITY_WEAK';
    operatorAction = 'CHECK_LIQUIDITY';
  }

  const executionImpact: Gate1ConsolidatedExecutionImpact = health === 'BLOCKED_LIVE_ONLY'
    ? 'LIVE_BUY_BLOCKED_ONLY'
    : health === 'OK'
      ? 'NONE'
      : 'DIAGNOSTIC_ONLY';

  const providerIssue = survival.quoteFreshness.providerIssue === true
    || survival.kisOfficialQuoteCoverage.providerIssue === true
    || survival.tradability.providerIssue === true
    || survival.liquidityFloor.providerIssue === true
    || survival.marketSessionCompatibility.providerIssue === true
    || survival.shadowEligibility.providerIssue === true
    || (tradabilityStatus === 'UNKNOWN' && stringOrNull(tradability.source) === 'UNKNOWN');

  const sections = buildSections(gate1);
  const compactText = buildCompactText({
    health,
    primaryIssue,
    operatorAction,
    inputsOk,
    quoteConfidence,
    quoteMissingFields,
    tradabilityStatus,
    liquidityStatus,
    sessionName,
    shadowMode,
    shadowAllowed,
  });
  const telegramText = buildTelegramText({
    health,
    primaryIssue,
    operatorAction,
    quoteSource,
    quoteConfidence,
    quoteMissingFields,
    tradabilityStatus,
    market: stringOrNull(tradability.market) ?? 'UNKNOWN',
    stockType: stringOrNull(tradability.stockType) ?? 'UNKNOWN',
    liquidityStatus,
    tradingValue: liquidity.tradingValue,
    sessionName,
    liveBuyAllowed,
    shadowMode,
    shadowScanAllowed: boolOrNull(shadow.shadowScanAllowed),
    shadowSignalAllowed: boolOrNull(shadow.shadowSignalAllowed),
    paperOrderAllowed: boolOrNull(shadow.paperOrderAllowed),
    caseRecordingAllowed,
    executionImpact,
  });

  return {
    health,
    summary: buildSummary(health, primaryIssue),
    primaryIssue,
    operatorAction,
    liveBuyAllowed,
    shadowAllowed,
    caseRecordingAllowed,
    marketSignal: false,
    providerIssue,
    executionImpact,
    sections,
    compactText,
    telegramText,
  };
}
