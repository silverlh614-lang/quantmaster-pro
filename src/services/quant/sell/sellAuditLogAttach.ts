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
