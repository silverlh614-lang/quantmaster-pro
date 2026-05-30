/**
 * @responsibility 매수 단계 운영 경고를 실행영향 등급으로 분류해 발행하는 어댑터를 제공한다.
 */

import { emitLegacyOperationalWarn } from '../../observability/legacyOperationalWarnAdapter.js';
import type { ExecutionImpact } from '../../observability/executionImpact.js';

export type OperationalWarnSeverity = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type BuyP0WarnCode =
  | 'P0_BUY_SIGNAL_STUCK'
  | 'P0_SHADOW_EXECUTION_STUCK'
  | 'P0_LIVE_EXECUTION_STUCK'
  | 'P0_BUY_STATUS_WRITE_FAILED'
  | 'P0_SHADOW_POSITION_OPEN_FAILED'
  | 'P0_BUY_APPROVAL_POLICY_VIOLATION';

export interface OperationalWarnEvent {
  code: BuyP0WarnCode | string;
  message: string;
  severity?: OperationalWarnSeverity;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export type OperationalWarnEmitter = (event: OperationalWarnEvent) => void;

function impactForBuyCode(code: string): ExecutionImpact {
  if (code === 'P0_LIVE_EXECUTION_STUCK') return 'LIVE_ORDER_BLOCKED';
  if (code === 'P0_SHADOW_EXECUTION_STUCK') return 'SHADOW_EXECUTION_DEGRADED';
  if (code === 'P0_SHADOW_POSITION_OPEN_FAILED') return 'SHADOW_POSITION_AT_RISK';
  if (code === 'P0_BUY_STATUS_WRITE_FAILED') return 'APPROVAL_FLOW_DEGRADED';
  if (code.includes('APPROVAL') || code.includes('BUY_SIGNAL')) return 'APPROVAL_FLOW_DEGRADED';
  return 'SHADOW_EXECUTION_DEGRADED';
}

export function emitOperationalWarn(event: OperationalWarnEvent): void {
  emitLegacyOperationalWarn(event, {
    domain: event.code.includes('APPROVAL') ? 'APPROVAL' : 'EXECUTION',
    impactForCode: impactForBuyCode,
  });
}
