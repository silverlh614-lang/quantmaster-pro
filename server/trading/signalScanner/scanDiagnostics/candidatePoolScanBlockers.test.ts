import { describe, expect, it } from 'vitest';
import { buildCandidatePool } from '../../candidatePoolBuilder.js';
import { formatScanBlockersMessage } from './scanBlockersFormatter.js';
import type { ScanSummary } from './scanSummaryTypes.js';

describe('scan_blockers candidate pool section', () => {
  it('renders broad candidate pool diagnostics and separated live permission', () => {
    const candidatePool = buildCandidatePool({
      sourceSnapshotId: 'scan-eval:test',
      existingWatchlist: [
        {
          symbol: '005930',
          name: 'Samsung Electronics',
          price: 75_000,
          volume: 10_000_000,
          turnover: 750_000_000_000,
          relativeStrengthScore: 10,
          breakoutScore: null,
          return20d: 5,
        },
      ],
      liveOrderAllowed: false,
      emitLogs: false,
    });
    const summary = {
      time: '12:00 KST',
      candidates: 1,
      trackB: 1,
      swing: 1,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 1,
      rrrMisses: 0,
      entries: 0,
      waitDistribution: {
        dataHold: 0,
        preBreakout: 0,
        gateFail: 1,
        sizingBlocked: 0,
        driftRemove: 0,
        corpAction: 0,
        volumeDrop: 0,
        other: 0,
      },
      candidatePool,
    } satisfies ScanSummary;

    const text = formatScanBlockersMessage(summary);

    expect(text).toContain('[Candidate Pool Runtime]');
    expect(text).toContain('importedCandidates=1');
    expect(text).toContain('gateEvaluated=1');
    expect(text).toContain('shadowEligible=1');
    expect(text).toContain('counterfactualRecorded=1');
    expect(text).toContain('Candidate evaluation active');
    expect(text).toContain('Live order permission separated');
    expect(text).toContain('Missing features scored as confidence penalty');
  });
});
