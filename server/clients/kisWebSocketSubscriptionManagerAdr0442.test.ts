/**
 * @responsibility ADR-0442 — `isKisWsSubscriptionDiagDisabled` ENV 헬퍼 회귀 (default OFF, ADR-0157 정확 비교 의무).
 *
 * ADR-0437 SSOT 본체 무수정 검증 — 본 PR 은 ENV 헬퍼 1개 + diagnosis 호출자 wiring 2곳 (scanBlockers.cmd / diagnostics.ts) 만 추가.
 *
 * 검증:
 *   - default OFF (ENV 미설정)
 *   - "true" 정확 매칭 → true
 *   - "1" / "TRUE" / "yes" / "" 모두 거부 (ADR-0157 정확 비교 의무)
 */

import { describe, it, expect, afterEach } from 'vitest';

import { isKisWsSubscriptionDiagDisabled } from './kisWebSocketSubscriptionManager.js';

const ENV_KEY = 'KIS_WS_SUBSCRIPTION_DIAG_DISABLED';

describe('ADR-0442 isKisWsSubscriptionDiagDisabled — ENV gate (default OFF, ADR-0157)', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('default (env 미설정) → false', () => {
    delete process.env[ENV_KEY];
    expect(isKisWsSubscriptionDiagDisabled()).toBe(false);
  });

  it('"true" 정확 매칭 → true (활성)', () => {
    process.env[ENV_KEY] = 'true';
    expect(isKisWsSubscriptionDiagDisabled()).toBe(true);
  });

  it('"1" 거부 (ADR-0157 정확 비교)', () => {
    process.env[ENV_KEY] = '1';
    expect(isKisWsSubscriptionDiagDisabled()).toBe(false);
  });

  it('"TRUE" 거부 (대소문자 일치 의무)', () => {
    process.env[ENV_KEY] = 'TRUE';
    expect(isKisWsSubscriptionDiagDisabled()).toBe(false);
  });

  it('"yes" 거부', () => {
    process.env[ENV_KEY] = 'yes';
    expect(isKisWsSubscriptionDiagDisabled()).toBe(false);
  });

  it('"false" / 빈 문자열 → false', () => {
    process.env[ENV_KEY] = 'false';
    expect(isKisWsSubscriptionDiagDisabled()).toBe(false);
    process.env[ENV_KEY] = '';
    expect(isKisWsSubscriptionDiagDisabled()).toBe(false);
  });
});
