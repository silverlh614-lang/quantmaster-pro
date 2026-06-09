// @responsibility ADR-0590 kospiTriggerFreshness 순수 SSOT 단위 커버리지 (trade-date 강등 / legacy 폴백 / close-shock 분리 / flag).
import { describe, expect, it, afterEach } from 'vitest';
import { resolveKospiTriggerFreshness, isTradeDateFreshnessEnabled } from './kospiTriggerFreshness.js';

// 2026-06-09(화) 는 KRX 거래일. 2026-06-08(월) 도 거래일(어제 봉). 2026-06-06(현충일)·주말 회피.
const NOW = new Date('2026-06-09T02:00:00.000Z'); // 11:00 KST 거래일
const TODAY_KEY = '2026-06-09';
const YESTERDAY_KEY = '2026-06-08';

afterEach(() => {
  delete process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED;
});

describe('resolveKospiTriggerFreshness (ADR-0590 D1 + Codex 정합 정정: per-trigger 강등)', () => {
  // 케이스 1: trade-date=오늘 → freshness 보존, intraday 트리거 active 유지(무강등).
  it('preserves freshness when trade-date is today (intraday trigger stays active-eligible)', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: TODAY_KEY, ageFreshness: 'FRESH', now: NOW });
    expect(r.freshness).toBe('FRESH');
    expect(r.tradeDateIsToday).toBe(true);
    expect(r.intradayDowngraded).toBe(false);
  });

  // 케이스 2: trade-date=어제(폭락) + age 짧음(FRESH) → 글로벌 freshness 보존 + intraday-low 만 per-trigger 강등(결함 A 회귀 방지).
  it('preserves global freshness but flags intradayDowngraded when trade-date bar is yesterday (defect A)', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: YESTERDAY_KEY, ageFreshness: 'FRESH', now: NOW });
    expect(r.freshness).toBe('FRESH');             // 글로벌 freshness 보존(recovery/latch side-effect 무회귀)
    expect(r.tradeDateIsToday).toBe(false);
    expect(r.intradayDowngraded).toBe(true);
  });

  it('flags intradayDowngraded for SOFT_STALE age while preserving global freshness when trade-date is yesterday', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: YESTERDAY_KEY, ageFreshness: 'SOFT_STALE', now: NOW });
    expect(r.freshness).toBe('SOFT_STALE');
    expect(r.intradayDowngraded).toBe(true);
  });

  // 케이스 3: trade-date 부재/파싱 실패 → 강등 안 함(보수, age-only 그대로).
  it('falls back to legacy age freshness when trade-date is absent', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: undefined, ageFreshness: 'FRESH', now: NOW });
    expect(r.freshness).toBe('FRESH');
    expect(r.intradayDowngraded).toBe(false);
  });

  it('falls back to legacy age freshness when trade-date is malformed', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: '20260608', ageFreshness: 'FRESH', now: NOW });
    expect(r.freshness).toBe('FRESH');
    expect(r.intradayDowngraded).toBe(false);
  });

  // 케이스 4: close-shock 계열(POST_CLOSE/EOD)은 active 게이팅 대상 아님 → intradayDowngraded=false(분리).
  it('does NOT flag intradayDowngraded for POST_CLOSE_VALID even when trade-date is yesterday (close-shock separated)', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: YESTERDAY_KEY, ageFreshness: 'POST_CLOSE_VALID', now: NOW });
    expect(r.freshness).toBe('POST_CLOSE_VALID');
    expect(r.intradayDowngraded).toBe(false);
  });

  it('does NOT flag intradayDowngraded for EOD_SNAPSHOT_VALID when trade-date is yesterday', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: YESTERDAY_KEY, ageFreshness: 'EOD_SNAPSHOT_VALID', now: NOW });
    expect(r.freshness).toBe('EOD_SNAPSHOT_VALID');
    expect(r.intradayDowngraded).toBe(false);
  });

  it('keeps already-stale freshness unchanged and no intraday downgrade when trade-date is yesterday', () => {
    const r = resolveKospiTriggerFreshness({ tradeDate: YESTERDAY_KEY, ageFreshness: 'HARD_STALE', now: NOW });
    expect(r.freshness).toBe('HARD_STALE');
    expect(r.intradayDowngraded).toBe(false);
  });

  // 거래일이 아닌 now(주말) → 봉 거래일 게이트 적용 불가 → 강등 안 함(보수).
  it('falls back to legacy freshness when today is not a KRX trading day (weekend)', () => {
    const weekend = new Date('2026-06-07T02:00:00.000Z'); // 일요일
    const r = resolveKospiTriggerFreshness({ tradeDate: '2026-06-05', ageFreshness: 'FRESH', now: weekend });
    expect(r.freshness).toBe('FRESH');
    expect(r.intradayDowngraded).toBe(false);
  });
});

describe('isTradeDateFreshnessEnabled (ADR-0590 flag, default OFF)', () => {
  // 케이스 5: flag default OFF.
  it('returns false when env unset (baseline byte-equivalent)', () => {
    expect(isTradeDateFreshnessEnabled()).toBe(false);
  });

  it('returns true only when env === "true"', () => {
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = 'true';
    expect(isTradeDateFreshnessEnabled()).toBe(true);
    process.env.R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED = '1';
    expect(isTradeDateFreshnessEnabled()).toBe(false);
  });
});
