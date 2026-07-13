// @responsibility PositionState SSOT resolver for holdings, PnL, pending state, and slot counts.

import {
  aggregatePositionSourceResults,
  type PositionSourceReaderMap,
} from '../telegram/commands/positions/positionSourceAggregator.js';
import type {
  NormalizedPosition,
  PositionSourceAggregate,
} from '../telegram/commands/positions/positionSourceTypes.js';
import { calculateRegimePositionSizing } from '../trading/sizing/regimePositionPolicy.js';
import type {
  TradeLifecycleOutcome,
  TradeLifecycleState,
  TradeOutcomeClass,
} from '../trading/tradeLifecycleOutcomeResolver.js';

type PositionMode =
  | 'LIVE'
  | 'SHADOW'
  | 'PAPER'
  | 'VIRTUAL'
  | 'COUNTERFACTUAL';

type PositionStatus =
  | 'NONE'
  | 'ORDER_PENDING'
  | 'OPEN'
  | 'PARTIALLY_CLOSED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'STALE_NEEDS_RECONCILIATION';

type PositionStateSource =
  | 'KIS_LIVE'
  | 'SHADOW_LEDGER'
  | 'PAPER_LEDGER'
  | 'VIRTUAL_ACCOUNT'
  | 'RECONCILED';

type PositionStateSourceConfidence =
  | 'VERIFIED'
  | 'RECONCILED'
  | 'STALE'
  | 'MISSING';

export interface PositionState {
  positionId: string;
  orderIntentId?: string;
  tradingDate: string;
  symbol: string;
  name?: string;
  mode: PositionMode;
  status: PositionStatus;
  quantity: number;
  avgEntryPrice: number | null;
  currentPrice: number | null;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL?: number;
  realizedPnLPct?: number;
  stopLoss?: number | null;
  targetPrice?: number | null;
  trailingStop?: number | null;
  tradePlanId?: string;
  initialStopLoss?: number | null;
  currentStopLoss?: number | null;
  targetPrice1?: number | null;
  riskReward1?: number;
  tp1SellPct?: number;
  moveStopToBreakevenAfterTp1?: boolean;
  openedAt?: string;
  updatedAt: string;
  closedAt?: string | null;
  source: PositionStateSource;
  sourceConfidence: PositionStateSourceConfidence;
  priceSnapshotId?: string;
  entryPriceSource?: string;
  entryPriceConfidence?: string;
  relatedOrderIds: string[];
  relatedSignalIds: string[];
  lifecycleOutcome?: TradeLifecycleOutcome | string;
  outcomeClass?: TradeOutcomeClass;
  finalExitReason?: string;
  lifecycleState?: TradeLifecycleState;
  reconciliationFlags?: string[];
}

export type PositionStateModePreference = 'SHADOW_FIRST' | 'LIVE_FIRST' | 'ALL';

export interface ResolvePositionStateInput {
  symbol?: string;
  modePreference: PositionStateModePreference;
  includePending: boolean;
}

export interface ResolvePositionStateDeps {
  sourceAggregate?: PositionSourceAggregate;
  readers?: PositionSourceReaderMap;
  now?: Date;
}

export interface PositionStateResolution {
  states: PositionState[];
  openCount: number;
  pendingCount: number;
  closedTodayCount: number;
  sourcesUsed: string[];
  sourceConfidence: PositionStateSourceConfidence;
  modePreference: PositionStateModePreference;
}

export interface PositionStateReconciliationInput {
  symbol?: string;
  dedupOpenCount?: number;
  paperOpenCount?: number;
  virtualHoldingCount?: number;
  liveHoldingCount?: number;
  pendingCount?: number;
  states?: PositionState[];
}

export interface PositionStateReconciliationIssue {
  symbol?: string;
  mismatchType:
    | 'STALE_DEDUP_LOCK_SUSPECTED'
    | 'POSITION_RECONCILIATION_REQUIRED'
    | 'POSITION_STATE_REBUILD_FROM_VIRTUAL_ACCOUNT'
    | 'LIVE_POSITION_IMPORT_REQUIRED'
    | 'POSITION_STATE_INVALID_QUANTITY';
  sources: string[];
  action: 'QUEUE_RECONCILIATION';
  executionImpact: 'NONE';
}

