import { describe, expect, it } from 'vitest';
import { buildLiveReadinessScore } from './liveReadinessScore.js';
import type { Gate3CompletionScore } from './gate3CompletionScore.js';

function completion(input: Partial<Gate3CompletionScore> = {}): Gate3CompletionScore {
  return {
    status: input.status ?? 'COMPLETE',
    score: input.score ?? 100,
    checks: input.checks ?? [
      { component: 'SOURCE_SNAPSHOT_INTEGRITY', passed: true, score: 6, reason: 'ok', severity: 'INFO' },
      { component: 'THRESHOLD_EVIDENCE', passed: true, score: 6, reason: 'ok', severity: 'INFO' },
    ],
    blockers: input.blockers ?? [],
    warnings: input.warnings ?? [],
    sourceSnapshotId: 'scan-eval:live',
    evaluatedCount: 3,
    candidateDetailCount: 3,
    completionReady: input.completionReady ?? (input.status === undefined || input.status === 'COMPLETE'),
    liveReadinessContribution: input.liveReadinessContribution ?? 10,
    asOf: '2026-05-24T09:00:00.000Z',
  };
}

describe('buildLiveReadinessScore', () => {
  it('returns LIVE_READY when Gate3 is complete, score is high, and policy allows live', () => {
    const score = buildLiveReadinessScore({
      gate3Completion: completion(),
      policy: { allowsLive: true, brokerLiveOrderAllowed: true },
    });

    expect(score.status).toBe('LIVE_READY');
    expect(score.liveAllowedByScore).toBe(true);
    expect(score.components.gate3Completion).toBe(10);
  });

  it('keeps live blocked in SHADOW_ONLY mode even with a high score', () => {
    const score = buildLiveReadinessScore({
      gate3Completion: completion(),
      policy: { allowsLive: true, shadowOnlyMode: true },
    });

    expect(score.status).toBe('SHADOW_READY');
    expect(score.liveAllowedByScore).toBe(false);
    expect(score.liveBlockedReasons).toContain('SHADOW_ONLY_MODE');
  });

  it('prevents LIVE_READY when policy safety fails', () => {
    const score = buildLiveReadinessScore({
      gate3Completion: completion(),
      policy: { allowsLive: false },
    });

    expect(score.status).toBe('SHADOW_READY');
    expect(score.liveBlockedReasons).toContain('LIVE_POLICY_BLOCKED');
  });

  it('branches to SHADOW_READY and DIAGNOSTIC_READY below live threshold', () => {
    const shadow = buildLiveReadinessScore({
      gate3Completion: completion({ status: 'PARTIAL', score: 90, completionReady: false }),
      componentScores: {
        gate3Completion: 90,
        gate3EntryTiming: 90,
        shadowEvidence: 90,
      },
    });
    const diagnostic = buildLiveReadinessScore({
      gate3Completion: completion({ status: 'INCOMPLETE', score: 50, completionReady: false }),
      componentScores: {
        gate1: 70,
        gate2: 70,
        sectorAuthority: 70,
        supplySemantic: 70,
        gate3EntryTiming: 50,
        gate3Completion: 50,
        shadowEvidence: 50,
        policySafety: 70,
      },
    });

    expect(shadow.status).toBe('SHADOW_READY');
    expect(diagnostic.status).toBe('DIAGNOSTIC_READY');
  });
});
