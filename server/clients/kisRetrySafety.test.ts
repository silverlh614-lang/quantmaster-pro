/**
 * @responsibility ADR-0014 KIS 재시도 안전성 — jitter·지수 백오프·긴급 무력화 스위치 회귀
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __testOnly } from './kisClient.js';

describe('ADR-0014 KIS retry safety', () => {
  beforeEach(() => {
    delete process.env.KIS_RETRY_DISABLED;
    delete process.env.KIS_RETRY_JITTER_DISABLED;
  });
  afterEach(() => {
    delete process.env.KIS_RETRY_DISABLED;
    delete process.env.KIS_RETRY_JITTER_DISABLED;
  });

  describe('_kisBackoffDelayMs — 5xx 지수 백오프 + jitter', () => {
    it('jitter 활성 시 retriesLeft=3 → 500~1500ms 범위', () => {
      const samples = Array.from({ length: 200 }, () => __testOnly.backoffDelayMs(3));
      for (const d of samples) {
        expect(d).toBeGreaterThanOrEqual(500);
        expect(d).toBeLessThan(1500);
      }
      // 분산 검증 — 200회 샘플의 고유값이 100개 이상이면 deterministic 아님.
      const unique = new Set(samples).size;
      expect(unique).toBeGreaterThan(100);
    });

    it('jitter 활성 시 retriesLeft=2 → 1000~3000ms', () => {
      for (let i = 0; i < 100; i++) {
        const d = __testOnly.backoffDelayMs(2);
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThan(3000);
      }
    });

    it('jitter 활성 시 retriesLeft=1 → 2000~6000ms', () => {
      for (let i = 0; i < 100; i++) {
        const d = __testOnly.backoffDelayMs(1);
        expect(d).toBeGreaterThanOrEqual(2000);
        expect(d).toBeLessThan(6000);
      }
    });

    it('KIS_RETRY_JITTER_DISABLED=true 면 deterministic 1/2/4s', () => {
      process.env.KIS_RETRY_JITTER_DISABLED = 'true';
      expect(__testOnly.backoffDelayMs(3)).toBe(1000);
      expect(__testOnly.backoffDelayMs(2)).toBe(2000);
      expect(__testOnly.backoffDelayMs(1)).toBe(4000);
    });
  });

  describe('_kis429DelayMs — 429 재시도 jitter', () => {
    it('jitter 활성 시 1000~1500ms', () => {
      const samples = Array.from({ length: 100 }, () => __testOnly.rateLimit429DelayMs());
      for (const d of samples) {
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThan(1500);
      }
    });

    it('JITTER_DISABLED 면 정확히 1000ms', () => {
      process.env.KIS_RETRY_JITTER_DISABLED = 'true';
      expect(__testOnly.rateLimit429DelayMs()).toBe(1000);
    });
  });

  describe('KIS_RETRY_DISABLED — 긴급 무력화', () => {
    it('기본값은 retry enabled', () => {
      expect(__testOnly.isRetryEnabled()).toBe(true);
    });

    it('KIS_RETRY_DISABLED=true 면 disabled', () => {
      process.env.KIS_RETRY_DISABLED = 'true';
      expect(__testOnly.isRetryEnabled()).toBe(false);
    });

    it('KIS_RETRY_DISABLED=false 나 다른 값은 disabled 아님', () => {
      process.env.KIS_RETRY_DISABLED = 'false';
      expect(__testOnly.isRetryEnabled()).toBe(true);
      process.env.KIS_RETRY_DISABLED = '1';
      expect(__testOnly.isRetryEnabled()).toBe(true);
    });
  });
});
