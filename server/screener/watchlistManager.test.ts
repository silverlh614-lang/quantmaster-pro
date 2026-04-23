import { describe, expect, it } from 'vitest';
import {
  computeFocusCodes,
  applyEntryPriceDrift,
  addToWatchlist,
  assignSection,
  SWING_MAX_SIZE,
  SWING_GATE_THRESHOLD,
  MAX_ENTRY_FAIL_COUNT,
  MAX_WATCHLIST,
  ENTRY_PRICE_DRIFT_PCT,
  CATALYST_MAX_SIZE,
  MOMENTUM_MAX_SIZE,
  CATALYST_POSITION_FACTOR,
  CATALYST_FIXED_STOP_PCT,
  SWING_EXPIRE_DAYS,
  CATALYST_EXPIRE_DAYS,
  MOMENTUM_EXPIRE_DAYS,
  // 하위 호환 re-export
  FOCUS_LIST_SIZE,
  FOCUS_GATE_THRESHOLD,
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
  it('returns top SWING_MAX_SIZE AUTO stocks by gateScore', () => {
    const list: WatchlistEntry[] = Array.from({ length: 15 }, (_, i) =>
      makeEntry({ code: `STOCK${String(i).padStart(2, '0')}`, gateScore: i }),
    );
    const codes = computeFocusCodes(list);
    expect(codes.size).toBe(SWING_MAX_SIZE);
    for (let i = 15 - SWING_MAX_SIZE; i < 15; i++) {
      expect(codes.has(`STOCK${String(i).padStart(2, '0')}`)).toBe(true);
    }
  });

  it('caps focus at SWING_MAX_SIZE even when many high-gate candidates exist', () => {
    // 회귀 가드: 과거에는 gateScore >= SWING_GATE_THRESHOLD(8) 항목을 무제한 포함시켜
    // SWING 상한을 터뜨리고 MOMENTUM 을 전멸시켰다 (fix-momentum-watchlist).
    // 이제는 상위 SWING_MAX_SIZE 개까지만 포함한다.
    const bigList: WatchlistEntry[] = Array.from({ length: 12 }, (_, i) =>
      makeEntry({ code: `MID${String(i).padStart(2, '0')}`, gateScore: SWING_GATE_THRESHOLD + i }),
    );
    const bigCodes = computeFocusCodes(bigList);
    expect(bigCodes.size).toBe(SWING_MAX_SIZE);
  });

  it('excludes MOMENTUM-tagged entries from focus (no auto-promotion by gateScore)', () => {
    // universeScanner 가 Gemini BUY 시그널로 section='MOMENTUM' 을 부여한 AUTO 종목은
    // gateScore 만으로 SWING 승격되지 않아야 한다 (STRONG_BUY 신호 품질 보존).
    const list: WatchlistEntry[] = [
      makeEntry({ code: 'MOM01', gateScore: 25, section: 'MOMENTUM' }),
      makeEntry({ code: 'MOM02', gateScore: 22, section: 'MOMENTUM' }),
      makeEntry({ code: 'SWG01', gateScore: 18, section: 'SWING' }),
    ];
    const codes = computeFocusCodes(list);
    expect(codes.has('MOM01')).toBe(false);
    expect(codes.has('MOM02')).toBe(false);
    expect(codes.has('SWG01')).toBe(true);
    expect(codes.size).toBe(1);
  });

  it('regression: keeps MOMENTUM populated when all AUTO entries pass entry floor', () => {
    // 장중 로그 회귀: entry floor gateScore >= 18 이 모든 AUTO 항목이 통과해도
    // MOMENTUM 으로 분류된 종목은 focus 에 포함되지 않아야 한다.
    const list: WatchlistEntry[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeEntry({ code: `SWG${String(i).padStart(2, '0')}`, gateScore: 20 + i, section: 'SWING' }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeEntry({ code: `MOM${String(i).padStart(2, '0')}`, gateScore: 18 + i, section: 'MOMENTUM' }),
      ),
    ];
    const codes = computeFocusCodes(list);
    expect(codes.size).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(codes.has(`SWG${String(i).padStart(2, '0')}`)).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      expect(codes.has(`MOM${String(i).padStart(2, '0')}`)).toBe(false);
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

  it('excludes CATALYST section entries from SWING focus computation', () => {
    const list: WatchlistEntry[] = [
      makeEntry({ code: 'DART01', addedBy: 'DART', section: 'CATALYST', gateScore: 20 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeEntry({ code: `AUTO${String(i).padStart(2, '0')}`, gateScore: i }),
      ),
    ];
    const codes = computeFocusCodes(list);
    expect(codes.has('DART01')).toBe(false);
  });

  it('returns fewer than SWING_MAX_SIZE when list has fewer AUTO entries', () => {
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

describe('assignSection', () => {
  it('assigns SWING to MANUAL entries', () => {
    const entry = makeEntry({ code: 'M01', addedBy: 'MANUAL' });
    expect(assignSection(entry, new Set())).toBe('SWING');
  });

  it('assigns CATALYST to DART entries', () => {
    const entry = makeEntry({ code: 'D01', addedBy: 'DART' });
    expect(assignSection(entry, new Set())).toBe('CATALYST');
  });

  it('assigns CATALYST to entries with section=CATALYST', () => {
    const entry = makeEntry({ code: 'D01', addedBy: 'AUTO', section: 'CATALYST' });
    expect(assignSection(entry, new Set())).toBe('CATALYST');
  });

  it('assigns SWING to AUTO entries in focusCodes', () => {
    const entry = makeEntry({ code: 'A01', addedBy: 'AUTO' });
    expect(assignSection(entry, new Set(['A01']))).toBe('SWING');
  });

  it('assigns MOMENTUM to AUTO entries not in focusCodes', () => {
    const entry = makeEntry({ code: 'A01', addedBy: 'AUTO' });
    expect(assignSection(entry, new Set())).toBe('MOMENTUM');
  });

  it('preserves MOMENTUM for BUY-signal entries even if gateScore is high', () => {
    // universeScanner 가 Gemini BUY 시그널로 MOMENTUM 을 부여한 종목.
    // computeFocusCodes 가 이 종목을 focus 에 넣지 않으므로 assignSection 도
    // MOMENTUM 을 유지해야 한다 (과거 회귀: SWING 으로 자동 승격되던 버그).
    const entry = makeEntry({ code: 'A01', addedBy: 'AUTO', gateScore: 25, section: 'MOMENTUM' });
    const focusCodes = computeFocusCodes([entry]);
    expect(focusCodes.has('A01')).toBe(false);
    expect(assignSection(entry, focusCodes)).toBe('MOMENTUM');
  });
});

describe('exported constants', () => {
  it('SWING_MAX_SIZE is positive integer', () => {
    expect(SWING_MAX_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(SWING_MAX_SIZE)).toBe(true);
  });

  it('CATALYST_MAX_SIZE is positive integer', () => {
    expect(CATALYST_MAX_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(CATALYST_MAX_SIZE)).toBe(true);
  });

  it('MOMENTUM_MAX_SIZE is positive integer', () => {
    expect(MOMENTUM_MAX_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(MOMENTUM_MAX_SIZE)).toBe(true);
  });

  it('CATALYST_POSITION_FACTOR is 0.6', () => {
    expect(CATALYST_POSITION_FACTOR).toBe(0.6);
  });

  it('CATALYST_FIXED_STOP_PCT is -0.05', () => {
    expect(CATALYST_FIXED_STOP_PCT).toBe(-0.05);
  });

  it('section expire days are ordered: MOMENTUM < CATALYST < SWING', () => {
    expect(MOMENTUM_EXPIRE_DAYS).toBeLessThan(CATALYST_EXPIRE_DAYS);
    expect(CATALYST_EXPIRE_DAYS).toBeLessThan(SWING_EXPIRE_DAYS);
  });

  it('MAX_ENTRY_FAIL_COUNT is positive integer', () => {
    expect(MAX_ENTRY_FAIL_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_ENTRY_FAIL_COUNT)).toBe(true);
  });

  it('MAX_WATCHLIST >= SWING_MAX_SIZE (backward compat)', () => {
    expect(MAX_WATCHLIST).toBeGreaterThanOrEqual(SWING_MAX_SIZE);
  });

  it('SWING_GATE_THRESHOLD is positive integer', () => {
    expect(SWING_GATE_THRESHOLD).toBeGreaterThan(0);
    expect(Number.isInteger(SWING_GATE_THRESHOLD)).toBe(true);
  });

  it('ENTRY_PRICE_DRIFT_PCT is 10', () => {
    expect(ENTRY_PRICE_DRIFT_PCT).toBe(10);
  });

  // 하위 호환 상수 검증
  it('FOCUS_LIST_SIZE equals SWING_MAX_SIZE (backward compat)', () => {
    expect(FOCUS_LIST_SIZE).toBe(SWING_MAX_SIZE);
  });

  it('FOCUS_GATE_THRESHOLD equals SWING_GATE_THRESHOLD (backward compat)', () => {
    expect(FOCUS_GATE_THRESHOLD).toBe(SWING_GATE_THRESHOLD);
  });
});

describe('applyEntryPriceDrift', () => {
  it('returns KEEP when price is below drift threshold', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 10_000 });
    expect(applyEntryPriceDrift(entry, 10_900)).toBe('KEEP');
  });

  it('returns KEEP when price equals drift threshold boundary', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 10_000 });
    expect(applyEntryPriceDrift(entry, 10_999)).toBe('KEEP');
  });

  it('returns REMOVE for AUTO entry at +10%', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 10_000, addedBy: 'AUTO' });
    expect(applyEntryPriceDrift(entry, 11_000)).toBe('REMOVE');
  });

  it('returns REMOVE for AUTO entry at +15%', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 10_000, addedBy: 'AUTO' });
    expect(applyEntryPriceDrift(entry, 11_500)).toBe('REMOVE');
  });

  it('returns UPDATE for MANUAL entry at +10%', () => {
    const entry = makeEntry({ code: 'M001', entryPrice: 10_000, addedBy: 'MANUAL' });
    expect(applyEntryPriceDrift(entry, 11_000)).toBe('UPDATE');
  });

  it('returns UPDATE for MANUAL entry at +20%', () => {
    const entry = makeEntry({ code: 'M001', entryPrice: 10_000, addedBy: 'MANUAL' });
    expect(applyEntryPriceDrift(entry, 12_000)).toBe('UPDATE');
  });

  it('returns KEEP when currentPrice is below entryPrice', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 10_000 });
    expect(applyEntryPriceDrift(entry, 9_000)).toBe('KEEP');
  });

  it('returns KEEP when currentPrice is 0', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 10_000 });
    expect(applyEntryPriceDrift(entry, 0)).toBe('KEEP');
  });

  it('returns KEEP when entryPrice is 0', () => {
    const entry = makeEntry({ code: 'A001', entryPrice: 0 });
    expect(applyEntryPriceDrift(entry, 11_000)).toBe('KEEP');
  });
});

