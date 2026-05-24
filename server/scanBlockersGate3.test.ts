import { describe, expect, it } from 'vitest';
import { formatScanBlockersGate3Section } from './telegram/commands/system/scanBlockersGate3.cmd.js';

describe('scan_blockers_gate3 RRR counters', () => {
  it('separates rrrMissing from rrrFail and preserves safe-degrade labels', () => {
    const text = formatScanBlockersGate3Section({
      gate1PassCount: 0,
      gate2PassCount: 0,
      gate3PassCount: 0,
      strongBuySuppressedByDataUnavailableCount: 0,
      topGate1BlockReasons: [],
      topGate2BlockReasons: [],
      topGate3BlockReasons: [],
      gate3Consolidated: {
        samples: 3,
        health: { DATA_INCOMPLETE: 1, TIMING_NOT_CONFIRMED: 2 },
        primaryIssue: { RRR_MISSING: 1, RRR_FAIL: 1, RRR_WATCH: 1 },
        compactText: {
          'Gate3: WAIT | issue=RRR_WATCH | priceFresh=VERIFIED | rrr=1.72 WATCH | rrrSource=FALLBACK_PERCENT | stopLoss=9300 | targetPrice=11500 | price=NEAR_BREAKOUT | volume=DRY_UP 0.42x | executionImpact=DIAGNOSTIC_ONLY | marketSignal=false': 1,
        },
        timingReadiness: { DATA_INCOMPLETE: 1, WAIT: 2 },
        lastTriggerStatus: { DATA_UNAVAILABLE: 1, THRESHOLD_NOT_MET: 2 },
        priceFreshness: { VERIFIED: 3 },
        executionImpact: { DIAGNOSTIC_ONLY: 3 },
        priceConfirmationStatus: { NEAR_BREAKOUT: 1, NOT_CONFIRMED: 2 },
        volumeConfirmationStatus: { DRY_UP: 1, WEAK: 2 },
        lastTriggerPassCount: 0,
        lastTriggerFiredCount: 0,
        lastTriggerWaitCount: 3,
        lastTriggerThresholdNotMetCount: 2,
        lastTriggerDataUnavailableCount: 1,
        entryPriceStaleCount: 0,
        priceBreakoutConfirmedCount: 0,
        priceNearBreakoutCount: 1,
        pricePullbackEntryCount: 0,
        priceNotConfirmedCount: 2,
        priceOverextendedCount: 0,
        volumeConfirmedCount: 0,
        volumePartialCount: 0,
        volumeDryUpCount: 1,
        volumeWeakCount: 2,
        volumeSpikeRiskCount: 0,
        rrrPassCount: 0,
        rrrWatchCount: 1,
        rrrFailCount: 1,
        rrrMissingCount: 1,
        rrrFallbackUsedCount: 1,
        falseBreakoutHighCount: 0,
        executionReadyCount: 0,
      },
    });

    expect(text).toContain('rrrWatch: 1');
    expect(text).toContain('rrrFail: 1');
    expect(text).toContain('rrrMissing: 1');
    expect(text).toContain('rrrFallbackUsed: 1');
    expect(text).toContain('rrrSource=FALLBACK_PERCENT');
    expect(text).toContain('price=NEAR_BREAKOUT');
    expect(text).toContain('volume=DRY_UP 0.42x');
    expect(text).toContain('priceNearBreakout: 1');
    expect(text).toContain('volumeDryUp: 1');
    expect(text).toContain('lastTriggerDataUnavailable: 1');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('shadowLearning=true');
    expect(text).toContain('counterfactualRecorded=true');
  });
});
