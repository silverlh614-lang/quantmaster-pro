import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import {
  appendShadowLog,
  loadShadowTrades,
} from '../../persistence/shadowTradeRepo.js';
import { channelShadowBuyFilled } from '../../alerts/channelPipeline.js';
import {
  executeShadowBuy,
  recordShadowExecutionOutcome,
  type ExecuteShadowBuyInput,
  type ShadowExecutionResult,
} from '../shadowExecutionPipeline.js';
import type { BuyApprovalPolicyResult } from './buyApprovalPolicy.js';
import type { BuySignalStateMachine } from './buySignalStateMachine.js';
import { emitOperationalWarn } from './operationalWarn.js';
import { markAutoTradeReady, markFilled, type TradeSignalStatusWriteResult } from './tradeSignalStatusWriter.js';

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
): ShadowBuyExecutionResult {
  input.trade.status = 'REJECTED';
  input.stateMachine?.transition('SHADOW_REJECTED', reason);
  return {
    outcome: 'SHADOW_REJECTED',
    reason,
    ...(shadowExecutionResult ? { shadowExecutionResult } : {}),
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

export async function executeShadowBuyOrder(
  input: ShadowBuyExecutorInput,
  deps: ShadowBuyExecutorDeps = defaultDeps,
): Promise<ShadowBuyExecutionResult> {
  const statusWrites: TradeSignalStatusWriteResult[] = [];
  console.log(
    `[SHADOW_EXECUTION_START] ${input.stockName}(${input.stockCode}) price=${input.currentPrice}`,
  );

  if (!input.approvalPolicy.executionAllowed) {
    return rejectShadow(input, input.approvalPolicy.reason, statusWrites);
  }

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
  input.stateMachine?.transition('SHADOW_ORDER_CREATED', 'shadow order created');
  console.log(`[SHADOW_ORDER_CREATED] ${input.stockName}(${input.stockCode}) tradeId=${input.trade.id}`);

  const shadowResult = await deps.executeShadowBuy({
    trade: input.trade,
    allTrades: mergeTradeForPaperFill(input.trade, deps.loadShadowTrades),
    proposedFillPrice: input.entryPrice,
    marketSession: input.marketSession,
    regime: input.regime,
    maxPositions: input.maxPositions,
    approvedAtIso: new Date().toISOString(),
    notifyFilled: deps.notifyFilled,
  });
  deps.recordShadowExecutionOutcome(shadowResult.outcome);

  if (shadowResult.outcome !== 'EXECUTED' && shadowResult.outcome !== 'ALREADY_FILLED') {
    return rejectShadow(
      input,
      `SHADOW_PAPER_FILL_REJECTED: ${shadowResult.outcome}: ${shadowResult.reason}`,
      statusWrites,
      shadowResult,
    );
  }

  input.stateMachine?.transition('SHADOW_PAPER_FILLED', 'shadow paper-fill recorded', {
    outcome: shadowResult.outcome,
    fillId: shadowResult.fillId,
  });
  console.log(
    `[SHADOW_PAPER_FILLED] ${input.stockName}(${input.stockCode}) tradeId=${input.trade.id} outcome=${shadowResult.outcome}`,
  );

  if (!hasOpenShadowPosition(input.trade)) {
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
    );
  }

  input.stateMachine?.transition('SHADOW_POSITION_OPENED', 'shadow position opened', {
    outcome: shadowResult.outcome,
    fillId: shadowResult.fillId,
  });
  statusWrites.push(deps.markFilled({
    signalId: input.signalId,
    reason: 'SHADOW paper-fill position opened',
    important: false,
  }));
  console.log(`[SHADOW_POSITION_OPENED] ${input.stockName}(${input.stockCode}) tradeId=${input.trade.id}`);
  appendShadowExecutorLogSafe(deps, {
    event: 'SHADOW_LEDGER_RECORDED',
    code: input.stockCode,
    tradeId: input.trade.id,
    outcome: shadowResult.outcome,
    fillId: shadowResult.fillId,
  }, {
    tradeId: input.trade.id,
    stockCode: input.stockCode,
    event: 'SHADOW_LEDGER_RECORDED',
  });
  console.log(`[SHADOW_LEDGER_RECORDED] ${input.stockName}(${input.stockCode}) tradeId=${input.trade.id}`);

  return {
    outcome: 'SHADOW_POSITION_OPENED',
    reason: 'SHADOW_POSITION_OPENED',
    shadowExecutionResult: shadowResult,
    statusWrites,
  };
}