const ACTIVE_STATUSES = new Set<PositionStatus>(['ORDER_PENDING', 'OPEN', 'PARTIALLY_CLOSED']);

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function tradingDateKst(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function normalizeSymbol(symbol: unknown): string {
  const raw = String(symbol ?? '').trim();
  return raw.length > 0 ? raw.padStart(6, '0') : '';
}

function finiteOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapMode(position: NormalizedPosition): PositionMode {
  if (position.sourceTag === 'LIVE' || position.mode === 'LIVE') return 'LIVE';
  if (position.sourceTag === 'PAPER') return 'PAPER';
  if (position.sourceTag === 'VIRTUAL') return 'VIRTUAL';
  return 'SHADOW';
}

function normalizeStatus(status: unknown, qty: number): PositionStatus {
  const normalized = String(status ?? '').trim().toUpperCase();
  if (normalized.includes('PENDING') || normalized.includes('ORDER_SUBMITTED')) return 'ORDER_PENDING';
  if (normalized.includes('PARTIAL') || normalized.includes('EUPHORIA')) return 'PARTIALLY_CLOSED';
  if (normalized.includes('CANCEL')) return 'CANCELLED';
  if (normalized.includes('REJECT')) return 'REJECTED';
  if (normalized.includes('CLOSED') || normalized.includes('STOPPED') || normalized.includes('HIT_TARGET') || normalized.includes('HIT_STOP')) {
    return 'CLOSED';
  }
  if (qty <= 0) return 'STALE_NEEDS_RECONCILIATION';
  return 'OPEN';
}

function mapSource(source: unknown, mode: PositionMode): PositionStateSource {
  const normalized = String(source ?? '');
  if (normalized === 'KISLiveHolding' || mode === 'LIVE') return 'KIS_LIVE';
  if (normalized === 'PaperTradeLedger' || mode === 'PAPER') return 'PAPER_LEDGER';
  if (normalized === 'VirtualAccount' || mode === 'VIRTUAL') return 'VIRTUAL_ACCOUNT';
  return 'SHADOW_LEDGER';
}

function sourceConfidence(source: PositionStateSource): PositionStateSourceConfidence {
  if (source === 'VIRTUAL_ACCOUNT') return 'RECONCILED';
  if (source === 'RECONCILED') return 'RECONCILED';
  return 'VERIFIED';
}

function sourcePriority(modePreference: PositionStateModePreference, state: PositionState): number {
  const shadowRank = state.mode === 'SHADOW' ? 0 : state.mode === 'VIRTUAL' ? 1 : state.mode === 'PAPER' ? 2 : 3;
  const liveRank = state.mode === 'LIVE' ? 0 : state.mode === 'SHADOW' ? 1 : state.mode === 'VIRTUAL' ? 2 : 3;
  if (modePreference === 'LIVE_FIRST') return liveRank;
  return shadowRank;
}

function toPositionState(position: NormalizedPosition, now: Date): PositionState {
  const symbol = normalizeSymbol(position.symbol);
  const mode = mapMode(position);
  const quantity = Math.max(0, finiteOrZero(position.qty));
  const avgEntryPrice = finiteOrNull(position.avgPrice);
  const currentPrice = finiteOrNull(position.currentPrice);
  const status = normalizeStatus(position.status, quantity);
  const source = mapSource(position.source, mode);
  const raw = position.raw as {
    priceSnapshotId?: string;
    entryQuoteSnapshotId?: string;
    entryPriceSource?: string;
    entryQuoteSource?: string;
    entryPriceConfidence?: string;
    entryQuoteConfidence?: string;
    orderIntentId?: string;
    tradePlanId?: string;
    initialStopLoss?: number | null;
    currentStopLoss?: number | null;
    stopLoss?: number | null;
    targetPrice1?: number | null;
    targetPrice?: number | null;
    riskReward1?: number;
    riskReward?: number;
    tp1SellPct?: number;
    moveStopToBreakevenAfterTp1?: boolean;
  } | undefined;
  const marketValue = quantity * (currentPrice ?? avgEntryPrice ?? 0);
  const unrealizedPnL = finiteOrZero(position.unrealizedPnl ?? (
    currentPrice !== null && avgEntryPrice !== null ? (currentPrice - avgEntryPrice) * quantity : 0
  ));
  const unrealizedPnLPct = finiteOrZero(position.unrealizedPnlPct ?? (
    currentPrice !== null && avgEntryPrice !== null && avgEntryPrice > 0
      ? ((currentPrice / avgEntryPrice) - 1) * 100
      : 0
  ));

  return {
    positionId: position.id ?? `${mode}:${symbol}`,
    orderIntentId: raw?.orderIntentId,
    tradingDate: tradingDateKst(now),
    symbol,
    name: position.name,
    mode,
    status,
    quantity,
    avgEntryPrice,
    currentPrice,
    marketValue,
    unrealizedPnL,
    unrealizedPnLPct,
    updatedAt: now.toISOString(),
    source,
    sourceConfidence: sourceConfidence(source),
    priceSnapshotId: raw?.priceSnapshotId ?? raw?.entryQuoteSnapshotId,
    entryPriceSource: raw?.entryPriceSource ?? raw?.entryQuoteSource,
    entryPriceConfidence: raw?.entryPriceConfidence ?? raw?.entryQuoteConfidence,
    tradePlanId: raw?.tradePlanId,
    initialStopLoss: finiteOrNull(raw?.initialStopLoss ?? raw?.stopLoss),
    currentStopLoss: finiteOrNull(raw?.currentStopLoss ?? raw?.initialStopLoss ?? raw?.stopLoss),
    stopLoss: finiteOrNull(raw?.currentStopLoss ?? raw?.initialStopLoss ?? raw?.stopLoss),
    targetPrice1: finiteOrNull(raw?.targetPrice1 ?? raw?.targetPrice),
    targetPrice: finiteOrNull(raw?.targetPrice1 ?? raw?.targetPrice),
    riskReward1: finiteOrNull(raw?.riskReward1 ?? raw?.riskReward) ?? undefined,
    tp1SellPct: finiteOrNull(raw?.tp1SellPct) ?? undefined,
    moveStopToBreakevenAfterTp1: raw?.moveStopToBreakevenAfterTp1,
    relatedOrderIds: [],
    relatedSignalIds: [],
    reconciliationFlags: status === 'STALE_NEEDS_RECONCILIATION'
      ? ['POSITION_STATE_INVALID_QUANTITY']
      : undefined,
  };
}

async function loadSourceAggregate(
  input: ResolvePositionStateInput,
  deps: ResolvePositionStateDeps,
): Promise<PositionSourceAggregate> {
  if (deps.sourceAggregate) return deps.sourceAggregate;
  const mode = input.modePreference === 'LIVE_FIRST' ? 'LIVE' : 'SHADOW';
  return aggregatePositionSourceResults({
    mode,
    includeLiveFallback: input.modePreference !== 'SHADOW_FIRST',
    readers: deps.readers,
  });
}

export async function resolvePositionState(
  input: ResolvePositionStateInput,
  deps: ResolvePositionStateDeps = {},
): Promise<PositionStateResolution> {
  const now = deps.now ?? new Date();
  const aggregate = await loadSourceAggregate(input, deps);
  const targetSymbol = input.symbol ? normalizeSymbol(input.symbol) : null;
  const states = aggregate.positions
    .map((position) => toPositionState(position, now))
    .filter((state) => targetSymbol === null || state.symbol === targetSymbol)
    .filter((state) => input.includePending || state.status !== 'ORDER_PENDING')
    .sort((a, b) => sourcePriority(input.modePreference, a) - sourcePriority(input.modePreference, b));

  const openCount = states.filter((state) => state.status === 'OPEN' || state.status === 'PARTIALLY_CLOSED').length;
  const pendingCount = states.filter((state) => state.status === 'ORDER_PENDING').length;
  const closedTodayCount = states.filter((state) => state.status === 'CLOSED' && state.tradingDate === tradingDateKst(now)).length;
  const sourcesUsed = Array.from(new Set(states.map((state) => state.source)));
  const confidence: PositionStateSourceConfidence = aggregate.allFailed
    ? 'MISSING'
    : aggregate.hasFailure ? 'STALE'
      : sourcesUsed.includes('VIRTUAL_ACCOUNT') ? 'RECONCILED'
        : states.length > 0 ? 'VERIFIED'
          : 'MISSING';

  return {
    states,
    openCount,
    pendingCount,
    closedTodayCount,
    sourcesUsed,
    sourceConfidence: confidence,
    modePreference: input.modePreference,
  };
}

export function positionExistsInStates(states: readonly PositionState[]): boolean {
  return states.some((state) => ACTIVE_STATUSES.has(state.status));
}

export async function hasOpenPosition(
  symbol: string,
  modePreference: PositionStateModePreference = 'SHADOW_FIRST',
  deps: ResolvePositionStateDeps = {},
): Promise<boolean> {
  const result = await resolvePositionState({ symbol, modePreference, includePending: true }, deps);
  return positionExistsInStates(result.states);
}

async function getCurrentPositionCount(
  modePreference: PositionStateModePreference = 'SHADOW_FIRST',
  deps: ResolvePositionStateDeps = {},
): Promise<number> {
  const result = await resolvePositionState({ modePreference, includePending: true }, deps);
  return result.states.filter((state) => ACTIVE_STATUSES.has(state.status)).length;
}

export async function calculatePositionSlotsBySsot(input: {
  regime?: string | null;
  totalEquity: number;
  modePreference?: PositionStateModePreference;
  sourceAggregate?: PositionSourceAggregate;
  readers?: PositionSourceReaderMap;
  now?: Date;
}): Promise<ReturnType<typeof calculateRegimePositionSizing>> {
  const currentPositions = await getCurrentPositionCount(input.modePreference ?? 'SHADOW_FIRST', {
    sourceAggregate: input.sourceAggregate,
    readers: input.readers,
    now: input.now,
  });
  const sizing = calculateRegimePositionSizing({
    regime: input.regime,
    totalEquity: input.totalEquity,
    currentPositions,
  });
  console.info(formatPositionSlotCalculatedBySsotLog({
    regime: sizing.policy.regime,
    maxPositions: sizing.policy.maxPositions,
    currentPositions: sizing.currentPositions,
    remainingSlots: sizing.remainingSlots,
    modePreference: input.modePreference ?? 'SHADOW_FIRST',
  }));
  return sizing;
}

export function detectPositionStateReconciliationIssues(
  input: PositionStateReconciliationInput,
): PositionStateReconciliationIssue[] {
  const states = input.states ?? [];
  const issues: PositionStateReconciliationIssue[] = [];
  const activeCount = states.filter((state) => ACTIVE_STATUSES.has(state.status)).length;
  const paperStates = states.filter((state) => state.source === 'PAPER_LEDGER' && ACTIVE_STATUSES.has(state.status)).length;
  const virtualStates = states.filter((state) => state.source === 'VIRTUAL_ACCOUNT' && ACTIVE_STATUSES.has(state.status)).length;

  if ((input.dedupOpenCount ?? 0) > 0 && activeCount === 0 && (input.paperOpenCount ?? 0) === 0 && (input.virtualHoldingCount ?? 0) === 0 && (input.pendingCount ?? 0) === 0) {
    issues.push({
      symbol: input.symbol,
      mismatchType: 'STALE_DEDUP_LOCK_SUSPECTED',
      sources: ['DedupRegistry'],
      action: 'QUEUE_RECONCILIATION',
      executionImpact: 'NONE',
    });
  }
  if ((input.paperOpenCount ?? paperStates) > 0 && virtualStates === 0) {
    issues.push({
      symbol: input.symbol,
      mismatchType: 'POSITION_RECONCILIATION_REQUIRED',
      sources: ['PaperTradeLedger', 'VirtualAccount'],
      action: 'QUEUE_RECONCILIATION',
      executionImpact: 'NONE',
    });
  }
  if ((input.virtualHoldingCount ?? virtualStates) > 0 && activeCount === 0) {
    issues.push({
      symbol: input.symbol,
      mismatchType: 'POSITION_STATE_REBUILD_FROM_VIRTUAL_ACCOUNT',
      sources: ['VirtualAccount', 'PositionState'],
      action: 'QUEUE_RECONCILIATION',
      executionImpact: 'NONE',
    });
  }
  if ((input.liveHoldingCount ?? 0) > 0 && activeCount === 0) {
    issues.push({
      symbol: input.symbol,
      mismatchType: 'LIVE_POSITION_IMPORT_REQUIRED',
      sources: ['KISLiveHolding', 'PositionState'],
      action: 'QUEUE_RECONCILIATION',
      executionImpact: 'NONE',
    });
  }
  for (const state of states) {
    if (ACTIVE_STATUSES.has(state.status) && state.quantity <= 0) {
      issues.push({
        symbol: state.symbol,
        mismatchType: 'POSITION_STATE_INVALID_QUANTITY',
        sources: [state.source],
        action: 'QUEUE_RECONCILIATION',
        executionImpact: 'NONE',
      });
    }
  }

  return issues;
}

export function formatPositionStateResolvedLog(result: PositionStateResolution, symbol?: string): string {
  return [
    '[POSITION_STATE_RESOLVED]',
    kv('symbol', symbol ?? 'ALL'),
    kv('modePreference', result.modePreference),
    kv('openCount', result.openCount),
    kv('pendingCount', result.pendingCount),
    kv('closedTodayCount', result.closedTodayCount),
    kv('sourcesUsed', `[${result.sourcesUsed.join(',') || 'none'}]`),
    kv('sourceConfidence', result.sourceConfidence),
  ].join(' ');
}

export function formatPositionExistenceCheckedBySsotLog(input: {
  symbol?: string;
  exists: boolean;
  state?: PositionState;
}): string {
  return [
    '[POSITION_EXISTENCE_CHECKED_BY_SSOT]',
    kv('symbol', input.symbol ?? input.state?.symbol ?? 'ALL'),
    kv('exists', input.exists),
    kv('status', input.state?.status ?? 'NONE'),
    kv('mode', input.state?.mode ?? 'NONE'),
    kv('source', input.state?.source ?? 'NONE'),
    'dedupIgnored=true',
  ].join(' ');
}

export function formatPositionSlotCalculatedBySsotLog(input: {
  regime: string;
  maxPositions: number;
  currentPositions: number;
  remainingSlots: number;
  modePreference: PositionStateModePreference;
}): string {
  return [
    '[POSITION_SLOT_CALCULATED_BY_SSOT]',
    kv('regime', input.regime),
    kv('maxPositions', input.maxPositions),
    kv('currentPositions', input.currentPositions),
    kv('remainingSlots', input.remainingSlots),
    kv('modePreference', input.modePreference),
    "source='PositionStateResolver'",
  ].join(' ');
}

export function formatTelegramPositionCommandUsingSsotLog(input: {
  command: '/pos' | '/pnl' | string;
  liveCount: number;
  shadowCount: number;
  virtualHoldingCount: number;
  displayedCount: number;
}): string {
  return [
    '[TELEGRAM_POSITION_COMMAND_USING_SSOT]',
    kv('command', input.command),
    "modePreference='SHADOW_FIRST'",
    kv('liveCount', input.liveCount),
    kv('shadowCount', input.shadowCount),
    kv('virtualHoldingCount', input.virtualHoldingCount),
    kv('displayedCount', input.displayedCount),
  ].join(' ');
}

export function formatPositionStateReconciliationRequiredLog(issue: PositionStateReconciliationIssue): string {
  return [
    '[POSITION_STATE_RECONCILIATION_REQUIRED]',
    kv('symbol', issue.symbol ?? 'ALL'),
    kv('mismatchType', issue.mismatchType),
    kv('sources', `[${issue.sources.join(',')}]`),
    "action='QUEUE_RECONCILIATION'",
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatPositionStateOpenedLog(state: PositionState): string {
  return [
    '[POSITION_STATE_OPENED]',
    kv('positionId', state.positionId),
    kv('orderIntentId', state.orderIntentId),
    kv('symbol', state.symbol),
    "mode='SHADOW'",
    kv('quantity', state.quantity),
    kv('avgEntryPrice', state.avgEntryPrice),
    kv('tradePlanId', state.tradePlanId),
    kv('initialStopLoss', state.initialStopLoss),
    kv('targetPrice1', state.targetPrice1),
    "source='SHADOW_LEDGER'",
  ].join(' ');
}

export function formatPositionStateClosedLog(state: PositionState): string {
  return [
    '[POSITION_STATE_CLOSED]',
    kv('positionId', state.positionId),
    kv('symbol', state.symbol),
    "mode='SHADOW'",
    kv('realizedPnL', state.realizedPnL ?? 0),
    kv('lifecycleOutcome', state.lifecycleOutcome ?? 'UNKNOWN'),
  ].join(' ');
}
