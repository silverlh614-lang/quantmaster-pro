// @responsibility client-only P4 warning 최근 내역 저장 모듈

import type { ClientWarnPayload } from './clientWarnTypes';

export type CompactClientWarn = Pick<
  ClientWarnPayload,
  | 'priority'
  | 'domain'
  | 'code'
  | 'message'
  | 'clientOnly'
  | 'executionImpact'
  | 'serverImpact'
  | 'telegramAlert'
  | 'dedupKey'
> & { at: string };

const MAX_RECENT_WARNINGS = 50;
const STORAGE_KEY = 'quantmaster.clientWarnings.recent';
const recentWarnings: CompactClientWarn[] = [];

function getLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function recordClientWarn(payload: ClientWarnPayload): void {
  const compact: CompactClientWarn = {
    priority: payload.priority,
    domain: payload.domain,
    code: payload.code,
    message: payload.message,
    clientOnly: payload.clientOnly,
    executionImpact: payload.executionImpact,
    serverImpact: payload.serverImpact,
    telegramAlert: payload.telegramAlert,
    dedupKey: payload.dedupKey,
    at: new Date().toISOString(),
  };

  recentWarnings.unshift(compact);
  if (recentWarnings.length > MAX_RECENT_WARNINGS) recentWarnings.length = MAX_RECENT_WARNINGS;

  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(recentWarnings));
  } catch {
    // Debug panel persistence is best-effort only and must never become operational noise.
  }
}

export function getRecentClientWarnings(): CompactClientWarn[] {
  return [...recentWarnings];
}

export function __resetClientWarnReporterForTests(): void {
  recentWarnings.length = 0;
  const storage = getLocalStorage();
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
