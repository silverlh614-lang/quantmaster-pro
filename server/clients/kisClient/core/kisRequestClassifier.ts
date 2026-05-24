// @responsibility Classify KIS requests by operational priority/purpose.

import type { KisApiPriority } from '../../kisRateLimiter.js';

export type KisRequestPriority =
  | 'P0_ORDER'
  | 'P0_FILL'
  | 'P0_POSITION_EXIT'
  | 'P1_QUOTE_HYDRATION'
  | 'P1_CORE_MARKET_DATA'
  | 'P2_AUX_PROVIDER'
  | 'P3_SCAN_DIAGNOSTIC'
  | 'P4_TELEMETRY';

export type KisHttpMethod = 'GET' | 'POST' | 'DELETE';

export interface KisRequestClassificationInput {
  method: KisHttpMethod;
  trId: string;
  apiPath: string;
  kisApiPriority?: KisApiPriority;
  purpose?: string;
  idempotency?: 'safe' | 'unsafe';
}

export interface KisRequestClassification {
  priority: KisRequestPriority;
  providerIssue: boolean;
  marketSignal: false;
  diagnosticSuppressed: boolean;
  executionImpact: 'NONE' | 'PROVIDER_CORE_DEGRADED';
}

function upper(value: string | undefined): string {
  return (value ?? '').toUpperCase();
}

export function isDiagnosticKisPriority(priority: KisRequestPriority): boolean {
  return priority === 'P3_SCAN_DIAGNOSTIC' || priority === 'P4_TELEMETRY';
}

export function isCoreKisPriority(priority: KisRequestPriority): boolean {
  return priority.startsWith('P0_') || priority.startsWith('P1_');
}

export function classifyKisRequest(input: KisRequestClassificationInput): KisRequestClassification {
  const purpose = upper(input.purpose);
  const path = upper(input.apiPath);
  const trId = upper(input.trId);
  const method = input.method;

  let priority: KisRequestPriority;
  if (purpose.includes('TELEMETRY')) {
    priority = 'P4_TELEMETRY';
  } else if (purpose.includes('DIAGNOSTIC') || purpose.includes('SCAN_DIAGNOSTIC')) {
    priority = 'P3_SCAN_DIAGNOSTIC';
  } else if (method === 'POST' && input.idempotency !== 'safe') {
    priority = 'P0_ORDER';
  } else if (path.includes('CCNL') || path.includes('CCLD') || trId.includes('CCNL') || trId.includes('CCLD')) {
    priority = 'P0_FILL';
  } else if (path.includes('BALANCE') || path.includes('INQUIRE-BALANCE') || purpose.includes('POSITION_EXIT')) {
    priority = 'P0_POSITION_EXIT';
  } else if (purpose.includes('QUOTE') || purpose.includes('HYDRATION')) {
    priority = 'P1_QUOTE_HYDRATION';
  } else if (input.kisApiPriority === 'LOW') {
    priority = 'P2_AUX_PROVIDER';
  } else {
    priority = 'P1_CORE_MARKET_DATA';
  }

  return {
    priority,
    providerIssue: false,
    marketSignal: false,
    diagnosticSuppressed: isDiagnosticKisPriority(priority),
    executionImpact: isCoreKisPriority(priority) ? 'PROVIDER_CORE_DEGRADED' : 'NONE',
  };
}
