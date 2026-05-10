// @responsibility PATCH-D shadowBlockedOutcomeAnalytics read-only aggregation tests

import { describe, expect, it, vi } from 'vitest';
import type { ShadowLearningOnlySignal } from '../trading/shadowLearningOnlyScan.js';
import {
  formatShadowBlockedOutcomeCompactLine,
  loadAndSummarizeShadowBlockedOutcomes,
  summarizeShadowBlockedOutcomes,
} from './shadowBlockedOutcomeAnalytics.js';

vi.mock('../persistence/shadowLearningOnlySignalRepo.js', () => ({
  loadShadowLearningOnlySignals: vi.fn(() => [
    signal({ symbol: '005930', blockedReason: 'DATA_STARVED', futureReturn5d: 0.04 }),
  ]),
}));

function signal(
  overrides: Partial<ShadowLearningOnlySignal> = {},
): ShadowLearningOnlySignal {
  return {
    symbol: overrides.symbol ?? '000000',
    signalDate: overrides.signalDate ?? '2026-05-10',
    blockedReason: overrides.blockedReason ?? 'DATA_STARVED',
    learningOnly: true,
    executionImpact: 'NONE',
    wouldHaveBought: overrides.wouldHaveBought ?? true,
    hypotheticalEntryPrice: overrides.hypotheticalEntryPrice ?? 10000,
    hypotheticalStopLoss: overrides.hypotheticalStopLoss ?? 9200,
    hypotheticalTargetPrice: overrides.hypotheticalTargetPrice ?? 12000,
    signalGrade: overrides.signalGrade ?? 'BUY',
    gateScore: overrides.gateScore ?? 7,
    regime: overrides.regime ?? 'R2_BULL',
    macroBlockReason: overrides.macroBlockReason ?? 'test',
    dataQualityStatus: overrides.dataQualityStatus ?? 'OK',
    ...overrides,
  };
}

