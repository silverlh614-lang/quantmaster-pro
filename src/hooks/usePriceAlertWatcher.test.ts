/**
 * @responsibility shouldDispatchAlert + requestPriceAlertPermission 단위 테스트 — ADR-0030 PR-C
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldDispatchAlert,
  ALERT_COOLDOWN_MS,
  requestPriceAlertPermission,
} from './usePriceAlertWatcher';

describe('shouldDispatchAlert — ADR-0030 transition + cooldown', () => {
  const now = 1_700_000_000_000;

  it('NORMAL 레벨 → false (알림 대상 아님)', () => {
    expect(shouldDispatchAlert('NORMAL', undefined, null, now)).toBe(false);
    expect(shouldDispatchAlert('NORMAL', 'CAUTION', null, now)).toBe(false);
  });

  it('처음 actionable 진입 (previousLevel 없음) + lastFiredAt=null → true', () => {
    expect(shouldDispatchAlert('CAUTION', undefined, null, now)).toBe(true);
    expect(shouldDispatchAlert('DANGER', undefined, null, now)).toBe(true);
    expect(shouldDispatchAlert('TAKE_PROFIT', undefined, null, now)).toBe(true);
  });

  it('같은 레벨 유지 (transition 없음) → false', () => {
    expect(shouldDispatchAlert('CAUTION', 'CAUTION', null, now)).toBe(false);
    expect(shouldDispatchAlert('DANGER', 'DANGER', null, now)).toBe(false);
  });

  it('CAUTION → DANGER transition + cooldown 만료 → true', () => {
    const fiveMinPlusAgo = now - ALERT_COOLDOWN_MS - 1;
    expect(shouldDispatchAlert('DANGER', 'CAUTION', fiveMinPlusAgo, now)).toBe(true);
  });

  it('cooldown 내 (5분 미만) → false', () => {
    const oneMinAgo = now - 60_000;
    expect(shouldDispatchAlert('DANGER', 'CAUTION', oneMinAgo, now)).toBe(false);
  });

  it('cooldown 정확히 5분 도달 → false (≤ 차단)', () => {
    const exactly5MinAgo = now - ALERT_COOLDOWN_MS;
    expect(shouldDispatchAlert('DANGER', 'CAUTION', exactly5MinAgo, now)).toBe(false);
  });

  it('cooldown 5분 + 1ms 경과 → true', () => {
    const justOver5Min = now - ALERT_COOLDOWN_MS - 1;
    expect(shouldDispatchAlert('DANGER', 'CAUTION', justOver5Min, now)).toBe(true);
  });

  it('lastFiredAt=NaN/Infinity → cooldown 무시 + true', () => {
    expect(shouldDispatchAlert('CAUTION', undefined, NaN, now)).toBe(true);
    expect(shouldDispatchAlert('CAUTION', undefined, Infinity, now)).toBe(true);
  });

  it('NORMAL → CAUTION transition + lastFiredAt 부재 → true', () => {
    expect(shouldDispatchAlert('CAUTION', 'NORMAL', null, now)).toBe(true);
  });

  it('TAKE_PROFIT → DANGER transition + cooldown 만료 → true (다른 레벨끼리도 transition)', () => {
    const twentyMinAgo = now - 20 * 60_000;
    expect(shouldDispatchAlert('DANGER', 'TAKE_PROFIT', twentyMinAgo, now)).toBe(true);
  });

  it('이미 같은 레벨 + cooldown 만료 → false (transition 우선)', () => {
    const oneHourAgo = now - 60 * 60_000;
    expect(shouldDispatchAlert('DANGER', 'DANGER', oneHourAgo, now)).toBe(false);
  });
});

describe('requestPriceAlertPermission — ADR-0030 권한 흐름', () => {
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    // node 환경에선 window 가 부재 — 테스트마다 명시적 stub
    (globalThis as { window?: unknown }).window = (globalThis as { window?: unknown }).window ?? {};
  });

  afterEach(() => {
    if (originalNotification === undefined) {
      delete (globalThis as { Notification?: unknown }).Notification;
    } else {
      (globalThis as { Notification?: unknown }).Notification = originalNotification;
    }
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('Notification API 미지원 → unsupported', async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    const result = await requestPriceAlertPermission();
    expect(result).toBe('unsupported');
  });

  it('이미 granted 상태 → granted (재요청 안 함)', async () => {
    const requestSpy = vi.fn();
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'granted',
      requestPermission: requestSpy,
    };
    const result = await requestPriceAlertPermission();
    expect(result).toBe('granted');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('이미 denied 상태 → denied (재요청 안 함, 브라우저 정책)', async () => {
    const requestSpy = vi.fn();
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'denied',
      requestPermission: requestSpy,
    };
    const result = await requestPriceAlertPermission();
    expect(result).toBe('denied');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('default 상태 + 사용자 granted 응답 → granted', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
    const result = await requestPriceAlertPermission();
    expect(result).toBe('granted');
  });

  it('default 상태 + 사용자 denied 응답 → denied', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('denied'),
    };
    const result = await requestPriceAlertPermission();
    expect(result).toBe('denied');
  });

  it('requestPermission throw → default (안전 fallback)', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const result = await requestPriceAlertPermission();
    expect(result).toBe('default');
  });

  it('requestPermission 가 알 수 없는 값 반환 → default', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('unknown_string'),
    };
    const result = await requestPriceAlertPermission();
    expect(result).toBe('default');
  });
});
