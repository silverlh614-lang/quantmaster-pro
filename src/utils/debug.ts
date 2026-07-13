// @responsibility debug 유틸 함수 모듈
/**
 * Global debug logging utility for QuantMaster Pro.
 * P4 debug warnings are client-only and isolated from server operational warnings.
 */

import { clientWarn } from './clientWarn';

const isDev = typeof process !== 'undefined'
  ? process.env.NODE_ENV === 'development'
  : (import.meta as any).env?.DEV ?? true;

/**
 * Debug log - outputs to console only in development mode.
 * @param label - descriptive label for the log entry
 * @param data  - optional payload to inspect
 */
export function debugLog(label: string, data?: unknown): void {
  if (!isDev) return;
  if (data !== undefined) {
    console.log(`[DEBUG] ${label}`, data);
  } else {
    console.log(`[DEBUG] ${label}`);
  }
}

/**
 * Debug warning - client-only P4 warning for UI/debug-panel visibility.
 */
export function debugWarn(label: string, data?: unknown): void {
  clientWarn({
    domain: 'CLIENT_DEBUG',
    code: 'P4_CLIENT_DEBUG_WARN',
    message: label,
    dedupKey: `debug:${label}`,
    details: data === undefined ? undefined : { data },
  });
}
