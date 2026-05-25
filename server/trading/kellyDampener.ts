/**
 * @responsibility kellyDampener — IPS 기반 Kelly 감쇠 제거됨 (stub only)
 *
 * IPS_KELLY_DAMPENER_REMOVED: IPS × Kelly 감쇠 체인 제거. getKellyMultiplier()는
 * 항상 1.0을 반환한다. preflight는 더 이상 이 모듈을 import하지 않는다.
 * 다른 호출처의 import 경로 단절 방지를 위해 파일은 유지한다.
 */

export interface KellyDampenerState {
  multiplier: number;
  ips: number;
  level: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXTREME';
  activeSince: string | null;
  updatedAt: string;
}

export const IPS_KELLY_TABLE: Array<{ threshold: number; multiplier: number; level: KellyDampenerState['level'] }> = [];

/**
 * IPS Kelly 감쇠 제거됨 — 항상 1.0 반환.
 */
export function getKellyMultiplier(): number {
  return 1.0; // IPS_KELLY_DAMPENER_REMOVED
}

export function isKellyDampenerActive(): boolean {
  return false; // IPS_KELLY_DAMPENER_REMOVED
}

export function loadKellyDampenerState(): KellyDampenerState {
  return { multiplier: 1.0, ips: 0, level: 'NORMAL', activeSince: null, updatedAt: new Date(0).toISOString() };
}

export function updateKellyDampenerFromIps(_ips: number): {
  changed: boolean;
  prevMultiplier: number;
  multiplier: number;
  level: KellyDampenerState['level'];
  activatedNow: boolean;
} {
  return { changed: false, prevMultiplier: 1.0, multiplier: 1.0, level: 'NORMAL', activatedNow: false }; // IPS_KELLY_DAMPENER_REMOVED
}

export function clearKellyDampener(): void {
  /* SDS-ignore: IPS_KELLY_DAMPENER_REMOVED — stub, no state to clear */
}
