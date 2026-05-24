import { describe, expect, it } from 'vitest';
import {
  buildSnapshotBundleFromScanSummary,
  executionSummaryFromAudit,
  gate2SummaryFromConfluence,
  gate3SummaryFromRuntimeClosure,
} from './snapshotBundle.js';

describe('ADR-0523 Telegram snapshot bundle', () => {
  it('extracts one sourceSnapshotId and compact Gate1 fields from scan summary', () => {
    const bundle = buildSnapshotBundleFromScanSummary({
      snapshotId: 'scan-eval-0523',
      time: '2026-05-24T09:00:00.000Z',
      candidates: 43,
      macroGateState: { engineMode: 'SHADOW_ONLY', macroRegimeEffective: 'R6_DEFENSE', canonicalSession: 'REGULAR' },
      gateLayerAudit: { gate1PassCount: 18 },
      gate1MinimumSignalForensicAdr0505: {
        totalCandidates: 43,
        evaluatedCandidateCount: 39,
        actualScoreAvg: 68.4,
        requiredScoreAvg: 70,
        watchlistScoreNormalizedCount: 38,
        technicalProjectedCount: 39,
        rsScoreUsableCount: 36,
        dominantFailureDistribution: { RS_WEAK: 12 },
      },
    });

    expect(bundle.sourceSnapshotId).toBe('scan-eval-0523');
    expect(bundle.gate1?.pass).toBe(18);
    expect(bundle.gate1?.mainIssue).toBe('RS_WEAK');
    expect(bundle.engineMode).toBe('SHADOW_ONLY');
    expect(bundle.effectiveRegime).toBe('R6_DEFENSE');
  });

  it('maps Gate2, Gate3, and execution summaries into compact fields', () => {
    expect(gate2SummaryFromConfluence({
      evaluated: 18,
      gate2PassStrong: 4,
      gate2PassWeak: 9,
      gate2Watch: 3,
      gate2Fail: 2,
      rsUsable: 16,
      supplyUsable: 14,
      sectorUsable: 12,
      technicalUsable: 18,
      fundamentalUsable: 9,
      topPositiveAxis: 'SUPPLY_CONFLUENCE',
      topMissingAxis: 'FUNDAMENTAL_QUALITY',
    }).nextAction).toBe('Gate3 timing for 13 candidates');
    expect(gate3SummaryFromRuntimeClosure({
      evaluated: 13,
      gate3Ready: 1,
      triggerWait: 8,
      rrrComputed: 11,
      lastTriggerTriggered: 1,
      lastTriggerWait: 8,
      priceConfirmed: 11,
    }).ready).toBe(1);
    expect(executionSummaryFromAudit({
      entryReady: 3,
      liveBuyAllowed: 0,
      liveBuyBlocked: 3,
      shadowBuyAllowed: 3,
      observeOnly: 20,
      blockReasonDistribution: { R6_DEFENSE_LIVE_BUY_BLOCKED: 3 },
      executionImpactDistribution: { LIVE_BUY_BLOCKED: 3 },
      providerIssueConvertedToMarketSignalCount: 0,
    }).topBlockReason).toBe('R6_DEFENSE_LIVE_BUY_BLOCKED');
  });
});
