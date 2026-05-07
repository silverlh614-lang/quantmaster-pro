import { describe, expect, it } from 'vitest';
import {
  FatalDataQualityError,
  assertQuoteSanityHealth,
  assertUsableKrxMaster,
  classifyStage1RejectStrict,
  formatNullablePct,
  makeStaleQuoteResult,
} from './emergencyDataQualityGuards';
// ADR-0440 — KRX code 정규화 / 검증은 SSOT (`server/utils/symbolNormalizer`) 직접 사용.
// 기존 `assertValidKrxCode` / `normalizeKrxCode` deprecated wrapper 는 등록 해제됨.
import { assertValidKrxCode, normalizeKrxCode } from '../utils/symbolNormalizer';

describe('emergencyDataQualityGuards', () => {
  describe('assertUsableKrxMaster', () => {
    it('master.total < 2000 blocks production scan', () => {
      expect(() => assertUsableKrxMaster({ total: 395, ageHours: 1, source: 'KRX_OPENAPI' }))
        .toThrowError(FatalDataQualityError);
    });

    it('master.ageHours > 24 blocks production scan', () => {
      expect(() => assertUsableKrxMaster({ total: 2500, ageHours: 48, source: 'KRX_OPENAPI' }))
        .toThrowError('KRX_MASTER_TTL_EXPIRED');
    });

    it('STATIC_SEED is diagnostic-only', () => {
      expect(() => assertUsableKrxMaster({ total: 2500, ageHours: 1, source: 'STATIC_SEED' }))
        .toThrowError('STATIC_SEED_NOT_ALLOWED_FOR_SCAN');
    });

    it('healthy KRX OpenAPI master passes', () => {
      expect(assertUsableKrxMaster({ total: 2500, ageHours: 1, source: 'KRX_OPENAPI' })).toBe(true);
    });
  });

  describe('KRX code normalization (ADR-0440 SSOT 직접 import)', () => {
    it.each([
      ['005930', '005930'],
      ['005930.KS', '005930'],
      ['403870.KQ', '403870'],
      [' 403870.kq ', '403870'],
    ])('normalizes %s', (input, expected) => {
      // ADR-0440 — SSOT 의 `.code` accessor 사용 (NormalizedKrxSymbol 격상).
      expect(normalizeKrxCode(input).code).toBe(expected);
      expect(normalizeKrxCode(input).valid).toBe(true);
    });

    it.each(['0070X0', '', 'ABCDEF', '12345', '1234567'])('rejects invalid code %s', input => {
      expect(normalizeKrxCode(input).code).toBeNull();
      expect(normalizeKrxCode(input).valid).toBe(false);
      expect(() => assertValidKrxCode(input)).toThrowError('INVALID_KRX_CODE');
    });
  });

  describe('Yahoo stale quote hard fail contract', () => {
    it('stale quote result never coerces percentage fields to zero', () => {
      const result = makeStaleQuoteResult({ currentPrice: 10000, baseAsOf: '2026-04-02T00:00:00.000Z' });
      expect(result.ok).toBe(false);
      expect(result.usableForSignal).toBe(false);
      expect(result.changePercent).toBeNull();
      expect(result.return20d).toBeNull();
    });

    it('Telegram formatter renders unavailable percentages as N/A', () => {
      expect(formatNullablePct(null)).toBe('N/A');
      expect(formatNullablePct(undefined)).toBe('N/A');
      expect(formatNullablePct(0)).toBe('0.00%');
    });
  });

  describe('sanity circuit breaker', () => {
    it('checked=8 violations=8 aborts scan', () => {
      expect(() => assertQuoteSanityHealth({ checked: 8, violations: 8 }))
        .toThrowError('QUOTE_SANITY_DEGRADED');
    });

    it('checked=8 violations=4 aborts scan at 50%', () => {
      expect(() => assertQuoteSanityHealth({ checked: 8, violations: 4 }))
        .toThrowError('QUOTE_SANITY_DEGRADED');
    });

    it('checked=8 violations=1 passes', () => {
      expect(assertQuoteSanityHealth({ checked: 8, violations: 1 })).toBe(true);
    });
  });

  describe('Stage1 DATA_MISSING split', () => {
    const baseQuote = {
      usableForSignal: true,
      currentPrice: 5000,
      volume: 100,
      return20d: 1,
    };

    it('missing quote is DATA_MISSING_QUOTE', () => {
      expect(classifyStage1RejectStrict({ quote: null, fundamental: { per: 10 } }))
        .toBe('DATA_MISSING_QUOTE');
    });

    it('volume null is DATA_MISSING_VOLUME, not LOW_VOLUME', () => {
      expect(classifyStage1RejectStrict({ quote: { ...baseQuote, volume: null }, fundamental: { per: 10 } }))
        .toBe('DATA_MISSING_VOLUME');
    });

    it('PER null is DATA_MISSING_PER, not HIGH_PER', () => {
      expect(classifyStage1RejectStrict({ quote: baseQuote, fundamental: { per: null } }))
        .toBe('DATA_MISSING_PER');
    });

    it('return20d null is DATA_MISSING_RETURN', () => {
      expect(classifyStage1RejectStrict({ quote: { ...baseQuote, return20d: null }, fundamental: { per: 10 } }))
        .toBe('DATA_MISSING_RETURN');
    });

    it('real low volume is LOW_VOLUME only when value exists', () => {
      expect(classifyStage1RejectStrict({ quote: baseQuote, fundamental: { per: 10 }, minVolume: 1000 }))
        .toBe('LOW_VOLUME');
    });

    it('real high PER is HIGH_PER only when value exists', () => {
      expect(classifyStage1RejectStrict({ quote: baseQuote, fundamental: { per: 100 }, maxPer: 60 }))
        .toBe('HIGH_PER');
    });
  });
});