describe('summarizeShadowBlockedOutcomes', () => {
  it('returns empty summary for empty input', () => {
    const summary = summarizeShadowBlockedOutcomes([]);

    expect(summary).toEqual({
      totalSignals: 0,
      pendingSignals: 0,
      resolvedSignals: 0,
      byBlockedReason: [],
      topOverBlockedReasons: [],
    });
  });

  it('computes pending and resolved counts across horizons', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A', blockedReason: 'DATA_STARVED' }),
      signal({ symbol: 'B', blockedReason: 'DATA_STARVED', futureReturn1d: 0.01 }),
      signal({ symbol: 'C', blockedReason: 'DATA_STARVED', futureReturn20d: -0.02 }),
    ]);

    expect(summary.totalSignals).toBe(3);
    expect(summary.pendingSignals).toBe(1);
    expect(summary.resolvedSignals).toBe(2);
    expect(summary.byBlockedReason[0]).toEqual(expect.objectContaining({
      blockedReason: 'DATA_STARVED',
      total: 3,
      pendingCount: 1,
      resolved1dCount: 1,
      resolved3dCount: 0,
      resolved5dCount: 0,
      resolved20dCount: 1,
    }));
  });

  it('groups by blockedReason and sorts by total desc then reason asc', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A', blockedReason: 'POSITION_FULL' }),
      signal({ symbol: 'B', blockedReason: 'DATA_STARVED' }),
      signal({ symbol: 'C', blockedReason: 'DATA_STARVED' }),
      signal({ symbol: 'D', blockedReason: 'FOMC_BLOCK' }),
    ]);

    expect(summary.byBlockedReason.map((row) => row.blockedReason)).toEqual([
      'DATA_STARVED',
      'FOMC_BLOCK',
      'POSITION_FULL',
    ]);
  });

  it('computes avgReturn5d and winRate5d using only rows with 5d data', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A', blockedReason: 'DATA_STARVED', futureReturn5d: 0.04 }),
      signal({ symbol: 'B', blockedReason: 'DATA_STARVED', futureReturn5d: -0.02 }),
      signal({ symbol: 'C', blockedReason: 'DATA_STARVED' }),
    ]);

    const row = summary.byBlockedReason[0]!;
    expect(row.avgReturn5d).toBeCloseTo(0.01);
    expect(row.winRate5d).toBe(0.5);
    expect(row.resolved5dCount).toBe(2);
    expect(row.pendingCount).toBe(1);
  });

  it('classifies over-blocked candidates only for approved reason set and positive 5d threshold', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A', blockedReason: 'DATA_STARVED', futureReturn5d: 0.03, wouldHaveBought: true }),
      signal({ symbol: 'B', blockedReason: 'VOLUME_CLOCK_BLOCK', futureReturn5d: 0.05, wouldHaveBought: true }),
      signal({ symbol: 'C', blockedReason: 'VOLUME_CLOCK_BLOCK', futureReturn5d: 0.029, wouldHaveBought: true }),
      signal({ symbol: 'D', blockedReason: 'POSITION_FULL', futureReturn5d: 0.08, wouldHaveBought: false }),
      signal({ symbol: 'E', blockedReason: 'FOMC_BLOCK', futureReturn5d: 0.1, wouldHaveBought: true }),
    ]);

    const dataStarved = summary.byBlockedReason.find((row) => row.blockedReason === 'DATA_STARVED')!;
    const volumeClock = summary.byBlockedReason.find((row) => row.blockedReason === 'VOLUME_CLOCK_BLOCK')!;
    const positionFull = summary.byBlockedReason.find((row) => row.blockedReason === 'POSITION_FULL')!;
    const fomc = summary.byBlockedReason.find((row) => row.blockedReason === 'FOMC_BLOCK')!;

    expect(dataStarved.overBlockedCount).toBe(1);
    expect(volumeClock.overBlockedCount).toBe(1);
    expect(positionFull.overBlockedCount).toBe(0);
    expect(fomc.overBlockedCount).toBe(0);
  });

  it('sorts topOverBlockedReasons by overBlocked desc then total desc', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A1', blockedReason: 'DATA_STARVED', futureReturn5d: 0.04 }),
      signal({ symbol: 'A2', blockedReason: 'DATA_STARVED', futureReturn5d: 0.05 }),
      signal({ symbol: 'B1', blockedReason: 'VOLUME_CLOCK_BLOCK', futureReturn5d: 0.06 }),
      signal({ symbol: 'B2', blockedReason: 'VOLUME_CLOCK_BLOCK' }),
      signal({ symbol: 'B3', blockedReason: 'VOLUME_CLOCK_BLOCK' }),
      signal({ symbol: 'C1', blockedReason: 'POSITION_FULL', futureReturn5d: 0.07 }),
    ]);

    expect(summary.topOverBlockedReasons.map((row) => row.blockedReason)).toEqual([
      'DATA_STARVED',
      'VOLUME_CLOCK_BLOCK',
      'POSITION_FULL',
    ]);
  });

  it('does not let missing futureReturn5d affect winRate5d', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A', blockedReason: 'SUPPLY_DATA_UNSTABLE', futureReturn5d: 0.02 }),
      signal({ symbol: 'B', blockedReason: 'SUPPLY_DATA_UNSTABLE' }),
      signal({ symbol: 'C', blockedReason: 'SUPPLY_DATA_UNSTABLE' }),
    ]);

    const row = summary.byBlockedReason[0]!;
    expect(row.resolved5dCount).toBe(1);
    expect(row.winRate5d).toBe(1);
  });

  it('loads persisted signals through convenience function', () => {
    const summary = loadAndSummarizeShadowBlockedOutcomes();

    expect(summary.totalSignals).toBe(1);
    expect(summary.byBlockedReason[0]).toEqual(expect.objectContaining({
      blockedReason: 'DATA_STARVED',
      overBlockedCount: 1,
    }));
  });

  it('formats compact operator line', () => {
    const summary = summarizeShadowBlockedOutcomes([
      signal({ symbol: 'A', blockedReason: 'DATA_STARVED', futureReturn5d: 0.04 }),
      signal({ symbol: 'B', blockedReason: 'DATA_STARVED' }),
    ]);

    const line = formatShadowBlockedOutcomeCompactLine(summary);

    expect(line).toContain('Shadow Blocked Outcomes');
    expect(line).toContain('total=2');
    expect(line).toContain('resolved=1');
    expect(line).toContain('pending=1');
    expect(line).toContain('DATA_STARVED 1건');
    expect(line).toContain('5d +4.0%');
  });

  it('formats null for empty compact line', () => {
    expect(formatShadowBlockedOutcomeCompactLine(summarizeShadowBlockedOutcomes([]))).toBeNull();
  });
});
