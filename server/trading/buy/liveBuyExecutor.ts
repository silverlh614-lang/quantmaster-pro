import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import type { ApprovalAction } from '../../telegram/buyApproval.js';
import { fetchAccountBalance, placeKisMarketBuyOrder } from '../../clients/kisClient.js';
import { appendShadowLog } from '../../persistence/shadowTradeRepo.js';
import { assertSafeOrder } from '../preOrderGuard.js';
import { fillMonitor } from '../fillMonitor.js';
import { getSmokeTestLastFailedReason, getSmokeTestLiveBlocked } from '../../state.js';
import type { BuyApprovalPolicyResult } from './buyApprovalPolicy.js';
import type { BuySignalStateMachine } from './buySignalStateMachine.js';
import { markAutoTradeReady, markOrderPending, type TradeSignalStatusWriteResult } from './tradeSignalStatusWriter.js';

export type LiveBuyExecutionOutcome = 'LIVE_ORDER_SUBMITTED' | 'LIVE_REJECTED';

export interface LiveBuyExecutorInput {
  trade: ServerShadowTrade;
  stockCode: string;
  stockName: string;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  currentPrice: number;
  logEvent: string;
  signalId?: string;
  approvalPolicy: BuyApprovalPolicyResult;
  stateMachine?: BuySignalStateMachine;
}

export interface LiveBuyExecutionResult {
  outcome: LiveBuyExecutionOutcome;
  ordNo: string | null;
  reason: string;
  statusWrites: TradeSignalStatusWriteResult[];
}

export interface LiveBuyExecutorDeps {
  fetchAccountBalance: typeof fetchAccountBalance;
  placeKisMarketBuyOrder: typeof placeKisMarketBuyOrder;
  assertSafeOrder: typeof assertSafeOrder;
  appendShadowLog: typeof appendShadowLog;
  addFillMonitorOrder: typeof fillMonitor.addOrder;
  getSmokeTestLiveBlocked: typeof getSmokeTestLiveBlocked;
  getSmokeTestLastFailedReason: typeof getSmokeTestLastFailedReason;
  markAutoTradeReady: typeof markAutoTradeReady;
  markOrderPending: typeof markOrderPending;
}

const defaultDeps: LiveBuyExecutorDeps = {
  fetchAccountBalance,
  placeKisMarketBuyOrder,
  assertSafeOrder,
  appendShadowLog,
  addFillMonitorOrder: fillMonitor.addOrder.bind(fillMonitor),
  getSmokeTestLiveBlocked,
  getSmokeTestLastFailedReason,
  markAutoTradeReady,
  markOrderPending,
};

const inflightLiveBuyOrders = new Set<string>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rejectLive(
  input: LiveBuyExecutorInput,
  reason: string,
  statusWrites: TradeSignalStatusWriteResult[] = [],
): LiveBuyExecutionResult {
  input.trade.status = 'REJECTED';
  input.stateMachine?.transition('LIVE_REJECTED', reason);
  return {
    outcome: 'LIVE_REJECTED',
    ordNo: null,
    reason,
    statusWrites,
  };
}

export async function executeLiveBuy(
  input: LiveBuyExecutorInput,
  deps: LiveBuyExecutorDeps = defaultDeps,
): Promise<LiveBuyExecutionResult> {
  const statusWrites: TradeSignalStatusWriteResult[] = [];

  if (!input.approvalPolicy.executionAllowed) {
    return rejectLive(input, input.approvalPolicy.reason, statusWrites);
  }

  input.stateMachine?.transition('LIVE_ORDER_PENDING', 'live order accepted by executor');

  if (deps.getSmokeTestLiveBlocked()) {
    return rejectLive(
      input,
      `LIVE_BLOCKED_BY_SMOKE_TEST: ${deps.getSmokeTestLastFailedReason()}`,
      statusWrites,
    );
  }

  if (inflightLiveBuyOrders.has(input.trade.id)) {
    return rejectLive(input, 'LIVE_DUPLICATE_INFLIGHT_TRADE', statusWrites);
  }
  inflightLiveBuyOrders.add(input.trade.id);

  try {
    const totalAssets = await deps.fetchAccountBalance().catch(() => null);
    deps.assertSafeOrder({
      stockCode: input.stockCode,
      stockName: input.stockName,
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      totalAssets,
    });
  } catch (error) {
    inflightLiveBuyOrders.delete(input.trade.id);
    return rejectLive(input, `LIVE_PRE_ORDER_GUARD_REJECTED: ${describeError(error)}`, statusWrites);
  }

  statusWrites.push(deps.markAutoTradeReady({
    signalId: input.signalId,
    reason: 'LIVE order submission pending',
  }));
  statusWrites.push(deps.markOrderPending({
    signalId: input.signalId,
    reason: 'LIVE order pending',
    important: false,
  }));

  let ordNo: string | null = null;
  try {
    ordNo = await deps.placeKisMarketBuyOrder(input.stockCode, input.quantity);
  } catch (error) {
    inflightLiveBuyOrders.delete(input.trade.id);
    return rejectLive(input, `LIVE_ORDER_API_THROW: ${describeError(error)}`, statusWrites);
  }

  if (!ordNo) {
    inflightLiveBuyOrders.delete(input.trade.id);
    return rejectLive(input, 'LIVE_ORDER_API_RETURNED_EMPTY_ORDER_NO', statusWrites);
  }

  input.trade.status = 'ORDER_SUBMITTED';
  input.stateMachine?.transition('LIVE_ORDER_SUBMITTED', 'KIS live buy order submitted', { ordNo });
  deps.appendShadowLog({
    event: input.logEvent,
    code: input.stockCode,
    price: input.currentPrice,
    ordNo,
  });
  deps.addFillMonitorOrder({
    ordNo,
    stockCode: input.stockCode,
    stockName: input.stockName,
    quantity: input.quantity,
    orderPrice: input.entryPrice,
    placedAt: new Date().toISOString(),
    relatedTradeId: input.trade.id,
  });
  inflightLiveBuyOrders.delete(input.trade.id);

  return {
    outcome: 'LIVE_ORDER_SUBMITTED',
    ordNo,
    reason: 'LIVE_ORDER_SUBMITTED',
    statusWrites,
  };
}

export function __resetLiveBuyExecutorForTests(): void {
  inflightLiveBuyOrders.clear();
}

export function mapLiveExecutionOutcomeToApprovalAction(
  outcome: LiveBuyExecutionOutcome,
): ApprovalAction {
  return outcome === 'LIVE_ORDER_SUBMITTED' ? 'APPROVE' : 'SKIP';
}
