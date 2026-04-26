// @responsibility useKillSwitchStatus React hook
/**
 * useKillSwitchStatus — 서버 Kill Switch 평가 + 최근 강등 기록 접근.
 *
 * 반환:
 *   - `current`: 현재 tick 평가 (shouldDowngrade + triggers 배열)
 *   - `last`: 가장 최근 강등 레코드 (없으면 null)
 *   - `isDowngraded`: 런타임 모드가 env 기본(LIVE) 대비 강등되었는지 — UI 배너용
 */

import { useMemo } from 'react';
import { useEngineStatusQuery } from './queries';
import type { KillSwitchAssessmentDto, KillSwitchRecordDto } from '../../api';

export interface UseKillSwitchStatusReturn {
  current: KillSwitchAssessmentDto | null;
  last: KillSwitchRecordDto | null;
  isDowngraded: boolean;
}

export function useKillSwitchStatus(): UseKillSwitchStatusReturn {
  const q = useEngineStatusQuery();
  const status = q.data;

  return useMemo<UseKillSwitchStatusReturn>(() => {
    const killSwitch = status?.killSwitch;
    const last = killSwitch?.last ?? null;
    const current = killSwitch?.current ?? null;
    // 강등 감지 — 최근 레코드가 LIVE→SHADOW 이고 현재 mode 가 여전히 SHADOW 인 경우.
    const isDowngraded = Boolean(
      last && last.from === 'LIVE' && last.to === 'SHADOW' && status?.mode === 'SHADOW',
    );
    return { current, last, isDowngraded };
  }, [status?.killSwitch, status?.mode]);
}
