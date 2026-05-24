import { describe, expect, it } from 'vitest';
import { renderExecutionCompact } from './executionCompactRenderer.js';
import { sampleBundle } from './telegramGateCompactRenderer.test.js';

describe('ADR-0523 Telegram execution compact renderer', () => {
  it('separates ENTRY_READY from live permission and provider issue from market signal', () => {
    const text = renderExecutionCompact(sampleBundle());

    expect(text).toContain('[Execution]');
    expect(text).toContain('entryReady: 3');
    expect(text).toContain('liveBuy: 0');
    expect(text).toContain('shadowBuy: 3');
    expect(text).toContain('providerIssue->marketSignal: 0');
    expect(text).toContain('impact: LIVE_BUY_BLOCKED');
    expect(text).toContain('learning: ON');
  });
});
