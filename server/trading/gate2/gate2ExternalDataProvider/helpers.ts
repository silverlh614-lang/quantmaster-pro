// @responsibility Gate2 external data provider pure leaf helpers: ISO clock, symbol/number cleaning, record guards, Korean text normalization.

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function cleanSymbol(symbol: string): string {
  return String(symbol || '').replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDartAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function responseStatusCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const status = payload.status ?? payload.rt_cd;
  return typeof status === 'string' ? status : status == null ? null : String(status);
}

export function compactKorean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').replace(/[()\uFF08\uFF09]/g, '').trim();
}
