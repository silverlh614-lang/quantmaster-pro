// @responsibility Track KIS provider health separately from market signals.

import { emitOperationalWarn } from '../../../observability/operationalWarn.js';
import type { KisRequestPriority } from './kisRequestClassifier.js';
import { isCoreKisPriority, isDiagnosticKisPriority } from './kisRequestClassifier.js';

export type KisProviderHealthState =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'COOLDOWN'
  | 'CIRCUIT_OPEN';

export interface KisProviderHealthRecord {
  priority: KisRequestPriority;
  status: KisProviderHealthState;
  updatedAt: string;
  failureCount: number;
  lastReason?: string;
  lastStatus?: number;
  providerIssue: boolean;
  marketSignal: false;
  diagnosticSuppressed: boolean;
}

export interface KisProviderFailureInput {
  priority: KisRequestPriority;
  reason: string;
  status?: number;
  providerHealth?: KisProviderHealthState;
  trId?: string;
  symbol?: string;
}

const health = new Map<KisRequestPriority, KisProviderHealthRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function getOrCreate(priority: KisRequestPriority): KisProviderHealthRecord {
  const existing = health.get(priority);
  if (existing) return existing;
  const created: KisProviderHealthRecord = {
    priority,
    status: 'MISSING',
    updatedAt: nowIso(),
    failureCount: 0,
    providerIssue: false,
    marketSignal: false,
    diagnosticSuppressed: isDiagnosticKisPriority(priority),
  };
  health.set(priority, created);
  return created;
}

function warnCodeFor(input: KisProviderFailureInput): string {
  if (input.providerHealth === 'CIRCUIT_OPEN') return 'P1_KIS_CIRCUIT_OPEN_CORE';
  if (input.status === 401) return 'P1_KIS_AUTH_REFRESH_FAILED';
  if (input.status === 429) return 'P1_KIS_RATE_LIMITED_CORE';
  if (input.status !== undefined && input.status >= 500) return 'P1_KIS_SERVER_ERROR_COOLDOWN';
  if (input.priority === 'P1_QUOTE_HYDRATION') return 'P1_KIS_QUOTE_HYDRATION_FAILED';
  return 'P1_KIS_CORE_PROVIDER_DEGRADED';
}

export function recordKisProviderSuccess(priority: KisRequestPriority): KisProviderHealthRecord {
  const record = getOrCreate(priority);
  record.status = 'VERIFIED';
  record.updatedAt = nowIso();
  record.providerIssue = false;
  record.marketSignal = false;
  record.diagnosticSuppressed = isDiagnosticKisPriority(priority);
  record.lastReason = undefined;
  record.lastStatus = undefined;
  return { ...record };
}

export function recordKisProviderFailure(input: KisProviderFailureInput): KisProviderHealthRecord {
  const record = getOrCreate(input.priority);
  record.status = input.providerHealth ?? (input.status === 429 ? 'COOLDOWN' : 'DEGRADED');
  record.updatedAt = nowIso();
  record.failureCount += 1;
  record.lastReason = input.reason;
  record.lastStatus = input.status;
  record.providerIssue = true;
  record.marketSignal = false;
  record.diagnosticSuppressed = isDiagnosticKisPriority(input.priority);

  if (isCoreKisPriority(input.priority)) {
    emitOperationalWarn({
      priority: 'P1',
      domain: 'PROVIDER',
      code: warnCodeFor(input),
      message: 'KIS core provider degraded; provider issue is separated from market signal.',
      executionImpact: 'PROVIDER_CORE_DEGRADED',
      symbol: input.symbol,
      dedupKey: `kis-core:${input.priority}:${warnCodeFor(input)}:${input.trId ?? 'unknown'}:${input.status ?? 'na'}`,
      ttlSec: 60,
      details: {
        reason: input.reason,
        trId: input.trId,
        status: input.status,
        providerIssue: true,
        marketSignal: false,
        diagnosticSuppressed: false,
      },
    });
    emitOperationalWarn({
      priority: 'P1',
      domain: 'PROVIDER',
      code: 'P1_KIS_PROVIDER_MARKET_SIGNAL_SEPARATED',
      message: 'KIS provider issue recorded without converting it into a market signal.',
      executionImpact: 'NONE',
      symbol: input.symbol,
      dedupKey: `kis-provider-market-signal-separated:${input.priority}:${input.trId ?? 'unknown'}`,
      ttlSec: 300,
      details: {
        reason: input.reason,
        providerIssue: true,
        marketSignal: false,
      },
    });
  }

  return { ...record };
}

export function getKisProviderHealthSnapshot(): KisProviderHealthRecord[] {
  return Array.from(health.values()).map((record) => ({ ...record }));
}

export function __resetKisProviderHealthForTests(): void {
  health.clear();
}
