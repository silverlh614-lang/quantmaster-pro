/**
 * @responsibility KIS 주문 게이트웨이 — 매수·매도·OCO·취소 주문 전송을 단일 통로로 집행한다.
 */

import { kisGet, kisPost } from '../http.js';
import { KIS_IS_REAL, selectCcldTrId } from '../constants.js';
import { buildKisBuyOrderRequest } from './kisBuyOrderAdapter.js';
import { buildKisSellOrderRequest, buildKisCancelOrderRequest } from './kisSellOrderAdapter.js';
import { buildKisOcoOrderRequest } from './kisOcoOrderAdapter.js';
import { classifyKisOrderError, classifyMissingKisConfig } from './kisOrderErrorClassifier.js';
import { emitKisOrderOperationalWarn } from './kisOrderOperationalWarn.js';
import { normalizeKisOrderError, normalizeKisOrderResult } from './kisOrderResultNormalizer.js';
import type {
  KisBuyOrderIntent,
  KisCancelOrderIntent,
  KisOcoOrderIntent,
  KisOrderGatewayDeps,
  KisOrderKind,
  KisOrderStatusQueryIntent,
  KisSellOrderIntent,
  OrderGatewayMetadata,
  OrderGatewayResult,
} from './kisOrderTypes.js';

const ORDER_CASH_PATH = '/uapi/domestic-stock/v1/trading/order-cash';

const defaultDeps: KisOrderGatewayDeps = {
  kisPost,
  kisGet,
  isKisConfigured: () => Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET),
  isReal: KIS_IS_REAL,
};

function warnCodeForOrderKind(orderKind: KisOrderKind): 'P0_KIS_BUY_ORDER_BLOCKED' | 'P0_KIS_SELL_ORDER_BLOCKED' | 'P0_KIS_OCO_ORDER_FAILED' {
  if (orderKind === 'BUY_MARKET' || orderKind === 'BUY_LIMIT') return 'P0_KIS_BUY_ORDER_BLOCKED';
  if (orderKind === 'OCO_STOP_LOSS' || orderKind === 'OCO_TAKE_PROFIT') return 'P0_KIS_OCO_ORDER_FAILED';
  return 'P0_KIS_SELL_ORDER_BLOCKED';
}

function emitBlockedIfNeeded(result: OrderGatewayResult, orderKind: KisOrderKind, context: Record<string, unknown>): void {
  if (result.kind === 'SUBMITTED' || result.kind === 'CANCEL_SUBMITTED') return;
  if (result.kind === 'CANCEL_FAILED') return;

  if (result.kind === 'FAILED_FATAL') {
    emitKisOrderOperationalWarn({
      code: 'P0_KIS_ORDER_FATAL',
      message: 'KIS order failed fatally',
      context: {
        orderKind,
        reason: result.reason,
        executionImpact: result.executionImpact,
        ...context,
      },
      cause: result.raw,
    });
  }

  emitKisOrderOperationalWarn({
    code: warnCodeForOrderKind(orderKind),
    message: 'Live KIS order was not submitted',
    context: {
      orderKind,
      resultKind: result.kind,
      executionImpact: 'LIVE_ORDER_BLOCKED',
      ...('reason' in result ? { reason: result.reason } : {}),
      ...context,
    },
    cause: 'raw' in result ? result.raw : undefined,
  });
}

function metadataFrom(input: OrderGatewayMetadata): OrderGatewayMetadata {
  return {
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.orderIntentId ? { orderIntentId: input.orderIntentId } : {}),
  };
}

async function submitOrderRequest(input: {
  request: {
    trId: string;
    apiPath: string;
    body: Record<string, string>;
    orderKind: KisOrderKind;
  };
  metadata: OrderGatewayMetadata;
  context: Record<string, unknown>;
  deps: KisOrderGatewayDeps;
}): Promise<OrderGatewayResult> {
  if (!input.deps.isKisConfigured()) {
    const result = normalizeKisOrderError(classifyMissingKisConfig(), input.metadata);
    emitBlockedIfNeeded(result, input.request.orderKind, input.context);
    return result;
  }

  try {
    const raw = await input.deps.kisPost(input.request.trId, input.request.apiPath, input.request.body);
    const result = normalizeKisOrderResult({
      raw,
      orderKind: input.request.orderKind,
      context: input.context,
      ...input.metadata,
    });
    emitBlockedIfNeeded(result, input.request.orderKind, input.context);
    return result;
  } catch (error) {
    const result = normalizeKisOrderError(classifyKisOrderError(error), input.metadata);
    emitBlockedIfNeeded(result, input.request.orderKind, input.context);
    return result;
  }
}

