/**
 * preMarketGapProbe.test.ts — 5개 decision 분기 계약 테스트.
 *
 * PROCEED · WARN · SKIP_DATA_ERROR · SKIP_STALE · SKIP_NO_DATA 각각
 * 최소 1건 + businessDaysBetween 경계(주말 스킵) 1건.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('preMarketGapProbe — decision 분기', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../clients/kisClient.js');
  });

  // ── PROCEED: |gap| < 2% ────────────────────────────────────────────────
  it('PROCEED — entryPrice 가 prevClose 와 ±2% 이내면 진행', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // 실제로는 KST today 를 기대하지만 UTC 기준과 거의 일치하면 영업일 0 반환.
    vi.doMock('../clients/kisClient.js', () => ({
      fetchKisPrevClose: vi.fn().mockResolvedValue({
        stockCode: '005930',
        prevClose: 70_000,
        tradingDate: today,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { probePreMarketGap } = await import('./preMarketGapProbe.js');
    const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 }); // +0.71%
    expect(res.decision).toBe('PROCEED');
    expect(res.prevClose).toBe(70_000);
    expect(res.gapPct).toBeCloseTo(0.71, 1);
  });

  // ── WARN: 2% <= |gap| < 30% ────────────────────────────────────────────
  it('WARN — |gap|=2.5% 이면 경보 부착 후 진행', async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.doMock('../clients/kisClient.js', () => ({
      fetchKisPrevClose: vi.fn().mockResolvedValue({
        stockCode: '005930',
        prevClose: 100_000,
        tradingDate: today,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { probePreMarketGap } = await import('./preMarketGapProbe.js');
    const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 102_500 });
    expect(res.decision).toBe('WARN');
    expect(res.gapPct).toBeCloseTo(2.5, 1);
    expect(res.reason).toContain('경보');
  });

  // ── SKIP_DATA_ERROR: |gap| >= 30% ──────────────────────────────────────
  it('SKIP_DATA_ERROR — |gap|>=30% 이면 데이터 오류로 스킵', async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.doMock('../clients/kisClient.js', () => ({
      fetchKisPrevClose: vi.fn().mockResolvedValue({
        stockCode: '005930',
        prevClose: 100_000,
        tradingDate: today,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { probePreMarketGap } = await import('./preMarketGapProbe.js');
    const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 60_000 }); // -40%
    expect(res.decision).toBe('SKIP_DATA_ERROR');
    expect(res.reason).toContain('데이터 오류');
  });

  // ── SKIP_STALE: tradingDate 2영업일 이상 과거 ─────────────────────────
  it('SKIP_STALE — tradingDate 가 5일 전이면 stale 스킵', async () => {
    // 5일 전 (주말 포함해도 최소 3영업일 이상 격차)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    vi.doMock('../clients/kisClient.js', () => ({
      fetchKisPrevClose: vi.fn().mockResolvedValue({
        stockCode: '005930',
        prevClose: 70_000,
        tradingDate: fiveDaysAgo,
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { probePreMarketGap } = await import('./preMarketGapProbe.js');
    const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
    expect(res.decision).toBe('SKIP_STALE');
    expect(res.reason).toMatch(/영업일 전/);
  });

  // ── SKIP_NO_DATA: fetchKisPrevClose 실패 ──────────────────────────────
  it('SKIP_NO_DATA — fetchKisPrevClose 가 null 이면 스킵', async () => {
    vi.doMock('../clients/kisClient.js', () => ({
      fetchKisPrevClose: vi.fn().mockResolvedValue(null),
    }));
    const { probePreMarketGap } = await import('./preMarketGapProbe.js');
    const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 70_500 });
    expect(res.decision).toBe('SKIP_NO_DATA');
    expect(res.prevClose).toBeNull();
  });

  it('SKIP_NO_DATA — entryPrice 무효(<=0) 면 즉시 스킵', async () => {
    vi.doMock('../clients/kisClient.js', () => ({
      fetchKisPrevClose: vi.fn().mockResolvedValue({
        stockCode: '005930', prevClose: 70_000,
        tradingDate: new Date().toISOString().slice(0, 10),
        fetchedAt: new Date().toISOString(),
      }),
    }));
    const { probePreMarketGap } = await import('./preMarketGapProbe.js');
    const res = await probePreMarketGap({ stockCode: '005930', entryPrice: 0 });
    expect(res.decision).toBe('SKIP_NO_DATA');
  });

  // ── businessDaysBetween: 주말 스킵 확인 ────────────────────────────────
  it('businessDaysBetween — 주말(토·일) 은 격차에서 제외', async () => {
    const { businessDaysBetween } = await import('./preMarketGapProbe.js');
    // 월요일 기준 직전 금요일 = 1영업일 전 (주말 2일은 스킵).
    const monday = new Date('2026-04-20T12:00:00Z'); // 2026-04-20 is a Monday
    // tradingDate 로 금요일(2026-04-17) 을 주면 1영업일 전이 나와야 함.
    // Note: 로직은 KST 기준 오늘을 사용하므로 now 를 주입한 값으로 비교.
    const diff = businessDaysBetween('2026-04-17', monday);
    expect(diff).toBe(1);
  });

  it('businessDaysBetween — tradingDate 가 오늘과 같으면 0', async () => {
    const { businessDaysBetween } = await import('./preMarketGapProbe.js');
    const now = new Date();
    const todayKst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(businessDaysBetween(todayKst, now)).toBe(0);
  });
});
