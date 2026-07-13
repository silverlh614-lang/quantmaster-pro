/**
 * @responsibility 승인된 매수 신호를 KIS 실주문으로 집행하며 체결 모니터에 등록하는 실행기를 제공한다.
 */

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import type { ApprovalAction } from '../../telegram/buyApproval.js';
import { fetchAccountBalance, submitBuyOrder } from '../../clients/kisClient.js';
import type { OrderGatewayResult } from '../../clients/kisClient.js';
import { appendShadowLog } from '../../persistence/shadowTradeRepo.js';
import { assertSafeOrder } from '../preOrderGuard.js';
import { fillMonitor } from '../fillMonitor.js';
import type { PendingOrder } from '../fillMonitor.js';
import { getSmokeTestLastFailedReason, getSmokeTestLiveBlocked } from '../../state.js';
import type { BuyApprovalPolicyResult } from './buyApprovalPolicy.js';
import type { BuySignalStateMachine } from './buySignalStateMachine.js';
import { markAutoTradeReady, markOrderPending, type TradeSignalStatusWriteResult } from './tradeSignalStatusWriter.js';
import { emitOperationalWarn } from './operationalWarn.js';

type LiveBuyExecutionOutcome = 'LIVE_ORDER_SUBMITTED' | 'LIVE_REJECTED';

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
  submitBuyOrder: typeof submitBuyOrder;
  assertSafeOrder: typeof assertSafeOrder;
  appendShadowLog: typeof appendShadowLog;
  addFillMonitorOrder: (order: Omit<PendingOrder, 'pollCount' | 'status'>) => void;
  getSmokeTestLiveBlocked: typeof getSmokeTestLiveBlocked;
  getSmokeTestLastFailedReason: typeof getSmokeTestLastFailedReason;
  markAutoTradeReady: typeof markAutoTradeReady;
  markOrderPending: typeof markOrderPending;
}

const defaultDeps: LiveBuyExecutorDeps = {
  fetchAccountBalance,
  submitBuyOrder,
  assertSafeOrder,
  appendShadowLog,
  addFillMonitorOrder: (order) => fillMonitor.addOrder(order),
  getSmokeTestLiveBlocked,
  getSmokeTestLastFailedReason,
  markAutoTradeReady,
  markOrderPending,
};

const inflightLiveBuyOrders = new Set<string>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeOrderGatewayResult(result: OrderGatewayResult): string {
  switch (result.kind) {
    case 'SUBMITTED':
      return 'SUBMITTED';
    case 'CANCEL_SUBMITTED':
      return 'CANCEL_SUBMITTED';
    case 'SKIPPED_KIS_NOT_CONFIGURED':
      return 'SKIPPED_KIS_NOT_CONFIGURED executionImpact=LIVE_ORDER_BLOCKED';
    case 'REJECTED':
    case 'FAILED_FATAL':
      return `${result.kind}: ${result.reason} executionImpact=${result.executionImpact}`;
    case 'FAILED_RETRYABLE':
    case 'CANCEL_FAILED':
      return `${result.kind}: ${result.reason}`;
  }
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

function appendLiveShadowLogSafe(
  deps: LiveBuyExecutorDeps,
  input: LiveBuyExecutorInput,
  ordNo: string,
): void {
  try {
    deps.appendShadowLog({
      event: input.logEvent,
      code: input.stockCode,
      price: input.currentPrice,
      ordNo,
    });
  } catch (error) {
    emitOperationalWarn({
      code: 'P2_LIVE_BUY_SHADOW_LOG_WRITE_FAILED',
      severity: 'P2',
      message: 'LIVE buy shadow log write failed after KIS submission; lifecycle continues',
      context: {
        tradeId: input.trade.id,
        stockCode: input.stockCode,
        ordNo,
      },
      cause: error,
    });
  }
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

  let orderResult: OrderGatewayResult;
  try {
    orderResult = await deps.submitBuyOrder({
      stockCode: input.stockCode,
      quantity: input.quantity,
      orderType: 'MARKET',
      correlationId: input.signalId,
      orderIntentId: input.trade.id,
    });
  } catch (error) {
    inflightLiveBuyOrders.delete(input.trade.id);
    return rejectLive(input, `LIVE_ORDER_GATEWAY_THROW: ${describeError(error)}`, statusWrites);
  }

  if (orderResult.kind !== 'SUBMITTED') {
    inflightLiveBuyOrders.delete(input.trade.id);
    return rejectLive(input, `LIVE_ORDER_GATEWAY_${describeOrderGatewayResult(orderResult)}`, statusWrites);
  }

  const ordNo = orderResult.ordNo;
  input.trade.status = 'ORDER_SUBMITTED';
  input.stateMachine?.transition('LIVE_ORDER_SUBMITTED', 'KIS live buy order submitted', { ordNo });
  appendLiveShadowLogSafe(deps, input, ordNo);
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
