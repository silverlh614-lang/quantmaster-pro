export type OrderGatewayExecutionImpact = 'LIVE_ORDER_BLOCKED';

export interface OrderGatewayMetadata {
  correlationId?: string;
  orderIntentId?: string;
}

export type OrderGatewayResult =
  | ({
      kind: 'SUBMITTED';
      ordNo: string;
      raw?: unknown;
    } & OrderGatewayMetadata)
  | ({
      kind: 'SKIPPED_KIS_NOT_CONFIGURED';
      executionImpact: 'LIVE_ORDER_BLOCKED';
    } & OrderGatewayMetadata)
  | ({
      kind: 'REJECTED';
      reason: string;
      executionImpact: 'LIVE_ORDER_BLOCKED';
      raw?: unknown;
    } & OrderGatewayMetadata)
  | ({
      kind: 'FAILED_RETRYABLE';
      reason: string;
      retryAfterMs?: number;
      raw?: unknown;
    } & OrderGatewayMetadata)
  | ({
      kind: 'FAILED_FATAL';
      reason: string;
      executionImpact: 'LIVE_ORDER_BLOCKED';
      raw?: unknown;
    } & OrderGatewayMetadata)
  | ({
      kind: 'CANCEL_SUBMITTED';
      ordNo: string;
      raw?: unknown;
    } & OrderGatewayMetadata)
  | ({
      kind: 'CANCEL_FAILED';
      reason: string;
      raw?: unknown;
    } & OrderGatewayMetadata);

export type KisOrderSide = 'BUY' | 'SELL';

export type KisOrderKind =
  | 'BUY_MARKET'
  | 'BUY_LIMIT'
  | 'SELL_MARKET'
  | 'SELL_LIMIT'
  | 'OCO_STOP_LOSS'
  | 'OCO_TAKE_PROFIT'
  | 'CANCEL'
  | 'QUERY_STATUS';

export interface KisOrderIntentBase extends OrderGatewayMetadata {
  stockCode: string;
  quantity: number;
}

export interface KisBuyOrderIntent extends KisOrderIntentBase {
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
}

export interface KisSellOrderIntent extends KisOrderIntentBase {
  stockName?: string;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  reason?: string;
}

export interface KisOcoOrderIntent extends KisOrderIntentBase {
  stockName?: string;
  leg: 'STOP_LOSS' | 'TAKE_PROFIT';
  triggerPrice: number;
}

export interface KisCancelOrderIntent extends KisOrderIntentBase {
  ordNo: string;
}

export interface KisOrderStatusQueryIntent extends OrderGatewayMetadata {
  stockCode: string;
  ordNo: string;
}

export interface KisOrderGatewayDeps {
  kisPost: (
    trId: string,
    apiPath: string,
    body: Record<string, string>,
    priorityOrOptions?: unknown,
  ) => Promise<unknown>;
  kisGet: (
    trId: string,
    apiPath: string,
    params: Record<string, string>,
    priorityOrOptions?: unknown,
  ) => Promise<unknown>;
  isKisConfigured: () => boolean;
  isReal: boolean;
}
