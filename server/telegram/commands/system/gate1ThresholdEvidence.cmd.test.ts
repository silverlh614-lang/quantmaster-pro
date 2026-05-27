import { describe, it, expect, vi } from 'vitest';
import gate1ThresholdEvidence from './gate1ThresholdEvidence.cmd.js';

describe('/gate1_threshold_evidence command', () => {
  it('is a read-only SYS command with the expected name/alias', () => {
    expect(gate1ThresholdEvidence.name).toBe('/gate1_threshold_evidence');
    expect(gate1ThresholdEvidence.aliases).toContain('/gate1_evidence');
    expect(gate1ThresholdEvidence.category).toBe('SYS');
    expect(gate1ThresholdEvidence.riskLevel).toBe(0);
  });

  it('replies with the Gate1 Threshold Evidence section (skeleton when ledger empty)', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await gate1ThresholdEvidence.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const message = reply.mock.calls[0][0] as string;
    expect(message).toContain('Gate1 Threshold Evidence');
    expect(message).not.toContain('Gate3 Threshold Evidence');
    expect(message).toContain('scoreBandTable:');
    expect(message).toContain('Gate1 Evidence Maturity Scheduler:');
    expect(message).toContain('executionImpact: NONE');
    // Empty ledger ⟹ read-only skeleton.
    expect(message).toContain('recommendedAction: OBSERVE_MORE');
    expect(message).toContain('confidence: INSUFFICIENT_SAMPLE');
  });
});
