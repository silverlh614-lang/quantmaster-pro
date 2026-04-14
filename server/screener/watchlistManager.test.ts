import { describe, expect, it } from 'vitest';
import {
  computeFocusCodes,
  FOCUS_LIST_SIZE,
  FOCUS_GATE_THRESHOLD,
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
    // All gateScores below FOCUS_GATE_THRESHOLD → only top N selected
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

  it('includes AUTO stocks above FOCUS_GATE_THRESHOLD even beyond top N', () => {
    // 12 AUTO stocks: 10 with low scores + 2 with score >= threshold
    const list: WatchlistEntry[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeEntry({ code: `LOW${String(i).padStart(2, '0')}`, gateScore: i }),
      ),
      makeEntry({ code: 'HIGH_A', gateScore: FOCUS_GATE_THRESHOLD }),
      makeEntry({ code: 'HIGH_B', gateScore: FOCUS_GATE_THRESHOLD + 5 }),
    ];
    const codes = computeFocusCodes(list);
    // Top 8 by score: HIGH_B(20), HIGH_A(15), LOW09(9), LOW08(8)..LOW04(4)
    // Above threshold: HIGH_A, HIGH_B — both already in top 8
    expect(codes.has('HIGH_A')).toBe(true);
    expect(codes.has('HIGH_B')).toBe(true);
    // Now add more high-score entries beyond 8
    const bigList: WatchlistEntry[] = [
      ...Array.from({ length: 12 }, (_, i) =>
        makeEntry({ code: `MID${String(i).padStart(2, '0')}`, gateScore: FOCUS_GATE_THRESHOLD + i }),
      ),
    ];
    const bigCodes = computeFocusCodes(bigList);
    // All 12 have gateScore >= FOCUS_GATE_THRESHOLD → all included
    expect(bigCodes.size).toBe(12);
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

  it('FOCUS_GATE_THRESHOLD is positive integer', () => {
    expect(FOCUS_GATE_THRESHOLD).toBeGreaterThan(0);
    expect(Number.isInteger(FOCUS_GATE_THRESHOLD)).toBe(true);
  });
});
