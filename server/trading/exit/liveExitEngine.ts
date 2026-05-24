// @responsibility Live exit evaluation with real sell submission boundary.

import { placeKisSellOrder } from '../../clients/kisClient.js';
import type { SellOrderResult } from '../../clients/kisClient/types.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import { emitExitOperationalWarn } from './exitOperationalWarn.js';
import { resolveR6LiveEmergencyExitPolicy } from './policies/r6LiveEmergencyExitPolicy.js';
import type { ExitDecision } from './exitTypes.js';

export interface LiveExitEngineInput {
  trade: ServerShadowTrade;
  currentRegime: string;
  currentPrice: number;
  returnPct: number;
  marketSessionState?: string;
  isKrxTradingOpen?: boolean;
  kisOrderAllowed?: boolean;
  liveOrderAllowed?: boolean;
  now?: Date;
}

export interface LiveExitEngineDeps {
  placeKisSellOrder?: typeof placeKisSellOrder;
  resolveR6LiveEmergencyExitPolicy?: typeof resolveR6LiveEmergencyExitPolicy;
}

export async function evaluateLiveExit(
  input: LiveExitEngineInput,
  deps: LiveExitEngineDeps = {},
): Promise<ExitDecision> {
  const resolvePolicy = deps.resolveR6LiveEmergencyExitPolicy ?? resolveR6LiveEmergencyExitPolicy;
  const policy = resolvePolicy(input);
  if (policy.kind !== 'LIVE_SELL_INTENT') {
    return policy;
  }

  const submitSell = deps.placeKisSellOrder ?? placeKisSellOrder;
  try {
    const order = await submitSell(input.trade.stockCode, input.trade.stockName, policy.qty, 'STOP_LOSS');
    return normalizeSellOrderResult(policy.reason, policy.qty, order);
  } catch (error) {
    emitExitOperationalWarn({
      code: 'P0_LIVE_EXIT_BLOCKED',
      message: 'Live exit sell order submission failed',
      context: {
        tradeId: input.trade.id,
        stockCode: input.trade.stockCode,
        qty: policy.qty,
        reason: policy.reason,
      },
      cause: error,
    });
    return {
      kind: 'EXIT_FAILED',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeSellOrderResult(reason: string, qty: number, order: SellOrderResult): ExitDecision {
  if (order.placed && order.ordNo) {
    return {
      kind: 'LIVE_SELL_SUBMITTED',
      reason,
      qty,
      ordNo: order.ordNo,
    };
  }

  emitExitOperationalWarn({
    code: 'P0_LIVE_EXIT_BLOCKED',
    message: 'Live exit sell order was blocked by order gateway',
    context: {
      reason,
      qty,
      outcome: order.outcome,
      failureReason: order.failureReason,
    },
  });
  return {
    kind: 'EXIT_FAILED',
    reason: order.failureReason ?? order.outcome ?? 'LIVE_EXIT_ORDER_BLOCKED',
  };
}
