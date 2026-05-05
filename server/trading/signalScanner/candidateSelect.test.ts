import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectCandidates } from './candidateSelect.js';

// Mock dependencies
vi.mock('../../persistence/intradayWatchlistRepo.js', () => ({
  loadIntradayWatchlist: vi.fn(),
}));

vi.mock('../../screener/watchlistManager.js', () => ({
  computeFocusCodes: vi.fn().mockReturnValue(new Set()),
  assignSection: vi.fn(),
}));

import { loadIntradayWatchlist } from '../../persistence/intradayWatchlistRepo.js';
import { assignSection } from '../../screener/watchlistManager.js';

const mockedLoadIntradayWatchlist = vi.mocked(loadIntradayWatchlist);
const mockedAssignSection = vi.mocked(assignSection);

describe('candidateSelect.ts byte-equivalent tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTO_SHADOW_FROM_MOMENTUM = 'true';

    // Default mock returns
    mockedLoadIntradayWatchlist.mockReturnValue([
      { code: '000001', intradayReady: true },
      { code: '000002', intradayReady: false }, // Should be filtered out
    ] as any[]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return empty arrays if watchlist is empty', async () => {
    const result = await selectCandidates({ watchlist: [] });
    
    expect(result.mainList).toEqual([]);
    expect(result.lengths.buyListLength).toBe(0);
    expect(result.lengths.intradayBuyListLength).toBe(0);
  });

  it('should classify SWING, CATALYST, and MOMENTUM lists correctly', async () => {
    const mockWatchlist = [
      { code: 'A', name: 'StockA' },
      { code: 'B', name: 'StockB' },
      { code: 'C', name: 'StockC' },
    ] as any[];

    mockedAssignSection.mockImplementation((w) => {
      if (w.code === 'A') return 'SWING';
      if (w.code === 'B') return 'CATALYST';
      if (w.code === 'C') return 'MOMENTUM';
      return 'SWING';
    });

    const result = await selectCandidates({ watchlist: mockWatchlist });

    expect(result.swingList).toHaveLength(1);
    expect(result.swingList[0].code).toBe('A');
    
    expect(result.catalystList).toHaveLength(1);
    expect(result.catalystList[0].code).toBe('B');
    
    expect(result.momentumList).toHaveLength(1);
    expect(result.momentumList[0].code).toBe('C');

    // Default: AUTO_SHADOW_FROM_MOMENTUM is true, so mainList includes MOMENTUM
    expect(result.mainList).toHaveLength(3);
  });

  it('should exclude MOMENTUM from mainList if AUTO_SHADOW_FROM_MOMENTUM is false', async () => {
    process.env.AUTO_SHADOW_FROM_MOMENTUM = 'false';
    
    const mockWatchlist = [
      { code: 'A', name: 'StockA' }, // SWING
      { code: 'C', name: 'StockC' }, // MOMENTUM
    ] as any[];

    mockedAssignSection.mockImplementation((w) => w.code === 'A' ? 'SWING' : 'MOMENTUM');

    const result = await selectCandidates({ watchlist: mockWatchlist });
    
    expect(result.momentumList).toHaveLength(1);
    expect(result.mainList).toHaveLength(1);
    expect(result.mainList[0].code).toBe('A'); // Only SWING is included
  });

  it('should correctly filter intraday ready stocks', async () => {
    const result = await selectCandidates({ watchlist: [{ code: 'A' }] as any[] });
    
    // Intraday list mock has 1 ready and 1 not ready
    expect(result.intradayList).toHaveLength(1);
    expect(result.intradayList[0].code).toBe('000001');
    expect(result.lengths.intradayBuyListLength).toBe(1);
  });

  it('should include forceBuyCodes in mainList regardless of section', async () => {
    const mockWatchlist = [
      { code: 'FORCE', name: 'Forced' }, // WILL be assigned an UNKNOWN section, but should be forced
    ] as any[];

    // ADR-0188 (lint baseline cleanup): WatchlistSection union ('SWING'|'CATALYST'|'MOMENTUM')
    // 외 'UNKNOWN' literal 은 *의도된 invalid input* 으로 forceBuyCodes 가 section 무관하게
    // 강제 통과시키는 동작 검증. `as unknown as <Type>` cast 로 의도 명시.
    mockedAssignSection.mockReturnValue('UNKNOWN' as unknown as ReturnType<typeof assignSection>);

    const result = await selectCandidates({ watchlist: mockWatchlist }, { forceBuyCodes: ['FORCE'] });
    
    expect(result.mainList).toHaveLength(1);
    expect(result.mainList[0].code).toBe('FORCE');
  });
});