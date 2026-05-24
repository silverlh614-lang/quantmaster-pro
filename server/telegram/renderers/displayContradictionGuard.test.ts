import { describe, expect, it } from 'vitest';
import { checkDisplayContradictions } from './displayContradictionGuard.js';
import { sampleBundle } from './telegramGateCompactRenderer.test.js';

describe('ADR-0523 display contradiction guard', () => {
  it('blocks holiday live buy display conflicts', () => {
    const result = checkDisplayContradictions(sampleBundle({
      marketSession: 'HOLIDAY',
      execution: {
        ...sampleBundle().execution!,
        liveBuyAllowed: 1,
      },
    }));

    expect(result.displayConflictDetected).toBe(true);
    expect(result.displayRenderBlocked).toBe(true);
    expect(result.displayConflictReason).toContain('HOLIDAY_LIVE_BUY_ALLOWED');
  });

  it('blocks provider issue converted to market signal and shadow learning suppression', () => {
    const result = checkDisplayContradictions(sampleBundle({
      shadowLearning: false,
      providerHealth: { providerIssue: true, marketSignal: true },
    }));

    expect(result.displayConflictReason).toContain('PROVIDER_ISSUE_CONVERTED_TO_MARKET_SIGNAL');
    expect(result.displayConflictReason).toContain('SHADOW_LEARNING_FALSE');
  });

  it('warns if Gate3 entry ready exists without execution summary', () => {
    const result = checkDisplayContradictions(sampleBundle({
      execution: undefined,
      gate3: { ...sampleBundle().gate3!, ready: 2 },
    }));

    expect(result.displayConflictDetected).toBe(true);
    expect(result.displayRenderBlocked).toBe(false);
    expect(result.displayConflictReason).toContain('GATE3_ENTRY_READY_EXECUTION_SUMMARY_MISSING');
  });
});
