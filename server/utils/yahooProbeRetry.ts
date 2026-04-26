// @responsibility Yahoo probe 다중 호스트 재시도 + 다중 심볼 헬퍼 SSOT — 미래 확장점
/**
 * yahooProbeRetry.ts — Yahoo Finance 단발성 503 회복력 헬퍼 (ADR-0056)
 *
 * 기능:
 *   1. probeYahooWithRetry — query1 실패(429/502/503/504) 시 query2 로 1회 재시도
 *   2. probeMultipleSymbols — 3종목 (KOSPI/KOSDAQ/한국 ETF) Promise.allSettled
 *   3. classifyMultiProbeResult — 2/3 이상 실패 시 DOWN, 1/3 실패 시 DEGRADED
 *
 * 사용처:
 *   - pipelineDiagnosis.ts 는 본 헬퍼 *직접 사용 안 함* — getYahooHealthSnapshot() SSOT 만 read.
 *   - 본 모듈은 미래 확장점 — `/probe yahoo` 텔레그램 명령, 수동 진단 도구, 관측성 SSOT 등.
 *
 * Boundary:
 *   - guardedFetch (EgressGuard) 경유 — Yahoo host 우회 금지 (ADR-0029)
 *   - 외부 의존 0건 (kisClient/macroState/aiUniverseService 무관)
 */
import { guardedFetch } from './egressGuard.js';

/** KOSPI 시총 1위(SK하이닉스) / KOSDAQ 대표(에코프로비엠) / 한국 ETF (iShares MSCI Korea). */
export const PROBE_SYMBOLS = ['000660.KS', '247540.KQ', 'EWY'] as const;

/** 단발성 5xx + 429 → 재시도 의미 있음. 4xx 영구 오류는 즉시 실패. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export const PROBE_TIMEOUT_MS = 8_000;
export const RETRY_BACKOFF_MS = 2_000;

const QUERY1_HOST = 'https://query1.finance.yahoo.com';
const QUERY2_HOST = 'https://query2.finance.yahoo.com';

export interface YahooProbeOptions {
  /** 단일 host 호출당 timeout (기본 8000ms). */
  timeoutMs?: number;
  /** query1→query2 재시도 직전 백오프 (기본 2000ms). */
  backoffMs?: number;
  /** 외부 abort 신호 — 다중 심볼 호출 시 일괄 취소용. */
  signal?: AbortSignal;
}

export interface YahooProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
  host?: 'query1' | 'query2';
  retried?: boolean;
}

export interface MultiProbeResult {
  total: number;
  failCount: number;
  results: Array<{ symbol: string } & YahooProbeResult>;
}

export type MultiProbeStatus = 'OK' | 'DEGRADED' | 'DOWN';

/** 재시도 결정 SSOT — undefined(timeout/network) 도 retry 대상. */
export function shouldRetryYahooStatus(status?: number): boolean {
  if (status === undefined) return true;
  return RETRYABLE_STATUSES.has(status);
}

/** 다중 probe 결과 분류 SSOT. failCount/total ≥ 2/3 → DOWN, 1/3 → DEGRADED, 0 → OK. */
export function classifyMultiProbeResult(failCount: number, total: number): MultiProbeStatus {
  if (total <= 0) return 'OK';
  const ratio = failCount / total;
  if (ratio >= 2 / 3) return 'DOWN';
  if (ratio > 0) return 'DEGRADED';
  return 'OK';
}

async function fetchOnce(
  host: string,
  symbol: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ status?: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await guardedFetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return { status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** query1 1회 시도 → 재시도 대상이면 query2 로 1회 재시도. */
export async function probeYahooWithRetry(
  symbol: string,
  options: YahooProbeOptions = {},
): Promise<YahooProbeResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? RETRY_BACKOFF_MS;

  const first = await fetchOnce(QUERY1_HOST, symbol, timeoutMs, options.signal);
  if (first.status !== undefined && first.status >= 200 && first.status < 300) {
    return { ok: true, status: first.status, host: 'query1' };
  }
  if (!shouldRetryYahooStatus(first.status)) {
    return { ok: false, status: first.status, error: first.error, host: 'query1' };
  }

  if (backoffMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  const second = await fetchOnce(QUERY2_HOST, symbol, timeoutMs, options.signal);
  const ok = second.status !== undefined && second.status >= 200 && second.status < 300;
  return {
    ok,
    status: second.status,
    error: ok ? undefined : second.error,
    host: 'query2',
    retried: true,
  };
}

/** 다중 심볼 Promise.allSettled — 부분 실패 허용. */
export async function probeMultipleSymbols(
  symbols: readonly string[] = PROBE_SYMBOLS,
  options: YahooProbeOptions = {},
): Promise<MultiProbeResult> {
  const settled = await Promise.allSettled(
    symbols.map((s) => probeYahooWithRetry(s, options)),
  );
  const results = settled.map((r, i) => {
    if (r.status === 'fulfilled') return { symbol: symbols[i], ...r.value };
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return { symbol: symbols[i], ok: false, error: msg };
  });
  const failCount = results.filter((r) => !r.ok).length;
  return { total: results.length, failCount, results };
}
