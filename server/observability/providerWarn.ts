// @responsibility Standard P2 provider warning wrapper with compact deduped output.

import { emitOperationalWarn } from './operationalWarn.js';
import { recordP2WarnSummary } from './p2WarnSummary.js';
import type { OperationalWarnEmission } from './operationalWarnTypes.js';

import type { ProviderWarnSource } from './p2WarnTypes.js';

const providerCodeBySource: Record<ProviderWarnSource, string> = {
  GEMINI: 'P2_PROVIDER_GEMINI_DEGRADED',
  GOOGLE_SEARCH: 'P2_PROVIDER_GOOGLE_SEARCH_DEGRADED',
  DART: 'P2_PROVIDER_DART_DEGRADED',
  YAHOO: 'P2_PROVIDER_YAHOO_DEGRADED',
  LOCAL_RAG: 'P2_PROVIDER_LOCAL_RAG_DEGRADED',
  AI_PROVIDER: 'P2_AI_PROVIDER_DEGRADED',
  SCREENER: 'P2_SCREENER_PROVIDER_DEGRADED',
  SECTOR: 'P2_SECTOR_PROVIDER_DEGRADED',
  KIS_AUX: 'P2_PROVIDER_KIS_AUX_DEGRADED',
  KRX_AUX: 'P2_PROVIDER_KRX_AUX_DEGRADED',
};

export interface ProviderWarnInput {
  source: ProviderWarnSource;
  code?: string;
  message: string;
  dedupKey?: string;
  fallbackUsed?: boolean;
  details?: Record<string, unknown>;
}

export function compactError(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === undefined || error === null) return undefined;
  return String(error);
}

export function emitProviderWarn(input: ProviderWarnInput): OperationalWarnEmission {
  const code = input.code ?? providerCodeBySource[input.source];
  const emission = emitOperationalWarn({
    priority: 'P2',
    domain: 'PROVIDER',
    code,
    message: input.message,
    executionImpact: 'NONE',
    dedupKey: input.dedupKey ?? `p2:provider:${input.source}:${code}`,
    ttlSec: 300,
    details: {
      ...input.details,
      source: input.source,
      providerIssue: true,
      marketSignal: false,
      fallbackUsed: input.fallbackUsed ?? false,
    },
  });
  recordP2WarnSummary(emission);
  return emission;
}
