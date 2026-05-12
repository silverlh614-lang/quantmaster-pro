import { describe, expect, it, vi } from 'vitest';
import { classifyInvestorFlowPayload, classifyShortPayload } from '../clients/kisClient/payloadValidators.js';
import { evaluateYahooTimeseriesGuard } from './yahooProviderGuard.js';
import { computeLiveExecutionAllowed, recordShadowCase } from './executionGate.js';
import {
  MemoryDedupeStore,
  buildShadowAuctionOrderKey,
  buildShadowAuctionTelegramFingerprint,
  formatGateSnap,
  saveShadowAuctionOrderOnce,
  sendShadowAuctionTelegramOnce,
} from './shadowAuctionIdempotency.js';
import { summarizeKisPriceHealth } from './kisOnlyRebuildHealth.js';

describe('KIS_ONLY_REBUILD defense patch', () => {
  it('A. stale Yahoo chart is not usable for execution/signal/router but remains shadow-allowed', () => {
    const result = evaluateYahooTimeseriesGuard([
      { close: 1000, timestamp: '2026-01-23T06:00:00.000Z' },
    ], { now: new Date('2026-05-12T03:00:00.000Z'), allowedStaleDays: 1 });

    expect(result.health).toBe('STALE');
    expect(result.usableForExecution).toBe(false);
    expect(result.usableForSignal).toBe(false);
    expect(result.usableForRouter).toBe(false);
    expect(result.usableForShadow).toBe(true);
    expect(result.reason).toBe('YAHOO_TIMESERIES_STALE');
  });

  it('B. KIS price current/prevClose/chart 10/10 reports OK', () => {
    expect(summarizeKisPriceHealth({
      currentOk: 10,
      currentTotal: 10,
      prevCloseOk: 10,
      prevCloseTotal: 10,
      chartOk: 10,
      chartTotal: 10,
    }).status).toBe('OK');
  });

  it('C. INQUIRE_INVESTOR quote-like output is diagnostic-only QUOTE_LIKE_OUTPUT', () => {
    const result = classifyInvestorFlowPayload([
      { stck_cntg_hour: '090001', stck_prpr: '10000', prdy_vrss: '10', prdy_vrss_sign: '2', cntg_vol: '1200', tday_rltv: '1.2', prdy_ctrt: '0.1' },
    ], { trId: 'FHKST01010300' });

    expect(result.status).toBe('QUOTE_LIKE_OUTPUT');
    expect(result.materialized).toBe(false);
    expect(result.providerIssue).toBe(false);
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('D. INVESTOR_TRADE_BY_STOCK_DAILY price-only output is not materialized', () => {
    const result = classifyInvestorFlowPayload([
      { stck_prpr: '10000', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '0.1', acml_vol: '1200', prdy_vol: '900', rprs_mrkt_kor_name: 'KOSDAQ' },
    ], { trId: 'FHPTJ04160001' });

    expect(['QUOTE_LIKE_OUTPUT', 'FIELD_MISSING', 'FIELD_MISMATCH']).toContain(result.status);
    expect(result.materialized).toBe(false);
  });

  it('E/F. SHORT price-only output is FIELD_MISMATCH_CONFIRMED and not provider/market signal', () => {
    const result = classifyShortPayload([
      { stck_prpr: '10000', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '0.1', acml_vol: '1200', prdy_vol: '900' },
    ], { trId: 'FHPST04830000' });

    expect(result.status).toBe('FIELD_MISMATCH_CONFIRMED');
    expect(result.materialized).toBe(false);
    expect(result.providerIssue).toBe(false);
    expect(result.marketSignal).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('G. KIS_ONLY_REBUILD forces liveExecutionAllowed=false', () => {
    expect(computeLiveExecutionAllowed({
      mode: 'KIS_ONLY_REBUILD',
      freshExecutionProviderExists: true,
      executionStage: 'CORE',
      hasCriticalProviderMismatch: false,
    })).toBe(false);
  });

  it('H. Shadow cases force executionImpact=NONE while learning remains enabled', () => {
    const result = recordShadowCase({ reason: 'KIS_INVESTOR_FLOW_FIELD_MISMATCH' });
    expect(result.executionImpact).toBe('NONE');
    expect(result.shadowLearning).toBe(true);
    expect(result.providerIssue).toBe(false);
    expect(result.marketSignal).toBe(false);
  });

  it('I. duplicate Shadow auction Telegram message calls sendMessage once', async () => {
    const store = new MemoryDedupeStore();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const fingerprint = buildShadowAuctionTelegramFingerprint({
      channelId: 'chan',
      tradeDate: '2026-05-12',
      auctionSession: 'OPENING_AUCTION',
      stockCode: '1234',
      plannedPrice: 10000,
      plannedQty: 3,
      gateSnap: 6.3999999999999995,
      gapPct: -2.44,
      accountMode: 'SHADOW',
    });

    await sendShadowAuctionTelegramOnce({ store, fingerprint, stockCode: '001234', sendMessage });
    const second = await sendShadowAuctionTelegramOnce({ store, fingerprint, stockCode: '001234', sendMessage });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ sent: false, reason: 'DUPLICATE_SHADOW_AUCTION_MESSAGE' });
  });

  it('J. duplicate Shadow auction order is saved once', async () => {
    const store = new MemoryDedupeStore();
    const createOrder = vi.fn(() => ({ id: 'order-1' }));
    const orderKey = buildShadowAuctionOrderKey({
      tradeDate: '2026-05-12',
      auctionSession: 'OPENING_AUCTION',
      stockCode: '1234',
      side: 'BUY',
      plannedPrice: 10000,
      plannedQty: 3,
      accountMode: 'SHADOW',
    });

    await saveShadowAuctionOrderOnce({ store, orderKey, createOrder });
    const second = await saveShadowAuctionOrderOnce({ store, orderKey, createOrder, existingOrder: () => ({ id: 'order-1' }) });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(second.saved).toBe(false);
    expect(second.reason).toBe('DUPLICATE_SHADOW_AUCTION_ORDER');
  });

  it('K. GateSnap 6.3999999999999995 formats as 6.40', () => {
    expect(formatGateSnap(6.3999999999999995)).toBe('6.40');
  });
});
