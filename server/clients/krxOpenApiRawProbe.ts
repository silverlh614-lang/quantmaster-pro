/**
 * @responsibility Raw KRX OpenAPI HTTP diagnostics for EMPTY_PARSE root-cause isolation.
 *
 * This module intentionally bypasses krxGet() because krxGet() normalizes failures to null.
 * It is diagnostic-only and does not mutate circuit/cache state.
 * ADR-0361: default probe base uses official openapi.krx.co.kr, with beta retained only as candidate.
 */

interface KrxOpenApiRawJson {
  OutBlock_1?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

export interface KrxRawProbeResult {
  base: string;
  endpoint: string;
  params: Record<string, string>;
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  textLength: number;
  first300Chars: string;
  jsonTopKeys: string[];
  rowCount: number;
  rowSampleKeys: string[];
  error?: string;
}

const DEFAULT_BASE = 'https://openapi.krx.co.kr/svc/apis';
const RAW_PROBE_TIMEOUT_MS = 10_000;

function normalizeBase(base: string): string {
  const cleaned = base.trim().replace(/\/+$/u, '');
  return /\/svc\/apis$/iu.test(cleaned) ? cleaned : `${cleaned}/svc/apis`;
}

export function readKrxOpenApiRawBase(): string {
  const legacy = process.env.KRX_OPENAPI_BASE?.trim();
  if (legacy) return normalizeBase(legacy);
  const canonical = process.env.KRX_API_BASE?.trim();
  if (canonical) return normalizeBase(canonical);
  return DEFAULT_BASE;
}

function readAuthKey(): string {
  const canonical = (process.env.KRX_API_KEY ?? '').trim();
  if (canonical) return canonical;
  return (process.env.KRX_OPENAPI_AUTH_KEY ?? '').trim();
}

export function getKrxOpenApiBaseProbeCandidates(): string[] {
  return Array.from(new Set([
    readKrxOpenApiRawBase(),
    'https://openapi.krx.co.kr/svc/apis',
    'https://data-dbg.krx.co.kr/svc/apis',
    'http://data-dbg.krx.co.kr/svc/apis',
  ].map(normalizeBase)));
}

function extractRows(raw: KrxOpenApiRawJson | null): unknown[] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.OutBlock_1)) return raw.OutBlock_1;
  if (Array.isArray(raw.output)) return raw.output;
  for (const v of Object.values(raw)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

function rowKeys(row: unknown): string[] {
  if (!row || typeof row !== 'object') return [];
  return Object.keys(row as Record<string, unknown>).slice(0, 20);
}

export async function krxRawProbe(
  endpoint: string,
  params: Record<string, string>,
  base = readKrxOpenApiRawBase(),
): Promise<KrxRawProbeResult> {
  const normalizedBase = normalizeBase(base);
  const url = new URL(`${normalizedBase}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RAW_PROBE_TIMEOUT_MS);

  try {
    const authKey = readAuthKey();
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...(authKey ? { AUTH_KEY: authKey } : {}),
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    const text = await res.text();
    let json: KrxOpenApiRawJson | null = null;
    try {
      json = JSON.parse(text) as KrxOpenApiRawJson;
    } catch {
      json = null;
    }
    const rows = extractRows(json);
    return {
      base: normalizedBase,
      endpoint,
      params,
      ok: res.ok,
      httpStatus: res.status,
      contentType: res.headers.get('content-type'),
      textLength: text.length,
      first300Chars: text.slice(0, 300),
      jsonTopKeys: json ? Object.keys(json).slice(0, 20) : [],
      rowCount: rows.length,
      rowSampleKeys: rowKeys(rows[0]),
    };
  } catch (err) {
    return {
      base: normalizedBase,
      endpoint,
      params,
      ok: false,
      httpStatus: null,
      contentType: null,
      textLength: 0,
      first300Chars: '',
      jsonTopKeys: [],
      rowCount: 0,
      rowSampleKeys: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeKrxOpenApiBases(
  endpoint: string,
  params: Record<string, string>,
): Promise<KrxRawProbeResult[]> {
  const candidates = getKrxOpenApiBaseProbeCandidates();
  const out: KrxRawProbeResult[] = [];
  for (const base of candidates) {
    out.push(await krxRawProbe(endpoint, params, base));
  }
  return out;
}

export function formatRawProbeSummary(probes: KrxRawProbeResult[]): string {
  return probes.map((p) =>
    `${p.base} status=${p.httpStatus ?? 'ERR'} rows=${p.rowCount} len=${p.textLength} keys=${p.rowSampleKeys.join('|') || 'NONE'}`,
  ).join(' || ');
}
