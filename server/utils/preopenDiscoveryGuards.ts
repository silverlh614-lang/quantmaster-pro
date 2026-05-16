// @responsibility PREOPEN discovery-only throttle helpers
/**
 * PATCH-PREOPEN-DISCOVERY-THROTTLE-001 — shared guards for the KST 08:45~09:00
 * preopen discovery layer.  These helpers intentionally do not affect EXIT,
 * position-management, order, reconcile, shadow-position-management, ledger, or
 * virtual-account paths.
 */

export type KisRealDataPurpose =
  | 'DISCOVERY'
  | 'TELEMETRY'
  | 'SCREENER'
  | 'EXIT'
  | 'POSITION_MANAGEMENT'
  | 'ORDER'
  | 'RECONCILE'
  | 'SHADOW_POSITION_MANAGEMENT'
  | string;

const PREOPEN_START = 845;
const PREOPEN_END_EXCLUSIVE = 900;
const DISCOVERY_PURPOSES = new Set(['DISCOVERY', 'TELEMETRY', 'SCREENER']);
const PROTECTED_PURPOSES = new Set([
  'EXIT',
  'POSITION_MANAGEMENT',
  'ORDER',
  'RECONCILE',
  'SHADOW_POSITION_MANAGEMENT',
]);
const PREOPEN_REALDATA_GUARDED_TR_IDS = new Set([
  'FHPST01760000',
  'FHPST01600000',
  'FHPST01710000',
]);

export const PREOPEN_AUTOPOPULATE_TTL_MS = 10 * 60 * 1000;

export interface KstClockParts {
  yyyymmdd: string;
  hhmm: string;
  t: number;
  dow: number;
}

export function getKstClockParts(now = new Date()): KstClockParts {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = String(kst.getUTCFullYear());
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return {
    yyyymmdd: `${yyyy}${mm}${dd}`,
    hhmm: `${hh}${min}`,
    t: Number(`${hh}${min}`),
    dow: kst.getUTCDay(),
  };
}

export function isKstPreopenDiscoveryWindow(now = new Date()): boolean {
  const { t, dow } = getKstClockParts(now);
  return dow >= 1 && dow <= 5 && t >= PREOPEN_START && t < PREOPEN_END_EXCLUSIVE;
}

export function normalizeKisPurpose(purpose?: string): string {
  return (purpose ?? 'DISCOVERY').trim().toUpperCase() || 'DISCOVERY';
}

export function isProtectedKisPurpose(purpose?: string): boolean {
  return PROTECTED_PURPOSES.has(normalizeKisPurpose(purpose));
}

export function shouldGuardKisRealDataPreopen(input: {
  trId: string;
  purpose?: string;
  now?: Date;
}): boolean {
  const purpose = normalizeKisPurpose(input.purpose);
  if (isProtectedKisPurpose(purpose)) return false;
  if (!DISCOVERY_PURPOSES.has(purpose)) return false;
  return PREOPEN_REALDATA_GUARDED_TR_IDS.has(input.trId) && isKstPreopenDiscoveryWindow(input.now ?? new Date());
}

export function buildPreopenOrchestratorCycleKey(now = new Date()): string {
  const { yyyymmdd, hhmm } = getKstClockParts(now);
  return `PREOPEN_ORCHESTRATOR:${yyyymmdd}:${hhmm}`;
}

export function msUntilKstMarketCloseOrMin(minTtlMs: number, now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const close = new Date(kst);
  close.setUTCHours(15, 30, 0, 0);
  const closeUtcMs = close.getTime() - 9 * 60 * 60 * 1000;
  return Math.max(minTtlMs, closeUtcMs - now.getTime());
}
