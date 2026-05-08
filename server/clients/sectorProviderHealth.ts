// @responsibility ADR-0462 Sector provider health/cache warmup semantics

export type ProviderHealth = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'EMPTY' | 'ERROR';

export interface SectorProviderHealthSnapshot {
  providerHealth: ProviderHealth;
  cacheEmpty: boolean;
  marketSignal: false;
  reasons: string[];
  updatedAt: string;
}

export function deriveSectorProviderHealth(input: {
  cacheSize?: number;
  stale?: boolean;
  error?: unknown;
  degraded?: boolean;
  now?: Date;
}): SectorProviderHealthSnapshot {
  const now = input.now ?? new Date();
  if (input.error) {
    return { providerHealth: 'ERROR', cacheEmpty: (input.cacheSize ?? 0) === 0, marketSignal: false, reasons: ['PROVIDER_ERROR'], updatedAt: now.toISOString() };
  }
  if ((input.cacheSize ?? 0) <= 0) {
    return { providerHealth: 'EMPTY', cacheEmpty: true, marketSignal: false, reasons: ['PROVIDER_CACHE_EMPTY'], updatedAt: now.toISOString() };
  }
  if (input.stale) {
    return { providerHealth: 'STALE', cacheEmpty: false, marketSignal: false, reasons: ['PROVIDER_STALE'], updatedAt: now.toISOString() };
  }
  if (input.degraded) {
    return { providerHealth: 'DEGRADED', cacheEmpty: false, marketSignal: false, reasons: ['PROVIDER_DEGRADED'], updatedAt: now.toISOString() };
  }
  return { providerHealth: 'VERIFIED', cacheEmpty: false, marketSignal: false, reasons: [], updatedAt: now.toISOString() };
}

export async function warmupSectorProviderCache(warmup: () => Promise<unknown[] | null | undefined>): Promise<SectorProviderHealthSnapshot> {
  try {
    const rows = await warmup();
    return deriveSectorProviderHealth({ cacheSize: rows?.length ?? 0 });
  } catch (error) {
    return deriveSectorProviderHealth({ error });
  }
}
