import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import {
  appendShadowLog,
  getRemainingQty,
  loadShadowTrades,
} from '../../persistence/shadowTradeRepo.js';
import { channelShadowBuyFilled } from '../../alerts/channelPipeline.js';
import {
  executeShadowBuy,
  recordShadowExecutionOutcome,
  type ExecuteShadowBuyInput,
  type ShadowFillNotificationInput,
  type ShadowExecutionResult,
} from '../shadowExecutionPipeline.js';
import type { BuyApprovalPolicyResult } from './buyApprovalPolicy.js';
import type { BuySignalStateMachine } from './buySignalStateMachine.js';
import { emitOperationalWarn } from './operationalWarn.js';
import { markAutoTradeReady, markFilled, type TradeSignalStatusWriteResult } from './tradeSignalStatusWriter.js';
import { formatPositionStateOpenedLog, type PositionState } from '../../positions/positionStateResolver.js';
import {
  assertPipelineStage,
  changeOrderIntentStatus,
  createOrderIntent,
  createPaperFill,
  createShadowOrder,
  formatBuyAllowedPipelineAdvancedLog,
  formatBuyAllowedPipelineBreakLog,
  formatOrderIntentCreatedLog,
  formatOrderPipelineCompletedLog,
  formatOrderPipelineFailedLog,
  formatPaperTradeLedgerRecordedLog,
  formatShadowOrderCreatedLog,
  formatShadowPaperFilledLog,
  formatVirtualAccountUpdatedLog,
  type OrderIntent,
  type OrderIntentStatus,
  type PaperFill,
  type ShadowOrder,
} from '../orderPipelineSsot.js';
import {
  registerShadowBuyLifecycle,
  updateShadowBuyLifecycleStatus,
  type ShadowBuyLifecycleStatus,
} from './shadowDuplicateBuyRegistry.js';

export type ShadowBuyExecutionOutcome =
  | 'SHADOW_POSITION_OPENED'
  | 'SHADOW_REJECTED';

export interface ShadowBuyExecutorInput {
  trade: ServerShadowTrade;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  entryPrice: number;
  marketSession?: string;
  regime?: string;
  maxPositions?: number;
  logEvent: string;
  signalId?: string;
  approvalPolicy: BuyApprovalPolicyResult;
  stateMachine?: BuySignalStateMachine;
}

export interface ShadowBuyExecutionResult {
  outcome: ShadowBuyExecutionOutcome;
  reason: string;
  shadowExecutionResult?: ShadowExecutionResult;
  orderIntent?: OrderIntent;
  statusWrites: TradeSignalStatusWriteResult[];
}

export interface ShadowBuyExecutorDeps {
  appendShadowLog: typeof appendShadowLog;
  loadShadowTrades: typeof loadShadowTrades;
  executeShadowBuy: typeof executeShadowBuy;
  recordShadowExecutionOutcome: typeof recordShadowExecutionOutcome;
  notifyFilled: NonNullable<ExecuteShadowBuyInput['notifyFilled']>;
  markAutoTradeReady: typeof markAutoTradeReady;
  markFilled: typeof markFilled;
}

const defaultDeps: ShadowBuyExecutorDeps = {
  appendShadowLog,
  loadShadowTrades,
  executeShadowBuy,
  recordShadowExecutionOutcome,
  notifyFilled: async (filled) => {
    await channelShadowBuyFilled({
      stockName: filled.stockName,
      stockCode: filled.stockCode,
      fillPrice: filled.fillPrice,
      quantity: filled.quantity,
      fillId: filled.fillId,
      tradeId: filled.tradeId,
      currentPrice: filled.currentPrice,
      fillReferencePrice: filled.fillReferencePrice,
      proposedFillPrice: filled.proposedFillPrice,
      deviationPct: filled.deviationPct,
      quoteAsOf: filled.quoteAsOf,
      quoteSource: filled.quoteSource,
      quoteSnapshotId: filled.quoteSnapshotId,
      priceSnapshotId: filled.priceSnapshotId,
      priceConfidence: filled.priceConfidence,
      priceAgeSec: filled.priceAgeSec,
      validation: filled.validation,
    });
  },
  markAutoTradeReady,
  markFilled,
};

