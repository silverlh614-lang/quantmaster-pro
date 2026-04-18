/**
 * EngineHealthBanner — 엔진 heartbeat 이상 / Kill Switch 강등 적색 경보.
 *
 * 두 가지 상태를 집약한 상단 배너:
 *   1. heartbeat 가 90초 초과 → "엔진 응답 없음" (red)
 *   2. Kill Switch 로 LIVE→SHADOW 강등 → 원인 표시 (orange)
 *
 * 디자인:
 *   - heartbeat stale 시 pulse 애니메이션 + 경과 초 카운터
 *   - Kill Switch 강등 시 triggers 배열을 리스트로 출력
 *   - 두 경보 동시 발생 가능 — stack 형태로 표시
 */

import React from 'react';
import { Activity, AlertOctagon, ShieldOff } from 'lucide-react';
import type { EngineHeartbeatInfo } from '../../hooks/autoTrade/useEngineHeartbeat';
import type { UseKillSwitchStatusReturn } from '../../hooks/autoTrade/useKillSwitchStatus';

interface EngineHealthBannerProps {
  heartbeat: EngineHeartbeatInfo;
  killSwitch: UseKillSwitchStatusReturn;
}

function formatAge(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}초 전`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초 전`;
  return `${Math.floor(ms / 3_600_000)}시간 전`;
}

export function EngineHealthBanner({ heartbeat, killSwitch }: EngineHealthBannerProps) {
  const { isStale, ageMs, source, thresholdMs } = heartbeat;
  const { isDowngraded, last, current } = killSwitch;

  const showHeartbeat = isStale;
  const showKillSwitch = isDowngraded || (current?.shouldDowngrade ?? false);

  if (!showHeartbeat && !showKillSwitch) return null;

  return (
    <div className="space-y-2">
      {showHeartbeat && (
        <div className="relative overflow-hidden rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-100">
          <div className="absolute inset-y-0 left-0 w-1 animate-pulse bg-red-400" />
          <div className="flex items-start gap-3 pl-3">
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300/80">
                Engine Heartbeat Stale
              </div>
              <div className="mt-0.5 font-bold text-red-50">
                엔진 응답 없음 — 마지막 tick {formatAge(ageMs)}
              </div>
              <div className="mt-1 text-xs text-red-200/70">
                임계값 {Math.round(thresholdMs / 1000)}초 초과. cron 루프 정지 가능성 · Railway 좀비 프로세스 의심.
                {source && <> 마지막 소스: <span className="font-mono text-red-200">{source}</span></>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showKillSwitch && (
        <div className="rounded-2xl border border-orange-500/40 bg-orange-500/10 px-5 py-4 text-sm text-orange-100">
          <div className="flex items-start gap-3">
            <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-300/80">
                Kill Switch · LIVE → SHADOW
              </div>
              <div className="mt-0.5 font-bold text-orange-50">
                {isDowngraded ? '엔진이 자동 강등되어 shadow 모드로 동작 중' : '강등 조건 감지 — 다음 tick 에서 강등 예정'}
              </div>
              {last && (
                <div className="mt-1 text-xs text-orange-200/70">
                  강등 시각: <span className="font-mono">{last.at}</span>
                </div>
              )}
              {current && current.triggers.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-orange-100/80">
                  {current.triggers.map((t: string) => (
                    <li key={t}>• {t}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2 text-[10px] text-orange-300/60">
                <Activity className="h-3 w-3" />
                원인 해결 후 수동으로 env `AUTO_TRADE_MODE=LIVE` + 재시작 시 복귀.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
