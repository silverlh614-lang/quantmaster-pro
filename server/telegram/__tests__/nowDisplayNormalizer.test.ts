import { describe, expect, it } from 'vitest';
import {
  normalizeNowDisplay,
  normalizeR6LatchDisplay,
} from '../nowDisplayNormalizer.js';

describe('normalizeNowDisplay', () => {
  it('labels STALE providerIssue isolated POST_CLOSE_VALID as post-close stale valid', () => {
    const normalized = normalizeNowDisplay({
      dataHealth: 'STALE',
      providerIssue: true,
      marketSignal: false,
      conflicts: [],
      freshness: 'POST_CLOSE_VALID',
      ttlSec: 300,
    });

    expect(normalized.dataLine).toContain('POST_CLOSE_STALE_VALID');
    expect(normalized.providerIsolationLabel).toContain('isolated');
    expect(normalized.conflictLabel).toContain('none');
  });

  it('explains POST_CLOSE_VALID age beyond hard stale threshold as post-close policy', () => {
    const normalized = normalizeNowDisplay({
      freshness: 'POST_CLOSE_VALID',
      ageSec: 6332,
      ttlSec: 300,
      hardStaleSec: 900,
    });

    expect(normalized.freshnessLabel).toBe('POST_CLOSE_VALID');
    expect(normalized.freshnessExplanation).toContain('post-close policy');
    expect(normalized.shouldShowRawTtl).toBe(false);
  });

  it('turns scheduled NOT_RUN shadow candidate scan into WAITING_SCHEDULE', () => {
    const normalized = normalizeNowDisplay({
      freshness: 'FRESH',
      shadowPolicyOn: true,
      shadowLearningAllowed: true,
      shadowCandidateScanStatus: 'NOT_RUN',
      shadowCandidateScanSkipReason: 'SCHEDULER_NOT_TRIGGERED',
    });

    expect(normalized.shadowScanLabel).toBe('WAITING_SCHEDULE');
  });

  it('turns post-close scheduled NOT_RUN shadow candidate scan into DEFERRED_POST_CLOSE', () => {
    const normalized = normalizeNowDisplay({
      freshness: 'POST_CLOSE_VALID',
      shadowPolicyOn: true,
      shadowLearningAllowed: true,
      shadowCandidateScanStatus: 'NOT_RUN',
      shadowCandidateScanSkipReason: 'SCHEDULER_NOT_TRIGGERED',
    });

    expect(normalized.shadowScanLabel).toBe('DEFERRED_POST_CLOSE');
  });

  it('warns when providerIssue is also marketSignal', () => {
    const normalized = normalizeNowDisplay({
      dataHealth: 'STALE',
      providerIssue: true,
      marketSignal: true,
      conflicts: [],
    });

    expect(normalized.conflictLabel).toContain('review required');
    expect(normalized.notes).toContain('WARNING_PROVIDER_ISSUE_MARKET_SIGNAL_LEAK');
  });
});

describe('normalizeR6LatchDisplay', () => {
  it('returns cooldown waiting when no active triggers but previous triggers exist', () => {
    const normalized = normalizeR6LatchDisplay({
      activeR6Triggers: [],
      previousR6Triggers: ['KOSPI_INTRADAY_LOW_SHOCK', 'KOSPI_CLOSE_SHOCK'],
    });

    expect(normalized.state).toBe('COOLDOWN_WAITING_CONFIRMATION');
    expect(normalized.explanation).toContain('latch/cooldown');
  });
});
