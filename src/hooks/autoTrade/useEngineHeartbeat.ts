/**
 * useEngineHeartbeat — 서버 cron tick 의 "실제 가동" 을 UI 측에서 감시.
 *
 * Railway 14분 self-ping 은 프로세스 생존만 증명할 뿐, cron 루프가 실제로
 * 돌고 있는지는 보장하지 않는다. 이 훅은 `engineStatus.heartbeat.at` 과
 * 클라이언트 현재 시각 차이가 임계값을 넘으면 `isStale=true` 를 반환하여
 * 상단 적색 배너 노출 트리거를 제공한다.
 *
 * 기본 임계값 90초 — orchestrator tick 이 최소 1분 주기이므로 2 tick 누락
 * 시 경보. 이 값은 cron 스케줄 변경 시 `queryKeys.ts` 폴링 정책과 함께 조정.
 */

import { useMemo } from 'react';
import { useEngineStatusQuery } from './queries';

export interface EngineHeartbeatInfo {
  /** 마지막 heartbeat 시각 (ms epoch) — null 이면 아직 데이터 없음. */
  lastTs: number | null;
  /** 마지막 heartbeat 소스 (예: 'orchestrator', 'oco-confirm'). */
  source: string | null;
  /** 마지막 heartbeat 로부터 경과한 밀리초. */
  ageMs: number | null;
  /** 임계값 초과 여부. */
  isStale: boolean;
  /** 임계값 (ms). */
  thresholdMs: number;
}

export interface UseEngineHeartbeatOptions {
  /** 경보 임계값 (ms). 기본 90,000. */
  thresholdMs?: number;
}

export function useEngineHeartbeat(opts: UseEngineHeartbeatOptions = {}): EngineHeartbeatInfo {
  const { thresholdMs = 90_000 } = opts;
  const q = useEngineStatusQuery();
  const heartbeat = q.data?.heartbeat;

  return useMemo<EngineHeartbeatInfo>(() => {
    const lastTs = heartbeat?.at ? new Date(heartbeat.at).getTime() : null;
    const source = heartbeat?.source ?? null;
    const ageMs = heartbeat?.ageMs ?? (lastTs ? Date.now() - lastTs : null);
    // engineStatus 자체가 로드 안 된 경우는 stale 아님(초기 로딩).
    const isStale = Boolean(lastTs && ageMs !== null && ageMs > thresholdMs);

    return { lastTs, source, ageMs, isStale, thresholdMs };
  }, [heartbeat?.at, heartbeat?.source, heartbeat?.ageMs, thresholdMs]);
}
