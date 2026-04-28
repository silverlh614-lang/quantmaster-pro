// @responsibility yahooRangePolicy 회귀 테스트 — capYahooRange + isAllowedYahooRange.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  YAHOO_ALLOWED_RANGES,
  YAHOO_DEFAULT_RANGE,
  YAHOO_MAX_RANGE,
  capYahooRange,
  isAllowedYahooRange,
  isYahooRangeCapDisabled,
} from './yahooRangePolicy.js';

describe('yahooRangePolicy', () => {
  const originalEnv = process.env.YAHOO_RANGE_CAP_DISABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.YAHOO_RANGE_CAP_DISABLED;
    } else {
      process.env.YAHOO_RANGE_CAP_DISABLED = originalEnv;
    }
  });

  describe('상수 SSOT 정합', () => {
    it('YAHOO_ALLOWED_RANGES 가 정확히 6개 — 1d/5d/1mo/3mo/6mo/1y', () => {
      expect(YAHOO_ALLOWED_RANGES).toEqual(['1d', '5d', '1mo', '3mo', '6mo', '1y']);
      expect(YAHOO_ALLOWED_RANGES).toHaveLength(6);
    });

    it('YAHOO_MAX_RANGE 는 1y', () => {
      expect(YAHOO_MAX_RANGE).toBe('1y');
    });

    it('YAHOO_DEFAULT_RANGE 는 1y', () => {
      expect(YAHOO_DEFAULT_RANGE).toBe('1y');
    });

    it('2y / 5y / 10y / max / ytd 는 허용 목록에 부재 (사용자 명시 위반 차단)', () => {
      expect(YAHOO_ALLOWED_RANGES).not.toContain('2y');
      expect(YAHOO_ALLOWED_RANGES).not.toContain('5y');
      expect(YAHOO_ALLOWED_RANGES).not.toContain('10y');
      expect(YAHOO_ALLOWED_RANGES).not.toContain('max');
      expect(YAHOO_ALLOWED_RANGES).not.toContain('ytd');
    });
  });

  describe('isAllowedYahooRange', () => {
    it('허용된 6값 모두 true', () => {
      for (const r of YAHOO_ALLOWED_RANGES) {
        expect(isAllowedYahooRange(r)).toBe(true);
      }
    });

    it('금지된 값 false — 2y / 5y / 10y / max / ytd', () => {
      expect(isAllowedYahooRange('2y')).toBe(false);
      expect(isAllowedYahooRange('5y')).toBe(false);
      expect(isAllowedYahooRange('10y')).toBe(false);
      expect(isAllowedYahooRange('max')).toBe(false);
      expect(isAllowedYahooRange('ytd')).toBe(false);
    });

    it('알 수 없는 값 false — 빈 문자열 / null / undefined / 숫자 / 객체', () => {
      expect(isAllowedYahooRange('')).toBe(false);
      expect(isAllowedYahooRange(null)).toBe(false);
      expect(isAllowedYahooRange(undefined)).toBe(false);
      expect(isAllowedYahooRange(123)).toBe(false);
      expect(isAllowedYahooRange({})).toBe(false);
      expect(isAllowedYahooRange('1Y')).toBe(false); // 대소문자 엄격
    });
  });

  describe('capYahooRange', () => {
    it('허용된 6값 그대로 통과', () => {
      expect(capYahooRange('1d')).toBe('1d');
      expect(capYahooRange('5d')).toBe('5d');
      expect(capYahooRange('1mo')).toBe('1mo');
      expect(capYahooRange('3mo')).toBe('3mo');
      expect(capYahooRange('6mo')).toBe('6mo');
      expect(capYahooRange('1y')).toBe('1y');
    });

    it("'2y' → '1y' cap (사용자 명시 위반)", () => {
      expect(capYahooRange('2y')).toBe('1y');
    });

    it("'5y' / '10y' / 'max' / 'ytd' → '1y' cap", () => {
      expect(capYahooRange('5y')).toBe('1y');
      expect(capYahooRange('10y')).toBe('1y');
      expect(capYahooRange('max')).toBe('1y');
      expect(capYahooRange('ytd')).toBe('1y');
    });

    it('미설정 / null / 빈 문자열 → DEFAULT 1y', () => {
      expect(capYahooRange(undefined)).toBe('1y');
      expect(capYahooRange(null)).toBe('1y');
      expect(capYahooRange('')).toBe('1y');
    });

    it('알 수 없는 입력 → 1y cap', () => {
      expect(capYahooRange('FOO')).toBe('1y');
      expect(capYahooRange('100y')).toBe('1y');
      expect(capYahooRange('1Y')).toBe('1y'); // 대문자 비허용
    });

    it('YAHOO_RANGE_CAP_DISABLED=true 시 입력 그대로 통과', () => {
      process.env.YAHOO_RANGE_CAP_DISABLED = 'true';
      expect(capYahooRange('2y')).toBe('2y');
      expect(capYahooRange('5y')).toBe('5y');
      expect(capYahooRange('max')).toBe('max');
    });

    it('YAHOO_RANGE_CAP_DISABLED=true + 미설정/빈값 → DEFAULT', () => {
      process.env.YAHOO_RANGE_CAP_DISABLED = 'true';
      expect(capYahooRange(undefined)).toBe('1y');
      expect(capYahooRange('')).toBe('1y');
    });

    it('YAHOO_RANGE_CAP_DISABLED=false 또는 미설정 시 정책 적용', () => {
      delete process.env.YAHOO_RANGE_CAP_DISABLED;
      expect(capYahooRange('2y')).toBe('1y');

      process.env.YAHOO_RANGE_CAP_DISABLED = 'false';
      expect(capYahooRange('2y')).toBe('1y');

      process.env.YAHOO_RANGE_CAP_DISABLED = '1';
      expect(capYahooRange('2y')).toBe('1y');
    });
  });

  describe('isYahooRangeCapDisabled', () => {
    beforeEach(() => {
      delete process.env.YAHOO_RANGE_CAP_DISABLED;
    });

    it('미설정 시 false', () => {
      expect(isYahooRangeCapDisabled()).toBe(false);
    });

    it('"true" 정확값에만 true', () => {
      process.env.YAHOO_RANGE_CAP_DISABLED = 'true';
      expect(isYahooRangeCapDisabled()).toBe(true);
    });

    it('다른 값은 모두 false (대소문자 엄격, 1/yes/on 도 false)', () => {
      process.env.YAHOO_RANGE_CAP_DISABLED = 'TRUE';
      expect(isYahooRangeCapDisabled()).toBe(false);

      process.env.YAHOO_RANGE_CAP_DISABLED = '1';
      expect(isYahooRangeCapDisabled()).toBe(false);

      process.env.YAHOO_RANGE_CAP_DISABLED = 'yes';
      expect(isYahooRangeCapDisabled()).toBe(false);
    });
  });
});
