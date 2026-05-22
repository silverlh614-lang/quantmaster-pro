// @responsibility Order pipeline SSOT: Signal -> Intent -> Order -> Fill -> Position -> Ledger -> Telegram.

import type { ConvictionLabel } from './gates/simpleDecision.js';

export type OrderMode = 'LIVE' | 'SHADOW';

export type OrderIntentStatus =
  | 'CREATED'
  | 'WAIT_PRICE_VALID'
  | 'WAIT_SLOT_AVAILABLE'
  | 'ORDER_CREATED'
  | 'SUBMITTED'
  | 'PAPER_FILLED'
  | 'LIVE_FILLED'
  | 'POSITION_OPENED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED';

export type OrderPipelineStage =
  | 'DECISION'
  | 'COUNTERFACTUAL_RECORDED'
  | 'ORDER_INTENT_CREATED'
  | 'SHADOW_ORDER_CREATED'
  | 'LIVE_ORDER_CREATED'
  | 'SHADOW_PAPER_FILLED'
  | 'LIVE_ORDER_FILLED'
  | 'POSITION_STATE_OPENED'
  | 'LEDGER_RECORDED'
  | 'VIRTUAL_ACCOUNT_UPDATED'
  | 'DISPLAY_STATE_RENDERED'
  | 'TELEGRAM_SENT'
  | 'TELEGRAM_NOTIFICATION_SUPPRESSED';

export interface OrderIntent {
  orderIntentId: string;
  snapshotId: string;
  sampleId: string;
  tradePlanId: string;
  priceSnapshotId: string;
  symbol: string;
  name?: string;
  side: 'BUY' | 'SELL';
  mode: OrderMode;
  decision: 'BUY_ALLOWED';
  label: Extract<ConvictionLabel, 'HIGH_CONVICTION' | 'BUY'>;
  quantity: number;
  referencePrice: number;
  positionAmount: number;
  status: OrderIntentStatus;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  reason?: string;
  failureReason?: string;
  executionImpact: 'LIVE_ORDER' | 'SHADOW_ONLY' | 'NONE';
}

export interface ShadowOrder {
  shadowOrderId: string;
  orderIntentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  referencePrice: number;
  tradePlanId: string;
  priceSnapshotId: string;
  status: 'CREATED' | 'PAPER_FILLED' | 'REJECTED';
  createdAt: string;
}

export interface PaperFill {
  fillId: string;
  shadowOrderId: string;
  orderIntentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  fillPrice: number;
  quantity: number;
  priceSnapshotId: string;
  filledAt: string;
}

export interface PipelineStageGuardResult {
  ok: boolean;
  log?: string;
  action?: 'BLOCK_STAGE_AND_RECORD_ERROR';
}

export interface OrderPipelineFailure {
  orderIntentId: string;
  symbol: string;
  stage: OrderPipelineStage | string;
  failureReason: string;
  counterfactualPreserved: true;
  executionImpact: 'LIVE_ORDER' | 'SHADOW_ONLY' | 'NONE';
}

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function sanitizeIdPart(value: unknown): string {
  return String(value ?? 'none').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'none';
}

function tradingDateFromIso(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

export function createOrderIntent(input: {
  snapshotId: string;
  sampleId: string;
  tradePlanId?: string;
  priceSnapshotId?: string;
  symbol: string;
  name?: string;
  side?: 'BUY' | 'SELL';
  mode: OrderMode;
  decision: 'BUY_ALLOWED';
  label?: ConvictionLabel;
  quantity: number;
  referencePrice: number;
  strategyId?: string;
  createdAt?: string;
  executionImpact?: 'LIVE_ORDER' | 'SHADOW_ONLY' | 'NONE';
}): OrderIntent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const side = input.side ?? 'BUY';
  const tradePlanId = input.tradePlanId ?? `trade_plan_pending_${sanitizeIdPart(input.symbol)}_${sanitizeIdPart(input.sampleId)}`;
  const priceSnapshotId = input.priceSnapshotId ?? `price_pending_${sanitizeIdPart(input.symbol)}_${sanitizeIdPart(input.sampleId)}`;
  const tradingDate = tradingDateFromIso(createdAt);
  const strategyId = input.strategyId ?? 'default';
  const idempotencyKey = [
    tradingDate,
    input.symbol,
    side,
    input.mode,
    strategyId,
    tradePlanId,
  ].map(sanitizeIdPart).join(':');
  const orderIntentId = `oi_${idempotencyKey.replace(/:/g, '_')}`;
  const label = input.label === 'HIGH_CONVICTION' ? 'HIGH_CONVICTION' : 'BUY';

  return {
    orderIntentId,
    snapshotId: input.snapshotId,
    sampleId: input.sampleId,
    tradePlanId,
    priceSnapshotId,
    symbol: input.symbol,
    name: input.name,
    side,
    mode: input.mode,
    decision: input.decision,
    label,
    quantity: input.quantity,
    referencePrice: input.referencePrice,
    positionAmount: input.quantity * input.referencePrice,
    status: 'CREATED',
    createdAt,
    updatedAt: createdAt,
    idempotencyKey,
    executionImpact: input.executionImpact ?? (input.mode === 'LIVE' ? 'LIVE_ORDER' : 'SHADOW_ONLY'),
  };
}

