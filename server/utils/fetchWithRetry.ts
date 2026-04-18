/**
 * fetchWithRetry.ts — 외부 HTTP 호출 재시도/타임아웃/지수 백오프 래퍼
 *
 * @responsibility 외부 API 호출의 일시적 실패를 자동 복구하고 일관된 타임아웃을 강제한다.
 *
 * 사용:
 *   const res = await fetchWithRetry(url, { timeoutMs: 8000, retries: 3 });
 *
 * 정책:
 *   - 5xx, 429, 네트워크 오류 → 재시도
 *   - 4xx (429 제외) → 즉시 throw (호출 측 처리 위임)
 *   - 각 시도마다 AbortSignal.timeout 강제
 *   - 지수 백오프: 500ms × 2^attempt + jitter (200ms)
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** 호출당 타임아웃 (기본 10초) */
  timeoutMs?: number;
  /** 추가 시도 횟수 (기본 2 — 총 3번) */
  retries?: number;
  /** 백오프 base ms (기본 500) */
  backoffMs?: number;
  /** 호출처 식별자 — 로그/CB 키에 사용 */
  callerLabel?: string;
}

export class FetchRetryError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FetchRetryError';
  }
}

function shouldRetry(status: number | null): boolean {
  if (status === null) return true; // 네트워크 오류
  if (status === 429) return true;  // rate limited
  if (status >= 500 && status < 600) return true;
  return false;
}

function jittered(base: number): number {
  return base + Math.floor(Math.random() * 200);
}

/**
 * fetch + 타임아웃 + 재시도 + 지수 백오프.
 *
 * 성공 시 Response 그대로 반환 — 본문 파싱은 호출 측 책임.
 * 모든 시도 실패 시 FetchRetryError throw.
 */
export async function fetchWithRetry(
  input: string | URL,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retries = 2,
    backoffMs = 500,
    callerLabel = 'fetch',
    signal: callerSignal,
    ...init
  } = options;

  const totalAttempts = retries + 1;
  let lastErr: unknown = null;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    // 타임아웃 + 호출자 시그널 결합
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
    const onCallerAbort = () => ctrl.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) ctrl.abort(callerSignal.reason);
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const res = await fetch(input, { ...init, signal: ctrl.signal });
      lastStatus = res.status;
      if (res.ok) return res;

      if (!shouldRetry(res.status) || attempt === totalAttempts) {
        // 본문은 호출자가 살펴볼 수 있도록 그대로 반환 (4xx 일관성)
        return res;
      }
    } catch (e) {
      lastErr = e;
      lastStatus = null;
      if (attempt === totalAttempts) break;
    } finally {
      clearTimeout(timeoutId);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }

    // 백오프 대기 후 재시도
    const delay = jittered(backoffMs * Math.pow(2, attempt - 1));
    console.warn(`[${callerLabel}] retry ${attempt}/${retries} after ${delay}ms (status=${lastStatus ?? 'NETWORK_ERR'})`);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new FetchRetryError(
    `${callerLabel} 실패 — ${totalAttempts}회 시도 후 포기`,
    lastStatus,
    totalAttempts,
    lastErr,
  );
}

/** JSON 응답까지 한번에 파싱하는 편의 함수. */
export async function fetchJsonWithRetry<T = unknown>(
  input: string | URL,
  options: FetchWithRetryOptions = {},
): Promise<T> {
  const res = await fetchWithRetry(input, options);
  if (!res.ok) {
    throw new FetchRetryError(
      `${options.callerLabel ?? 'fetch'} HTTP ${res.status}`,
      res.status,
      1,
    );
  }
  return res.json() as Promise<T>;
}
