// @responsibility Gate3 consolidated timing diagnostic renderer; diagnostic output only.

import type { GateLayerSummary } from '../quantFilter.js';
import type {
  Gate3EntryPriceGuardDiagnostic,
  Gate3ExecutionImpact,
  Gate3LastTriggerEvaluation,
  Gate3RrrCheckDiagnostic,
} from './gate3LastTrigger.js';

export type Gate3ConsolidatedHealth = 'OK' | 'WARN' | 'DEGRADED' | 'DATA_INCOMPLETE' | 'TIMING_NOT_CONFIRMED' | 'CONFLICT' | 'UNKNOWN';
export type Gate3TimingReadiness = 'READY' | 'WAIT' | 'DATA_INCOMPLETE';
export type Gate3OperatorAction =
  | 'NONE'
  | 'CHECK_TECHNICAL_INDICATORS'
  | 'CHECK_VOLUME_BASELINE'
  | 'CHECK_PRICE_STRUCTURE'
  | 'CHECK_MOMENTUM_INDICATORS'
  | 'CHECK_PULLBACK_SUPPORT'
  | 'REVIEW_FALSE_BREAKOUT_RISK'
  | 'CHECK_INTRADAY_FEED'
  | 'REVIEW_GATE3_INPUTS'
  | 'WAIT_FOR_INTRADAY_CONFIRMATION';

export interface Gate3ConsolidatedDiagnostic {
  health: Gate3ConsolidatedHealth;
  summary: string;
  primaryIssue: string | null;
  operatorAction: Gate3OperatorAction;
  dataReadiness: Record<string, string>;
  timingAlignment: Record<string, string>;
  timingReadiness: Gate3TimingReadiness;
  lastTrigger: Pick<Gate3LastTriggerEvaluation, 'status' | 'fired' | 'reason' | 'executionReady' | 'liveBuyAllowed' | 'shadowObservableAllowed' | 'counterfactualAllowed' | 'executionImpact' | 'marketSignal'>;
  entryPriceGuard: Gate3EntryPriceGuardDiagnostic | Record<string, unknown>;
  rrrCheck: Gate3RrrCheckDiagnostic | Record<string, unknown>;
  falseBreakoutRisk: string;
  executionReadiness: Record<string, unknown>;
  conflictFlags: string[];
  missingCriticalData: string[];
  providerIssues: string[];
  calculationIssues: string[];
  freshnessIssues: string[];
  marketSignal: false;
  providerIssue: boolean;
  calculationIssue: boolean;
  freshnessIssue: boolean;
  executionImpact: Gate3ExecutionImpact;
  sections: Record<string, string[]>;
  compactText: string;
  telegramText: string;
}

type Gate3Bucket = GateLayerSummary['gate3'];
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const asString = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asList = (v: unknown): string[] => Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : [];