export function changeOrderIntentStatus(
  intent: OrderIntent,
  to: OrderIntentStatus,
  reason?: string,
  updatedAt = new Date().toISOString(),
): { intent: OrderIntent; log: string } {
  const from = intent.status;
  intent.status = to;
  intent.updatedAt = updatedAt;
  if (reason) intent.reason = reason;
  return {
    intent,
    log: formatOrderIntentStatusChangedLog({ orderIntentId: intent.orderIntentId, symbol: intent.symbol, from, to, reason }),
  };
}

export function createShadowOrder(intent: OrderIntent, createdAt = new Date().toISOString()): ShadowOrder {
  return {
    shadowOrderId: `so_${sanitizeIdPart(intent.orderIntentId)}`,
    orderIntentId: intent.orderIntentId,
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    referencePrice: intent.referencePrice,
    tradePlanId: intent.tradePlanId,
    priceSnapshotId: intent.priceSnapshotId,
    status: 'CREATED',
    createdAt,
  };
}

export function createPaperFill(input: {
  shadowOrder: ShadowOrder;
  fillId: string;
  fillPrice: number;
  quantity?: number;
  priceSnapshotId?: string;
  filledAt?: string;
}): PaperFill {
  return {
    fillId: input.fillId,
    shadowOrderId: input.shadowOrder.shadowOrderId,
    orderIntentId: input.shadowOrder.orderIntentId,
    symbol: input.shadowOrder.symbol,
    side: input.shadowOrder.side,
    fillPrice: input.fillPrice,
    quantity: input.quantity ?? input.shadowOrder.quantity,
    priceSnapshotId: input.priceSnapshotId ?? input.shadowOrder.priceSnapshotId,
    filledAt: input.filledAt ?? new Date().toISOString(),
  };
}

export function assertPipelineStage(input: {
  requiredPreviousStage: OrderPipelineStage;
  currentStage: OrderPipelineStage;
  orderIntentId?: string;
  symbol?: string;
  exists: boolean;
}): PipelineStageGuardResult {
  if (input.exists) return { ok: true };
  return {
    ok: false,
    action: 'BLOCK_STAGE_AND_RECORD_ERROR',
    log: formatPipelineStageGuardFailedLog({
      orderIntentId: input.orderIntentId,
      symbol: input.symbol,
      requiredPreviousStage: input.requiredPreviousStage,
      currentStage: input.currentStage,
    }),
  };
}

export function formatOrderIntentCreatedLog(intent: OrderIntent): string {
  return [
    '[ORDER_INTENT_CREATED]',
    kv('orderIntentId', intent.orderIntentId),
    kv('symbol', intent.symbol),
    kv('mode', intent.mode),
    kv('side', intent.side),
    kv('quantity', intent.quantity),
    kv('referencePrice', intent.referencePrice),
    kv('positionAmount', intent.positionAmount),
    kv('tradePlanId', intent.tradePlanId),
    kv('priceSnapshotId', intent.priceSnapshotId),
  ].join(' ');
}

export function formatBuyAllowedPipelineAdvancedLog(input: {
  snapshotId?: string;
  symbol: string;
  nextStage: OrderPipelineStage | OrderIntentStatus;
}): string {
  return [
    '[BUY_ALLOWED_PIPELINE_ADVANCED]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    "decision='BUY_ALLOWED'",
    kv('nextStage', input.nextStage),
  ].join(' ');
}

export function formatBuyAllowedPipelineBreakLog(input: {
  snapshotId?: string;
  symbol: string;
  missingStage: OrderPipelineStage | string;
}): string {
  return [
    '[BUY_ALLOWED_PIPELINE_BREAK]',
    kv('snapshotId', input.snapshotId),
    kv('symbol', input.symbol),
    "decision='BUY_ALLOWED'",
    kv('missingStage', input.missingStage),
    "severity='ERROR'",
  ].join(' ');
}

