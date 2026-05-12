// @responsibility ADR dry-run diagnostic log level and LUNCH_GUARD rate-limit tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logAdrDiagnostic,
  resetAdrDiagnosticLogRateLimiterForTest,
} from './scanDiagnostics.js';

describe('ADR diagnostic logging normalization', () => {
  beforeEach(() => {
    resetAdrDiagnosticLogRateLimiterForTest();
  });

  function logger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  it('ADR-0472 Gate1ScoringAlignment SHADOW_ONLY dry-run is not logged as error', () => {
    const mockLogger = logger();

    const emitted = logAdrDiagnostic(
      '[ADR-0472] Gate1ScoringAlignment SHADOW_ONLY dry-run emitted',
      {
        adrCode: 'ADR-0472',
        dryRun: true,
        engineMode: 'SHADOW_ONLY',
        executionImpact: 'NONE',
        missingComponents: ['WATCHLIST_UPSTREAM_SCORE', 'BREAKOUT_STRUCTURE'],
        reason: 'WATCHLIST_UPSTREAM_SCORE|BREAKOUT_STRUCTURE',
      },
      { logger: mockLogger },
    );

    expect(emitted).toBe(true);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug.mock.calls[0]?.[1]).toMatchObject({
      issueClass: 'GATE1_DIAGNOSTIC',
      providerIssue: false,
      marketSignal: false,
      executionImpact: 'NONE',
      deferred: true,
    });
  });

  it('rate-limits identical Gate1 dry-run ADR logs during LUNCH_GUARD while preserving shadow case recording', () => {
    const mockLogger = logger();
    const recordShadowCase = vi.fn();
    const payload = {
      adrCode: 'ADR-0476',
      dryRun: true,
      executionImpact: 'NONE',
      session: 'LUNCH_GUARD',
      reason: 'GATE1_DRY_RUN_OBSERVATION_ROWS',
    } as const;

    const first = logAdrDiagnostic('[ADR-0476] Gate1DryRunObservation rows emitted', payload, {
      logger: mockLogger,
      recordShadowCase,
      nowMs: 1_000_000,
      rateLimitMs: 15 * 60 * 1000,
    });
    const second = logAdrDiagnostic('[ADR-0476] Gate1DryRunObservation rows emitted', payload, {
      logger: mockLogger,
      recordShadowCase,
      nowMs: 1_000_000 + 60_000,
      rateLimitMs: 15 * 60 * 1000,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(recordShadowCase).toHaveBeenCalledTimes(2);
  });
});
