// @responsibility ADR-0504 6 ENV 헬퍼 default + ADR-0157 정확 비교 회귀.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isMorningPositionCardEnabled,
  isPositionCardEnabled,
  isPositionCardFallbackForbidden,
  isPositionCardSourceValidationEnabled,
  isSendEmptyPositionCardEnabled,
  isShadowPositionCardEnabled,
} from './positionCardEnvHelpers.js';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.TELEGRAM_POSITION_CARD_ENABLED;
  delete process.env.TELEGRAM_SHADOW_POSITION_CARD_ENABLED;
  delete process.env.TELEGRAM_MORNING_POSITION_CARD_ENABLED;
  delete process.env.TELEGRAM_SEND_EMPTY_POSITION_CARD;
  delete process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE;
  delete process.env.TELEGRAM_POSITION_CARD_FALLBACK_FORBIDDEN;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('ADR-0504 default ON 4종 (`!== "false"`)', () => {
  it('isPositionCardEnabled — default ON / =false 차단 / 임의 truthy 거부 (ADR-0157 정확 비교)', () => {
    expect(isPositionCardEnabled()).toBe(true); // default
    process.env.TELEGRAM_POSITION_CARD_ENABLED = 'false';
    expect(isPositionCardEnabled()).toBe(false);
    // ADR-0157 정확 비교 — 'false' 외 모든 값은 ON
    process.env.TELEGRAM_POSITION_CARD_ENABLED = 'true';
    expect(isPositionCardEnabled()).toBe(true);
    process.env.TELEGRAM_POSITION_CARD_ENABLED = '1';
    expect(isPositionCardEnabled()).toBe(true);
    process.env.TELEGRAM_POSITION_CARD_ENABLED = '';
    expect(isPositionCardEnabled()).toBe(true);
  });

  it('isShadowPositionCardEnabled — default ON / =false 차단', () => {
    expect(isShadowPositionCardEnabled()).toBe(true);
    process.env.TELEGRAM_SHADOW_POSITION_CARD_ENABLED = 'false';
    expect(isShadowPositionCardEnabled()).toBe(false);
  });

  it('isMorningPositionCardEnabled — default ON / =false 차단', () => {
    expect(isMorningPositionCardEnabled()).toBe(true);
    process.env.TELEGRAM_MORNING_POSITION_CARD_ENABLED = 'false';
    expect(isMorningPositionCardEnabled()).toBe(false);
  });

  it('isPositionCardSourceValidationEnabled — default ON / =false 차단', () => {
    expect(isPositionCardSourceValidationEnabled()).toBe(true);
    process.env.TELEGRAM_POSITION_CARD_VALIDATE_SOURCE = 'false';
    expect(isPositionCardSourceValidationEnabled()).toBe(false);
  });

  it('isPositionCardFallbackForbidden — default ON / =false 차단', () => {
    expect(isPositionCardFallbackForbidden()).toBe(true);
    process.env.TELEGRAM_POSITION_CARD_FALLBACK_FORBIDDEN = 'false';
    expect(isPositionCardFallbackForbidden()).toBe(false);
  });
});

describe('ADR-0504 default OFF (`=== "true"`) — isSendEmptyPositionCardEnabled', () => {
  it('default OFF — 빈 보유 카드 발송 생략 (사용자 결정)', () => {
    expect(isSendEmptyPositionCardEnabled()).toBe(false);
  });

  it('"true" 명시 시에만 ON — ADR-0157 정확 비교, "1"/"TRUE"/"yes"/빈문자열 거부', () => {
    process.env.TELEGRAM_SEND_EMPTY_POSITION_CARD = 'true';
    expect(isSendEmptyPositionCardEnabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', '']) {
      process.env.TELEGRAM_SEND_EMPTY_POSITION_CARD = v;
      expect(isSendEmptyPositionCardEnabled()).toBe(false);
    }
  });
});
