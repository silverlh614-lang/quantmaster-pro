/**
 * @responsibility 주말 KR 게이트 판정 로직 단위 테스트 — PR-24, ADR-0010
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateWeekendGate,
  isKstWeekend,
  KR_SYMBOL_PATTERN,
  proxyCacheReset,
  proxyCacheSet,
} from './marketDataRouter.js';

const SAT_KST_NOON_UTC = new Date('2026-04-25T03:00:00.000Z'); // KST 토요일 12:00
const SUN_KST_NOON_UTC = new Date('2026-04-26T03:00:00.000Z'); // KST 일요일 12:00
const MON_KST_NOON_UTC = new Date('2026-04-27T03:00:00.000Z'); // KST 월요일 12:00

describe('marketDataRouter — 주말 KR 게이트 (ADR-0010)', () => {
  beforeEach(() => proxyCacheReset());
  afterEach(() => proxyCacheReset());

  it('KR 심볼 패턴 인식 — .KS / .KQ / 6자리 숫자', () => {
    expect(KR_SYMBOL_PATTERN.test('009540.KS')).toBe(true);
    expect(KR_SYMBOL_PATTERN.test('035420.KQ')).toBe(true);
    expect(KR_SYMBOL_PATTERN.test('035420')).toBe(true);
    expect(KR_SYMBOL_PATTERN.test('AAPL')).toBe(false);
    expect(KR_SYMBOL_PATTERN.test('^KS11')).toBe(false);
  });

  it('isKstWeekend — 토/일 true, 평일 false', () => {
    expect(isKstWeekend(SAT_KST_NOON_UTC)).toBe(true);
    expect(isKstWeekend(SUN_KST_NOON_UTC)).toBe(true);
    expect(isKstWeekend(MON_KST_NOON_UTC)).toBe(false);
  });

  it('주말 KR 심볼 + 캐시 hit → stale 서빙', () => {
    proxyCacheSet('009540.KS:1y:1d', {
      body: '{"chart":"weekend-cached"}',
      contentType: 'application/json; charset=utf-8',
      expiresAt: Date.now() + 60 * 60_000,
    });
    const decision = evaluateWeekendGate('009540.KS', '1y', '1d', SAT_KST_NOON_UTC);
    expect(decision.action).toBe('stale');
    if (decision.action === 'stale') {
      expect(decision.body).toBe('{"chart":"weekend-cached"}');
    }
  });

  it('주말 KR 심볼 + 캐시 miss → skip(204)', () => {
    const decision = evaluateWeekendGate('000660.KS', '1y', '1d', SAT_KST_NOON_UTC);
    expect(decision.action).toBe('skip');
  });

  it('주말 6자리 KOSDAQ 코드도 게이트 적용', () => {
    const decision = evaluateWeekendGate('035420', '1d', '5m', SUN_KST_NOON_UTC);
    expect(decision.action).toBe('skip');
  });

  it('주말 US 심볼은 게이트 미적용 (pass)', () => {
    const decision = evaluateWeekendGate('AAPL', '1y', '1d', SAT_KST_NOON_UTC);
    expect(decision.action).toBe('pass');
  });

  it('평일 KR 심볼은 게이트 미적용 (pass)', () => {
    const decision = evaluateWeekendGate('009540.KS', '1y', '1d', MON_KST_NOON_UTC);
    expect(decision.action).toBe('pass');
  });

  it('주말 KR 심볼이지만 만료된 캐시 → skip', () => {
    proxyCacheSet('009540.KS:1y:1d', {
      body: '{"chart":"expired"}',
      contentType: 'application/json',
      expiresAt: Date.now() - 1, // 만료
    });
    const decision = evaluateWeekendGate('009540.KS', '1y', '1d', SAT_KST_NOON_UTC);
    expect(decision.action).toBe('skip');
  });
});
