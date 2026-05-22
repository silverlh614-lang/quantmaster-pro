// @responsibility mtasGateStep soft Gate regression.

import { describe, expect, it, vi } from 'vitest';
import { mtasGateStep } from '../mtasGateStep.js';

describe('mtasGateStep', () => {
  it('mtas > 3 proceeds', () => {
    const result = mtasGateStep({ stockName: 'Samsung', mtas: 5.5 });
    expect(result.proceed).toBe(true);
  });

  it('mtas = 3 is no longer a hard entry block', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = mtasGateStep({ stockName: 'Samsung', mtas: 3 });

    expect(result.proceed).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[GATE_HARD_FAIL_LIMITED]'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("newRole='SOFT_FAIL_OR_SCORE_PENALTY'"));
    spy.mockRestore();
  });

  it('mtas = 0 remains score evidence instead of a failReason block', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = mtasGateStep({ stockName: 'Samsung', mtas: 0 });

    expect(result.proceed).toBe(true);
    expect(result).not.toHaveProperty('failReasons');
    spy.mockRestore();
  });

  it('mtas = 3.01 proceeds', () => {
    const result = mtasGateStep({ stockName: 'Samsung', mtas: 3.01 });
    expect(result.proceed).toBe(true);
  });
});
