// @responsibility useEngineArming React hook
/**
 * useEngineArming — 실매매 시작을 위한 Nuclear Reactor Pattern 상태 머신.
 *
 *   IDLE ──(arm)──▶ ARMED ──(confirm)──▶ CONFIRMING ──(commit)──▶ COMMITTING
 *     ▲                │                     │                        │
 *     └────(abort / 10초 타임아웃)──────────────┴───────────(success/error)┘
 *
 * 실매매(LIVE) 전환은 "의도치 않은 1회 클릭" 으로 절대 발생해선 안 된다.
 * 이 훅은 3단계 게이트를 강제한다:
 *   1. **ARM** — 사용자가 "실매매 시작" 버튼을 눌러 무장 (경고 표시).
 *   2. **CONFIRM** — 사용자가 ARMED 상태에서 "진행" 을 눌러 확인창 진입.
 *   3. **COMMIT** — 오늘 날짜(YYYY-MM-DD) 를 타이핑해야 실제 토글 호출.
 *
 * ARMED 에서 10초 내 진행하지 않으면 자동 IDLE 로 복귀 — 주의 환기.
 *
 * 페르소나 원칙 8 확장 — "의도치 않은 실매매 = 최대 운영 비용".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ArmingState = 'IDLE' | 'ARMED' | 'CONFIRMING' | 'COMMITTING';

export interface UseEngineArmingOptions {
  /** ARMED 자동 복귀 타임아웃 (ms). 기본 10초. */
  armTimeoutMs?: number;
  /** COMMIT 단계 실제 실행 함수 (mutation 래핑). */
  onCommit: () => Promise<void>;
}

export interface UseEngineArmingReturn {
  state: ArmingState;
  /** ARMED 상태에서 자동 복귀까지 남은 초. */
  armCountdown: number;
  arm: () => void;
  proceed: () => void;
  abort: () => void;
  /** `expectedToken` 과 일치하면 commit 실행, 아니면 false 반환. */
  commit: (typedToken: string, expectedToken: string) => Promise<boolean>;
  /** 오늘 날짜 KST 기준 YYYY-MM-DD — 확인 토큰. */
  todayToken: string;
}

function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function useEngineArming(opts: UseEngineArmingOptions): UseEngineArmingReturn {
  const { armTimeoutMs = 10_000, onCommit } = opts;
  const [state, setState] = useState<ArmingState>('IDLE');
  const [armCountdown, setArmCountdown] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const todayTokenRef = useRef<string>(getTodayKst());

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const abort = useCallback(() => {
    clearTimers();
    setArmCountdown(0);
    setState('IDLE');
  }, [clearTimers]);

  const arm = useCallback(() => {
    clearTimers();
    todayTokenRef.current = getTodayKst();
    setState('ARMED');
    setArmCountdown(Math.ceil(armTimeoutMs / 1000));

    intervalRef.current = setInterval(() => {
      setArmCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    timeoutRef.current = setTimeout(() => {
      // 자동 복귀 — ARMED 또는 CONFIRMING 모두 해제.
      clearTimers();
      setArmCountdown(0);
      setState((curr) => (curr === 'COMMITTING' ? curr : 'IDLE'));
    }, armTimeoutMs);
  }, [armTimeoutMs, clearTimers]);

  const proceed = useCallback(() => {
    setState((curr) => (curr === 'ARMED' ? 'CONFIRMING' : curr));
  }, []);

  const commit = useCallback(
    async (typedToken: string, expectedToken: string): Promise<boolean> => {
      if (typedToken.trim() !== expectedToken) return false;
      clearTimers();
      setArmCountdown(0);
      setState('COMMITTING');
      try {
        await onCommit();
        setState('IDLE');
        return true;
      } catch (err) {
        // 실패 시 ARMED 로 돌아가 재시도 가능하게 — 단, 타이머는 재시작하지 않음
        // (사용자 이벤트 기반으로만 타이머 재시작).
        setState('ARMED');
        throw err;
      }
    },
    [clearTimers, onCommit],
  );

  useEffect(() => () => { clearTimers(); }, [clearTimers]);

  return {
    state,
    armCountdown,
    arm,
    proceed,
    abort,
    commit,
    todayToken: todayTokenRef.current,
  };
}
