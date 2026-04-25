/**
 * @responsibility useMarketMode 분류기 단위 테스트 — ADR-0016 (PR-37) MarketDataMode SSOT
 */
import { describe, it, expect } from 'vitest';
import { classifyClientMarketMode } from './useMarketMode';

describe('classifyClientMarketMode — ADR-0016 5분류', () => {
  it('평일 KST 10:00 (월요일) → LIVE_TRADING_DAY', () => {
    // 2026-04-27 월요일 KST 10:00 = UTC 2026-04-27 01:00
    const monMorning = new Date(Date.UTC(2026, 3, 27, 1, 0, 0));
    expect(classifyClientMarketMode(monMorning)).toBe('LIVE_TRADING_DAY');
  });

  it('평일 KST 16:00 (월요일 장 마감 후) → AFTER_MARKET', () => {
    // 2026-04-27 월요일 KST 16:00 = UTC 2026-04-27 07:00
    const monAfter = new Date(Date.UTC(2026, 3, 27, 7, 0, 0));
    expect(classifyClientMarketMode(monAfter)).toBe('AFTER_MARKET');
  });

  it('토요일 KST 14:00 → WEEKEND_CACHE', () => {
    // 2026-04-25 토요일 KST 14:00 = UTC 2026-04-25 05:00
    const sat = new Date(Date.UTC(2026, 3, 25, 5, 0, 0));
    expect(classifyClientMarketMode(sat)).toBe('WEEKEND_CACHE');
  });

  it('일요일 KST 11:00 → WEEKEND_CACHE', () => {
    // 2026-04-26 일요일 KST 11:00 = UTC 2026-04-26 02:00
    const sun = new Date(Date.UTC(2026, 3, 26, 2, 0, 0));
    expect(classifyClientMarketMode(sun)).toBe('WEEKEND_CACHE');
  });

  it('평일 KST 08:00 (개장 전) → AFTER_MARKET', () => {
    // 2026-04-27 월요일 KST 08:00 = UTC 2026-04-26 23:00
    const monBefore = new Date(Date.UTC(2026, 3, 26, 23, 0, 0));
    expect(classifyClientMarketMode(monBefore)).toBe('AFTER_MARKET');
  });

  it('평일 KST 15:30 (정확히 마감 시각) → AFTER_MARKET (closeMin 포함 안 함)', () => {
    // 2026-04-27 월요일 KST 15:30 = UTC 2026-04-27 06:30
    const monClose = new Date(Date.UTC(2026, 3, 27, 6, 30, 0));
    expect(classifyClientMarketMode(monClose)).toBe('AFTER_MARKET');
  });
});
