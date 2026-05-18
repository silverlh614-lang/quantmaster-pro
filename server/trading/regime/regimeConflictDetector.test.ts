import { describe, expect, it } from 'vitest';
import { detectRegimeConflicts } from './regimeConflictDetector.js';
import type { RegimeSnapshot } from './effectiveRegimeSnapshot.js';

function snapshot(overrides: Partial<RegimeSnapshot> = {}): RegimeSnapshot {
  return {
    snapshotId: 'regime_test',
    asOf: '2026-05-19T00:00:00.000Z',
    ttlSec: 300,
    detectedRegime: 'R3_BULL_TREND',
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
    conflicts: [],
    ...overrides,
  };
}

describe('regimeConflictDetector', () => {
  it('detects high MHS/R6 display conflicts without allowing GREEN display', () => {
    const conflicts = detectRegimeConflicts(snapshot());

    expect(conflicts).toContain('GREEN_WITH_R6');
    expect(conflicts).toContain('MHS_BIAS_CONFLICT');
    expect(conflicts).not.toContain('DISPLAY_REGIME_CONFLICT');
  });

  it('flags displayRegime if R6 risk override is not the displayed state', () => {
    const conflicts = detectRegimeConflicts(snapshot({ displayRegime: 'GREEN' }));

    expect(conflicts).toContain('GREEN_WITH_R6');
    expect(conflicts).toContain('DISPLAY_REGIME_CONFLICT');
  });
});
