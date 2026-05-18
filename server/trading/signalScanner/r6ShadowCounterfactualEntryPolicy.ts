// @responsibility R6 recovery shadow counterfactual entry policy.
import {
  appendFill,
  appendShadowLog,
  getRemainingQty,
  loadShadowTrades,
  saveShadowTrades,
  type ServerShadowTrade,
} from '../../persistence/shadowTradeRepo.js';
import { appendCounterfactualShadowLearningEntry } from '../../persistence/counterfactualShadowLearningRepo.js';
import { getSectorByCode } from '../../screener/sectorMap.js';
import type { MacroGateState } from './scanDiagnostics.js';
import type {
  CandidateWithSupplyContext,
} from './injectPerSymbolSupplyContext.js';
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
} from './normalSupplyPreview/types.js';
import type {
  CounterfactualShadowLearningCandidate,
} from './counterfactualShadowLearningLane.js';
import { isOpenShadowStatus } from '../entryEngine.js';

export type R6ShadowEntryType =
  | 'SHADOW_BUY_SIGNAL'
  | 'R6_COUNTERFACTUAL_BUY'
  | 'ACCUMULATION_SHADOW_ENTRY';

export type R6ShadowPolicyRegime =
  | 'R6_DEFENSE'
  | 'R6_CONFIRMATION_WAIT'
  | 'R6_RECOVERY_WATCH'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY';

export type R6NoShadowEntryReason =
  | 'ALL_ACCUMULATING_FAILED_MIN_LIQUIDITY'
  | 'PRICE_DATA_MISSING'
  | 'DUPLICATE_OPEN_POSITION'
  | 'POSITION_LIMIT_REACHED'
  | 'SHADOW_ENTRY_DISABLED_BY_ENV'
  | 'R6_COUNTERFACTUAL_DISABLED'
  | 'NO_R6_SHADOW_POLICY'
  | 'NO_ACCUMULATING_CANDIDATES'
  | 'NO_ELIGIBLE_ACCUMULATING_CANDIDATES';

export interface R6ShadowEntryPolicySummary {
  policyName: 'R6_SHADOW_ENTRY_POLICY';
  regime: R6ShadowPolicyRegime | 'NONE';
  liveNewBuyAllowed: false;
  realOrderAllowed: false;
  strongBuyAllowed: false;
  shadowLearningAllowed: boolean;
  shadowScanAllowed: boolean;
  shadowCounterfactualAllowed: boolean;
  accumulatingEligible: boolean;
  candidateEvaluated: number;
  accumulatingCandidates: number;
  shadowBuySignals: number;
  r6CounterfactualEntries: number;
  noShadowEntryReason?: R6NoShadowEntryReason | 'N/A';
  executionImpact: 'NONE';
}

export interface ApplyR6ShadowCounterfactualInput<T extends CandidateWithSupplyContext = CandidateWithSupplyContext> {
  preview: NormalSupplyPreview;
  rawCandidates?: T[];
  macroGateState?: MacroGateState;
  shadowScanAllowed?: boolean;
  now?: Date;
}

interface SelectedCandidate {
  candidate: NormalSupplyPreviewCandidate;
  entryPrice: number;
  rankScore: number;
}

const DEFAULT_R6_COUNTERFACTUAL_MAX_ENTRIES = 3;
const DEFAULT_R6_COUNTERFACTUAL_NOMINAL_KRW = 100_000;

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function normalizeSymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNumber(source: unknown, keys: string[]): number | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const direct = finiteNumber(record[key]);
    if (direct !== null) return direct;
  }
  return null;
}

function candidatePrice(raw: CandidateWithSupplyContext | undefined): number | null {
  if (!raw) return null;
  return readNumber(raw, [
    'currentPrice',
    'price',
    'entryPrice',
    'lastPrice',
    'closePrice',
    'signalPrice',
  ]) ?? readNumber((raw as Record<string, unknown>).quote, [
    'currentPrice',
    'price',
    'close',
    'regularMarketPrice',
  ]) ?? readNumber((raw as Record<string, unknown>).symbolFeatures, [
    'currentPrice',
    'price',
  ]);
}

function buildRawCandidateMap(rawCandidates: CandidateWithSupplyContext[] | undefined): Map<string, CandidateWithSupplyContext> {
  const map = new Map<string, CandidateWithSupplyContext>();
  for (const raw of rawCandidates ?? []) {
    const symbol = normalizeSymbol(raw.code ?? raw.symbol);
    if (symbol && !map.has(symbol)) map.set(symbol, raw);
  }
  return map;
}

