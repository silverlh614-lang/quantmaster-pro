import { describe, expect, it } from 'vitest';
import { classifyKisOrderError, classifyMissingKisConfig } from './kisOrderErrorClassifier.js';

describe('kisOrderErrorClassifier', () => {
  it('classifies missing config explicitly', () => {
    expect(classifyMissingKisConfig()).toEqual({
      kind: 'CONFIG_MISSING',
      reason: 'KIS_APP_KEY_OR_SECRET_MISSING',
    });
  });

  it('classifies auth, rate limit, and server failures by HTTP status', () => {
    expect(classifyKisOrderError({ status: 401, message: 'unauthorized' }).kind).toBe('AUTH_FAILED');
    expect(classifyKisOrderError({ response: { status: 429 }, retryAfterMs: 1200 }).kind).toBe('RATE_LIMITED');
    expect(classifyKisOrderError(new Error('KIS API 503 unavailable')).kind).toBe('RETRYABLE_SERVER_ERROR');
  });

  it('classifies KIS rejected payloads separately from fatal failures', () => {
    expect(classifyKisOrderError({ rt_cd: '1', msg1: '주문불가' })).toEqual({
      kind: 'REJECTED',
      reason: '주문불가',
      raw: { rt_cd: '1', msg1: '주문불가' },
    });
    expect(classifyKisOrderError(new Error('unexpected mapping failure')).kind).toBe('FATAL');
  });
});
