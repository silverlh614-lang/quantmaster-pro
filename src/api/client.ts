// @responsibility client API 클라이언트 모듈
/**
 * 공통 REST 클라이언트 — 모든 브라우저 측 API 호출은 이 모듈을 통해 이뤄진다.
 *
 * 도입 목적:
 *  1. fetch 상태 코드 검증과 JSON 파싱 로직을 한 곳에 모은다.
 *  2. 4xx/5xx를 조용히 통과시키던 기존 `catch(() => null)` 패턴으로 인한
 *     silent failure를 ApiError 로 일관되게 변환한다.
 *  3. UI/훅 레이어가 fetch 시그니처가 아닌 도메인 함수에만 의존하도록 한다.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON 본문 — 직렬화 및 Content-Type 설정을 자동 처리한다. */
  json?: unknown;
  /** 질의 문자열 파라미터 — undefined/null 값은 제외된다. */
  query?: Record<string, string | number | boolean | null | undefined>;
}

function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (res.status === 204) return null;
  if (ct.includes('application/json')) {
    try { return await res.json(); }
    catch { return null; }
  }
  try { return await res.text(); }
  catch { return null; }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const { json, query, headers, ...rest } = opts;

  const init: RequestInit = { ...rest };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers = {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    };
  } else if (headers) {
    init.headers = headers;
  }

  const url = buildUrl(path, query);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(
      `네트워크 오류: ${err instanceof Error ? err.message : String(err)}`,
      0,
      url,
      null,
    );
  }

  const body = await parseBody(res);

  if (!res.ok) {
    throw new ApiError(
      `${res.status} ${res.statusText || 'Request failed'} — ${url}`,
      res.status,
      url,
      body,
    );
  }

  return body as T;
}

/**
 * 응답이 null/undefined/실패여도 UI를 막지 않는 경로에서 사용.
 * 이전 코드의 `.catch(() => null)` 과 동일한 의도이나, 로그는 남긴다.
 */
export async function apiFetchSafe<T>(
  path: string,
  opts: ApiRequestOptions = {},
  fallback: T,
): Promise<T> {
  try {
    return await apiFetch<T>(path, opts);
  } catch (err) {
    console.error(`[api] ${path} 실패 — fallback 사용:`, err);
    return fallback;
  }
}
