import { describe, expect, it } from 'vitest';
import { resolveTelegramChannelRouting } from './telegramChannelRouting.js';

describe('ADR-0523 Telegram channel routing', () => {
  it('keeps signal channel compact and blocks raw forensic output', () => {
    const decision = resolveTelegramChannelRouting({
      channel: 'SIGNAL',
      requestedVerbosity: 'FULL_FORENSIC',
      isTradeEvent: false,
    });

    expect(decision.verbosity).toBe('COMPACT');
    expect(decision.allowRawForensic).toBe(false);
    expect(decision.allowSignalEvent).toBe(false);
  });

  it('allows debug raw forensic and operator detail defaults', () => {
    expect(resolveTelegramChannelRouting({ channel: 'DEBUG' }).allowRawForensic).toBe(true);
    expect(resolveTelegramChannelRouting({ channel: 'OPERATOR' }).verbosity).toBe('DETAIL');
    expect(resolveTelegramChannelRouting({ channel: 'DM', requestedVerbosity: 'DEBUG_RAW' }).allowRawForensic).toBe(true);
  });
});
