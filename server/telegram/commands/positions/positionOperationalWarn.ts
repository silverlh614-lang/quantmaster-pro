// @responsibility Operational warnings for Telegram position source queries.
import { emitLegacyOperationalWarn } from '../../../observability/legacyOperationalWarnAdapter.js';
import type { ExecutionImpact } from '../../../observability/executionImpact.js';

type PositionP0WarnCode =
  | 'P0_POSITION_QUERY_DEGRADED'
  | 'P0_SHADOW_POSITION_SOURCE_FAILED'
  | 'P0_VIRTUAL_ACCOUNT_POSITION_FAILED'
  | 'P0_PAPER_LEDGER_POSITION_FAILED'
  | 'P0_POSITION_DISPLAY_NORMALIZE_FAILED';

export interface PositionOperationalWarnEvent {
  code: PositionP0WarnCode | string;
  message: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  context?: Record<string, unknown>;
  cause?: unknown;
}

function impactForPositionCode(): ExecutionImpact {
  return 'POSITION_QUERY_DEGRADED';
}

export function emitPositionOperationalWarn(event: PositionOperationalWarnEvent): void {
  emitLegacyOperationalWarn(event, {
    domain: 'POSITION',
    impactForCode: impactForPositionCode,
  });
}
