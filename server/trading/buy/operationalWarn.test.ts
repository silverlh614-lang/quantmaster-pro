import { describe, expect, it, vi } from 'vitest';
import { emitOperationalWarn } from './operationalWarn.js';

describe('emitOperationalWarn', () => {
  it('normalizes P0 warn output through the shared wrapper', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    emitOperationalWarn({
      code: 'P0_BUY_SIGNAL_STUCK',
      message: 'stuck',
      context: { tradeId: 't1' },
    });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[P0][EXECUTION][P0_BUY_SIGNAL_STUCK]'),
      expect.objectContaining({
        priority: 'P0',
        domain: 'EXECUTION',
        code: 'P0_BUY_SIGNAL_STUCK',
        executionImpact: 'APPROVAL_FLOW_DEGRADED',
        details: expect.objectContaining({ context: { tradeId: 't1' } }),
      }),
    );
    spy.mockRestore();
  });
});
