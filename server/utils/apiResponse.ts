/**
 * apiResponse.ts — 표준 API 응답 envelope + 핸들러 래퍼 + zod 검증 미들웨어
 *
 * @responsibility express 라우트의 응답 형태와 에러 처리를 한 곳에서 표준화한다.
 *
 * 응답 형태:
 *   성공: { ok: true, data: ... }
 *   실패: { ok: false, error: { code, message, details? } }
 *
 * 사용:
 *   router.get('/foo', asyncHandler(async (req, res) => {
 *     const data = await loadFoo();
 *     ok(res, data);
 *   }));
 *
 *   router.post('/bar', validateBody(BarSchema), asyncHandler(async (req, res) => {
 *     // req.body 는 BarSchema 로 파싱됨 (이미 검증된 값)
 *     ...
 *   }));
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { CircuitOpenError } from './circuitBreaker.js';
import { FetchRetryError } from './fetchWithRetry.js';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;

/** 200 OK + 표준 success envelope */
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ ok: true, data } satisfies ApiSuccess<T>);
}

/** 표준 error envelope. 스택 트레이스나 PII 가 details 에 들어가지 않도록 호출자 책임. */
export function err(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return res.status(status).json({
    ok: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  } satisfies ApiError);
}

/**
 * async route handler 래퍼 — 거부된 promise 를 자동으로 next(err) 로 전달.
 * try/catch 보일러플레이트 제거.
 */
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * zod 스키마 기반 입력 검증 미들웨어.
 * body|query|params 중 하나에 적용. 검증 실패 시 400 표준 에러.
 */
export function validate<T>(
  schema: ZodSchema<T>,
  source: 'body' | 'query' | 'params' = 'body',
): RequestHandler {
  return (req, res, next) => {
    const target = req as unknown as Record<string, unknown>;
    const result = schema.safeParse(target[source]);
    if (!result.success) {
      err(res, 400, 'VALIDATION_FAILED', `${source} 검증 실패`, result.error.flatten());
      return;
    }
    target[source] = result.data;
    next();
  };
}

export const validateBody  = <T>(schema: ZodSchema<T>): RequestHandler => validate(schema, 'body');
export const validateQuery = <T>(schema: ZodSchema<T>): RequestHandler => validate(schema, 'query');
export const validateParams = <T>(schema: ZodSchema<T>): RequestHandler => validate(schema, 'params');

/**
 * 마지막 단계의 글로벌 에러 핸들러.
 * - ZodError → 400 VALIDATION_FAILED
 * - CircuitOpenError → 503 CIRCUIT_OPEN
 * - FetchRetryError → 502 UPSTREAM_UNAVAILABLE
 * - 그 외 → 500 INTERNAL_ERROR (메시지 노출)
 *
 * server/index.ts 의 라우터 등록 직후 `app.use(globalErrorHandler)` 로 장착.
 */
export function globalErrorHandler(
  e: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return; // express 가 이미 응답을 시작했으면 위임 종료

  if (e instanceof ZodError) {
    err(res, 400, 'VALIDATION_FAILED', '요청 검증 실패', e.flatten());
    return;
  }
  if (e instanceof CircuitOpenError) {
    res.setHeader('Retry-After', Math.ceil(e.retryAfterMs / 1000).toString());
    err(res, 503, 'CIRCUIT_OPEN', `${e.name} 일시 차단 — ${Math.ceil(e.retryAfterMs / 1000)}초 후 재시도`);
    return;
  }
  if (e instanceof FetchRetryError) {
    err(res, 502, 'UPSTREAM_UNAVAILABLE', e.message, { upstreamStatus: e.status, attempts: e.attempts });
    return;
  }
  const message = e instanceof Error ? e.message : String(e);
  console.error('[API] 미처리 오류:', e);
  err(res, 500, 'INTERNAL_ERROR', message);
}
