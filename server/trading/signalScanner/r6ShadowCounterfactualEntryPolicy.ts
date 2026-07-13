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
import { computeShadowAccount } from '../../persistence/shadowAccountRepo.js';
import { loadTradingSettings } from '../../persistence/tradingSettingsRepo.js';
import { getSectorByCode } from '../../screener/sectorMap.js';
import {
  calculateShadowRegimeSizing,
  computeFinalPosition,
  resolveShadowRegimeSizingLevel,
  type PositionSizingResult,
  type ShadowRegimeSizingLevel,
  type ShadowRegimeSizingResult,
} from '../sizing/index.js';
import { channelShadowBuyFilled } from '../../alerts/channelPipeline.js';
import type { MacroGateState } from './scanDiagnostics.js';
import type {
  CandidateWithSupplyContext,
  SupplySignal,
} from './injectPerSymbolSupplyContext.js';
import type {
  NormalSupplyPreview,
  NormalSupplyPreviewCandidate,
} from './normalSupplyPreview/types.js';
import type {
  CounterfactualShadowLearningCandidate,
} from './counterfactualShadowLearningLane.js';
import { isOpenShadowStatus } from '../entryEngine.js';

type R6ShadowEntryType =
  | 'SHADOW_BUY_SIGNAL'
  | 'R6_COUNTERFACTUAL_BUY'
  | 'ACCUMULATION_SHADOW_ENTRY';

type R6ShadowPolicyRegime =
  | 'R6_DEFENSE'
  | 'R6_CONFIRMATION_WAIT'
  | 'R6_RECOVERY_WATCH'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY';

type R6NoShadowEntryReason =
  | 'DUPLICATE_SAME_SYMBOL_OPEN'
  | 'DUPLICATE_SAME_SYMBOL_PENDING'
  | 'STALE_DEDUP_LOCK'
  | 'MAX_R6_SHADOW_POSITION_REACHED'
  | 'R6_CONFIRMATION_WAIT'
  | 'ENTRY_SCORE_BELOW_THRESHOLD'
  | 'NO_BUY_CANDIDATE'
  | 'MARKET_SESSION_BLOCKED'
  | 'ALL_ACCUMULATING_FAILED_MIN_LIQUIDITY'
  | 'PRICE_DATA_MISSING'
  | 'POSITION_LIMIT_REACHED'
  | 'SHADOW_ENTRY_DISABLED_BY_ENV'
  | 'R6_COUNTERFACTUAL_DISABLED'
  | 'R6_COUNTERFACTUAL_ACTIVE_POSITION_DISABLED'
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
  shadowNewBuyAllowed: boolean;
  shadowPaperFillAllowed: boolean;
  shadowPositionOpenAllowed: boolean;
  accumulatingEligible: boolean;
  candidateEvaluated: number;
  accumulatingCandidates: number;
  shadowBuySignals: number;
  r6CounterfactualEntries: number;
  counterfactualLearningEntries?: number;
  duplicateLearningEntries?: number;
  noShadowEntryReason?: R6NoShadowEntryReason | 'N/A';
  noShadowEntryReasons?: Array<R6NoShadowEntryReason | 'N/A'>;
  buyCandidates?: number;
  shadowDedupCounts?: {
    registryOpenCount: number;
    ledgerOpenCount: number;
    tradeRepoOpenCount: number;
    tradeRepoPendingCount: number;
    paperLedgerOpenCount: number;
    virtualHoldingCount: number;
    finalOpenShadowPositions: number;
  };
  accumulatingToBuyBlockReasons?: {
    scoreBelowThreshold: number;
    confirmationWait: number;
    duplicateSameSymbol: number;
    capReached: number;
    marketClosed: number;
  };
  sizingSource?: 'LIVE_SIZING_MIRROR';
  sizingRegime?: ShadowRegimeSizingLevel;
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

interface ShadowSizingState {
  totalShadowEquity: number;
  availableVirtualCash: number;
  currentShadowExposure: number;
  openShadowSymbols: Set<string>;
}
interface ShadowDedupSourceCounts {
  openShadowPositions: number;
  pendingShadowOrders: number;
  paperOpenCount: number;
  virtualHoldingCount: number;
}

interface StaleDedupLockContext {
  lockAgeSec: number | null;
  lockCreatedAt: string;
  invalidTimestamp: boolean;
  lockKey: string;
  symbol: string;
  strategy: string;
  side: 'BUY';
  session: string;
  configuredTtlSec: number;
  sourceCounts: ShadowDedupSourceCounts;
}

const DEFAULT_R6_COUNTERFACTUAL_MAX_ENTRIES = 3;

function kstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function normalizeSymbol(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits;
}