export function buildGate3ConsolidatedDiagnostic(input: { gate3: Gate3Bucket }): Gate3ConsolidatedDiagnostic {
  const gate3 = input.gate3;
  const source = asRecord(gate3.sourceCoverage);
  const ext = asRecord(gate3.externalDataCoverage);

  const technical = asRecord(ext.technicalIndicators);
  const volumeTiming = asRecord(ext.volumeTiming);
  const priceStructure = asRecord(ext.priceStructure);
  const momentum = asRecord(ext.momentumIndicators);
  const pullback = asRecord(ext.pullbackSupport);
  const falseBreakout = asRecord(ext.falseBreakout);
  const intraday = asRecord(ext.intradayTiming);
  const lastTriggerRecord = asRecord(ext.lastTrigger);
  const entryPriceGuard = asRecord(ext.entryPriceGuard);
  const rrrCheck = asRecord(ext.rrrCheck);
  const executionReadinessRecord = asRecord(ext.executionReadiness);

  const dataReadiness = {
    technicalIndicators: asString(technical.status) ?? 'UNKNOWN',
    volumeTiming: asString(volumeTiming.status) ?? 'UNKNOWN',
    priceStructure: asString(priceStructure.status) ?? 'UNKNOWN',
    momentumIndicators: asString(momentum.status) ?? 'UNKNOWN',
    pullbackSupport: asString(pullback.status) ?? 'OPTIONAL',
    falseBreakout: asString(falseBreakout.status) ?? 'OPTIONAL',
    intradayTiming: asString(intraday.status) ?? 'OPTIONAL',
    lastTrigger: asString(lastTriggerRecord.status) ?? 'UNKNOWN',
    entryPriceGuard: asString(entryPriceGuard.priceFreshness) ?? 'UNKNOWN',
  };

  const vb = asRecord(volumeTiming.breakoutVolume);
  const volumeValues = asRecord(volumeTiming.values);
  const volumeRatio = asNumber(volumeValues.volumeRatio) ?? asNumber(volumeTiming.volumeRatio) ?? asNumber(vb.volumeRatio);
  const tradingValueRatio = asNumber(volumeValues.tradingValueRatio) ?? asNumber(volumeTiming.tradingValueRatio) ?? asNumber(vb.tradingValueRatio);
  const breakoutVolumeStatus = asString(vb.status);
  const breakout = asRecord(priceStructure.breakout);
  const turtle = asRecord(priceStructure.turtle);
  const overheat = asRecord(momentum.overheat);
  const pullbackQuality = asRecord(pullback.pullbackQuality);
  const fbRisk = asRecord(falseBreakout.falseBreakout);
  const divergence = asRecord(falseBreakout.divergence);
  const exhaustion = asRecord(falseBreakout.exhaustion);
  const lastTick = asRecord(intraday.lastTick);
  const quoteFreshness = asRecord(intraday.quoteFreshness);
  const sessionCompatibility = asRecord(intraday.sessionCompatibility);
  const lastTriggerStatus = asString(lastTriggerRecord.status) ?? 'UNKNOWN';
  const lastTriggerFired = lastTriggerRecord.fired === true;
  const lastTriggerReason = asString(lastTriggerRecord.reason) ?? (lastTriggerFired ? 'FIRED' : 'LAST_TRIGGER_NOT_FIRED');
  const priceFreshness = asString(entryPriceGuard.priceFreshness) ?? 'UNKNOWN';
  const rrrValue = asNumber(rrrCheck.rrr);
  const rrrStatus = asString(rrrCheck.status) ?? 'UNKNOWN';
  const executionImpact = (asString(lastTriggerRecord.executionImpact) ?? asString(executionReadinessRecord.executionImpact) ?? 'DIAGNOSTIC_ONLY') as Gate3ExecutionImpact;
  const intradaySession = asString(sessionCompatibility.session) ?? 'UNKNOWN';
  const eodOnlyExpected = ['AFTERMARKET', 'CLOSED', 'HOLIDAY'].includes(intradaySession);

  const timingAlignment = {
    volume: (breakoutVolumeStatus === 'PASS' || (volumeRatio != null && volumeRatio >= 2) || (tradingValueRatio != null && tradingValueRatio >= 2)) ? 'CONFIRMED' : (breakoutVolumeStatus === 'FAIL' || volumeRatio != null || tradingValueRatio != null) ? 'WEAK' : breakoutVolumeStatus === 'MISSING' ? 'MISSING' : 'UNKNOWN',
    priceBreakout: (asString(breakout.status) === 'PASS' || asString(turtle.status) === 'PASS') ? 'CONFIRMED' : (asString(breakout.status) === 'FAIL' ? 'NOT_CONFIRMED' : asString(breakout.status) === 'MISSING' ? 'MISSING' : 'UNKNOWN'),
    momentum: asString(overheat.status) === 'OVERHEATED' ? 'OVERHEATED' : (asString(momentum.status) === 'MISSING' ? 'MISSING' : asString(momentum.alignment) ?? 'CONFIRMED'),
    pullback: asString(pullbackQuality.status) === 'HEALTHY_PULLBACK' ? 'HEALTHY' : asString(pullbackQuality.status) === 'EXTENDED_CHASE' ? 'EXTENDED' : asString(pullbackQuality.status) === 'TOO_DEEP' ? 'TOO_DEEP' : (asString(pullback.status) === 'MISSING' ? 'MISSING' : 'DIAGNOSTIC_ONLY'),
    falseBreakoutRisk: asString(fbRisk.status) === 'LOW_RISK' ? 'LOW' : asString(fbRisk.status) === 'WATCH' ? 'WATCH' : asString(fbRisk.status) === 'HIGH_RISK' ? 'HIGH' : (asString(falseBreakout.status) === 'MISSING' ? 'MISSING' : 'DIAGNOSTIC_ONLY'),
    intraday: asString(lastTick.status) === 'STALE' ? 'STALE' : asString(intraday.dataMode) === 'EOD_ONLY' ? 'EOD_ONLY' : (asString(intraday.dataMode) === 'INTRADAY' && asString(quoteFreshness.status) === 'FRESH' ? 'CONFIRMED' : (asString(intraday.status) === 'MISSING' ? 'MISSING' : 'DIAGNOSTIC_ONLY')),
    lastTrigger: lastTriggerFired ? 'FIRED' : lastTriggerStatus === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : 'WAIT',
    entryPrice: priceFreshness,
    rrr: rrrStatus,
  };

  let health: Gate3ConsolidatedHealth = 'OK';
  let primaryIssue: string | null = null;
  let operatorAction: Gate3OperatorAction = 'NONE';
  const conflictFlags: string[] = [];

  const missingCriticalData = [
    ...asList(source.missingInputs),
    ...asList(source.missingRequiredData),
  ];
  const providerIssues = asList(source.providerIssues);
  const calculationIssues = asList(source.calculationIssues);
  const freshnessIssues: string[] = [];

  const degradedStatus = new Set(['MISSING', 'CALCULATION_MISSING', 'DEGRADED']);
  const volumeDataIncomplete = degradedStatus.has(dataReadiness.volumeTiming) && timingAlignment.volume === 'MISSING';
  const timingReadiness: Gate3TimingReadiness = lastTriggerFired
    ? 'READY'
    : lastTriggerStatus === 'DATA_UNAVAILABLE' || lastTriggerReason.startsWith('ENTRY_PRICE')
      ? 'DATA_INCOMPLETE'
      : 'WAIT';

  if (timingReadiness === 'DATA_INCOMPLETE') {
    health = 'DATA_INCOMPLETE';
    primaryIssue = lastTriggerReason;
    operatorAction = lastTriggerReason.startsWith('ENTRY_PRICE') ? 'CHECK_INTRADAY_FEED' : 'REVIEW_GATE3_INPUTS';
    if (lastTriggerReason.startsWith('ENTRY_PRICE')) freshnessIssues.push(lastTriggerReason);
  } else if (source.allDeclaredInputsAvailable === false) {
    health = 'DEGRADED'; primaryIssue = 'GATE3_INPUT_MISSING'; operatorAction = 'REVIEW_GATE3_INPUTS';
  } else if (degradedStatus.has(dataReadiness.technicalIndicators)) {
    health = dataReadiness.technicalIndicators === 'DEGRADED' ? 'DEGRADED' : 'DATA_INCOMPLETE'; primaryIssue = 'TECHNICAL_INDICATORS_UNAVAILABLE'; operatorAction = 'CHECK_TECHNICAL_INDICATORS';
  } else if (volumeDataIncomplete) {
    health = 'DATA_INCOMPLETE'; primaryIssue = 'VOLUME_TIMING_UNAVAILABLE'; operatorAction = 'CHECK_VOLUME_BASELINE';
  } else if (degradedStatus.has(dataReadiness.priceStructure)) {
    health = 'DATA_INCOMPLETE'; primaryIssue = 'PRICE_STRUCTURE_UNAVAILABLE'; operatorAction = 'CHECK_PRICE_STRUCTURE';
  } else if (degradedStatus.has(dataReadiness.momentumIndicators)) {
    health = 'DATA_INCOMPLETE'; primaryIssue = 'MOMENTUM_INDICATORS_UNAVAILABLE'; operatorAction = 'CHECK_MOMENTUM_INDICATORS';
  } else if (asString(fbRisk.status) === 'HIGH_RISK') {
    health = timingAlignment.priceBreakout === 'CONFIRMED' ? 'CONFLICT' : 'WARN'; primaryIssue = 'FALSE_BREAKOUT_RISK'; operatorAction = 'REVIEW_FALSE_BREAKOUT_RISK';
  } else if (['RSI_BEARISH', 'MACD_BEARISH', 'BOTH_BEARISH'].includes(asString(divergence.status) ?? '')) {
    health = timingAlignment.priceBreakout === 'CONFIRMED' ? 'CONFLICT' : 'WARN'; primaryIssue = 'MOMENTUM_DIVERGENCE_WARNING'; operatorAction = 'REVIEW_FALSE_BREAKOUT_RISK';
  } else if (asString(exhaustion.status) === 'EXHAUSTED') {
    health = 'WARN'; primaryIssue = 'EXHAUSTION_RISK'; operatorAction = 'REVIEW_FALSE_BREAKOUT_RISK';
  } else if (asString(lastTick.status) === 'STALE') {
    freshnessIssues.push('INTRADAY_LAST_TICK_STALE'); health = 'WARN'; primaryIssue = 'INTRADAY_TICK_STALE'; operatorAction = 'CHECK_INTRADAY_FEED';
  } else if (asString(intraday.dataMode) === 'EOD_ONLY' || asString(intraday.status) === 'STAGE_NOT_FETCHED') {
    if (!eodOnlyExpected) {
      health = 'WARN'; primaryIssue = 'INTRADAY_NOT_FETCHED_EOD_ONLY'; operatorAction = 'WAIT_FOR_INTRADAY_CONFIRMATION';
    }
  }

  if (timingAlignment.priceBreakout === 'CONFIRMED' && (timingAlignment.volume === 'MISSING' || timingAlignment.volume === 'WEAK')) {
    if (health === 'OK') {
      health = timingAlignment.volume === 'MISSING' ? 'DATA_INCOMPLETE' : 'CONFLICT';
      primaryIssue ??= timingAlignment.volume === 'MISSING' ? 'VOLUME_TIMING_UNAVAILABLE' : 'VOLUME_NOT_CONFIRMED';
      operatorAction = 'CHECK_VOLUME_BASELINE';
    }
    conflictFlags.push('PRICE_BREAKOUT_WITHOUT_VOLUME_CONFIRMATION');
  }

  if (health === 'OK' && timingReadiness === 'WAIT') {
    health = 'TIMING_NOT_CONFIRMED';
    primaryIssue ??= lastTriggerReason;
  }

  if (health === 'OK' && !(timingAlignment.volume === 'CONFIRMED' && timingAlignment.priceBreakout === 'CONFIRMED' && timingAlignment.momentum === 'CONFIRMED' && timingAlignment.falseBreakoutRisk === 'LOW')) {
    health = 'TIMING_NOT_CONFIRMED';
  }

  const rrrText = rrrValue == null ? 'MISSING' : rrrValue.toFixed(1);
  const summary = primaryIssue ? `Gate3 diagnostic issue: ${primaryIssue}.` : 'Gate3 timing diagnostic dashboard is healthy.';
  const compactText = timingReadiness === 'READY'
    ? `Gate3: READY | trigger=FIRED | priceFresh=${priceFreshness} | rrr=${rrrText} | volume=${timingAlignment.volume} | price=${timingAlignment.priceBreakout} | falseBreakout=${timingAlignment.falseBreakoutRisk} | marketSignal=false`
    : timingReadiness === 'WAIT'
      ? `Gate3: WAIT | issue=${lastTriggerReason} | priceFresh=${priceFreshness} | rrr=${rrrText} | volume=${timingAlignment.volume} | price=${timingAlignment.priceBreakout} | falseBreakout=${timingAlignment.falseBreakoutRisk} | executionImpact=${executionImpact} | marketSignal=false`
      : `Gate3: DATA_INCOMPLETE | issue=${lastTriggerReason} | priceFresh=${priceFreshness} | rrr=${rrrText} | volume=${timingAlignment.volume} | price=${timingAlignment.priceBreakout} | falseBreakout=${timingAlignment.falseBreakoutRisk} | executionImpact=${executionImpact} | marketSignal=false`;
  const telegramLines = [
    '🧩 Gate3 Timing',
    `상태: ${health}`,
    primaryIssue ? `주요 이슈: ${primaryIssue}` : null,
    `LastTrigger: ${lastTriggerStatus}`,
    `PriceFresh: ${priceFreshness}`,
    `RRR: ${rrrText}`,
    `Volume: ${timingAlignment.volume}`,
    `Price: ${timingAlignment.priceBreakout}`,
    `Momentum: ${timingAlignment.momentum}`,
    `FalseBreakout: ${timingAlignment.falseBreakoutRisk}`,
    `Intraday: ${timingAlignment.intraday}`,
    `조치: ${operatorAction}`,
    '시장신호: false',
  ].filter(Boolean).slice(0, 10) as string[];

  return {
    health,
    summary,
    primaryIssue,
    operatorAction,
    dataReadiness,
    timingAlignment,
    timingReadiness,
    lastTrigger: {
      status: lastTriggerStatus as Gate3LastTriggerEvaluation['status'],
      fired: lastTriggerFired,
      reason: lastTriggerReason,
      executionReady: lastTriggerRecord.executionReady === true,
      liveBuyAllowed: lastTriggerRecord.liveBuyAllowed === true,
      shadowObservableAllowed: lastTriggerRecord.shadowObservableAllowed !== false,
      counterfactualAllowed: lastTriggerRecord.counterfactualAllowed !== false,
      executionImpact,
      marketSignal: false,
    },
    entryPriceGuard,
    rrrCheck,
    falseBreakoutRisk: timingAlignment.falseBreakoutRisk,
    executionReadiness: {
      ...executionReadinessRecord,
      status: timingReadiness,
      marketSignal: false,
    },
    conflictFlags,
    missingCriticalData,
    providerIssues,
    calculationIssues,
    freshnessIssues,
    marketSignal: false,
    providerIssue: providerIssues.length > 0,
    calculationIssue: calculationIssues.length > 0,
    freshnessIssue: freshnessIssues.length > 0,
    executionImpact,
    sections: {
      wiring: [`inputs=${source.allDeclaredInputsAvailable === true ? 'OK' : 'MISSING'}`, `requiredData=${source.allRequiredDataAvailable === true ? 'OK' : 'MISSING'}`],
      volume: [`status=${dataReadiness.volumeTiming}`, `breakoutVolume=${timingAlignment.volume}`],
      price: [`status=${dataReadiness.priceStructure}`, `breakout=${timingAlignment.priceBreakout}`],
      momentum: [`status=${dataReadiness.momentumIndicators}`, `alignment=${timingAlignment.momentum}`, `divergence=${asString(divergence.status) ?? 'UNKNOWN'}`],
      pullback: [`status=${dataReadiness.pullbackSupport}`, `pullback=${timingAlignment.pullback}`],
      falseBreakout: [`status=${dataReadiness.falseBreakout}`, `risk=${timingAlignment.falseBreakoutRisk}`, `exhaustion=${asString(exhaustion.status) ?? 'UNKNOWN'}`],
      intraday: [`status=${dataReadiness.intradayTiming}`, `dataMode=${asString(intraday.dataMode) ?? 'UNKNOWN'}`, `lastTick=${asString(lastTick.status) ?? 'UNKNOWN'}`],
      lastTrigger: [`status=${lastTriggerStatus}`, `reason=${lastTriggerReason}`, `priceFresh=${priceFreshness}`, `rrr=${rrrText}`, `executionImpact=${executionImpact}`],
    },
    compactText,
    telegramText: telegramLines.join('\n'),
  };
}
