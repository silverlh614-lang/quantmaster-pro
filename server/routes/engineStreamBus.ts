/**
 * engineStreamBus.ts — SSE 연결 풀 + 이벤트 브로드캐스트 허브.
 *
 * `/api/auto-trade/engine/stream` 으로 접속한 클라이언트를 Set 으로 보관하고,
 * 엔진 상태 변화 발생 시 `publishEngineStatus()` 로 모든 연결에 동시 전송한다.
 *
 * 설계 원칙:
 *   - 단일 Process 메모리 버스 — Railway 단일 컨테이너 전제.
 *   - 클라이언트 연결 끊김은 자동 감지 (`res.on('close')`) — 메모리 누수 방지.
 *   - SSE keep-alive 25초 핑 — 프록시/로드밸런서 idle timeout 회피.
 *   - 발신 실패 시 해당 연결 즉시 제거 — 나머지 구독자에는 영향 없음.
 */

import type { Request, Response } from 'express';

export type StreamEventKind = 'engine-status' | 'kill-switch' | 'heartbeat' | 'ping';

interface Subscriber {
  res: Response;
  openedAt: number;
}

const subscribers = new Set<Subscriber>();

/** 연결 등록 — SSE 헤더 설정 + keep-alive 타이머 시작. */
export function attachEngineStream(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx proxy disable buffering
  res.flushHeaders?.();

  const sub: Subscriber = { res, openedAt: Date.now() };
  subscribers.add(sub);

  // 즉시 웰컴 이벤트 — 클라이언트가 "연결 확립" 상태 확인 가능.
  safeWrite(sub, 'engine-status', { kind: 'welcome', at: new Date().toISOString() });

  // 25초 ping — 방화벽/로드밸런서 idle 끊김 방지.
  const pingInterval = setInterval(() => {
    safeWrite(sub, 'ping', { at: Date.now() });
  }, 25_000);

  req.on('close', () => {
    clearInterval(pingInterval);
    subscribers.delete(sub);
  });
}

/** 구독자 수 — 운영 진단용. */
export function getEngineStreamSubscriberCount(): number {
  return subscribers.size;
}

/** 엔진 상태 스냅샷 브로드캐스트 — 호출부는 직렬화 가능한 plain object 전달. */
export function publishEngineStatus(payload: Record<string, unknown>): void {
  broadcast('engine-status', payload);
}

/** Kill Switch 이벤트 브로드캐스트 — 즉시 UI 경보용. */
export function publishKillSwitch(payload: Record<string, unknown>): void {
  broadcast('kill-switch', payload);
}

/** Heartbeat 단독 브로드캐스트 — 상태 스냅샷보다 가볍게. */
export function publishHeartbeat(payload: Record<string, unknown>): void {
  broadcast('heartbeat', payload);
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────────────────

function broadcast(kind: StreamEventKind, payload: unknown): void {
  const stale: Subscriber[] = [];
  for (const sub of subscribers) {
    if (!safeWrite(sub, kind, payload)) stale.push(sub);
  }
  for (const s of stale) subscribers.delete(s);
}

function safeWrite(sub: Subscriber, kind: StreamEventKind, payload: unknown): boolean {
  try {
    sub.res.write(`event: ${kind}\n`);
    sub.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    try { sub.res.end(); } catch { /* noop */ }
    return false;
  }
}