function hasOpenShadowPosition(trade: ServerShadowTrade): boolean {
  if (trade.status === 'ACTIVE') return true;
  if (trade.status === 'PARTIALLY_FILLED') return true;
  if (trade.status === 'EUPHORIA_PARTIAL') return true;
  return (trade.fills ?? []).some((fill) => fill.type === 'BUY' && fill.status !== 'REVERTED');
}

function mergeTradeForPaperFill(
  trade: ServerShadowTrade,
  loadTrades: typeof loadShadowTrades,
): ServerShadowTrade[] {
  const allTrades = loadTrades();
  const existingIndex = allTrades.findIndex((candidate) => candidate.id === trade.id);
  if (existingIndex >= 0) {
    allTrades[existingIndex] = trade;
  } else {
    allTrades.push(trade);
  }
  return allTrades;
}

function rejectShadow(
  input: ShadowBuyExecutorInput,
  reason: string,
  statusWrites: TradeSignalStatusWriteResult[],
  shadowExecutionResult?: ShadowExecutionResult,
  orderIntent?: OrderIntent,
): ShadowBuyExecutionResult {
  input.trade.status = 'REJECTED';
  input.stateMachine?.transition('SHADOW_REJECTED', reason);
  return {
    outcome: 'SHADOW_REJECTED',
    reason,
    ...(shadowExecutionResult ? { shadowExecutionResult } : {}),
    ...(orderIntent ? { orderIntent } : {}),
    statusWrites,
  };
}

function appendShadowExecutorLogSafe(
  deps: ShadowBuyExecutorDeps,
  entry: Parameters<typeof appendShadowLog>[0],
  context: Record<string, unknown>,
): void {
  try {
    deps.appendShadowLog(entry);
  } catch (error) {
    emitOperationalWarn({
      code: 'P2_SHADOW_BUY_LEDGER_LOG_WRITE_FAILED',
      severity: 'P2',
      message: 'SHADOW buy executor log write failed; execution lifecycle continues',
      context,
      cause: error,
    });
  }
}

function tradeExtension(trade: ServerShadowTrade): ServerShadowTrade & {
  tradePlanId?: string;
  priceSnapshotId?: string;
  entryQuoteSnapshotId?: string;
  profileType?: string;
  shadowBuyLifecycleKey?: string;
  shadowBuyLifecycleStatus?: ShadowBuyLifecycleStatus;
} {
  return trade as ServerShadowTrade & {
    tradePlanId?: string;
    priceSnapshotId?: string;
    entryQuoteSnapshotId?: string;
    profileType?: string;
  };
}

function shadowBuyLifecycleKey(trade: ServerShadowTrade): string | undefined {
  return tradeExtension(trade).shadowBuyLifecycleKey;
}

function makeOrderIntent(input: ShadowBuyExecutorInput): OrderIntent {
  const ext = tradeExtension(input.trade);
  return createOrderIntent({
    snapshotId: input.signalId ?? input.trade.id,
    sampleId: input.signalId ?? input.trade.id,
    tradePlanId: ext.tradePlanId,
    priceSnapshotId: ext.priceSnapshotId ?? ext.entryQuoteSnapshotId,
    symbol: input.stockCode,
    name: input.stockName,
    mode: 'SHADOW',
    decision: 'BUY_ALLOWED',
    label: 'BUY',
    quantity: input.trade.quantity,
    referencePrice: input.entryPrice,
    strategyId: ext.profileType ?? input.logEvent,
    executionImpact: 'SHADOW_ONLY',
  });
}

function logStatusChange(intent: OrderIntent, to: OrderIntentStatus, reason: string): void {
  const changed = changeOrderIntentStatus(intent, to, reason);
  console.log(changed.log);
}

function failPipeline(input: {
  intent: OrderIntent;
  stage: string;
  reason: string;
}): void {
  console.error(formatOrderPipelineFailedLog({
    orderIntentId: input.intent.orderIntentId,
    symbol: input.intent.symbol,
    stage: input.stage,
    failureReason: input.reason,
    counterfactualPreserved: true,
    executionImpact: input.intent.executionImpact,
  }));
}

