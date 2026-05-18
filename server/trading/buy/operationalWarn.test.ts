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
      '[P0][P0_BUY_SIGNAL_STUCK] stuck',
      expect.objectContaining({
        severity: 'P0',
        code: 'P0_BUY_SIGNAL_STUCK',
        context: { tradeId: 't1' },
      }),
    );
    spy.mockRestore();
  });
});
