import { describe, it, expect, vi } from 'vitest';
import gateThresholdRecommendation from './gateThresholdRecommendation.cmd.js';

describe('/gate_threshold_reco command', () => {
  it('is a read-only SYS command with the expected name/alias', () => {
    expect(gateThresholdRecommendation.name).toBe('/gate_threshold_reco');
    expect(gateThresholdRecommendation.aliases).toContain('/counterfacture_gate');
    expect(gateThresholdRecommendation.category).toBe('SYS');
    expect(gateThresholdRecommendation.riskLevel).toBe(0);
  });

  it('replies with the ROC recommendation report (read-only, safety footer always present)', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await gateThresholdRecommendation.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain('Gate Threshold ROC 권고');
    expect(message).toContain('liveThresholdAutoChanged=false');
    expect(message).toContain('executionImpact=NONE');
  });
});