async function notifyFilledAfterPositionOpen(input: {
  deps: ShadowBuyExecutorDeps;
  trade: ServerShadowTrade;
  stockCode: string;
  stockName: string;
  shadowResult: ShadowExecutionResult;
  fill: PaperFill;
}): Promise<'SENT' | 'NOT_REQUESTED'> {
  const shadowResult = input.shadowResult;
  const notification: ShadowFillNotificationInput = {
    stockCode: input.stockCode,
    stockName: input.stockName,
    fillPrice: shadowResult.fillPrice ?? input.fill.fillPrice,
    quantity: input.fill.quantity,
    fillId: input.fill.fillId,
    tradeId: input.trade.id,
    filledAtIso: shadowResult.executedAtIso,
    currentPrice: shadowResult.currentPrice,
    fillReferencePrice: shadowResult.currentPrice,
    proposedFillPrice: shadowResult.proposedFillPrice,
    deviationPct: shadowResult.deviationPct,
    quoteAsOf: shadowResult.quoteAsOf,
    quoteSource: shadowResult.quoteSource,
    quoteSnapshotId: shadowResult.quoteSnapshotId,
    priceSnapshotId: shadowResult.priceSnapshotId,
    priceConfidence: shadowResult.priceConfidence,
    priceAgeSec: shadowResult.priceAgeSec,
    validation: shadowResult.tradePlanValid === true ? 'VERIFIED' : undefined,
    signalType: input.trade.profileType ?? 'B',
    watchlistSource: input.trade.watchlistSource,
    mode: 'SHADOW',
    liveOrderPlaced: false,
  };
  await input.deps.notifyFilled(notification);
  return 'SENT';
}