function getConfiguredDedupTtlSec(): number {
  const raw = Number(process.env.R6_SHADOW_DEDUP_TTL_SEC ?? '86400');
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 86400;
}

function countShadowDedupSources(trades: ServerShadowTrade[]): ShadowDedupSourceCounts {
  const openShadowPositions = trades.filter((trade) => isOpenShadowHolding(trade)).length;
  const pendingShadowOrders = trades.filter((trade) => trade.mode === 'SHADOW' && trade.status === 'PENDING').length;
  return {
    openShadowPositions,
    pendingShadowOrders,
    paperOpenCount: openShadowPositions,
    virtualHoldingCount: openShadowPositions,
  };
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

function readString(source: unknown, keys: string[]): string | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function resolveEntryEffectiveState(macroGateState: MacroGateState | undefined, fallback: string): string {
  return readString(macroGateState, ['r6RecoveryStatus', 'r6StateMachineState', 'macroRegimeEffective', 'regime'])
    ?? fallback;
}

function resolveR6LatchDecayAtEntry(macroGateState: MacroGateState | undefined): number | string | undefined {
  return readNumber(macroGateState, ['latchDecayPercent', 'r6LatchDecayPercent', 'r6LatchDecay'])
    ?? readString(macroGateState, ['latchDecayLevel', 'r6LatchDecayLevel'])
    ?? undefined;
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

function counterfactualOnlyEnabled(): boolean {
  return process.env.R6_COUNTERFACTUAL_ONLY === 'true' || process.env.R6_COUNTERFACTUAL_OPEN_POSITION_ENABLED === 'false';
}

function resolvePolicyRegime(input: ApplyR6ShadowCounterfactualInput): R6ShadowPolicyRegime | null {
  void input;
  return null;
}

function resolveLegacyPolicyRegime(input: ApplyR6ShadowCounterfactualInput): R6ShadowPolicyRegime | null {
  const macro = input.macroGateState;
  const status = macro?.r6RecoveryStatus;
  if (status === 'R6_CONFIRMATION_WAIT') return 'R6_CONFIRMATION_WAIT';
  if (status === 'R6_RECOVERY_WATCH') return 'R6_RECOVERY_WATCH';
  const rawRegime = (macro?.regime ?? '').toString();
  const normalizedRawRegime = rawRegime && rawRegime !== 'NONE' && rawRegime !== 'UNKNOWN' ? rawRegime : '';
  if (normalizedRawRegime === 'R6_DEFENSE') return 'R6_DEFENSE';
  if (macro?.bearDefenseMode === true) return 'R6_DEFENSE';
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
  now: Date;
}): { reason: 'DUPLICATE_SAME_SYMBOL_OPEN' | 'DUPLICATE_SAME_SYMBOL_PENDING' | 'STALE_DEDUP_LOCK' | null; staleLock?: StaleDedupLockContext } {
  for (const trade of params.trades) {
    if (trade.stockCode !== params.symbol) continue;
    if (isOpenShadowHolding(trade)) return { reason: 'DUPLICATE_SAME_SYMBOL_OPEN' };
    if (trade.mode === 'SHADOW' && trade.status === 'PENDING') return { reason: 'DUPLICATE_SAME_SYMBOL_PENDING' };
    const meta = trade.r6Counterfactual;
    if (
      trade.entryType === params.entryType &&
      meta?.tradingDate === params.tradingDate &&
      meta?.regime === params.regime
    ) {
      const legacyTimestamps = trade as ServerShadowTrade & { updatedAt?: string; createdAt?: string };
      const createdAtIso = readString(trade.r6Counterfactual, ['createdAtIso']) ?? legacyTimestamps.updatedAt ?? legacyTimestamps.createdAt ?? '';
      const createdAtMs = readNumber(trade.r6Counterfactual, ['createdAtMs']);
      const parsedMs = Number.isFinite(Date.parse(createdAtIso)) ? Date.parse(createdAtIso) : null;
      const invalidTimestamp = !createdAtIso || createdAtIso.startsWith('1970-01-01') || (createdAtMs !== null && createdAtMs <= 0) || (createdAtMs === null && parsedMs === null);
      const lockAgeSec = invalidTimestamp
        ? null
        : Math.max(0, Math.floor((params.now.getTime() - ((createdAtMs && createdAtMs > 0) ? createdAtMs : (parsedMs ?? params.now.getTime()))) / 1000));
      const sourceCounts = countShadowDedupSources(params.trades);
      const configuredTtlSec = getConfiguredDedupTtlSec();
      return {
        reason: 'STALE_DEDUP_LOCK',
        staleLock: {
          lockAgeSec,
          lockCreatedAt: createdAtIso || '1970-01-01T00:00:00.000Z',
          invalidTimestamp,
          lockKey: `${params.entryType}:${params.symbol}:${params.tradingDate}:${params.regime}`,
          symbol: params.symbol,
          strategy: params.entryType,
          side: 'BUY',
          session: params.tradingDate,
          configuredTtlSec,
          sourceCounts,
        },
      };
    }
  }
  return { reason: null };
}

function buildShadowSizingState(trades: ServerShadowTrade[]): ShadowSizingState {
  const startingCapital = loadTradingSettings().startingCapital;
  const fallbackEquity = Number.isFinite(startingCapital) && startingCapital > 0 ? startingCapital : 100_000_000;
  try {
    const shadowTrades = trades.filter((trade) => trade.mode !== 'LIVE');
    const account = computeShadowAccount(shadowTrades, fallbackEquity, {});
    return {
      totalShadowEquity: account.totalAssets > 0 ? account.totalAssets : fallbackEquity,
      availableVirtualCash: account.cashBalance,
      currentShadowExposure: account.openPositions.reduce((sum, position) => sum + position.investedCash, 0),
      openShadowSymbols: new Set(account.openPositions.map((position) => normalizeSymbol(position.stockCode))),
    };
  } catch (error) {
    console.warn('[R6_COUNTERFACTUAL_SIZING_ACCOUNT_WARN]', error);
    return {
      totalShadowEquity: fallbackEquity,
      availableVirtualCash: fallbackEquity,
      currentShadowExposure: 0,
      openShadowSymbols: new Set<string>(),
    };
  }
}

function computeLiveSizingMirrorResult(input: {
  totalShadowEquity: number;
  entryPrice: number;
}): PositionSizingResult {
  const stopLoss = Math.max(1, Math.round(input.entryPrice * 0.93));
  const stopLossPct = Math.max(0.001, (input.entryPrice - stopLoss) / input.entryPrice);
  const accountEquity = Math.max(1, Math.floor(input.totalShadowEquity));
  return computeFinalPosition({
    accountEquity,
    peakEquity: accountEquity,
    signalGrade: 'BUY',
    stopLossPct,
    regimeMultiplier: 1.0,
    confidenceMultiplier: 1.0,
    rrrMultiplier: 1.0,
    correlationMultiplier: 1.0,
    lossStreakState: {
      consecutiveLosses: 0,
      lastLossDate: null,
      coolOffUntil: null,
    },
    avgDailyVolume20d: 1_000_000_000_000_000,
    marketCap: 1_000_000_000_000_000,
    isAdminStock: false,
    isInvestmentWarning: false,
    currentSectorWeight: 0,
    isNormalRegime: true,
    rrrAbove2_5: true,
    enemyChecklistPassed: true,
    highDataReliability: true,
    gate1AllPassed: true,
    notInDowntrend: true,
  });
}

function buildSizingSnapshot(input: {
  result: PositionSizingResult;
  decision: ShadowRegimeSizingResult;
  positionAmount: number;
  totalShadowEquity: number;
  nowIso: string;
}): ServerShadowTrade['sizingEngineSnapshot'] {
  const totalShadowEquity = Math.max(1, input.totalShadowEquity);
  return {
    tierName: input.result.tier.name,
    basePct: input.result.basePct,
    finalPositionPct: input.positionAmount / totalShadowEquity,
    finalPositionKrw: input.positionAmount,
    drawdownMultiplier: input.result.drawdownMultiplier,
    lossStreakMultiplier: input.result.lossStreakMultiplier,
    liquidityMultiplier: input.result.liquidityMultiplier,
    sectorExposureMultiplier: input.result.sectorExposureMultiplier,
    expectedStopLossDamagePct: input.result.expectedStopLossDamagePct,
    signalPriorityApplied: input.result.signalPriorityApplied,
    adjustmentReasons: [
      ...input.result.adjustmentReasons,
      `sizingSource=${input.decision.sizingSource}`,
      `regimeCap=${input.decision.policy.level}`,
      `cappedBy=${input.decision.cappedBy.join(',') || 'NONE'}`,
    ],
    snapshotAt: input.nowIso,
  };
}

function buildCounterfactualLearningCandidate(input: {
  selected: SelectedCandidate;
  regime: R6ShadowPolicyRegime;
  tradingDate: string;
  nowIso: string;
  macroGateState?: MacroGateState;
  opensShadowPosition: boolean;
}): CounterfactualShadowLearningCandidate {
  const c = input.selected.candidate;
  const regimePhase = input.regime === 'SELL_ONLY' || input.regime === 'SHADOW_ONLY'
    ? input.regime
    : 'R6_DEFENSE';
  const mhs = readNumber(input.macroGateState, ['mhs']);
  const entryEffectiveState = resolveEntryEffectiveState(input.macroGateState, input.regime);
  const r6LatchDecayAtEntry = resolveR6LatchDecayAtEntry(input.macroGateState);
  return {
    symbol: c.symbol,
    ...(c.name ? { name: c.name } : {}),
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: input.opensShadowPosition,
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
    paperAllowed: input.opensShadowPosition,
    executionShadowAllowed: input.opensShadowPosition,
    virtualAccountImpact: input.opensShadowPosition ? 'SHADOW_ONLY' : 'NONE',
    regime: input.regime,
    rawRegime: input.macroGateState?.macroRegimeRaw ?? input.macroGateState?.regime ?? input.regime,
    effectiveRegime: input.macroGateState?.macroRegimeEffective ?? input.regime,
    regimePhase,
    regimeAtSignal: regimePhase,
    regimeAtEntry: regimePhase,
    entryRegime: regimePhase,
    entryEffectiveState,
    transitionPath: [regimePhase],
    ...(r6LatchDecayAtEntry !== undefined ? { r6LatchDecayAtEntry } : {}),
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
    ...(mhs !== null ? { mhsAtEntry: mhs } : {}),
    bias: 'BULL',
    biasAtEntry: 'BULL',
    supplyScore: c.supplyScore,
    supplyScoreAtEntry: c.supplyScore,
    activeFlow: c.activeFlow,
    passiveFlow: c.passiveFlow,
    programNetBuy: c.stockProgramNetBuyAmount,
    programFlowAtEntry: c.stockProgramNetBuyAmount,
    paperFillCreated: input.opensShadowPosition,
    shadowPositionOpened: input.opensShadowPosition,
  };
}

function buildShadowTrade(input: {
  selected: SelectedCandidate;
  regime: R6ShadowPolicyRegime;
  tradingDate: string;
  nowIso: string;
  macroGateState?: MacroGateState;
  sizingDecision: ShadowRegimeSizingResult;
  sizingEngineResult: PositionSizingResult;
  totalShadowEquity: number;
  qty: number;
}): ServerShadowTrade {
  const c = input.selected.candidate;
  const entryPrice = input.selected.entryPrice;
  const qty = input.qty;
  const positionAmount = qty * entryPrice;
  const stopLoss = Math.max(1, Math.round(entryPrice * 0.93));
  const targetPrice = Math.max(entryPrice + 1, Math.round(entryPrice * 1.14));
  const entryEffectiveState = resolveEntryEffectiveState(input.macroGateState, input.regime);
  const r6LatchDecayAtEntry = resolveR6LatchDecayAtEntry(input.macroGateState);
  const entryRegime = input.regime === 'SELL_ONLY' || input.regime === 'SHADOW_ONLY'
    ? input.regime
    : 'R6_DEFENSE';
  const mhs = readNumber(input.macroGateState, ['mhs']);
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
    profileType: 'D',
    watchlistSource: 'INTRADAY',
    profitTranches: [{ price: targetPrice, ratio: 1, taken: false }],
    trailingHighWaterMark: entryPrice,
    trailPct: 0.1,
    trailingEnabled: false,
    learningTag: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
    entryType: 'R6_COUNTERFACTUAL_BUY',
    entryRegime,
    entryEffectiveState,
    transitionPath: [entryRegime],
    ...(r6LatchDecayAtEntry !== undefined ? { r6LatchDecayAtEntry } : {}),
    ...(mhs !== null ? { mhsAtEntry: mhs } : {}),
    biasAtEntry: 'BULL',
    supplyScoreAtEntry: c.supplyScore,
    programFlowAtEntry: c.stockProgramNetBuyAmount,
    sourceSignal: 'ACCUMULATING',
    entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
    executionImpact: 'NONE',
    liveOrderSent: false,
    riskUnit: 'R6_COUNTERFACTUAL',
    sizingSource: 'LIVE_SIZING_MIRROR',
    sizingEngineSnapshot: buildSizingSnapshot({
      result: input.sizingEngineResult,
      decision: input.sizingDecision,
      positionAmount,
      totalShadowEquity: input.totalShadowEquity,
      nowIso: input.nowIso,
    }),
    r6Counterfactual: {
      tradingDate: input.tradingDate,
      regime: input.regime,
      entryRegime,
      entryEffectiveState,
      transitionPath: [entryRegime],
      ...(r6LatchDecayAtEntry !== undefined ? { r6LatchDecayAtEntry } : {}),
      ...(mhs !== null ? { mhsAtEntry: mhs } : {}),
      biasAtEntry: 'BULL',
      supplyScoreAtEntry: c.supplyScore,
      programFlowAtEntry: c.stockProgramNetBuyAmount,
      mhs,
      bias: 'BULL',
      supplyScore: c.supplyScore,
      activeFlow: c.activeFlow,
      passiveFlow: c.passiveFlow,
      programNetBuy: c.stockProgramNetBuyAmount,
      entryType: 'R6_COUNTERFACTUAL_BUY',
      liveOrderSent: false,
      executionImpact: 'NONE',
      sizingSource: 'LIVE_SIZING_MIRROR',
      liveSizingEngineBudget: input.sizingDecision.liveSizingEngineBudget,
      finalShadowBudget: positionAmount,
      createdAtMs: Date.now(),
      createdAtIso: input.nowIso,
      regimeMaxSymbols: input.sizingDecision.policy.maxSymbols,
      regimeMaxPositionPct: input.sizingDecision.policy.maxPositionPct,
      regimeTotalExposureCap: input.sizingDecision.policy.totalExposureCap,
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
  const seenSymbols = new Set<string>();
  for (const candidate of input.preview.candidates) {
    const normalized = normalizeSymbol(candidate.symbol);
    if (!normalized || seenSymbols.has(normalized)) continue;
    seenSymbols.add(normalized);
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
    shadowNewBuyAllowed: Boolean(regime) && shadowLearningAllowed && shadowScanAllowed,
    shadowPaperFillAllowed: Boolean(regime) && shadowLearningAllowed && shadowScanAllowed,
    shadowPositionOpenAllowed: Boolean(regime) && shadowLearningAllowed && shadowScanAllowed && !counterfactualOnlyEnabled(),
    accumulatingEligible: accumulating > 0,
    candidateEvaluated: input.preview.candidateCount,
    accumulatingCandidates: accumulating,
    shadowBuySignals: input.preview.signalCounts.BULLISH ?? 0,
    buyCandidates: (input.preview.signalCounts as Partial<Record<SupplySignal | 'BUY', number>>).BUY ?? 0,
    r6CounterfactualEntries: 0,
    executionImpact: 'NONE',
  };
}

export function applyR6ShadowCounterfactualEntries<T extends CandidateWithSupplyContext>(
  input: ApplyR6ShadowCounterfactualInput<T>,
): R6ShadowEntryPolicySummary {
  const legacyRegime = resolveLegacyPolicyRegime(input);
  if (legacyRegime) {
    console.info(
      `[REMOVED_POLICY_INPUT_IGNORED] inputEntryBlockMode=${legacyRegime} ` +
      `removedPolicies=${legacyRegime} shadowSignalAllowed=true ` +
      `diagnosticAllowed=true counterfactualAllowed=true executionImpact='NONE' rollback='SELL_ONLY_AND_R6_EXECUTION_DISABLED'`,
    );
  }
  const regime = resolvePolicyRegime(input);
  const base = summaryBase(input, regime);
  if (base.regime === 'NONE' && (input.macroGateState?.r6RecoveryStatus || input.macroGateState?.bearDefenseMode)) {
    console.warn(
      `[P1_REGIME_CONTEXT_MISSING_FOR_SHADOW_POLICY] inputRegime=NONE fallbackEffectiveRegime=${input.macroGateState?.r6RecoveryStatus ?? 'UNKNOWN'} ` +
      `fallbackDisplayRegime=${input.macroGateState?.regime ?? 'UNKNOWN'} riskOverride=${input.macroGateState?.regime ?? 'N/A'} correctionApplied=true executionImpact=NONE`,
    );
  }
  console.info(
    `[R6_SHADOW_ENTRY_POLICY_RESOLVED] regime=${base.regime} ` +
      `legacyPolicyDisabled=true livePermission=GATE_DATA_ONLY shadowScanAllowed=${base.shadowScanAllowed} ` +
      `shadowLearningAllowed=${base.shadowLearningAllowed} shadowNewBuyAllowed=${base.shadowNewBuyAllowed} ` +
      `shadowPaperFillAllowed=${base.shadowPaperFillAllowed} shadowPositionOpenAllowed=${base.shadowPositionOpenAllowed} ` +
      `shadowCounterfactualAllowed=${base.shadowCounterfactualAllowed} accumulatingEligible=${base.accumulatingEligible} executionImpact=NONE`,
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
  if (counterfactualOnlyEnabled()) {
    let recorded = 0;
    let duplicate = 0;
    for (const item of selected) {
      const symbol = item.candidate.symbol;
      const scanId = `${tradingDate}:${regime}:R6_COUNTERFACTUAL_BUY`;
      const result = appendCounterfactualShadowLearningEntry({
        candidate: buildCounterfactualLearningCandidate({
          selected: item,
          regime,
          tradingDate,
          nowIso,
          macroGateState: input.macroGateState,
          opensShadowPosition: false,
        }),
        scanId,
        scannedAtKst: nowIso,
      });
      if (result.recorded) recorded += 1;
      else if (result.reason === 'DUPLICATE') duplicate += 1;
      appendShadowLog({
        event: 'R6_COUNTERFACTUAL_LEARNING_ONLY_RECORDED',
        symbol,
        stockName: item.candidate.name ?? symbol,
        entryType: 'R6_COUNTERFACTUAL_BUY',
        sourceSignal: 'ACCUMULATING',
        entryReason: 'R6_COUNTERFACTUAL_RECOVERY_TEST',
        entryPrice: item.entryPrice,
        regime,
        tradingDate,
        liveOrderSent: false,
        executionImpact: 'NONE',
        paperFillCreated: false,
        shadowPositionOpened: false,
        approvalRequiredForActiveShadowPosition: true,
      });
      console.info(
        `[R6_COUNTERFACTUAL_LEARNING_ONLY_RECORDED] symbol=${symbol} ` +
          `entryType=R6_COUNTERFACTUAL_BUY shadowPositionOpened=false ` +
          `paperFillCreated=false approvalRequiredForActiveShadowPosition=true ` +
          `executionImpact=NONE`,
      );
    }
    return {
      ...base,
      r6CounterfactualEntries: 0,
      counterfactualLearningEntries: recorded,
      noShadowEntryReason: 'R6_COUNTERFACTUAL_ACTIVE_POSITION_DISABLED',
      ...(duplicate > 0 ? { duplicateLearningEntries: duplicate } : {}),
    };
  }

  const trades = loadShadowTrades();
  const sizingState = buildShadowSizingState(trades);
  const sizingRegime = resolveShadowRegimeSizingLevel({
    regime,
    effectiveRegime: input.macroGateState?.macroRegimeEffective ?? input.macroGateState?.regime ?? regime,
    r6RecoveryStatus: input.macroGateState?.r6RecoveryStatus,
    engineMode: input.preview.engineMode,
  });
  let created = 0;
  let duplicateBlocked = 0;
  let positionBlocked = 0;
  let duplicatePendingBlocked = 0;
  let staleDedupBlocked = 0;
  let capReached = 0;
  let noBuyCandidate = 0;
  const newTradeIds = new Set<string>();
  const dedupCounts = {
    registryOpenCount: 0,
    ledgerOpenCount: 0,
    tradeRepoOpenCount: trades.filter(isOpenShadowHolding).length,
    tradeRepoPendingCount: trades.filter((t) => t.mode === 'SHADOW' && t.status === 'PENDING').length,
    paperLedgerOpenCount: 0,
    virtualHoldingCount: 0,
    finalOpenShadowPositions: sizingState.openShadowSymbols.size,
  };

  for (const item of selected) {
    const symbol = item.candidate.symbol;
    const duplicateReason = hasDuplicateEntry({
      trades,
      symbol,
      entryType: 'R6_COUNTERFACTUAL_BUY',
      tradingDate,
      regime,
      now,
    });
    if (duplicateReason.reason) {
      if (duplicateReason.reason === 'DUPLICATE_SAME_SYMBOL_OPEN') duplicateBlocked += 1;
      else if (duplicateReason.reason === 'DUPLICATE_SAME_SYMBOL_PENDING') duplicatePendingBlocked += 1;
      else staleDedupBlocked += 1;
      if (duplicateReason.staleLock) {
        const stale = duplicateReason.staleLock;
        const c = stale.sourceCounts;
        console.info(
          `[SHADOW_DEDUP_LOCK_CHECK] lockAgeSec=${stale.lockAgeSec ?? 'null'} invalidTimestamp=${stale.invalidTimestamp} lockCreatedAt=${stale.lockCreatedAt} ` +
          `lockKey=${stale.lockKey} symbol=${stale.symbol} strategy=${stale.strategy} side=${stale.side} session=${stale.session} ` +
          `openShadowPositions=${c.openShadowPositions} pendingShadowOrders=${c.pendingShadowOrders} ` +
          `paperOpenCount=${c.paperOpenCount} virtualHoldingCount=${c.virtualHoldingCount} configuredTtlSec=${stale.configuredTtlSec} executionImpact=NONE`,
        );
        const shouldClear = c.openShadowPositions === 0 && c.pendingShadowOrders === 0 && c.paperOpenCount === 0
          && c.virtualHoldingCount === 0 && (stale.invalidTimestamp || ((stale.lockAgeSec ?? 0) > stale.configuredTtlSec));
        if (shouldClear) {
          const target = trades.find((trade) => trade.stockCode === symbol && trade.entryType === 'R6_COUNTERFACTUAL_BUY' && trade.r6Counterfactual?.tradingDate === tradingDate && trade.r6Counterfactual?.regime === regime);
          if (target) {
            target.entryType = 'SHADOW_BUY_SIGNAL';
            delete target.r6Counterfactual;
            console.info(
              `[SHADOW_DEDUP_INVALID_TIMESTAMP_LOCK_CLEARED] symbol=${symbol} lockKey=${stale.lockKey} createdAtIso=${stale.lockCreatedAt} reason=INVALID_TIMESTAMP_AND_NO_OPEN_OR_PENDING_POSITION executionImpact=NONE`,
            );
            staleDedupBlocked = Math.max(0, staleDedupBlocked - 1);
            continue;
          }
        }
      }
      console.info(
        `[SHADOW_COUNTERFACTUAL_DUPLICATE_BLOCKED] symbol=${symbol} ` +
          `entryType=R6_COUNTERFACTUAL_BUY tradingDate=${tradingDate} regime=${regime} reason=${duplicateReason.reason} ` +
          `open=${dedupCounts.tradeRepoOpenCount} pending=${dedupCounts.tradeRepoPendingCount} ` +
          `paperOpen=${dedupCounts.paperLedgerOpenCount} virtualHolding=${dedupCounts.virtualHoldingCount} executionImpact=NONE`,
      );
      continue;
    }

    const liveSizingEngineResult = computeLiveSizingMirrorResult({
      totalShadowEquity: sizingState.totalShadowEquity,
      entryPrice: item.entryPrice,
    });
    const sizingDecision = calculateShadowRegimeSizing({
      regimeLevel: sizingRegime,
      liveSizingEngineBudget: liveSizingEngineResult.blocked ? 0 : liveSizingEngineResult.finalPosition,
      totalShadowEquity: sizingState.totalShadowEquity,
      currentShadowExposure: sizingState.currentShadowExposure,
      availableVirtualCash: sizingState.availableVirtualCash,
      openShadowSymbolCount: sizingState.openShadowSymbols.size,
    });
    const qty = Math.floor(sizingDecision.finalShadowBudget / item.entryPrice);

    if (!sizingDecision.allowed || qty < 1) {
      positionBlocked += 1;
      capReached += 1;
      if (sizingDecision.blockReason === 'REGIME_SHADOW_SLOT_BLOCKED') {
        console.info(
          `[REGIME_SHADOW_SLOT_BLOCKED] symbol=${symbol} regime=${regime} sizingRegime=${sizingRegime} ` +
            `maxSymbols=${sizingDecision.policy.maxSymbols} openShadowSymbols=${sizingState.openShadowSymbols.size} ` +
            `executionImpact=NONE`,
        );
      } else {
        console.info(
          `[REGIME_SHADOW_BUDGET_BLOCKED] symbol=${symbol} regime=${regime} sizingRegime=${sizingRegime} ` +
            `reason=${sizingDecision.blockReason ?? 'QUANTITY_BELOW_ONE'} ` +
            `liveSizingEngineBudget=${Math.round(sizingDecision.liveSizingEngineBudget)} ` +
            `finalShadowBudget=${Math.round(sizingDecision.finalShadowBudget)} ` +
            `executionImpact=NONE`,
        );
      }
      continue;
    }

    console.info(
      `[R6_COUNTERFACTUAL_CANDIDATE_SELECTED] symbol=${symbol} ` +
        `supplyScore=${item.candidate.supplyScore} signal=ACCUMULATING reason=R6_RECOVERY_OBSERVE executionImpact=NONE`,
    );
    console.info(
      `[SHADOW_LIVE_SIZING_MIRROR] symbol=${symbol} regime=${regime} sizingRegime=${sizingRegime} ` +
        `liveSizingEngineBudget=${Math.round(sizingDecision.liveSizingEngineBudget)} ` +
        `finalShadowBudget=${Math.round(qty * item.entryPrice)} qty=${qty} ` +
        `sizingSource=LIVE_SIZING_MIRROR liveOrderSent=false executionImpact=NONE`,
    );
    const trade = buildShadowTrade({
      selected: item,
      regime,
      tradingDate,
      nowIso,
      macroGateState: input.macroGateState,
      sizingDecision,
      sizingEngineResult: liveSizingEngineResult,
      totalShadowEquity: sizingState.totalShadowEquity,
      qty,
    });
    trades.push(trade);
    newTradeIds.add(trade.id);
    const positionAmount = qty * item.entryPrice;
    sizingState.currentShadowExposure += positionAmount;
    sizingState.availableVirtualCash = Math.max(0, sizingState.availableVirtualCash - positionAmount);
    sizingState.openShadowSymbols.add(normalizeSymbol(symbol));
    appendCounterfactualShadowLearningEntry({
      candidate: buildCounterfactualLearningCandidate({
        selected: item,
        regime,
        tradingDate,
        nowIso,
        macroGateState: input.macroGateState,
        opensShadowPosition: true,
      }),
      scanId: `${tradingDate}:${regime}:R6_COUNTERFACTUAL_BUY`,
      scannedAtKst: nowIso,
    });
    appendShadowLog({
      event: 'SHADOW_ORDER_CREATED',
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
      sizingSource: 'LIVE_SIZING_MIRROR',
      liveSizingEngineBudget: sizingDecision.liveSizingEngineBudget,
      finalShadowBudget: positionAmount,
      sizingRegime,
    });
    console.info(
      `[SHADOW_ORDER_CREATED] symbol=${symbol} ` +
        `entryType=R6_COUNTERFACTUAL_BUY sizingSource=LIVE_SIZING_MIRROR ` +
        `liveOrderSent=false executionImpact=NONE`,
    );
    console.info(
      `[SHADOW_PAPER_FILLED] symbol=${symbol} source=R6_COUNTERFACTUAL_BUY executionImpact=NONE`,
    );
    console.info(
      `[SHADOW_POSITION_OPENED] symbol=${symbol} source=R6_COUNTERFACTUAL_BUY executionImpact=NONE`,
    );
    console.info(
      `[R6_SHADOW_ACTIVE_RECORDED] symbol=${symbol} entryType=R6_COUNTERFACTUAL_BUY shadowPositionOpened=true paperFillCreated=true liveOrderSent=false executionImpact=NONE`,
    );
    created += 1;
  }

  if (created > 0) {
    const freshTrades = loadShadowTrades();
    const freshOpenSymbols = new Set(
      freshTrades.filter(isOpenShadowHolding).map((trade) => normalizeSymbol(trade.stockCode)),
    );
    const createdTrades = trades.filter((trade) => newTradeIds.has(trade.id));
    const safeNewTrades: ServerShadowTrade[] = [];
    for (const trade of createdTrades) {
      const symbol = normalizeSymbol(trade.stockCode);
      if (!symbol) continue;
      if (freshOpenSymbols.has(symbol)) {
        console.warn(
          `[R6_COUNTERFACTUAL_RACE_GUARD] duplicate removed symbol=${symbol} tradeId=${trade.id} executionImpact=NONE`,
        );
        created = Math.max(0, created - 1);
        continue;
      }
      freshOpenSymbols.add(symbol);
      safeNewTrades.push(trade);
    }
    if (safeNewTrades.length > 0) {
      saveShadowTrades([...freshTrades, ...safeNewTrades]);
      for (const trade of safeNewTrades) {
        void channelShadowBuyFilled({
          stockCode: trade.stockCode,
          stockName: trade.stockName,
          fillPrice: trade.shadowEntryPrice,
          quantity: trade.originalQuantity ?? trade.quantity,
          fillId: trade.fills?.[0]?.id ?? `${trade.id}:INITIAL_BUY`,
          tradeId: trade.id,
        }).catch((error) => {
          console.warn('[R6_CF_BUY_NOTIFY_FAILED]', error);
        });
      }
    }
    return {
      ...base,
      r6CounterfactualEntries: created,
      noShadowEntryReason: 'N/A',
      sizingSource: 'LIVE_SIZING_MIRROR',
      sizingRegime,
    };
  }

  const reason: R6NoShadowEntryReason = duplicateBlocked > 0
    ? 'DUPLICATE_SAME_SYMBOL_OPEN'
    : duplicatePendingBlocked > 0
      ? 'DUPLICATE_SAME_SYMBOL_PENDING'
      : staleDedupBlocked > 0
        ? 'STALE_DEDUP_LOCK'
        : (base.buyCandidates ?? 0) <= 0
          ? 'NO_BUY_CANDIDATE'
          : positionBlocked > 0
            ? 'MAX_R6_SHADOW_POSITION_REACHED'
            : 'NO_ELIGIBLE_ACCUMULATING_CANDIDATES';
  noBuyCandidate = (base.buyCandidates ?? 0) <= 0 ? 1 : 0;
  console.info(
    `[NO_SHADOW_ENTRY_REASON] candidateCount=${base.candidateEvaluated} ` +
      `accumulating=${base.accumulatingCandidates} reason=${reason} executionImpact=NONE`,
  );
  return {
    ...base,
    noShadowEntryReason: reason,
    noShadowEntryReasons: [reason],
    shadowDedupCounts: dedupCounts,
    accumulatingToBuyBlockReasons: {
      scoreBelowThreshold: Math.max(0, base.accumulatingCandidates - (base.buyCandidates ?? 0)),
      confirmationWait: regime === 'R6_CONFIRMATION_WAIT' ? 1 : 0,
      duplicateSameSymbol: duplicateBlocked + duplicatePendingBlocked + staleDedupBlocked,
      capReached,
      marketClosed: input.preview.engineMode === 'SELL_ONLY' ? 1 : 0,
    },
  };
}
