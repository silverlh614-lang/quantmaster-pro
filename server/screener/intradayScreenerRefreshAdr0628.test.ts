/**
 * @responsibility ADR-0628 장중 screener 신선화 회귀 — flag OFF byte-identical·throttle 게이트·12분/하한5분 clamp·실패 비차단.
 *
 * intradayScreenerRefreshAdr0628.test.ts
 *
 * 검증 (architect pin 5케이스):
 *   1. flag OFF → maybeRefreshScreenerIntraday() false + preScreenStocks 미호출(부작용 0, byte-identical)
 *   2. flag ON + throttle 미충족 → false + preScreenStocks 미호출
 *   3. flag ON + 충족 → true + preScreenStocks 1회 호출 + lastIntradayRefreshAt 갱신(2차 즉시 호출 throttle false)
 *   4. interval clamp — 미설정/NaN/3분 입력 모두 5분 하한, 12분 기본
 *   5. preScreenStocks throw → false 반환·throw 전파 안 함(엔진 비차단, 불변식 #1)
 *   6. ENV SSOT isIntradayScreenerRefreshEnabled === 'true' 정확 비교
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  maybeRefreshScreenerIntraday,
  isIntradayScreenerRefreshEnabled,
  getIntradayScreenerRefreshIntervalMs,
  __intradayRefreshDeps,
  __resetIntradayRefreshThrottleForTest,
} from './stockScreener.js';

const ORIGINAL_PRESCREEN = __intradayRefreshDeps.preScreenStocks;

describe('ADR-0628 — 장중 screener 신선화', () => {
  let preScreenSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete process.env.INTRADAY_SCREENER_REFRESH_ENABLED;
    delete process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN;
    __resetIntradayRefreshThrottleForTest(0);
    preScreenSpy = vi.fn(async () => []);
    __intradayRefreshDeps.preScreenStocks =
      preScreenSpy as unknown as typeof __intradayRefreshDeps.preScreenStocks;
  });

  afterEach(() => {
    __intradayRefreshDeps.preScreenStocks = ORIGINAL_PRESCREEN;
    __resetIntradayRefreshThrottleForTest(0);
    delete process.env.INTRADAY_SCREENER_REFRESH_ENABLED;
    delete process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN;
    vi.restoreAllMocks();
  });

  // ── 1. flag OFF → byte-identical 부작용 0 ───────────────────────────────────
  it('1. flag OFF → false + preScreenStocks 미호출(부작용 0, byte-identical)', async () => {
    // 미설정(default OFF)
    const r1 = await maybeRefreshScreenerIntraday();
    expect(r1).toBe(false);
    // 명시 false
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'false';
    const r2 = await maybeRefreshScreenerIntraday();
    expect(r2).toBe(false);
    expect(preScreenSpy).not.toHaveBeenCalled();
  });

  // ── 2. flag ON + throttle 미충족 → false + 미호출 ────────────────────────────
  it('2. flag ON + throttle 미충족 → false + preScreenStocks 미호출', async () => {
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'true';
    // 방금 갱신한 것으로 간주 — interval 미경과.
    __resetIntradayRefreshThrottleForTest(Date.now());
    const r = await maybeRefreshScreenerIntraday();
    expect(r).toBe(false);
    expect(preScreenSpy).not.toHaveBeenCalled();
  });

  // ── 3. flag ON + 충족 → true + 1회 호출 + throttle 갱신 ──────────────────────
  it('3. flag ON + throttle 충족 → true + preScreenStocks 1회 + lastIntradayRefreshAt 갱신', async () => {
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'true';
    __resetIntradayRefreshThrottleForTest(0); // 미실행 상태 → 즉시 충족

    const r1 = await maybeRefreshScreenerIntraday();
    expect(r1).toBe(true);
    expect(preScreenSpy).toHaveBeenCalledTimes(1);

    // 직후 재호출 — throttle 갱신되어 interval 미경과 → false + 재호출 없음.
    const r2 = await maybeRefreshScreenerIntraday();
    expect(r2).toBe(false);
    expect(preScreenSpy).toHaveBeenCalledTimes(1);
  });

  // ── 4. interval clamp ───────────────────────────────────────────────────────
  it('4. interval clamp — 미설정 12분, NaN/0/3분 입력 → 5분 하한', () => {
    const FIVE_MIN = 5 * 60 * 1000;
    const TWELVE_MIN = 12 * 60 * 1000;

    delete process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN;
    expect(getIntradayScreenerRefreshIntervalMs()).toBe(TWELVE_MIN);

    process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN = 'abc'; // NaN
    expect(getIntradayScreenerRefreshIntervalMs()).toBe(FIVE_MIN);

    process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN = '0';
    expect(getIntradayScreenerRefreshIntervalMs()).toBe(FIVE_MIN);

    process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN = '3'; // 5 미만
    expect(getIntradayScreenerRefreshIntervalMs()).toBe(FIVE_MIN);

    process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN = '5'; // 경계 — 통과
    expect(getIntradayScreenerRefreshIntervalMs()).toBe(FIVE_MIN);

    process.env.INTRADAY_SCREENER_REFRESH_MIN_INTERVAL_MIN = '20'; // 정상 상향
    expect(getIntradayScreenerRefreshIntervalMs()).toBe(20 * 60 * 1000);
  });

  // ── 5. preScreenStocks throw → false·전파 안 함(엔진 비차단) ─────────────────
  it('5. preScreenStocks throw → false 반환·throw 전파 안 함(불변식 #1 엔진 비차단)', async () => {
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'true';
    __resetIntradayRefreshThrottleForTest(0);
    preScreenSpy.mockRejectedValueOnce(new Error('KIS 일시장애'));

    await expect(maybeRefreshScreenerIntraday()).resolves.toBe(false);
    expect(preScreenSpy).toHaveBeenCalledTimes(1);
    // 실패 시 throttle 미갱신 → 다음 호출 즉시 재시도 가능.
    preScreenSpy.mockResolvedValueOnce([]);
    const retry = await maybeRefreshScreenerIntraday();
    expect(retry).toBe(true);
  });

  // ── 6. ENV SSOT 정확 비교 ────────────────────────────────────────────────────
  it('6. isIntradayScreenerRefreshEnabled — `=== "true"` 정확 비교(default OFF)', () => {
    delete process.env.INTRADAY_SCREENER_REFRESH_ENABLED;
    expect(isIntradayScreenerRefreshEnabled()).toBe(false);
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'false';
    expect(isIntradayScreenerRefreshEnabled()).toBe(false);
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = '1';
    expect(isIntradayScreenerRefreshEnabled()).toBe(false);
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'TRUE';
    expect(isIntradayScreenerRefreshEnabled()).toBe(false);
    process.env.INTRADAY_SCREENER_REFRESH_ENABLED = 'true';
    expect(isIntradayScreenerRefreshEnabled()).toBe(true);
  });
});

// ── 인접 회귀: 오케스트레이터 wiring 정적 가드 ─────────────────────────────────
import fs from 'fs';
import path from 'path';

describe('ADR-0628 — tradingOrchestrator INTRADAY tick wiring 정적 가드', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../orchestrator/tradingOrchestrator.ts'),
    'utf-8',
  );

  it('wiring-a. maybeRefreshScreenerIntraday import + flag-gated 호출(scanAndUpdateIntradayWatchlist 직전)', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*maybeRefreshScreenerIntraday[^}]*\}\s*from\s*['"]\.\.\/screener\/stockScreener\.js['"]/);
    // 1줄 catch 가드 삽입 — throw 전파 차단.
    expect(SRC).toMatch(/await maybeRefreshScreenerIntraday\(\)\.catch\(\(\)\s*=>\s*false\)/);
    // scanAndUpdateIntradayWatchlist 직전 순서.
    const refreshIdx = SRC.indexOf('maybeRefreshScreenerIntraday()');
    const scanIdx = SRC.indexOf('scanAndUpdateIntradayWatchlist().catch');
    expect(refreshIdx).toBeGreaterThan(0);
    expect(scanIdx).toBeGreaterThan(refreshIdx);
  });
});
