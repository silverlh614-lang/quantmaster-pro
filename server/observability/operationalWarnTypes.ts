// @responsibility Shared operational warning payload contracts.

import type { ExecutionImpact } from './executionImpact.js';

export type WarnPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type WarnDomain =
  | 'EXECUTION'
  | 'POSITION'
  | 'EXIT'
  | 'APPROVAL'
  | 'REGIME'
  | 'DATA'
  | 'TELEGRAM'
  | 'PROVIDER'
  | 'UI'
  | 'DIAGNOSTIC';

export type WarnMode =
  | 'LIVE'
  | 'SHADOW'
  | 'SHADOW_ONLY'
  | 'SELL_ONLY'
  | 'OBSERVE_ONLY'
  | 'NORMAL'
  | 'DEGRADED';

export interface OperationalWarnPayload {
  priority: WarnPriority;
  domain: WarnDomain;
  code: string;
  message: string;
  executionImpact: ExecutionImpact;
  mode?: WarnMode;
  regime?: string;
  symbol?: string;
  dedupKey: string;
  ttlSec: number;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export interface OperationalWarnEmission {
  payload: OperationalWarnPayload;
  emitted: boolean;
  suppressed: boolean;
  suppressedCount: number;
}
