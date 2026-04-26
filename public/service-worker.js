/**
 * QuantMaster Pro Service Worker (PR-L)
 *
 * 책임:
 *   - 가격 알림 전용 (PR-C usePriceAlertWatcher 와 협업)
 *   - 페이지가 백그라운드 탭일 때도 OS-level 알림 표시 (registration.showNotification)
 *   - 페이지 완전 닫힘 시 진짜 백그라운드는 Push API + 서버 web-push 인프라 필요 (후속 PR)
 *
 * 캐시·offline 전략은 본 SW 범위 밖 — 알림 전용으로만 운용.
 */

const SW_VERSION = 'qm-v1';

self.addEventListener('install', () => {
  // 즉시 활성화 (waiting phase 스킵) — 알림 전용 SW 라 정합성 위험 낮음
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 모든 클라이언트에 즉시 적용
  event.waitUntil(self.clients.claim());
});

/**
 * 알림 클릭 시 PR-L: 메인 윈도우로 포커스. 없으면 새로 열기.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (allClients.length > 0) {
      const target = allClients[0];
      try { await target.focus(); } catch { /* ignore */ }
      return;
    }
    if (self.clients.openWindow) {
      try { await self.clients.openWindow('/'); } catch { /* ignore */ }
    }
  })());
});

/**
 * Push API 수신 — 향후 서버 web-push 인프라 도입 시 활용.
 * 본 PR-L 범위 밖 — 페이로드 schema 미정의 시 무시.
 */
self.addEventListener('push', (event) => {
  // 페이로드 없는 push 는 무시
  if (!event.data) return;
  let payload = null;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || !payload.title) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body || '',
      tag: payload.tag || `qm-push-${Date.now()}`,
    }),
  );
});

// SW 버전 노출 — 디버깅용
self.addEventListener('message', (event) => {
  if (event.data === 'GET_VERSION' && event.source) {
    try { event.source.postMessage({ version: SW_VERSION }); } catch { /* ignore */ }
  }
});
