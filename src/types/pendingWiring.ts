// @responsibility pending wiring dashboard domain 타입 정의

export type PendingPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type PendingWiringStatus =
  | 'NOT_STARTED'
  | 'INFRASTRUCTURE_ONLY'
  | 'PARTIAL'
  | 'OBSERVE_ONLY'
  | 'SHADOW_ONLY'
  | 'ADVISORY_ONLY'
  | 'WEIGHTED_READY'
  | 'GATED_READY'
  | 'CORE_READY'
  | 'BLOCKED'
  | 'DONE';

export type PendingScope =
  | 'LIVE'
  | 'SHADOW'
  | 'UI'
  | 'DIAGNOSTIC'
  | 'TELEGRAM'
  | 'DATA_PROVIDER'
  | 'BACKTEST'
  | 'LEARNING'
  | 'MACRO'
  | 'SECTOR'
  | 'RISK';

export type PendingExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'SHADOW_ONLY'
  | 'DEGRADED'
  | 'BLOCKING';

export interface PendingWiringItem {
  id: string;
  priority: PendingPriority;
  moduleName: string;
  status: PendingWiringStatus;
  scope: PendingScope[];
  sourceFile?: string;
  owner?: string;
  createdAt?: string;
  dueAt?: string;
  executionImpact: PendingExecutionImpact;
  nextAction?: string;
  notes?: string;
}
