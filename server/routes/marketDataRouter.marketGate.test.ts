/**
 * @responsibility 시장 게이트 판정 로직 단위 테스트 — SymbolMarketRegistry 위임
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateMarketGate,
  proxyCacheReset,
  proxyCacheSet,
} from './marketDataRouter.js';

// UTC 기준: KST = UTC+9, ET = UTC-5 (EST)
const SAT_KST_NOON_UTC      = new Date('2026-04-25T03:00:00.000Z'); // KST 토 12:00 / ET 금 22:00 → NYSE 닫힘
const SUN_KST_NOON_UTC      = new Date('2026-04-26T03:00:00.000Z'); // KST 일 12:00 / ET 토 22:00 → NYSE 닫힘
const MON_KST_NOON_UTC      = new Date('2026-04-27T03:00:00.000Z'); // KST 월 12:00 / ET 일 22:00 → KRX 열림, NYSE 닫힘
const MON_KST_EVENING_UTC   = new Date('2026-04-27T08:00:00.000Z'); // KST 월 17:00 / ET 월 03:00 → KRX 닫힘, NYSE 닫힘
const MON_NYSE_OPEN_UTC     = new Date('2026-04-27T15:30:00.000Z'); // KST 화 00:30 / ET 월 10:30 → NYSE 열림, KRX 닫힘

describe('evaluateMarketGate — SymbolMarketRegistry 게이트', () => {
  beforeEach(() => proxyCacheReset());
  afterEach(() => proxyCacheReset());

  it('KRX 장중(월요일 정오 KST) — KR 심볼 pass', () => {
    expect(evaluateMarketGate('009540.KS', '1y', '1d', MON_KST_NOON_UTC).action).toBe('pass');
    expect(evaluateMarketGate('035420',    '1d', '5m', MON_KST_NOON_UTC).action).toBe('pass');
  });

  it('KRX 장외(월요일 17:00 KST) — 캐시 miss → skip', () => {
    expect(evaluateMarketGate('009540.KS', '1y', '1d', MON_KST_EVENING_UTC).action).toBe('skip');
  });

  it('KRX 장외(토요일) + 캐시 hit → stale 서빙', () => {
    proxyCacheSet('009540.KS:1y:1d', {
      body: '{"chart":"weekend-cached"}',
      contentType: 'application/json; charset=utf-8',
      expiresAt: Date.now() + 60 * 60_000,
    });
    const decision = evaluateMarketGate('009540.KS', '1y', '1d', SAT_KST_NOON_UTC);
    expect(decision.action).toBe('stale');
    if (decision.action === 'stale') {
      expect(decision.body).toBe('{"chart":"weekend-cached"}');
    }
  });

  it('KRX 주말 + 캐시 miss → skip', () => {
    expect(evaluateMarketGate('000660.KS', '1y', '1d', SAT_KST_NOON_UTC).action).toBe('skip');
    expect(evaluateMarketGate('035420',    '1d', '5m', SUN_KST_NOON_UTC).action).toBe('skip');
  });

  it('NYSE 평일 장중(ET 월 10:30) — US 심볼 pass, KR 심볼 skip', () => {
    expect(evaluateMarketGate('AAPL', '1y', '1d', MON_NYSE_OPEN_UTC).action).toBe('pass');
    expect(evaluateMarketGate('^VIX', '5d', '1d', MON_NYSE_OPEN_UTC).action).toBe('pass');
    expect(evaluateMarketGate('009540.KS', '1y', '1d', MON_NYSE_OPEN_UTC).action).toBe('skip');
  });

  it('NYSE 장외(KST 토요일 정오 ≒ ET 금 22:00) — US 심볼 skip', () => {
    expect(evaluateMarketGate('AAPL', '1y', '1d', SAT_KST_NOON_UTC).action).toBe('skip');
    expect(evaluateMarketGate('MTUM', '5d', '1d', SAT_KST_NOON_UTC).action).toBe('skip');
  });

  it('KR 지수 ^KS11 / ^KQ11 / ^VKOSPI 는 KRX 로 분류', () => {
    expect(evaluateMarketGate('^KS11',   '1d', '5m', MON_KST_NOON_UTC).action).toBe('pass');
    expect(evaluateMarketGate('^KS11',   '1d', '5m', SAT_KST_NOON_UTC).action).toBe('skip');
    expect(evaluateMarketGate('^VKOSPI', '1d', '5m', MON_KST_EVENING_UTC).action).toBe('skip');
  });

  it('만료된 캐시 → skip (stale 서빙 안 함)', () => {
    proxyCacheSet('009540.KS:1y:1d', {
      body: '{"chart":"expired"}',
      contentType: 'application/json',
      expiresAt: Date.now() - 1,
    });
    expect(evaluateMarketGate('009540.KS', '1y', '1d', SAT_KST_NOON_UTC).action).toBe('skip');
  });

  it('ET 17:00~23:30 구간 — US 심볼도 skip (평일 장외 차단)', () => {
    // KST 화 08:00 = ET 월 18:00 → NYSE 마감 직후
    const MON_ET_EVENING_UTC = new Date('2026-04-27T23:00:00.000Z'); // KST 화 08:00 / ET 월 18:00
    expect(evaluateMarketGate('AAPL', '1y', '1d', MON_ET_EVENING_UTC).action).toBe('skip');
  });
});
