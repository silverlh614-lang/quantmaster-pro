// @responsibility client-only P4 warning 단일 진입점 모듈

import { shouldPrintClientWarn } from './clientDebugFlag';
import { shouldEmitClientWarn } from './clientWarnDedup';
import { recordClientWarn } from './clientWarnReporter';
import type { ClientWarnInput, ClientWarnPayload } from './clientWarnTypes';

const DEFAULT_TTL_SEC = 1800;

function makeDedupKey(input: ClientWarnInput): string {
  return input.dedupKey ?? `${input.domain}:${input.code}:${input.message}`;
}

export function createClientWarnPayload(input: ClientWarnInput): ClientWarnPayload {
  return {
    priority: 'P4',
    domain: input.domain,
    code: input.code,
    message: input.message,
    clientOnly: true,
    executionImpact: 'NONE',
    serverImpact: 'NONE',
    telegramAlert: false,
    dedupKey: makeDedupKey(input),
    ttlSec: DEFAULT_TTL_SEC,
    details: input.details,
  };
}

export function clientWarn(input: ClientWarnInput): ClientWarnPayload | null {
  const ttlSec = input.ttlSec ?? DEFAULT_TTL_SEC;
  const payload = createClientWarnPayload(input);

  if (!shouldEmitClientWarn(payload.dedupKey, ttlSec)) {
    return null;
  }

  recordClientWarn(payload);

  if (shouldPrintClientWarn()) {
    console.warn(
      `[P4][${payload.domain}][${payload.code}] clientOnly=true executionImpact=NONE serverImpact=NONE telegramAlert=false ${payload.message}`,
      payload.details ?? {},
    );
  }

  return payload;
}
