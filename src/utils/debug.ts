/**
 * Global debug logging utility for QuantMaster Pro.
 * Only outputs in development mode to keep production console clean.
 */

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
 * Debug warning - for "silent failure" situations (e.g. missing data, null returns).
 */
export function debugWarn(label: string, data?: unknown): void {
  if (!isDev) return;
  if (data !== undefined) {
    console.warn(`[WARN] ${label}`, data);
  } else {
    console.warn(`[WARN] ${label}`);
  }
}

/**
 * Debug error - for caught exceptions in development.
 */
export function debugError(label: string, error?: unknown): void {
  if (!isDev) return;
  console.error(`[ERROR] ${label}`, error);
}
