import { describe, it, expect, vi } from 'vitest';
import promotionReadiness from './promotionReadiness.cmd.js';

describe('/promotion_readiness command', () => {
  it('is a read-only HIDDEN SYS command (riskLevel 0)', () => {
    expect(promotionReadiness.name).toBe('/promotion_readiness');
    expect(promotionReadiness.category).toBe('SYS');
    expect(promotionReadiness.visibility).toBe('HIDDEN');
    expect(promotionReadiness.riskLevel).toBe(0);
  });

  it('replies with the ADR-0631 promotion readiness section (DATA_UNAVAILABLE when ledger empty)', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await promotionReadiness.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain('Shadow→Live Promotion Readiness (ADR-0631)');
    expect(message).toContain('executionImpact: NONE');
    expect(message).toContain('REGIME_AWARE_THRESHOLD_ADR0546');
    expect(message).toContain('CONDITION_WEIGHT_ADR0624');
  });
});
