import { describe, expect, it } from 'vitest';
import {
  computeFocusCodes,
  FOCUS_LIST_SIZE,
  MAX_ENTRY_FAIL_COUNT,
  MAX_WATCHLIST,
} from './watchlistManager.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

function makeEntry(overrides: Partial<WatchlistEntry> & { code: string }): WatchlistEntry {
  return {
    name: overrides.code,
    entryPrice: 10_000,
    stopLoss: 9_000,
    targetPrice: 12_000,
    addedAt: new Date().toISOString(),
    addedBy: 'AUTO',
    ...overrides,
  };
}

describe('computeFocusCodes', () => {
  it('returns top FOCUS_LIST_SIZE AUTO stocks by gateScore', () => {
    const list: WatchlistEntry[] = Array.from({ length: 15 }, (_, i) =>
      makeEntry({ code: `STOCK${String(i).padStart(2, '0')}`, gateScore: i }),
    );
    const codes = computeFocusCodes(list);
    expect(codes.size).toBe(FOCUS_LIST_SIZE);
    // Highest gateScore = 14 → STOCK14, 13 → STOCK13, etc.
    for (let i = 15 - FOCUS_LIST_SIZE; i < 15; i++) {
      expect(codes.has(`STOCK${String(i).padStart(2, '0')}`)).toBe(true);
    }
  });

  it('excludes MANUAL entries from focus computation', () => {
    const list: WatchlistEntry[] = [
      makeEntry({ code: 'MANUAL01', addedBy: 'MANUAL', gateScore: 27 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeEntry({ code: `AUTO${String(i).padStart(2, '0')}`, gateScore: i }),
      ),
    ];
    const codes = computeFocusCodes(list);
    expect(codes.has('MANUAL01')).toBe(false);
  });

  it('returns fewer than FOCUS_LIST_SIZE when list has fewer AUTO entries', () => {
    const list: WatchlistEntry[] = [
      makeEntry({ code: 'A01', gateScore: 20 }),
      makeEntry({ code: 'A02', gateScore: 10 }),
    ];
    const codes = computeFocusCodes(list);
    expect(codes.size).toBe(2);
  });

  it('returns empty set for empty list', () => {
    expect(computeFocusCodes([]).size).toBe(0);
  });
});

describe('exported constants', () => {
  it('FOCUS_LIST_SIZE is positive integer', () => {
    expect(FOCUS_LIST_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(FOCUS_LIST_SIZE)).toBe(true);
  });

  it('MAX_ENTRY_FAIL_COUNT is positive integer', () => {
    expect(MAX_ENTRY_FAIL_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_ENTRY_FAIL_COUNT)).toBe(true);
  });

  it('MAX_WATCHLIST >= FOCUS_LIST_SIZE', () => {
    expect(MAX_WATCHLIST).toBeGreaterThanOrEqual(FOCUS_LIST_SIZE);
  });
});
