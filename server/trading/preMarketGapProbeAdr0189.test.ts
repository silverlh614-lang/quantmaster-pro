/**
 * preMarketGapProbeAdr0189.test.ts — KRX 거래일 달력 SSOT 적용 후 stale 분기 회귀 검증.
 *
 * ADR-0189: `businessDaysBetween()` 의 KRX 휴장일 미반영 결함 차단.
 *
 * 시나리오 매트릭스:
 *   - 시나리오 A: NOW=5/4 월 + tradingDate=4/30 → PROCEED (5/1 근로자의 날 휴장 반영)
 *   - 시나리오 B: NOW=5/6 수 + tradingDate=5/4 → PROCEED (5/5 어린이날 휴장 반영)
 *   - 진짜 stale: NOW=5/4 + tradingDate=4/24 (1주 전) → SKIP_STALE 유지
 *   - ENV 우회: PRE_MARKET_GAP_KRX_CALENDAR_DISABLED=true 시 legacy 동작
 *   - ENV 정확 비교: '1'/'TRUE'/'yes' 거부
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED;

describe('preMarketGapProbe — ADR-0189 KRX 거래일 달력', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED;
  });

  afterEach(() => {
    vi.doUnmock('../clients/kisClient.js');
    vi.useRealTimers();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED;
    } else {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = ORIGINAL_ENV;
    }
  });

  // ── ENV 헬퍼 ────────────────────────────────────────────────────────────────

  describe('isPreMarketGapKrxCalendarDisabled — ENV gate', () => {
    it('미설정 → false (default OFF, 정책 적용)', async () => {
      delete process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED;
      const { isPreMarketGapKrxCalendarDisabled } = await import('./preMarketGapProbe.js');
      expect(isPreMarketGapKrxCalendarDisabled()).toBe(false);
    });

    it('"true" → true (legacy 동작)', async () => {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = 'true';
      const { isPreMarketGapKrxCalendarDisabled } = await import('./preMarketGapProbe.js');
      expect(isPreMarketGapKrxCalendarDisabled()).toBe(true);
    });

    it('"1" → false (정확 비교 의무, ADR-0157)', async () => {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = '1';
      const { isPreMarketGapKrxCalendarDisabled } = await import('./preMarketGapProbe.js');
      expect(isPreMarketGapKrxCalendarDisabled()).toBe(false);
    });

    it('"TRUE" → false (대소문자 정확 비교)', async () => {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = 'TRUE';
      const { isPreMarketGapKrxCalendarDisabled } = await import('./preMarketGapProbe.js');
      expect(isPreMarketGapKrxCalendarDisabled()).toBe(false);
    });

    it('"yes"/"false"/빈 문자열 → false', async () => {
      const { isPreMarketGapKrxCalendarDisabled } = await import('./preMarketGapProbe.js');
      for (const v of ['yes', 'false', '']) {
        process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = v;
        expect(isPreMarketGapKrxCalendarDisabled()).toBe(false);
      }
    });
  });

  // ── 시나리오 A: 5/4 월 + 4/30 → PROCEED ─────────────────────────────────────

  describe('시나리오 A — 5/4 월 (정상 거래일) 장전, prev.tradingDate=4/30 목', () => {
    it('default 정책 → PROCEED (KRX 5/1 휴장 반영)', async () => {
      // KST 5/4 09:00 = UTC 5/4 00:00
      vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-04-30',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      expect(res.decision).toBe('PROCEED');
      expect(res.tradingDate).toBe('2026-04-30');
    });

    it('legacy ENV 우회 → SKIP_STALE (businessDaysBetween 결함 재현)', async () => {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = 'true';
      vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-04-30',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      // legacy: businessDaysBetween 가 5/1 + 5/4 = 2 카운트 → SKIP_STALE
      expect(res.decision).toBe('SKIP_STALE');
      expect(res.reason).toMatch(/영업일 전/);
    });
  });

  // ── 시나리오 B: 5/6 수 + 5/4 → PROCEED ──────────────────────────────────────

  describe('시나리오 B — 5/6 수 장전, prev.tradingDate=5/4 월', () => {
    it('default 정책 → PROCEED (KRX 5/5 어린이날 휴장 반영)', async () => {
      vi.setSystemTime(new Date('2026-05-06T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-05-04',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      expect(res.decision).toBe('PROCEED');
      expect(res.tradingDate).toBe('2026-05-04');
    });

    it('legacy ENV 우회 → SKIP_STALE (businessDaysBetween 결함 재현)', async () => {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = 'true';
      vi.setSystemTime(new Date('2026-05-06T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-05-04',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      // legacy: businessDaysBetween 가 5/5 + 5/6 = 2 카운트 → SKIP_STALE
      expect(res.decision).toBe('SKIP_STALE');
      expect(res.reason).toMatch(/영업일 전/);
    });
  });

  // ── 진짜 stale: 1주 전 → SKIP_STALE ─────────────────────────────────────────

  describe('진짜 stale — KRX 거래일 달력에서도 stale 판정 유지', () => {
    it('NOW=5/4 + tradingDate=4/24 (1주 전) → SKIP_STALE', async () => {
      vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-04-24', // 4/30 expected, lookback 4/29 까지만 grace
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      expect(res.decision).toBe('SKIP_STALE');
      expect(res.tradingDate).toBe('2026-04-24');
      expect(res.reason).toMatch(/KRX 거래일 stale/);
    });

    it('NOW=5/6 + tradingDate=4/29 (5 영업일 전) → SKIP_STALE', async () => {
      // expected = 5/4 (5/5 휴장 → 5/4), lookback grace 4/30 까지만
      vi.setSystemTime(new Date('2026-05-06T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-04-29',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      expect(res.decision).toBe('SKIP_STALE');
    });
  });

  // ── 메시지 형식 ────────────────────────────────────────────────────────────

  describe('SKIP_STALE 메시지 형식', () => {
    it('default 정책 → "KRX 거래일 stale" 라벨 + 진단 영업일 격차', async () => {
      vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-04-24',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      expect(res.decision).toBe('SKIP_STALE');
      expect(res.reason).toMatch(/KRX 거래일 stale/);
      expect(res.reason).toMatch(/2026-04-24/);
      expect(res.reason).toMatch(/~\d+영업일 전/);
    });

    it('legacy ENV 우회 → "N영업일 전" 라벨 (기존 형식 보존)', async () => {
      process.env.PRE_MARKET_GAP_KRX_CALENDAR_DISABLED = 'true';
      vi.setSystemTime(new Date('2026-05-04T00:00:00Z'));
      vi.doMock('../clients/kisClient.js', () => ({
        fetchKisPrevClose: vi.fn().mockResolvedValue({
          stockCode: '005930',
          prevClose: 70_000,
          tradingDate: '2026-04-24',
          fetchedAt: new Date().toISOString(),
        }),
      }));
      const { probePreMarketGap } = await import('./preMarketGapProbe.js');
      const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
      expect(res.decision).toBe('SKIP_STALE');
      expect(res.reason).toMatch(/^전일종가 \d+영업일 전/);
      expect(res.reason).not.toMatch(/KRX 거래일 stale/);
    });
  });
});