function maxEntries(): number {
  const parsed = Number(process.env.R6_COUNTERFACTUAL_MAX_ENTRIES ?? DEFAULT_R6_COUNTERFACTUAL_MAX_ENTRIES);
  if (!Number.isFinite(parsed)) return DEFAULT_R6_COUNTERFACTUAL_MAX_ENTRIES;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

function nominalKrw(): number {
  const parsed = Number(process.env.R6_COUNTERFACTUAL_NOMINAL_KRW ?? DEFAULT_R6_COUNTERFACTUAL_NOMINAL_KRW);
  if (!Number.isFinite(parsed)) return DEFAULT_R6_COUNTERFACTUAL_NOMINAL_KRW;
  return Math.max(10_000, Math.floor(parsed));
}

function resolvePolicyRegime(input: ApplyR6ShadowCounterfactualInput): R6ShadowPolicyRegime | null {
  const macro = input.macroGateState;
  const status = macro?.r6RecoveryStatus;
  if (status === 'R6_CONFIRMATION_WAIT') return 'R6_CONFIRMATION_WAIT';
  if (status === 'R6_RECOVERY_WATCH') return 'R6_RECOVERY_WATCH';
  if (macro?.regime === 'R6_DEFENSE' || macro?.bearDefenseMode === true) return 'R6_DEFENSE';
  if (input.preview.reason?.includes('R6_CONFIRMATION_WAIT')) return 'R6_CONFIRMATION_WAIT';
  if (input.preview.reason?.includes('R6_RECOVERY_WATCH')) return 'R6_RECOVERY_WATCH';
  if (input.preview.reason?.includes('R6_DEFENSE')) return 'R6_DEFENSE';
  if (input.preview.engineMode === 'SELL_ONLY' && macro?.shadowLearningAllowed === true) return 'SELL_ONLY';
  if (input.preview.engineMode === 'SHADOW_ONLY') return 'SHADOW_ONLY';
  return null;
}

function hasPositiveActiveFlow(candidate: NormalSupplyPreviewCandidate): boolean {
  const foreign = candidate.foreignNetBuyAmount ?? 0;
  const institution = candidate.institutionNetBuyAmount ?? 0;
  return foreign > 0 && institution > 0;
}

function hasGoodSupply(candidate: NormalSupplyPreviewCandidate): boolean {
  return candidate.supplyScore >= 75 || candidate.activePassiveConfluence === 'ACTIVE_PASSIVE_CONFIRMED_BUY';
}

function isEligibleAccumulatingCandidate(candidate: NormalSupplyPreviewCandidate): boolean {
  if (candidate.supplySignal !== 'ACCUMULATING') return false;
  if (candidate.supplyScore < 70) return false;
  if (candidate.dataStatus !== 'VERIFIED') return false;
  if (candidate.confidence !== 'HIGH') return false;
  if (candidate.providerIssue) return false;
  if (candidate.programMissingAsBearish) return false;
  if (!candidate.shadowTracking) return false;
  if (!hasPositiveActiveFlow(candidate) && !hasGoodSupply(candidate)) return false;
  return true;
}

function isOpenShadowHolding(trade: ServerShadowTrade): boolean {
  return trade.mode === 'SHADOW' && isOpenShadowStatus(trade.status) && getRemainingQty(trade) > 0;
}

function hasDuplicateEntry(params: {
  trades: ServerShadowTrade[];
  symbol: string;
  entryType: R6ShadowEntryType;
  tradingDate: string;
  regime: R6ShadowPolicyRegime;
}): boolean {
  return params.trades.some((trade) => {
    if (trade.stockCode !== params.symbol) return false;
    if (isOpenShadowHolding(trade)) return true;
    const meta = trade.r6Counterfactual;
    return (
      trade.entryType === params.entryType &&
      meta?.tradingDate === params.tradingDate &&
      meta?.regime === params.regime
    );
  });
}

function buildCounterfactualLearningCandidate(input: {
  selected: SelectedCandidate;
  regime: R6ShadowPolicyRegime;
  tradingDate: string;
  nowIso: string;
  macroGateState?: MacroGateState;
}): CounterfactualShadowLearningCandidate {
  const c = input.selected.candidate;
  const regimePhase = input.regime === 'SELL_ONLY' || input.regime === 'SHADOW_ONLY'
    ? input.regime
    : 'R6_DEFENSE';
  const mhs = readNumber(input.macroGateState, ['mhs']);
  return {
    symbol: c.symbol,
    ...(c.name ? { name: c.name } : {}),
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: true,
    label: 'R6_COUNTERFACTUAL_BUY',
    reasons: [
      'HARD_BLOCK',
      'LEARNING_ONLY',
      'NO_HARD_RISK_BYPASS_ATTEMPT',
      'ACCUMULATING',
      'R6_RECOVERY_OBSERVE',
    ],
    blockedBy: [input.regime],
    liveAllowed: false,
    paperAllowed: true,
    executionShadowAllowed: true,
    virtualAccountImpact: 'SHADOW_ONLY',
    regime: input.regime,
    rawRegime: input.macroGateState?.macroRegimeRaw ?? input.macroGateState?.regime ?? input.regime,
    effectiveRegime: input.macroGateState?.macroRegimeEffective ?? input.regime,
    regimePhase,
    regimeAtSignal: regimePhase,
    regimeAtEntry: regimePhase,
    r6Trigger: input.macroGateState?.activeR6Triggers?.join(',') || 'none',
    engineMode: 'SHADOW_ONLY',
    marketSession: 'R6_SHADOW_ENTRY_POLICY',
    sellOnlyActive: input.regime === 'SELL_ONLY',
    hardBlockActive: input.regime.startsWith('R6_'),
    sourceFreshness: 'VERIFIED',
    scanId: `${input.tradingDate}:${input.regime}:R6_COUNTERFACTUAL_BUY`,
    createdAtKst: input.nowIso,
    gate1Passed: false,
    gate2Passed: false,
    entryPriceHint: input.selected.entryPrice,
    entryType: 'R6_COUNTERFACTUAL_BUY',
    sourceSignal: 'ACCUMULATING',
    entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
    executionImpact: 'NONE',
    liveOrderSent: false,
    riskUnit: 'R6_COUNTERFACTUAL',
    ...(mhs !== null ? { mhs } : {}),
    bias: 'BULL',
    supplyScore: c.supplyScore,
    activeFlow: c.activeFlow,
    passiveFlow: c.passiveFlow,
    programNetBuy: c.stockProgramNetBuyAmount,
    paperFillCreated: true,
    shadowPositionOpened: true,
  };
}

function buildShadowTrade(input: {
  selected: SelectedCandidate;
  regime: R6ShadowPolicyRegime;
  tradingDate: string;
  nowIso: string;
  macroGateState?: MacroGateState;
}): ServerShadowTrade {
  const c = input.selected.candidate;
  const entryPrice = input.selected.entryPrice;
  const qty = Math.max(1, Math.floor(nominalKrw() / entryPrice));
  const stopLoss = Math.max(1, Math.round(entryPrice * 0.93));
  const targetPrice = Math.max(entryPrice + 1, Math.round(entryPrice * 1.14));
  const trade: ServerShadowTrade = {
    id: `r6cf_${input.tradingDate.replace(/[^0-9]/g, '')}_${c.symbol}_${Date.now()}`,
    stockCode: c.symbol,
    stockName: c.name ?? c.symbol,
    signalTime: input.nowIso,
    signalPrice: entryPrice,
    shadowEntryPrice: entryPrice,
    entryPriceRaw: entryPrice,
    cumulativeAdjustmentFactor: 1,
    quantity: qty,
    originalQuantity: qty,
    stopLoss,
    initialStopLoss: stopLoss,
    regimeStopLoss: stopLoss,
    hardStopLoss: stopLoss,
    targetPrice,
    status: 'ACTIVE',
    mode: 'SHADOW',
    sector: getSectorByCode(c.symbol) || undefined,
    entryRegime: input.regime,
    profileType: 'D',
    watchlistSource: 'INTRADAY',
    profitTranches: [{ price: targetPrice, ratio: 1, taken: false }],
    trailingHighWaterMark: entryPrice,
    trailPct: 0.1,
    trailingEnabled: false,
    learningTag: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
    entryType: 'R6_COUNTERFACTUAL_BUY',
    sourceSignal: 'ACCUMULATING',
    entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
    executionImpact: 'NONE',
    liveOrderSent: false,
    riskUnit: 'R6_COUNTERFACTUAL',
    r6Counterfactual: {
      tradingDate: input.tradingDate,
      regime: input.regime,
      mhs: readNumber(input.macroGateState, ['mhs']),
      bias: 'BULL',
      supplyScore: c.supplyScore,
      activeFlow: c.activeFlow,
      passiveFlow: c.passiveFlow,
      programNetBuy: c.stockProgramNetBuyAmount,
      entryType: 'R6_COUNTERFACTUAL_BUY',
      liveOrderSent: false,
      executionImpact: 'NONE',
    },
  };
  appendFill(trade, {
    type: 'BUY',
    subType: 'INITIAL_BUY',
    qty,
    price: entryPrice,
    reason: 'R6_COUNTERFACTUAL_RECOVERY_TEST (SHADOW/PAPER, not a live order)',
    timestamp: input.nowIso,
    status: 'CONFIRMED',
    confirmedAt: input.nowIso,
  });
  return trade;
}

function selectCandidates(input: ApplyR6ShadowCounterfactualInput): SelectedCandidate[] {
  const rawBySymbol = buildRawCandidateMap(input.rawCandidates);
  const rows: SelectedCandidate[] = [];
  for (const candidate of input.preview.candidates) {
    if (!isEligibleAccumulatingCandidate(candidate)) continue;
    const entryPrice = candidatePrice(rawBySymbol.get(candidate.symbol));
    if (entryPrice === null || entryPrice <= 0) continue;
    const rankScore =
      candidate.supplyScore +
      (hasPositiveActiveFlow(candidate) ? 8 : 0) +
      ((candidate.stockProgramNetBuyAmount ?? 0) > 0 ? 4 : 0) +
      (candidate.activePassiveConfluence === 'ACTIVE_PASSIVE_CONFIRMED_BUY' ? 6 : 0);
    rows.push({ candidate, entryPrice, rankScore });
  }
  return rows
    .sort((a, b) => b.rankScore - a.rankScore || b.candidate.supplyScore - a.candidate.supplyScore)
    .slice(0, maxEntries());
}

function summaryBase(input: ApplyR6ShadowCounterfactualInput, regime: R6ShadowPolicyRegime | null): R6ShadowEntryPolicySummary {
  const accumulating = input.preview.signalCounts.ACCUMULATING ?? 0;
  const shadowLearningAllowed = input.macroGateState?.shadowLearningAllowed !== false;
  const shadowScanAllowed = input.shadowScanAllowed ?? input.macroGateState?.diagnosticAllowed !== false;
  return {
    policyName: 'R6_SHADOW_ENTRY_POLICY',
    regime: regime ?? 'NONE',
    liveNewBuyAllowed: false,
    realOrderAllowed: false,
    strongBuyAllowed: false,
    shadowLearningAllowed,
    shadowScanAllowed,
    shadowCounterfactualAllowed: Boolean(regime) && shadowLearningAllowed && shadowScanAllowed,
    accumulatingEligible: accumulating > 0,
    candidateEvaluated: input.preview.candidateCount,
    accumulatingCandidates: accumulating,
    shadowBuySignals: input.preview.signalCounts.BULLISH ?? 0,
    r6CounterfactualEntries: 0,
    executionImpact: 'NONE',
  };
}

export function applyR6ShadowCounterfactualEntries<T extends CandidateWithSupplyContext>(
  input: ApplyR6ShadowCounterfactualInput<T>,
): R6ShadowEntryPolicySummary {
  const regime = resolvePolicyRegime(input);
  const base = summaryBase(input, regime);
  console.info(
    `[R6_SHADOW_ENTRY_POLICY_RESOLVED] regime=${base.regime} ` +
      `liveNewBuyAllowed=false shadowCounterfactualAllowed=${base.shadowCounterfactualAllowed} ` +
      `accumulatingEligible=${base.accumulatingEligible} executionImpact=NONE`,
  );

  if (!regime) return { ...base, noShadowEntryReason: 'NO_R6_SHADOW_POLICY' };
  if (process.env.R6_COUNTERFACTUAL_DISABLED === 'true') {
    console.info(
      `[NO_SHADOW_ENTRY_REASON] candidateCount=${base.candidateEvaluated} ` +
        `accumulating=${base.accumulatingCandidates} reason=R6_COUNTERFACTUAL_DISABLED executionImpact=NONE`,
    );
    return { ...base, noShadowEntryReason: 'R6_COUNTERFACTUAL_DISABLED' };
  }
  if (!base.shadowLearningAllowed || !base.shadowScanAllowed) {
    console.info(
      `[NO_SHADOW_ENTRY_REASON] candidateCount=${base.candidateEvaluated} ` +
        `accumulating=${base.accumulatingCandidates} reason=SHADOW_ENTRY_DISABLED_BY_ENV executionImpact=NONE`,
    );
    return { ...base, noShadowEntryReason: 'SHADOW_ENTRY_DISABLED_BY_ENV' };
  }
  if (base.accumulatingCandidates <= 0) {
    return { ...base, noShadowEntryReason: 'NO_ACCUMULATING_CANDIDATES' };
  }

  const selected = selectCandidates(input);
  if (selected.length === 0) {
    const hasEligibleWithoutPrice = input.preview.candidates.some(isEligibleAccumulatingCandidate);
    const reason: R6NoShadowEntryReason = hasEligibleWithoutPrice
      ? 'PRICE_DATA_MISSING'
      : 'NO_ELIGIBLE_ACCUMULATING_CANDIDATES';
    console.info(
      `[NO_SHADOW_ENTRY_REASON] candidateCount=${base.candidateEvaluated} ` +
        `accumulating=${base.accumulatingCandidates} reason=${reason} executionImpact=NONE`,
    );
    return { ...base, noShadowEntryReason: reason };
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const tradingDate = kstDateKey(now);
  const trades = loadShadowTrades();
  let created = 0;
  let duplicateBlocked = 0;

  for (const item of selected) {
    const symbol = item.candidate.symbol;
    if (hasDuplicateEntry({
      trades,
      symbol,
      entryType: 'R6_COUNTERFACTUAL_BUY',
      tradingDate,
      regime,
    })) {
      duplicateBlocked += 1;
      console.info(
        `[SHADOW_COUNTERFACTUAL_DUPLICATE_BLOCKED] symbol=${symbol} ` +
          `entryType=R6_COUNTERFACTUAL_BUY tradingDate=${tradingDate} regime=${regime} executionImpact=NONE`,
      );
      continue;
    }

    console.info(
      `[R6_COUNTERFACTUAL_CANDIDATE_SELECTED] symbol=${symbol} ` +
        `supplyScore=${item.candidate.supplyScore} signal=ACCUMULATING reason=R6_RECOVERY_OBSERVE executionImpact=NONE`,
    );
    const trade = buildShadowTrade({
      selected: item,
      regime,
      tradingDate,
      nowIso,
      macroGateState: input.macroGateState,
    });
    trades.push(trade);
    appendCounterfactualShadowLearningEntry({
      candidate: buildCounterfactualLearningCandidate({
        selected: item,
        regime,
        tradingDate,
        nowIso,
        macroGateState: input.macroGateState,
      }),
      scanId: `${tradingDate}:${regime}:R6_COUNTERFACTUAL_BUY`,
      scannedAtKst: nowIso,
    });
    appendShadowLog({
      event: 'R6_COUNTERFACTUAL_BUY_CREATED',
      symbol,
      stockName: item.candidate.name ?? symbol,
      entryType: 'R6_COUNTERFACTUAL_BUY',
      sourceSignal: 'ACCUMULATING',
      entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
      entryPrice: item.entryPrice,
      quantity: trade.originalQuantity ?? trade.quantity,
      regime,
      tradingDate,
      liveOrderSent: false,
      executionImpact: 'NONE',
    });
    console.info(
      `[R6_COUNTERFACTUAL_BUY_CREATED] symbol=${symbol} ` +
        `entryType=R6_COUNTERFACTUAL_BUY liveOrderSent=false executionImpact=NONE`,
    );
    console.info(
      `[SHADOW_PAPER_FILLED] symbol=${symbol} source=R6_COUNTERFACTUAL_BUY executionImpact=NONE`,
    );
    created += 1;
  }

  if (created > 0) {
    saveShadowTrades(trades);
    return {
      ...base,
      r6CounterfactualEntries: created,
      noShadowEntryReason: 'N/A',
    };
  }

  const reason: R6NoShadowEntryReason = duplicateBlocked > 0
    ? 'DUPLICATE_OPEN_POSITION'
    : 'NO_ELIGIBLE_ACCUMULATING_CANDIDATES';
  console.info(
    `[NO_SHADOW_ENTRY_REASON] candidateCount=${base.candidateEvaluated} ` +
      `accumulating=${base.accumulatingCandidates} reason=${reason} executionImpact=NONE`,
  );
  return { ...base, noShadowEntryReason: reason };
}