export function formatShadowOrderCreatedLog(order: ShadowOrder): string {
  return [
    '[SHADOW_ORDER_CREATED]',
    kv('shadowOrderId', order.shadowOrderId),
    kv('orderIntentId', order.orderIntentId),
    kv('symbol', order.symbol),
    kv('side', order.side),
    kv('quantity', order.quantity),
    kv('referencePrice', order.referencePrice),
  ].join(' ');
}

export function formatShadowPaperFilledLog(fill: PaperFill): string {
  return [
    '[SHADOW_PAPER_FILLED]',
    kv('fillId', fill.fillId),
    kv('shadowOrderId', fill.shadowOrderId),
    kv('orderIntentId', fill.orderIntentId),
    kv('symbol', fill.symbol),
    kv('fillPrice', fill.fillPrice),
    kv('quantity', fill.quantity),
    kv('priceSnapshotId', fill.priceSnapshotId),
  ].join(' ');
}

export function formatPaperTradeLedgerRecordedLog(input: {
  tradeId: string;
  orderIntentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  fillPrice: number;
}): string {
  return [
    '[PAPER_TRADE_LEDGER_RECORDED]',
    kv('tradeId', input.tradeId),
    kv('orderIntentId', input.orderIntentId),
    kv('symbol', input.symbol),
    kv('side', input.side),
    kv('quantity', input.quantity),
    kv('fillPrice', input.fillPrice),
  ].join(' ');
}

export function formatVirtualAccountUpdatedLog(input: {
  orderIntentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  cashBefore?: number | string;
  cashAfter?: number | string;
  holdingBefore?: number;
  holdingAfter?: number;
  mode?: OrderMode;
}): string {
  return [
    '[VIRTUAL_ACCOUNT_UPDATED]',
    kv('orderIntentId', input.orderIntentId),
    kv('symbol', input.symbol),
    kv('side', input.side),
    kv('cashBefore', input.cashBefore ?? 'DERIVED_FROM_PAPER_LEDGER'),
    kv('cashAfter', input.cashAfter ?? 'DERIVED_FROM_PAPER_LEDGER'),
    kv('holdingBefore', input.holdingBefore ?? 0),
    kv('holdingAfter', input.holdingAfter ?? 0),
    `mode='${input.mode ?? 'SHADOW'}'`,
  ].join(' ');
}

export function formatOrderIntentStatusChangedLog(input: {
  orderIntentId: string;
  symbol: string;
  from: OrderIntentStatus;
  to: OrderIntentStatus;
  reason?: string;
}): string {
  return [
    '[ORDER_INTENT_STATUS_CHANGED]',
    kv('orderIntentId', input.orderIntentId),
    kv('symbol', input.symbol),
    kv('from', input.from),
    kv('to', input.to),
    kv('reason', input.reason),
  ].join(' ');
}

export function formatPipelineStageGuardFailedLog(input: {
  orderIntentId?: string;
  symbol?: string;
  requiredPreviousStage: OrderPipelineStage;
  currentStage: OrderPipelineStage;
}): string {
  return [
    '[PIPELINE_STAGE_GUARD_FAILED]',
    kv('orderIntentId', input.orderIntentId),
    kv('symbol', input.symbol),
    kv('requiredPreviousStage', input.requiredPreviousStage),
    kv('currentStage', input.currentStage),
    "action='BLOCK_STAGE_AND_RECORD_ERROR'",
  ].join(' ');
}

export function formatOrderPipelineFailedLog(input: OrderPipelineFailure): string {
  return [
    '[ORDER_PIPELINE_FAILED]',
    kv('orderIntentId', input.orderIntentId),
    kv('symbol', input.symbol),
    kv('stage', input.stage),
    kv('failureReason', input.failureReason),
    'counterfactualPreserved=true',
    kv('executionImpact', input.executionImpact),
  ].join(' ');
}

export function formatOrderPipelineCompletedLog(input: {
  orderIntentId: string;
  symbol: string;
  mode: OrderMode;
  telegramStatus?: 'SENT' | 'SUPPRESSED' | 'NOT_REQUESTED';
}): string {
  return [
    '[ORDER_PIPELINE_COMPLETED]',
    kv('orderIntentId', input.orderIntentId),
    kv('symbol', input.symbol),
    kv('mode', input.mode),
    "finalStage='POSITION_OPENED'",
    kv('telegramStatus', input.telegramStatus ?? 'NOT_REQUESTED'),
  ].join(' ');
}
