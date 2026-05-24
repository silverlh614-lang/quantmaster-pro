// @responsibility KIS 429 retry-after rate-limit backoff helpers.

export function parseRetryAfterMs(headers: Headers | Record<string, string | undefined>): number | undefined {
  const raw = headers instanceof Headers
    ? headers.get('retry-after') ?? headers.get('Retry-After')
    : headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const dateMs = new Date(raw).getTime();
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

export function kisRateLimitBackoffMs(input: { retryAfterMs?: number; attempt: number }): number {
  if (input.retryAfterMs !== undefined) return input.retryAfterMs;
  const base = Math.min(30_000, 1_000 * Math.max(1, input.attempt));
  return base + Math.floor(Math.random() * 250);
}
