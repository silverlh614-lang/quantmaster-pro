/**
 * @responsibility marketClock — 장중/장외/통계확정 판정 회귀 테스트 (ADR-0009)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  isMarketOpen,
  isMarketDataPublished,
  isPostClosePendingPublish,
  describeMarketPhase,
  isKstWeekend,
} from './marketClock.js';

// UTC 기준: KST = UTC + 9
// 2026-04-24 (금요일) KST 10:00 → UTC 01:00
const FRI_1000_KST = new Date('2026-04-24T01:00:00.000Z');
const FRI_1530_KST = new Date('2026-04-24T06:30:00.000Z'); // 장 마감 직후
const FRI_1700_KST = new Date('2026-04-24T08:00:00.000Z'); // POST_CLOSE_PENDING
const FRI_1900_KST = new Date('2026-04-24T10:00:00.000Z'); // 통계 확정 이후
const SAT_1000_KST = new Date('2026-04-25T01:00:00.000Z');

afterEach(() => {
  delete process.env.DATA_FETCH_FORCE_MARKET;
  delete process.env.DATA_FETCH_FORCE_OFF;
});

describe('marketClock.isMarketOpen', () => {
  it('평일 10:00 KST — 장중', () => {
    expect(isMarketOpen(FRI_1000_KST)).toBe(true);
  });
  it('평일 15:30 KST — 장 마감 직후, 장외', () => {
    expect(isMarketOpen(FRI_1530_KST)).toBe(false);
  });
  it('평일 19:00 KST — 장외', () => {
    expect(isMarketOpen(FRI_1900_KST)).toBe(false);
  });
  it('토요일 10:00 KST — 장외', () => {
    expect(isMarketOpen(SAT_1000_KST)).toBe(false);
  });
  it('DATA_FETCH_FORCE_OFF=true — 장중 시각이어도 false', () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    expect(isMarketOpen(FRI_1000_KST)).toBe(false);
  });
  it('DATA_FETCH_FORCE_MARKET=true — 장외여도 true', () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    expect(isMarketOpen(SAT_1000_KST)).toBe(true);
  });
});

describe('marketClock.isMarketDataPublished', () => {
  it('평일 17:00 KST — 아직 미확정', () => {
    expect(isMarketDataPublished(FRI_1700_KST)).toBe(false);
  });
  it('평일 19:00 KST — 확정', () => {
    expect(isMarketDataPublished(FRI_1900_KST)).toBe(true);
  });
  it('주말 — 직전 영업일 기준 확정 상태', () => {
    expect(isMarketDataPublished(SAT_1000_KST)).toBe(true);
  });
  it('DATA_FETCH_FORCE_OFF=true — 통계도 미확정 취급 (캐시 강제)', () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    expect(isMarketDataPublished(FRI_1900_KST)).toBe(false);
  });
});

describe('marketClock.isPostClosePendingPublish', () => {
  it('평일 17:00 KST — pending 구간', () => {
    expect(isPostClosePendingPublish(FRI_1700_KST)).toBe(true);
  });
  it('평일 10:00 KST — 장중이므로 false', () => {
    expect(isPostClosePendingPublish(FRI_1000_KST)).toBe(false);
  });
  it('평일 19:00 KST — 확정 이후이므로 false', () => {
    expect(isPostClosePendingPublish(FRI_1900_KST)).toBe(false);
  });
});

describe('marketClock.isKstWeekend', () => {
  it('토요일 KST true', () => {
    expect(isKstWeekend(SAT_1000_KST)).toBe(true);
  });
  it('금요일 KST false', () => {
    expect(isKstWeekend(FRI_1000_KST)).toBe(false);
  });
  it('UTC 금요일 16:00 = KST 토요일 01:00 → true', () => {
    // UTC 2026-04-24 16:00 = KST 2026-04-25 01:00 (토)
    expect(isKstWeekend(new Date('2026-04-24T16:00:00.000Z'))).toBe(true);
  });
});

describe('marketClock.describeMarketPhase', () => {
  it('라벨이 4종 중 하나로 정규화된다', () => {
    expect(describeMarketPhase(FRI_1000_KST)).toBe('OPEN');
    expect(describeMarketPhase(FRI_1700_KST)).toBe('POST_CLOSE_PENDING');
    expect(describeMarketPhase(FRI_1900_KST)).toBe('OFF_HOURS');
    expect(describeMarketPhase(SAT_1000_KST)).toBe('WEEKEND');
  });
});
