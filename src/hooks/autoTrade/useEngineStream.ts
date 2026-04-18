/**
 * useEngineStream — Server-Sent Events 기반 엔진 상태 실시간 수신 훅.
 *
 * `/api/auto-trade/engine/stream` 에 EventSource 로 접속하여 엔진 상태·
 * Kill Switch 이벤트를 수신하고, 수신 데이터를 TanStack Query 캐시에 기록한다.
 * 이 훅을 마운트하면 자동으로 기존 5초 폴링은 의미가 사라지므로, queryKey 를
 * 공유해 같은 데이터 스토어를 사용한다.
 *
 * 장점:
 *   - 5초 폴링 + 동일 탭 여러 개 → 트래픽 N배. SSE 는 1 연결로 해결.
 *   - 지연 60초 → 5초 (폴링 주기 상관없이 서버가 push 할 때마다)
 *
 * Fallback: EventSource 가 지원되지 않거나 장시간 끊기면, queries.ts 의
 * `refetchInterval` 이 여전히 safety net 으로 동작하므로 기능적 퇴행 없음.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EngineStatus } from '../../api';
import { AUTO_TRADE_KEYS } from './queryKeys';

export interface UseEngineStreamOptions {
  /** 스트림 URL. 기본 `/api/auto-trade/engine/stream`. */
  url?: string;
  /** 활성화 여부. false 로 바꾸면 기존 연결 정리. */
  enabled?: boolean;
}

export function useEngineStream(opts: UseEngineStreamOptions = {}): void {
  const { url = '/api/auto-trade/engine/stream', enabled = true } = opts;
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const es = new EventSource(url);
    esRef.current = es;

    const onEngine = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data) as EngineStatus;
        // welcome 이벤트는 { kind: 'welcome', at } 형태라 전체 덮어쓰지 않음.
        if ((payload as unknown as { kind?: string }).kind === 'welcome') return;
        qc.setQueryData<EngineStatus>(AUTO_TRADE_KEYS.engineStatus, payload);
      } catch (err) {
        console.warn('[engine-stream] parse fail:', err);
      }
    };

    const onKillSwitch = () => {
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
    };

    const onError = (evt: Event) => {
      // EventSource 는 자동 재연결 — 에러 시점에서 강제 종료하지 않는다.
      console.debug('[engine-stream] event error (auto-retry):', evt);
    };

    es.addEventListener('engine-status', onEngine as EventListener);
    es.addEventListener('kill-switch', onKillSwitch as EventListener);
    es.addEventListener('error', onError);

    return () => {
      es.removeEventListener('engine-status', onEngine as EventListener);
      es.removeEventListener('kill-switch', onKillSwitch as EventListener);
      es.removeEventListener('error', onError);
      es.close();
      esRef.current = null;
    };
  }, [url, enabled, qc]);
}