export async function submitBuyOrder(
  input: KisBuyOrderIntent,
  deps: KisOrderGatewayDeps = defaultDeps,
): Promise<OrderGatewayResult> {
  const request = buildKisBuyOrderRequest(input);
  return submitOrderRequest({
    request,
    metadata: metadataFrom(input),
    context: {
      side: 'BUY',
      symbol: input.stockCode,
      quantity: input.quantity,
    },
    deps,
  });
}

export async function submitSellOrder(
  input: KisSellOrderIntent,
  deps: KisOrderGatewayDeps = defaultDeps,
): Promise<OrderGatewayResult> {
  const request = buildKisSellOrderRequest(input);
  return submitOrderRequest({
    request,
    metadata: metadataFrom(input),
    context: {
      side: 'SELL',
      symbol: input.stockCode,
      stockName: input.stockName,
      quantity: input.quantity,
      reason: input.reason,
    },
    deps,
  });
}

export async function submitOcoOrder(
  input: KisOcoOrderIntent,
  deps: KisOrderGatewayDeps = defaultDeps,
): Promise<OrderGatewayResult> {
  const request = buildKisOcoOrderRequest(input);
  return submitOrderRequest({
    request,
    metadata: metadataFrom(input),
    context: {
      side: 'SELL',
      symbol: input.stockCode,
      stockName: input.stockName,
      quantity: input.quantity,
      leg: input.leg,
      syntheticOco: true,
    },
    deps,
  });
}

export async function cancelOrder(
  input: KisCancelOrderIntent,
  deps: KisOrderGatewayDeps = defaultDeps,
): Promise<OrderGatewayResult> {
  const request = buildKisCancelOrderRequest({
    stockCode: input.stockCode,
    ordNo: input.ordNo,
    quantity: input.quantity,
    isReal: deps.isReal,
  });

  if (!deps.isKisConfigured()) {
    return {
      kind: 'CANCEL_FAILED',
      reason: 'KIS_APP_KEY_OR_SECRET_MISSING',
      ...metadataFrom(input),
    };
  }

  try {
    const raw = await deps.kisPost(request.trId, request.apiPath, request.body);
    return normalizeKisOrderResult({
      raw,
      orderKind: 'CANCEL',
      fallbackOrdNo: input.ordNo,
      context: {
        side: 'SELL',
        symbol: input.stockCode,
        ordNo: input.ordNo,
      },
      ...metadataFrom(input),
    });
  } catch (error) {
    const classified = classifyKisOrderError(error);
    return {
      kind: 'CANCEL_FAILED',
      reason: classified.reason,
      raw: classified.raw,
      ...metadataFrom(input),
    };
  }
}

export async function queryOrderStatus(
  input: KisOrderStatusQueryIntent,
  deps: KisOrderGatewayDeps = defaultDeps,
): Promise<OrderGatewayResult> {
  if (!deps.isKisConfigured()) {
    return normalizeKisOrderError(classifyMissingKisConfig(), metadataFrom(input));
  }

  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const raw = await deps.kisGet(selectCcldTrId(deps.isReal), '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', {
      CANO: process.env.KIS_ACCOUNT_NO ?? '',
      ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
      INQR_STRT_DT: today,
      INQR_END_DT: today,
      SLL_BUY_DVSN_CD: '00',
      INQR_DVSN: '00',
      PDNO: input.stockCode.padStart(6, '0'),
      CCLD_DVSN: '00',
      ORD_GNO_BRNO: '',
      ODNO: input.ordNo,
      INQR_DVSN_3: '00',
      INQR_DVSN_1: '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    });
    return normalizeKisOrderResult({
      raw,
      orderKind: 'QUERY_STATUS',
      fallbackOrdNo: input.ordNo,
      context: {
        symbol: input.stockCode,
        ordNo: input.ordNo,
        apiPath: ORDER_CASH_PATH,
      },
      ...metadataFrom(input),
    });
  } catch (error) {
    return normalizeKisOrderError(classifyKisOrderError(error), metadataFrom(input));
  }
}
