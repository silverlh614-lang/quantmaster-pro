import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildShadowLiquidationEventId,
  resetShadowExitDedupStateForTest,
  shouldSendShadowExitNotification,
  recordShadowExitNotification,
} from './shadowExitDedup.js';

describe('shadowExitDedup', () => {
  beforeEach(() => resetShadowExitDedupStateForTest());

  it('deterministic event id for same identity', () => {
    const a = buildShadowLiquidationEventId({ mode: 'SHADOW', tradeDate: '2026-05-19', symbol: '005930', positionId: 'P1', exitReason: 'STOP_LOSS', exitStage: 'PRE_ALERT' });
    const b = buildShadowLiquidationEventId({ mode: 'SHADOW', tradeDate: '2026-05-19', symbol: '005930', positionId: 'P1', exitReason: 'STOP_LOSS', exitStage: 'PRE_ALERT' });
    expect(a).toBe(b);
  });

  it('suppresses duplicated PRE_ALERT', () => {
    const input = { mode: 'SHADOW', tradeDate: '2026-05-19', symbol: '005930', positionId: 'P1', exitReason: 'STOP_LOSS', exitStage: 'PRE_ALERT', channelType: 'USER_SIGNAL', messageKind: 'STOP_APPROACH' };
    expect(shouldSendShadowExitNotification({ ...input, positionStatus: 'ACTIVE' }).allow).toBe(true);
    recordShadowExitNotification(input);
    expect(shouldSendShadowExitNotification({ ...input, positionStatus: 'ACTIVE' }).allow).toBe(false);
  });

  it('suppresses PRE_ALERT for CLOSED status', () => {
    const res = shouldSendShadowExitNotification({ mode: 'SHADOW', tradeDate: '2026-05-19', symbol: '005930', positionId: 'P1', exitReason: 'STOP_LOSS', exitStage: 'PRE_ALERT', positionStatus: 'CLOSED', channelType: 'USER_SIGNAL', messageKind: 'STOP_APPROACH' });
    expect(res.allow).toBe(false);
  });
});
