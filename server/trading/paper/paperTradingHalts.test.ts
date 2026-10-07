// @responsibility Verify halt memory keeps only the newest full-quote evidence.
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetPaperTradingHaltsForTest, paperHaltedSymbols, paperTradingHaltStatus, recordPaperTradingHalt } from './paperTradingHalts.js';

beforeEach(() => __resetPaperTradingHaltsForTest());

describe('paper trading halt memory', () => {
  it('stays unknown until a full quote reports the flag, then lists only halted symbols', () => {
    expect(paperTradingHaltStatus('005930')).toBeUndefined();
    recordPaperTradingHalt('005930', undefined, '2026-10-07T01:00:00.000Z');
    recordPaperTradingHalt('005930', true, 'invalid');
    expect(paperTradingHaltStatus('005930')).toBeUndefined();
    recordPaperTradingHalt('005930', true, '2026-10-07T01:00:00.000Z');
    recordPaperTradingHalt('000660', false, '2026-10-07T01:00:00.000Z');
    expect(paperTradingHaltStatus('005930')).toBe(true);
    expect(paperTradingHaltStatus('000660')).toBe(false);
    expect([...paperHaltedSymbols()]).toEqual(['005930']);
  });
  it('lets a newer check lift a halt but never lets an older scan quote overwrite it', () => {
    recordPaperTradingHalt('005930', true, '2026-10-07T01:00:00.000Z');
    recordPaperTradingHalt('005930', false, '2026-10-07T01:05:00.000Z');
    recordPaperTradingHalt('005930', true, '2026-10-07T01:03:00.000Z');
    expect(paperTradingHaltStatus('005930')).toBe(false);
    expect(paperHaltedSymbols().size).toBe(0);
  });
});
