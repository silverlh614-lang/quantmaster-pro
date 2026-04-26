/**
 * @responsibility serviceWorkerRegistration 단위 테스트 — PR-L
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerPriceAlertServiceWorker,
  getPriceAlertRegistration,
  __resetServiceWorkerForTests,
} from './serviceWorkerRegistration';

describe('serviceWorkerRegistration — PR-L', () => {
  beforeEach(() => {
    __resetServiceWorkerForTests();
    // 코드 내부 `typeof window === 'undefined'` 체크 우회 (node 환경)
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serviceWorker 미지원 → false', async () => {
    vi.stubGlobal('navigator', {});
    expect(await registerPriceAlertServiceWorker()).toBe(false);
  });

  it('정상 등록 → true', async () => {
    const mockReg = { active: {} } as unknown as ServiceWorkerRegistration;
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(mockReg),
        ready: Promise.resolve(mockReg),
      },
    });
    expect(await registerPriceAlertServiceWorker()).toBe(true);
  });

  it('등록 throw → false (안전 fallback)', async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockRejectedValue(new Error('blocked')),
      },
    });
    expect(await registerPriceAlertServiceWorker()).toBe(false);
  });

  it('getPriceAlertRegistration — 캐싱된 reg 우선', async () => {
    const mockReg = { active: {} } as unknown as ServiceWorkerRegistration;
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(mockReg),
        ready: Promise.resolve(mockReg),
      },
    });
    await registerPriceAlertServiceWorker();
    const r = await getPriceAlertRegistration();
    expect(r).toBe(mockReg);
  });

  it('getPriceAlertRegistration — 미등록 시 ready 폴링', async () => {
    const mockReg = { active: {} } as unknown as ServiceWorkerRegistration;
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(mockReg),
      },
    });
    const r = await getPriceAlertRegistration();
    expect(r).toBe(mockReg);
  });

  it('getPriceAlertRegistration — SW 미지원 → null', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getPriceAlertRegistration()).toBeNull();
  });

  it('getPriceAlertRegistration — ready throw → null', async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.reject(new Error('boom')),
      },
    });
    expect(await getPriceAlertRegistration()).toBeNull();
  });
});
