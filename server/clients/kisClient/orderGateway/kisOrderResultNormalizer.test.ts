import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeKisOrderError, normalizeKisOrderResult } from './kisOrderResultNormalizer.js';

describe('kisOrderResultNormalizer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps KIS submitted order responses to SUBMITTED with metadata', () => {
    expect(
      normalizeKisOrderResult({
        orderKind: 'BUY_MARKET',
        raw: { rt_cd: '0', output: { ODNO: 'ORD-123' } },
        correlationId: 'corr-1',
        orderIntentId: 'intent-1',
      }),
    ).toEqual({
      kind: 'SUBMITTED',
      ordNo: 'ORD-123',
      raw: { rt_cd: '0', output: { ODNO: 'ORD-123' } },
      correlationId: 'corr-1',
      orderIntentId: 'intent-1',
    });
  });

  it('maps KIS rejected responses to REJECTED and emits P0 warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      normalizeKisOrderResult({
        orderKind: 'SELL_MARKET',
        raw: { rt_cd: '1', msg1: 'insufficient quantity' },
      }),
    ).toEqual({
      kind: 'REJECTED',
      reason: 'insufficient quantity',
      executionImpact: 'LIVE_ORDER_BLOCKED',
      raw: { rt_cd: '1', msg1: 'insufficient quantity' },
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[P0][P0_KIS_ORDER_REJECTED]'), expect.any(Object));
  });

  it('maps unmapped raw responses to fatal result and emits P0 warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      normalizeKisOrderResult({
        orderKind: 'BUY_MARKET',
        raw: { rt_cd: '0', output: {} },
      }),
    ).toEqual({
      kind: 'FAILED_FATAL',
      reason: 'KIS_ORDER_RESULT_UNMAPPED',
      executionImpact: 'LIVE_ORDER_BLOCKED',
      raw: { rt_cd: '0', output: {} },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[P0][P0_KIS_ORDER_RESULT_UNMAPPED]'),
      expect.any(Object),
    );
  });

  it('maps classified config and retryable errors to standard results', () => {
    expect(normalizeKisOrderError({ kind: 'CONFIG_MISSING', reason: 'missing' })).toEqual({
      kind: 'SKIPPED_KIS_NOT_CONFIGURED',
      executionImpact: 'LIVE_ORDER_BLOCKED',
    });
    expect(normalizeKisOrderError({ kind: 'RATE_LIMITED', reason: '429', retryAfterMs: 1000 })).toEqual({
      kind: 'FAILED_RETRYABLE',
      reason: '429',
      retryAfterMs: 1000,
    });
  });
});
