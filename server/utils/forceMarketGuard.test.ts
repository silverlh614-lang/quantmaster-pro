/**
 * @responsibility forceMarketGuard SSOT 회귀 — env 토글 + 예외 시 복구 (장외 강제 명령용)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withForcedMarket, isForcedMarketActive } from './forceMarketGuard.js';
import { isMarketOpen } from './marketClock.js';

const KEY = 'DATA_FETCH_FORCE_MARKET';

beforeEach(() => {
  delete process.env[KEY];
});

afterEach(() => {
  delete process.env[KEY];
});

describe('withForcedMarket — 임시 env 토글 SSOT', () => {
  it('미설정 상태에서 진입 → fn 실행 중 true → 종료 후 미설정 복구', async () => {
    expect(process.env[KEY]).toBeUndefined();

    let insideValue: string | undefined;
    const result = await withForcedMarket(async () => {
      insideValue = process.env[KEY];
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(insideValue).toBe('true');
    expect(process.env[KEY]).toBeUndefined();
  });

  it('이미 설정된 상태(false) 에서 진입 → 종료 후 false 복구 (의도된 값 보존)', async () => {
    process.env[KEY] = 'false';

    await withForcedMarket(async () => {
      expect(process.env[KEY]).toBe('true');
    });

    expect(process.env[KEY]).toBe('false');
  });

  it('이미 true 인 상태에서 진입 → 종료 후 true 유지', async () => {
    process.env[KEY] = 'true';

    await withForcedMarket(async () => {
      expect(process.env[KEY]).toBe('true');
    });

    expect(process.env[KEY]).toBe('true');
  });

  it('fn 이 throw → finally 블록에서 env 복구 + 예외 전파', async () => {
    expect(process.env[KEY]).toBeUndefined();

    await expect(async () => {
      await withForcedMarket(async () => {
        throw new Error('boom');
      });
    }).rejects.toThrow('boom');

    expect(process.env[KEY]).toBeUndefined();
  });

  it('fn 이 throw + 사전 설정값 있음 → 사전 값 그대로 복구', async () => {
    process.env[KEY] = 'preserved';

    await expect(async () => {
      await withForcedMarket(async () => {
        throw new Error('boom');
      });
    }).rejects.toThrow();

    expect(process.env[KEY]).toBe('preserved');
  });

  it('marketClock.isMarketOpen 가 진입 중에 true 반환 (장외 시각 mock)', async () => {
    // KST 토요일 정오 — 평소 false 인 시점
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T03:00:00Z'));

    expect(isMarketOpen()).toBe(false);

    await withForcedMarket(async () => {
      expect(isMarketOpen()).toBe(true); // env override 효과
    });

    expect(isMarketOpen()).toBe(false); // 복구

    vi.useRealTimers();
  });
});

describe('isForcedMarketActive — read-only 진단', () => {
  it('미설정 → false', () => {
    expect(isForcedMarketActive()).toBe(false);
  });

  it('"true" 설정 → true', () => {
    process.env[KEY] = 'true';
    expect(isForcedMarketActive()).toBe(true);
  });

  it('"false" 설정 → false', () => {
    process.env[KEY] = 'false';
    expect(isForcedMarketActive()).toBe(false);
  });

  it('"TRUE" 대문자 → false (정확히 "true" 만 인정)', () => {
    process.env[KEY] = 'TRUE';
    expect(isForcedMarketActive()).toBe(false);
  });
});