describe('addToWatchlist', () => {
  it('adds a new entry when the section has capacity', () => {
    const list: WatchlistEntry[] = [];
    const result = addToWatchlist(list, makeEntry({ code: 'A001', section: 'MOMENTUM' }));
    expect(result.added).toBe(true);
    expect(list).toHaveLength(1);
  });

  it('rejects duplicate codes', () => {
    const list: WatchlistEntry[] = [
      makeEntry({ code: 'A001', section: 'MOMENTUM' }),
    ];
    const result = addToWatchlist(list, makeEntry({ code: 'A001', section: 'MOMENTUM' }));
    expect(result.added).toBe(false);
    expect(result.reason).toBe('duplicate');
    expect(list).toHaveLength(1);
  });

  it('evicts the weakest entry when the new one is stronger', () => {
    const list: WatchlistEntry[] = Array.from({ length: MOMENTUM_MAX_SIZE }, (_, i) =>
      makeEntry({
        code: `M${String(i).padStart(3, '0')}`,
        section: 'MOMENTUM',
        gateScore: i,
      }),
    );
    const result = addToWatchlist(list, makeEntry({
      code: 'M999',
      section: 'MOMENTUM',
      gateScore: 99,
    }));
    expect(result.added).toBe(true);
    expect(result.evicted?.code).toBe('M000');
    expect(list.some((entry) => entry.code === 'M999')).toBe(true);
  });

  it('rejects a weak entry when the section is already full', () => {
    const list: WatchlistEntry[] = Array.from({ length: MOMENTUM_MAX_SIZE }, (_, i) =>
      makeEntry({
        code: `M${String(i).padStart(3, '0')}`,
        section: 'MOMENTUM',
        gateScore: 50 + i,
      }),
    );
    const result = addToWatchlist(list, makeEntry({
      code: 'M999',
      section: 'MOMENTUM',
      gateScore: 0,
    }));
    expect(result.added).toBe(false);
    expect(result.reason).toBe('full');
    expect(list.some((entry) => entry.code === 'M999')).toBe(false);
  });
});
