import { emitLegacyOperationalWarn } from '../../../observability/legacyOperationalWarnAdapter.js';
import type { ExecutionImpact } from '../../../observability/executionImpact.js';

export type KisOrderP0WarnCode =
  | 'P0_KIS_BUY_ORDER_BLOCKED'
  | 'P0_KIS_SELL_ORDER_BLOCKED'
  | 'P0_KIS_ORDER_REJECTED'
  | 'P0_KIS_ORDER_FATAL'
  | 'P0_KIS_OCO_ORDER_FAILED'
  | 'P0_KIS_ORDER_RESULT_UNMAPPED';

export interface KisOrderOperationalWarnEvent {
  code: KisOrderP0WarnCode | string;
  message: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3';
  context?: Record<string, unknown>;
  cause?: unknown;
}

function impactForKisCode(code: string, context?: Record<string, unknown>): ExecutionImpact {
  const orderKind = typeof context?.orderKind === 'string' ? context.orderKind : '';
  if (code.includes('SELL') || orderKind.includes('SELL')) return 'LIVE_SELL_BLOCKED';
  return 'LIVE_ORDER_BLOCKED';
}

export function emitKisOrderOperationalWarn(event: KisOrderOperationalWarnEvent): void {
  emitLegacyOperationalWarn(event, {
    domain: 'EXECUTION',
    impactForCode: impactForKisCode,
  });
}
