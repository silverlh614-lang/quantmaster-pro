import { describe, expect, it, vi } from 'vitest';
import {
  createBuySignalStateMachine,
  canTransitionBuySignal,
} from './buySignalStateMachine.js';
import type { OperationalWarnEvent } from './operationalWarn.js';

describe('buySignalStateMachine', () => {
  it('allows the required LIVE approval lifecycle', () => {
    const sm = createBuySignalStateMachine({ mode: 'LIVE' });

    expect(sm.transition('APPROVAL_REQUESTED', 'approval card sent').ok).toBe(true);
    expect(sm.transition('APPROVED', 'user approved').ok).toBe(true);
    expect(sm.transition('LIVE_ORDER_PENDING', 'live executor accepted').ok).toBe(true);
    expect(sm.transition('LIVE_ORDER_SUBMITTED', 'kis order submitted').ok).toBe(true);
    expect(sm.transition('LIVE_FILLED', 'fill confirmed').ok).toBe(true);

    expect(sm.state).toBe('LIVE_FILLED');
    expect(sm.assertSettled()).toEqual({
      ok: true,
      state: 'LIVE_FILLED',
      emittedCodes: [],
    });
  });

  it('allows the required SHADOW paper-fill lifecycle', () => {
    const sm = createBuySignalStateMachine({ mode: 'SHADOW' });

    expect(sm.transition('APPROVAL_REQUESTED', 'approval card sent').ok).toBe(true);
    expect(sm.transition('APPROVED', 'user approved').ok).toBe(true);
    expect(sm.transition('SHADOW_ORDER_CREATED', 'shadow order created').ok).toBe(true);
    expect(sm.transition('SHADOW_PAPER_FILLED', 'paper fill recorded').ok).toBe(true);
    expect(sm.transition('SHADOW_POSITION_OPENED', 'position opened').ok).toBe(true);

    expect(sm.state).toBe('SHADOW_POSITION_OPENED');
    expect(sm.assertSettled()).toEqual({
      ok: true,
      state: 'SHADOW_POSITION_OPENED',
      emittedCodes: [],
    });
  });

  it('blocks impossible transitions and emits the policy violation P0', () => {
    const warn = vi.fn<(event: OperationalWarnEvent) => void>();
    const sm = createBuySignalStateMachine({ mode: 'LIVE', onWarn: warn });

    const result = sm.transition('LIVE_ORDER_PENDING', 'invalid jump');

    expect(result.ok).toBe(false);
    expect(sm.state).toBe('NEW');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      code: 'P0_BUY_APPROVAL_POLICY_VIOLATION',
    }));
    expect(canTransitionBuySignal('NEW', 'LIVE_ORDER_PENDING')).toBe(false);
  });

  it('emits generic and LIVE stuck P0 warnings when approval does not settle', () => {
    const warn = vi.fn<(event: OperationalWarnEvent) => void>();
    const sm = createBuySignalStateMachine({ mode: 'LIVE', onWarn: warn });

    sm.transition('APPROVAL_REQUESTED', 'approval card sent');
    sm.transition('APPROVED', 'approved');

    const result = sm.assertSettled();

    expect(result.ok).toBe(false);
    expect(result.emittedCodes).toEqual([
      'P0_BUY_SIGNAL_STUCK',
      'P0_LIVE_EXECUTION_STUCK',
    ]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'P0_BUY_SIGNAL_STUCK' }));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'P0_LIVE_EXECUTION_STUCK' }));
  });

  it('treats LIVE_ORDER_SUBMITTED as an open settled state', () => {
    const warn = vi.fn<(event: OperationalWarnEvent) => void>();
    const sm = createBuySignalStateMachine({ mode: 'LIVE', onWarn: warn });

    sm.transition('APPROVAL_REQUESTED', 'approval card sent');
    sm.transition('APPROVED', 'approved');
    sm.transition('LIVE_ORDER_PENDING', 'pending');
    sm.transition('LIVE_ORDER_SUBMITTED', 'submitted');

    expect(sm.assertSettled()).toEqual({
      ok: true,
      state: 'LIVE_ORDER_SUBMITTED',
      emittedCodes: [],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits generic and SHADOW stuck P0 warnings when paper-fill does not open/reject', () => {
    const warn = vi.fn<(event: OperationalWarnEvent) => void>();
    const sm = createBuySignalStateMachine({ mode: 'SHADOW', onWarn: warn });

    sm.transition('APPROVAL_REQUESTED', 'approval card sent');
    sm.transition('APPROVED', 'approved');
    sm.transition('SHADOW_ORDER_CREATED', 'created');
    sm.transition('SHADOW_PAPER_FILLED', 'paper filled');

    const result = sm.assertSettled();

    expect(result.ok).toBe(false);
    expect(result.emittedCodes).toEqual([
      'P0_BUY_SIGNAL_STUCK',
      'P0_SHADOW_EXECUTION_STUCK',
    ]);
  });
});
