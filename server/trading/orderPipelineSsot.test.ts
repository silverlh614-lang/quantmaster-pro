import { describe, expect, it } from 'vitest';

import {
  assertPipelineStage,
  changeOrderIntentStatus,
  createOrderIntent,
  createPaperFill,
  createShadowOrder,
  formatBuyAllowedPipelineAdvancedLog,
  formatOrderIntentCreatedLog,
  formatOrderPipelineCompletedLog,
  formatOrderPipelineFailedLog,
  formatPaperTradeLedgerRecordedLog,
  formatShadowOrderCreatedLog,
  formatShadowPaperFilledLog,
  formatVirtualAccountUpdatedLog,
} from './orderPipelineSsot.js';

function intent() {
  return createOrderIntent({
    snapshotId: 'scan_1',
    sampleId: 'cf_1',
    tradePlanId: 'tp_1',
    priceSnapshotId: 'ps_1',
    symbol: '005930',
    name: 'Samsung',
    mode: 'SHADOW',
    decision: 'BUY_ALLOWED',
    label: 'BUY',
    quantity: 3,
    referencePrice: 70_000,
    strategyId: 'B',
    createdAt: '2026-05-21T00:05:00.000Z',
  });
}

describe('Simplification Step 15 order pipeline SSOT', () => {
  it('A. creates OrderIntent after BUY_ALLOWED', () => {
    const orderIntent = intent();

    expect(orderIntent.status).toBe('CREATED');
    expect(orderIntent.orderIntentId).toContain('005930');
    expect(orderIntent.idempotencyKey).toContain('tp_1');
    expect(formatOrderIntentCreatedLog(orderIntent)).toContain('[ORDER_INTENT_CREATED]');
    expect(formatBuyAllowedPipelineAdvancedLog({
      snapshotId: orderIntent.snapshotId,
      symbol: orderIntent.symbol,
      nextStage: 'ORDER_INTENT_CREATED',
    })).toContain('[BUY_ALLOWED_PIPELINE_ADVANCED]');
  });

  it('B. blocks PaperFill when ShadowOrder is missing', () => {
    const orderIntent = intent();
    const guard = assertPipelineStage({
      requiredPreviousStage: 'SHADOW_ORDER_CREATED',
      currentStage: 'SHADOW_PAPER_FILLED',
      orderIntentId: orderIntent.orderIntentId,
      symbol: orderIntent.symbol,
      exists: false,
    });

    expect(guard.ok).toBe(false);
    expect(guard.log).toContain('[PIPELINE_STAGE_GUARD_FAILED]');
    expect(guard.log).toContain("action='BLOCK_STAGE_AND_RECORD_ERROR'");
  });

  it('C. advances ShadowOrder to PaperFill and PositionState stages', () => {
    const orderIntent = intent();
    const shadowOrder = createShadowOrder(orderIntent, orderIntent.createdAt);
    const fill = createPaperFill({
      shadowOrder,
      fillId: 'fill-1',
      fillPrice: 70_000,
      filledAt: '2026-05-21T00:05:01.000Z',
    });
    const status = changeOrderIntentStatus(orderIntent, 'PAPER_FILLED', 'shadow paper fill recorded');

    expect(formatShadowOrderCreatedLog(shadowOrder)).toContain('[SHADOW_ORDER_CREATED]');
    expect(formatShadowPaperFilledLog(fill)).toContain('[SHADOW_PAPER_FILLED]');
    expect(status.intent.status).toBe('PAPER_FILLED');
    expect(status.log).toContain('[ORDER_INTENT_STATUS_CHANGED]');
    expect(formatPaperTradeLedgerRecordedLog({
      tradeId: 'trade-1',
      orderIntentId: orderIntent.orderIntentId,
      symbol: '005930',
      side: 'BUY',
      quantity: fill.quantity,
      fillPrice: fill.fillPrice,
    })).toContain('[PAPER_TRADE_LEDGER_RECORDED]');
    expect(formatVirtualAccountUpdatedLog({
      orderIntentId: orderIntent.orderIntentId,
      symbol: '005930',
      side: 'BUY',
      holdingBefore: 0,
      holdingAfter: 3,
    })).toContain('[VIRTUAL_ACCOUNT_UPDATED]');
  });

  it('D. requires PositionState before Telegram fill messages', () => {
    const orderIntent = intent();
    const guard = assertPipelineStage({
      requiredPreviousStage: 'POSITION_STATE_OPENED',
      currentStage: 'DISPLAY_STATE_RENDERED',
      orderIntentId: orderIntent.orderIntentId,
      symbol: orderIntent.symbol,
      exists: false,
    });

    expect(guard.ok).toBe(false);
    expect(guard.log).toContain('POSITION_STATE_OPENED');
  });

  it('E/F. records wait or failure status without dropping counterfactuals', () => {
    const orderIntent = intent();
    const wait = changeOrderIntentStatus(orderIntent, 'WAIT_PRICE_VALID', 'PRICE_NOT_USABLE');
    const failed = formatOrderPipelineFailedLog({
      orderIntentId: orderIntent.orderIntentId,
      symbol: orderIntent.symbol,
      stage: 'SHADOW_PAPER_FILLED',
      failureReason: 'PRICE_NOT_USABLE',
      counterfactualPreserved: true,
      executionImpact: 'SHADOW_ONLY',
    });

    expect(wait.intent.status).toBe('WAIT_PRICE_VALID');
    expect(wait.log).toContain('WAIT_PRICE_VALID');
    expect(failed).toContain('[ORDER_PIPELINE_FAILED]');
    expect(failed).toContain('counterfactualPreserved=true');
  });

  it('completes the order pipeline only after PositionState stage', () => {
    const orderIntent = intent();
    const completed = formatOrderPipelineCompletedLog({
      orderIntentId: orderIntent.orderIntentId,
      symbol: orderIntent.symbol,
      mode: 'SHADOW',
      telegramStatus: 'SUPPRESSED',
    });

    expect(completed).toContain('[ORDER_PIPELINE_COMPLETED]');
    expect(completed).toContain("finalStage='POSITION_OPENED'");
  });
});