export async function executeShadowBuyOrder(
  input: ShadowBuyExecutorInput,
  deps: ShadowBuyExecutorDeps = defaultDeps,
): Promise<ShadowBuyExecutionResult> {
  const statusWrites: TradeSignalStatusWriteResult[] = [];
  let orderIntent: OrderIntent | undefined;
  let shadowOrder: ShadowOrder | undefined;
  let paperFill: PaperFill | undefined;
  console.log(
    `[SHADOW_EXECUTION_START] ${input.stockName}(${input.stockCode}) price=${input.currentPrice}`,
  );

  if (!input.approvalPolicy.executionAllowed) {
    return rejectShadow(input, input.approvalPolicy.reason, statusWrites);
  }
  console.log(
    `[SHADOW_SIGNAL_APPROVED] symbol=${input.stockCode} tradeId=${input.trade.id} ` +
      'mode=SHADOW liveOrderPlaced=false executionImpact=NONE',
  );

  const lifecycleRegistration = registerShadowBuyLifecycle({
    trade: input.trade,
    allTrades: deps.loadShadowTrades(),
    strategy: input.logEvent,
  });
  if (!lifecycleRegistration.ok) {
    const message = `${lifecycleRegistration.logTags.join(' ')} symbol=${input.stockCode} ` +
      `key=${lifecycleRegistration.key} existingTradeId=${lifecycleRegistration.existingTradeId} ` +
      `existingStatus=${lifecycleRegistration.existingStatus} executionImpact=NONE`;
    console.warn(message);
    appendShadowExecutorLogSafe(
      deps,
      {
        event: 'SHADOW_DUPLICATE_BUY_BLOCKED',
        code: input.stockCode,
        tradeId: input.trade.id,
        duplicateKey: lifecycleRegistration.key,
        existingTradeId: lifecycleRegistration.existingTradeId,
        existingStatus: lifecycleRegistration.existingStatus,
        existingRawStatus: lifecycleRegistration.existingRawStatus,
        counterfactualRecorded: true,
        counterfactualReason: 'SHADOW_DUPLICATE_BUY_BLOCKED',
        telegramSuppressed: true,
        executionImpact: 'NONE',
      },
      {
        tradeId: input.trade.id,
        stockCode: input.stockCode,
        event: 'SHADOW_DUPLICATE_BUY_BLOCKED',
      },
    );
    input.trade.status = 'REJECTED';
    input.stateMachine?.transition('DUPLICATE_BLOCKED', 'duplicate shadow buy blocked', {
      duplicateKey: lifecycleRegistration.key,
      existingTradeId: lifecycleRegistration.existingTradeId,
      existingStatus: lifecycleRegistration.existingStatus,
    });
    return {
      outcome: 'SHADOW_REJECTED',
      reason: 'SHADOW_DUPLICATE_BUY_BLOCKED',
      statusWrites,
    };
  }
  console.log(
    `${lifecycleRegistration.logTags.join(' ')} symbol=${input.stockCode} ` +
      `key=${lifecycleRegistration.registration.key} status=${lifecycleRegistration.registration.lifecycleStatus} ` +
      `executionImpact=NONE`,
  );
  appendShadowExecutorLogSafe(
    deps,
    {
      event: 'SHADOW_SIGNAL_LIFECYCLE_REGISTERED',
      code: input.stockCode,
      tradeId: input.trade.id,
      lifecycleKey: lifecycleRegistration.registration.key,
      lifecycleStatus: lifecycleRegistration.registration.lifecycleStatus,
      executionImpact: 'NONE',
    },
    {
      tradeId: input.trade.id,
      stockCode: input.stockCode,
      event: 'SHADOW_SIGNAL_LIFECYCLE_REGISTERED',
    },
  );

  orderIntent = makeOrderIntent(input);
  console.log(formatOrderIntentCreatedLog(orderIntent));
  console.log(formatBuyAllowedPipelineAdvancedLog({
    snapshotId: orderIntent.snapshotId,
    symbol: input.stockCode,
    nextStage: 'ORDER_INTENT_CREATED',
  }));

  statusWrites.push(deps.markAutoTradeReady({
    signalId: input.signalId,
    reason: 'SHADOW order creation approved',
  }));

  appendShadowExecutorLogSafe(
    deps,
    { event: input.logEvent, ...input.trade },
    {
      tradeId: input.trade.id,
      stockCode: input.stockCode,
      event: input.logEvent,
    },
  );
  shadowOrder = createShadowOrder(orderIntent);
  updateShadowBuyLifecycleStatus({
    key: shadowBuyLifecycleKey(input.trade),
    tradeId: input.trade.id,
    status: 'ORDER_PENDING',
  });
  input.stateMachine?.transition('SHADOW_ORDER_CREATED', 'shadow order created');
  logStatusChange(orderIntent, 'ORDER_CREATED', 'shadow order created');
  console.log(formatShadowOrderCreatedLog(shadowOrder));

  const shadowResult = await deps.executeShadowBuy({
    trade: input.trade,
    allTrades: mergeTradeForPaperFill(input.trade, deps.loadShadowTrades),
    proposedFillPrice: input.entryPrice,
    marketSession: input.marketSession,
    regime: input.regime,
    maxPositions: input.maxPositions,
    approvedAtIso: new Date().toISOString(),
  });
  deps.recordShadowExecutionOutcome(shadowResult.outcome);

  if (shadowResult.outcome !== 'EXECUTED' && shadowResult.outcome !== 'ALREADY_FILLED') {
    const nextStatus: OrderIntentStatus = shadowResult.orderIntentStatus === 'WAIT_PRICE_VALID'
      ? 'WAIT_PRICE_VALID'
      : shadowResult.outcome === 'SHADOW_SLOT_FULL_AT_FILL_TIME'
        ? 'WAIT_SLOT_AVAILABLE'
        : 'REJECTED';
    logStatusChange(orderIntent, nextStatus, shadowResult.outcome);
    failPipeline({
      intent: orderIntent,
      stage: 'SHADOW_PAPER_FILLED',
      reason: shadowResult.outcome,
    });
    return rejectShadow(
      input,
      `SHADOW_PAPER_FILL_REJECTED: ${shadowResult.outcome}: ${shadowResult.reason}`,
      statusWrites,
      shadowResult,
      orderIntent,
    );
  }

  const fillGuard = assertPipelineStage({
    requiredPreviousStage: 'SHADOW_ORDER_CREATED',
    currentStage: 'SHADOW_PAPER_FILLED',
    orderIntentId: orderIntent.orderIntentId,
    symbol: input.stockCode,
    exists: shadowOrder !== undefined,
  });
  if (!fillGuard.ok) {
    if (fillGuard.log) console.error(fillGuard.log);
    console.error(formatBuyAllowedPipelineBreakLog({
      snapshotId: orderIntent.snapshotId,
      symbol: input.stockCode,
      missingStage: 'SHADOW_ORDER_CREATED',
    }));
    failPipeline({ intent: orderIntent, stage: 'SHADOW_PAPER_FILLED', reason: 'SHADOW_ORDER_MISSING' });
    logStatusChange(orderIntent, 'FAILED', 'SHADOW_ORDER_MISSING');
    return rejectShadow(input, 'SHADOW_ORDER_MISSING_BEFORE_PAPER_FILL', statusWrites, shadowResult, orderIntent);
  }

  paperFill = createPaperFill({
    shadowOrder,
    fillId: shadowResult.fillId ?? `${input.trade.id}-fill`,
    fillPrice: shadowResult.fillPrice ?? input.entryPrice,
    quantity: input.trade.quantity,
    priceSnapshotId: shadowResult.priceSnapshotId,
    filledAt: shadowResult.executedAtIso,
  });
  updateShadowBuyLifecycleStatus({
    key: shadowBuyLifecycleKey(input.trade),
    tradeId: input.trade.id,
    status: 'PAPER_FILLED',
  });
  input.stateMachine?.transition('SHADOW_PAPER_FILLED', 'shadow paper-fill recorded', {
    outcome: shadowResult.outcome,
    fillId: shadowResult.fillId,
  });
  logStatusChange(orderIntent, 'PAPER_FILLED', 'shadow paper-fill recorded');
  console.log(formatShadowPaperFilledLog(paperFill));

  const positionGuard = assertPipelineStage({
    requiredPreviousStage: 'SHADOW_PAPER_FILLED',
    currentStage: 'POSITION_STATE_OPENED',
    orderIntentId: orderIntent.orderIntentId,
    symbol: input.stockCode,
    exists: paperFill !== undefined,
  });
  if (!positionGuard.ok && positionGuard.log) console.error(positionGuard.log);
  if (!hasOpenShadowPosition(input.trade)) {
    failPipeline({
      intent: orderIntent,
      stage: 'POSITION_STATE_OPENED',
      reason: 'SHADOW_POSITION_OPEN_FAILED_AFTER_PAPER_FILL',
    });
    logStatusChange(orderIntent, 'FAILED', 'SHADOW_POSITION_OPEN_FAILED_AFTER_PAPER_FILL');
    emitOperationalWarn({
      code: 'P0_SHADOW_POSITION_OPEN_FAILED',
      message: 'Shadow BUY paper-fill completed but no open position was detected',
      context: {
        tradeId: input.trade.id,
        stockCode: input.stockCode,
        stockName: input.stockName,
        tradeStatus: input.trade.status,
        shadowOutcome: shadowResult.outcome,
      },
    });
    return rejectShadow(
      input,
      'SHADOW_POSITION_OPEN_FAILED_AFTER_PAPER_FILL',
      statusWrites,
      shadowResult,
      orderIntent,
    );
  }

  input.stateMachine?.transition('SHADOW_POSITION_OPENED', 'shadow position opened', {
    outcome: shadowResult.outcome,
    fillId: shadowResult.fillId,
  });
  console.log(
    `[SHADOW_POSITION_OPENED] symbol=${input.stockCode} tradeId=${input.trade.id} ` +
      `fillId=${shadowResult.fillId ?? 'N/A'} mode=SHADOW executionImpact=NONE`,
  );
  updateShadowBuyLifecycleStatus({
    key: shadowBuyLifecycleKey(input.trade),
    tradeId: input.trade.id,
    status: 'OPEN',
  });
  statusWrites.push(deps.markFilled({
    signalId: input.signalId,
    reason: 'SHADOW paper-fill position opened',
    important: false,
  }));
  logStatusChange(orderIntent, 'POSITION_OPENED', 'shadow position opened');
  const openedPositionState: PositionState = {
    positionId: input.trade.id,
    orderIntentId: orderIntent.orderIntentId,
    tradingDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
    symbol: input.stockCode.padStart(6, '0'),
    name: input.stockName,
    mode: 'SHADOW',
    status: 'OPEN',
    quantity: getRemainingQty(input.trade),
    avgEntryPrice: shadowResult.fillPrice ?? input.trade.shadowEntryPrice ?? input.entryPrice,
    currentPrice: shadowResult.currentPrice ?? input.currentPrice,
    marketValue: (shadowResult.currentPrice ?? input.currentPrice) * getRemainingQty(input.trade),
    unrealizedPnL: ((shadowResult.currentPrice ?? input.currentPrice) - (shadowResult.fillPrice ?? input.trade.shadowEntryPrice ?? input.entryPrice)) * getRemainingQty(input.trade),
    unrealizedPnLPct: (shadowResult.fillPrice ?? input.trade.shadowEntryPrice ?? input.entryPrice) > 0
      ? (((shadowResult.currentPrice ?? input.currentPrice) / (shadowResult.fillPrice ?? input.trade.shadowEntryPrice ?? input.entryPrice)) - 1) * 100
      : 0,
    stopLoss: input.trade.stopLoss,
    targetPrice: input.trade.targetPrice,
    openedAt: shadowResult.executedAtIso,
    updatedAt: shadowResult.executedAtIso,
    source: 'SHADOW_LEDGER',
    sourceConfidence: 'VERIFIED',
    priceSnapshotId: shadowResult.priceSnapshotId,
    entryPriceSource: shadowResult.quoteSource,
    entryPriceConfidence: shadowResult.priceConfidence ?? shadowResult.quoteConfidence,
    relatedOrderIds: [orderIntent.orderIntentId],
    relatedSignalIds: input.signalId ? [input.signalId] : [],
    lifecycleOutcome: 'SHADOW_POSITION_OPENED',
  };
  console.log(formatPositionStateOpenedLog(openedPositionState));
  appendShadowExecutorLogSafe(deps, {
    event: 'PAPER_TRADE_LEDGER_RECORDED',
    code: input.stockCode,
    tradeId: input.trade.id,
    orderIntentId: orderIntent.orderIntentId,
    outcome: shadowResult.outcome,
    fillId: shadowResult.fillId,
  }, {
    tradeId: input.trade.id,
    stockCode: input.stockCode,
    event: 'PAPER_TRADE_LEDGER_RECORDED',
  });
  console.log(formatPaperTradeLedgerRecordedLog({
    tradeId: input.trade.id,
    orderIntentId: orderIntent.orderIntentId,
    symbol: input.stockCode,
    side: 'BUY',
    quantity: paperFill.quantity,
    fillPrice: paperFill.fillPrice,
  }));
  console.log(formatVirtualAccountUpdatedLog({
    orderIntentId: orderIntent.orderIntentId,
    symbol: input.stockCode,
    side: 'BUY',
    holdingBefore: 0,
    holdingAfter: getRemainingQty(input.trade),
    mode: 'SHADOW',
  }));
  logStatusChange(orderIntent, 'COMPLETED', 'position state opened and ledger recorded');

  let telegramStatus: 'SENT' | 'SUPPRESSED' | 'NOT_REQUESTED' = 'NOT_REQUESTED';
  try {
    telegramStatus = await notifyFilledAfterPositionOpen({
      deps,
      trade: input.trade,
      stockCode: input.stockCode,
      stockName: input.stockName,
      shadowResult,
      fill: paperFill,
    });
  } catch (error) {
    telegramStatus = 'SUPPRESSED';
    failPipeline({
      intent: orderIntent,
      stage: 'DISPLAY_STATE_RENDERED',
      reason: `TELEGRAM_SEND_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  console.log(formatOrderPipelineCompletedLog({
    orderIntentId: orderIntent.orderIntentId,
    symbol: input.stockCode,
    mode: 'SHADOW',
    telegramStatus,
  }));

  return {
    outcome: 'SHADOW_POSITION_OPENED',
    reason: 'SHADOW_POSITION_OPENED',
    shadowExecutionResult: shadowResult,
    orderIntent,
    statusWrites,
  };
}
