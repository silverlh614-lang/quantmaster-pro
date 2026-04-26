// @responsibility Service Worker 등록·해제 헬퍼 — 가격 알림 백그라운드 표시 (PR-L)

const SW_PATH = '/service-worker.js';

let _registration: ServiceWorkerRegistration | null = null;

/**
 * SW 등록 시도. 성공 시 registration 캐싱.
 *
 * - HTTPS 또는 localhost 에서만 동작 (브라우저 정책)
 * - SW 미지원 환경 → false
 * - 등록 실패 → false (에러 로그 + fallback to Notification API)
 */
export async function registerPriceAlertServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    _registration = reg;
    return true;
  } catch (e) {
    console.warn('[ServiceWorker] 등록 실패 — Notification API fallback', e);
    _registration = null;
    return false;
  }
}

/**
 * 캐싱된 registration 반환. 미등록 시 navigator.serviceWorker.ready 폴링.
 * 미지원 환경 또는 활성화 실패 시 null.
 */
export async function getPriceAlertRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (_registration) return _registration;
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    _registration = reg;
    return reg;
  } catch {
    return null;
  }
}

/** 테스트 용 reset. */
export function __resetServiceWorkerForTests(): void {
  _registration = null;
}
