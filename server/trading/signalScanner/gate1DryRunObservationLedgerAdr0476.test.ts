import { describe, expect, it } from 'vitest';
import { collectOperatorActionSourcesFromScanSummaryAdr0480, buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import type { ScanSummary } from './scanDiagnostics.js';

describe('ADR-0476 Gate1 dry-run observation ledger evidence for ADR-0480', () => {
  it('DATA_BLOCKED_NEAR_MISS summary becomes advisory Gate1 near-miss operator action', () => {
    const summary = {
      time: '2026-05-09 09:00',
      candidates: 1,
      trackB: 0,
      swing: 0,
      catalyst: 0,
      momentum: 0,
      yahooFails: 0,
      gateMisses: 1,
      rrrMisses: 0,
      entries: 0,
      gateScoreCandidateBuckets: { counts: { DATA_BLOCKED_NEAR_MISS: 2 } as never, dataBlockedNearMissTopUnavailable: [], probingTopConditions: [], totalNearMissLike: 2 },
    } as ScanSummary;
    const report = buildOperatorActionQueueAdr0480({ sources: collectOperatorActionSourcesFromScanSummaryAdr0480(summary) });
    expect(report.allActions.map((a) => a.rootCause)).toContain('GATE1_NEAR_MISS_DATA_BLOCKED');
    expect(report.allActions.every((a) => a.policyPromotionMode === 'SHADOW_ONLY')).toBe(true);
  });
});
