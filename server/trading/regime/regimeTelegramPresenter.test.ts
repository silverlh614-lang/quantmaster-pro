import { describe, expect, it } from 'vitest';
import { formatRegimeTelegramNow } from './regimeTelegramPresenter.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';

function r6Snapshot(): ResolvedRegimeSnapshot {
  const marketState = {
    snapshotId: 'mkt_r6',
    asOf: '2026-05-19T00:00:00.000Z',
    ttlSec: 300,
    biasScore: -25,
    biasLabel: 'BEAR',
    mhs: 70,
    mhsLabel: 'GREEN',
    detectedRegime: 'R3_EARLY',
    rawTrend: 'GREEN',
    riskOverride: 'NONE',
    effectiveRegime: 'R6_DEFENSE',
    liveNewBuyAllowed: false,
    liveSellAllowed: true,
    positionManagementAllowed: true,
    shadowLearningAllowed: true,
    shadowScanAllowed: true,
    shadowPaperFillAllowed: true,
    executionMode: 'SELL_ONLY',
    displaySeverity: 'DEFENSE',
    displayTitle: 'R6_DEFENSE',
    displayEmoji: 'R6',
    reasonCodes: ['R6_SHOCK_LATCH'],
    stale: false,
    staleSources: [],
    macroState: {
      stale: false,
      freshness: 'FRESH',
      ttlSec: 300,
      softStaleSec: 900,
      hardStaleSec: 900,
      staleReason: 'NONE',
      executionImpact: 'NONE',
    },
  } as unknown as ResolvedRegimeSnapshot['marketState'];

  return {
    snapshotId: 'regime_r6',
    asOf: marketState.asOf,
    ttlSec: 300,
    detectedRegime: 'R3_EARLY',
    effectiveRegime: 'R6_DEFENSE',
    displayRegime: 'R6_DEFENSE',
    riskOverride: 'R6_DEFENSE',
    engineMode: 'SELL_ONLY',
    biasScore: -25,
    mhs: 70,
    dataHealth: { macroState: 'VERIFIED' },
    sourceHealth: 'VERIFIED',
    stale: false,
    providerIssue: false,
    marketSignal: false,
    conflicts: ['GREEN_WITH_R6', 'MHS_BIAS_CONFLICT'],
    macroState: null,
    marketState,
    diagnostics: {
      rawRegime: 'R3_EARLY',
      effectiveRegime: 'R6_DEFENSE',
    } as unknown as ResolvedRegimeSnapshot['diagnostics'],
  };
}

describe('formatRegimeTelegramNow', () => {
  it('uses displayRegime and masks GREEN/OK status text while R6 is active', () => {
    const text = formatRegimeTelegramNow(r6Snapshot());

    expect(text).toContain('Display regime: R6_DEFENSE');
    expect(text).toContain('Effective regime: R6_DEFENSE');
    expect(text).toContain('riskOverride=R6_DEFENSE');
    expect(text).not.toContain('MHS: 70 GREEN');
    expect(text).not.toContain('Raw trend: GREEN');
  });
});
