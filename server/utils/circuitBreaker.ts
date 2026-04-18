/**
 * circuitBreaker.ts — 외부 API 연속 실패 시 일정 시간 호출을 차단한다.
 *
 * @responsibility 일정 윈도우 내 실패율이 임계치를 넘으면 OPEN 상태로 전환해 호출을 단락시킨다.
 *
 * 상태 전이:
 *   CLOSED → 실패 ≥ failureThreshold (windowMs 내) → OPEN
 *   OPEN   → cooldownMs 경과 → HALF_OPEN (다음 1회 호출만 허용)
 *   HALF_OPEN → 성공 → CLOSED / 실패 → OPEN (cooldown 재시작)
 *
 * 사용:
 *   const cb = createCircuitBreaker({ name: 'gemini', failureThreshold: 5, windowMs: 60_000, cooldownMs: 60_000 });
 *   const result = await cb.exec(() => fetch(...));
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number;
}

export class CircuitOpenError extends Error {
  constructor(public readonly name: string, public readonly retryAfterMs: number) {
    super(`circuit breaker OPEN: ${name} (retry after ${retryAfterMs}ms)`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreaker {
  readonly name: string;
  state: CircuitState;
  exec<T>(fn: () => Promise<T>): Promise<T>;
  getStats(): { state: CircuitState; failures: number; openedAt: number | null };
  reset(): void;
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const { name, failureThreshold, windowMs, cooldownMs } = options;

  let state: CircuitState = 'CLOSED';
  let recentFailures: number[] = [];
  let openedAt: number | null = null;

  function pruneFailures(now: number): void {
    recentFailures = recentFailures.filter((t) => now - t <= windowMs);
  }

  function trip(now: number): void {
    state = 'OPEN';
    openedAt = now;
    console.warn(`[CB:${name}] OPEN — ${recentFailures.length}회 실패 (윈도우 ${windowMs}ms), ${cooldownMs}ms 대기`);
  }

  function close(): void {
    state = 'CLOSED';
    openedAt = null;
    recentFailures = [];
    console.log(`[CB:${name}] CLOSED — 정상 복구`);
  }

  return {
    get name() { return name; },
    get state() { return state; },
    async exec<T>(fn: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (state === 'OPEN') {
        if (openedAt !== null && now - openedAt >= cooldownMs) {
          state = 'HALF_OPEN';
          console.log(`[CB:${name}] HALF_OPEN — 1회 시도 허용`);
        } else {
          const retryIn = openedAt !== null ? cooldownMs - (now - openedAt) : cooldownMs;
          throw new CircuitOpenError(name, retryIn);
        }
      }
      try {
        const result = await fn();
        if (state === 'HALF_OPEN') close();
        return result;
      } catch (e) {
        const tNow = Date.now();
        if (state === 'HALF_OPEN') {
          trip(tNow);
        } else {
          recentFailures.push(tNow);
          pruneFailures(tNow);
          if (recentFailures.length >= failureThreshold) trip(tNow);
        }
        throw e;
      }
    },
    getStats() {
      return { state, failures: recentFailures.length, openedAt };
    },
    reset() {
      close();
    },
  };
}
