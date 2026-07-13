/**
 * @responsibility 체결 단계 운영 경고를 실행영향 등급으로 분류해 발행하는 어댑터를 제공한다.
 */

import { emitLegacyOperationalWarn } from '../../observability/legacyOperationalWarnAdapter.js';
import type { ExecutionImpact } from '../../observability/executionImpact.js';

type FillP0WarnCode =
  | 'P0_FILL_QUERY_EMPTY'
  | 'P0_FILL_QUERY_FAILED'
  | 'P0_SELL_FILL_MONITOR_DEGRADED'
  | 'P0_SELL_REISSUE_FAILED'
  | 'P0_SELL_REISSUE_DUPLICATE_BLOCKED'
  | 'P0_PROVISIONAL_FILL_RECONCILE_FAILED';

export interface FillOperationalWarnEvent {
  code: FillP0WarnCode | string;
  message: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  context?: Record<string, unknown>;
  cause?: unknown;
}

function impactForFillCode(code: string): ExecutionImpact {
  if (code.includes('SELL_REISSUE')) return 'LIVE_SELL_BLOCKED';
  if (code.includes('SELL_FILL_MONITOR')) return 'EXIT_MONITOR_DEGRADED';
  if (code.includes('PROVISIONAL_FILL')) return 'EXIT_MONITOR_DEGRADED';
  if (code.includes('FILL_QUERY')) return 'EXIT_MONITOR_DEGRADED';
  return 'EXIT_MONITOR_DEGRADED';
}

export function emitOperationalWarn(event: FillOperationalWarnEvent): void {
  emitLegacyOperationalWarn(event, {
    domain: 'EXECUTION',
    impactForCode: impactForFillCode,
  });
}
