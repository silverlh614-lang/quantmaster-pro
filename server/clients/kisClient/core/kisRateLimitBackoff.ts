// @responsibility KIS 429 retry-after and rate-limit backoff helpers.

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
