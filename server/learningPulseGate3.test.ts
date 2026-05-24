import { describe, expect, it } from 'vitest';
import { formatGate3LearningFinalizationSection } from './quant/gate3CompletionScore.js';
import { buildGate3EvidenceWarmupStatus, formatGate3EvidenceWarmupSection } from './quant/gate3EvidenceWarmup.js';

describe('Gate3 Learning Finalization pulse section', () => {
  it('prints outcome, threshold evidence, warm-up health, and completion status for /learning_pulse', () => {
    const evidenceWarmup = buildGate3EvidenceWarmupStatus([]);
    const text = formatGate3LearningFinalizationSection({
      outcomeSeeds: 11,
      labeled: 4,
      pending: 7,
      dataInsufficient: 0,
      thresholdEvidenceSampleSize: 4,
      suggestions: 1,
      completionScore: 99,
      status: 'COMPLETE',
      evidenceWarmup,
      marketSignal: false,
    });

    expect(text).toContain('Gate3 Learning Finalization');
    expect(text).toContain('outcomeSeeds: 11');
    expect(text).toContain('labeled: 4');
    expect(text).toContain('pending: 7');
    expect(text).toContain('thresholdEvidenceSampleSize: 4');
    expect(text).toContain('suggestions: 1');
    expect(text).toContain('completionScore: 99');
    expect(text).toContain('status: COMPLETE');
    expect(text).toContain('evidenceWarmupSchedulerHealthy: true');
    expect(text).toContain('marketSignal=false');
  });

  it('prints the Gate3 Evidence Warm-up detail section', () => {
    const text = formatGate3EvidenceWarmupSection(buildGate3EvidenceWarmupStatus([], {
      thresholdEvidenceSampleSize: 0,
    }));

    expect(text).toContain('Gate3 Evidence Warm-up');
    expect(text).toContain('pending: 0');
    expect(text).toContain('schedulerHealthy: true');
    expect(text).toContain('providerIssue=false');
  });
});
