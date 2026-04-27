// @responsibility quant sellAuditLogAttach 엔진 모듈
/**
 * sell/sellAuditLogAttach.ts — AuditLog를 PositionEventBus에 연결하는 헬퍼
 *
 * 서버 부팅 시 1회 호출해 SELL_EXECUTED 이벤트를 자동 기록.
 */

import type { SellSignal, ActivePosition } from '../../../types/sell';
import type { RegimeLevel, ROEType } from '../../../types/core';
import { buildAuditEntry, type AuditLogAdapter } from './sellAuditLog';

type Subscribe = (
  handler: (e: { type: string; payload: unknown }) => void,
  types?: readonly string[],
) => () => void;

export interface AuditContextBuilder {
  (position: ActivePosition): {
    triggeredLayerIds: readonly string[];
    winningLayerId: string;
    regime: RegimeLevel;
    roeType?: ROEType;
    ichimokuState?: 'ABOVE_CLOUD' | 'INSIDE_CLOUD' | 'BELOW_CLOUD';
  };
}

export function attachAuditLogger(
  subscribe: Subscribe,
  adapter: AuditLogAdapter,
  buildContext: AuditContextBuilder,
): () => void {
  return subscribe((event) => {
    if (event.type !== 'SELL_EXECUTED') return;
    const payload = event.payload as {
      kind: string;
      position: ActivePosition;
      signal: SellSignal;
      executedPrice: number;
      executedRatio: number;
    };
    if (payload.kind !== 'EXECUTION') return;

    const ctx = buildContext(payload.position);
    const entry = buildAuditEntry({
      position: payload.position,
      triggeredSignals: [payload.signal],
      winningSignal: payload.signal,
      executedPrice: payload.executedPrice,
      executedRatio: payload.executedRatio,
      ...ctx,
    });
    void adapter.append(entry);
  }, ['SELL_EXECUTED']);
}
