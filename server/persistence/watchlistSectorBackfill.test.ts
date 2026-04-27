// @responsibility watchlistSectorBackfill 회귀 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistEntry } from './watchlistRepo.js';

vi.mock('./watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(),
  saveWatchlist: vi.fn(),
}));
vi.mock('../screener/sectorMap.js', () => ({
  getSectorByCode: vi.fn(),
}));

import { backfillWatchlistSectors } from './watchlistSectorBackfill.js';
import { loadWatchlist, saveWatchlist } from './watchlistRepo.js';
import { getSectorByCode } from '../screener/sectorMap.js';

function makeEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    code: '005930',
    name: '삼성전자',
    entryPrice: 70000,
    stopLoss: 65000,
    targetPrice: 80000,
    addedAt: '2026-04-26T00:00:00Z',
    addedBy: 'AUTO',
    ...overrides,
  };
}

describe('backfillWatchlistSectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('빈 워치리스트 → 모든 카운트 0, saveWatchlist 미호출', () => {
    vi.mocked(loadWatchlist).mockReturnValue([]);
    const result = backfillWatchlistSectors();
    expect(result).toEqual({ total: 0, scanned: 0, filled: 0, unmatched: 0 });
    expect(saveWatchlist).not.toHaveBeenCalled();
  });

  it('sector 이미 채워진 entry → 보존 + scanned=0', () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: '005930', sector: '반도체' }),
    ]);
    const result = backfillWatchlistSectors();
    expect(result).toEqual({ total: 1, scanned: 0, filled: 0, unmatched: 0 });
    expect(getSectorByCode).not.toHaveBeenCalled();
    expect(saveWatchlist).not.toHaveBeenCalled();
  });

  it('sector 빈 문자열 → 백필 시도 + 매칭 시 채움', () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: '005930', sector: '' }),
    ]);
    vi.mocked(getSectorByCode).mockReturnValue('반도체');
    const result = backfillWatchlistSectors();
    expect(result).toEqual({ total: 1, scanned: 1, filled: 1, unmatched: 0 });
    expect(saveWatchlist).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveWatchlist).mock.calls[0][0];
    expect(saved[0].sector).toBe('반도체');
  });

  it('sector undefined → 백필 매칭', () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: '000660', sector: undefined }),
    ]);
    vi.mocked(getSectorByCode).mockReturnValue('반도체');
    const result = backfillWatchlistSectors();
    expect(result.filled).toBe(1);
  });

  it("getSectorByCode '미분류' 반환 → unmatched 카운트, 백필 안 함", () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: 'XYZ', sector: undefined }),
    ]);
    vi.mocked(getSectorByCode).mockReturnValue('미분류');
    const result = backfillWatchlistSectors();
    expect(result).toEqual({ total: 1, scanned: 1, filled: 0, unmatched: 1 });
    expect(saveWatchlist).not.toHaveBeenCalled();
  });

  it("getSectorByCode 빈 문자열 → unmatched", () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: 'XYZ', sector: undefined }),
    ]);
    vi.mocked(getSectorByCode).mockReturnValue('');
    const result = backfillWatchlistSectors();
    expect(result.unmatched).toBe(1);
    expect(saveWatchlist).not.toHaveBeenCalled();
  });

  it('혼재 (3 entries: sector 있음 / 백필 가능 / unmatched)', () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: '005930', sector: '반도체' }),       // 보존
      makeEntry({ code: '000660', sector: undefined }),      // 백필 가능
      makeEntry({ code: 'XYZ',    sector: undefined }),      // unmatched
    ]);
    vi.mocked(getSectorByCode).mockImplementation((code) => {
      if (code === '000660') return '반도체';
      return '미분류';
    });
    const result = backfillWatchlistSectors();
    expect(result).toEqual({ total: 3, scanned: 2, filled: 1, unmatched: 1 });
    expect(saveWatchlist).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveWatchlist).mock.calls[0][0];
    expect(saved[0].sector).toBe('반도체');
    expect(saved[1].sector).toBe('반도체');
    expect(saved[2].sector).toBeUndefined();
  });

  it('백필 0건 → saveWatchlist 미호출 (disk write 회피)', () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: 'XYZ', sector: undefined }),
    ]);
    vi.mocked(getSectorByCode).mockReturnValue('미분류');
    backfillWatchlistSectors();
    expect(saveWatchlist).not.toHaveBeenCalled();
  });

  it("'unknown' 라벨도 미분류로 처리 (대소문자 모두)", () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: 'A', sector: undefined }),
      makeEntry({ code: 'B', sector: undefined }),
    ]);
    vi.mocked(getSectorByCode).mockImplementation((code) => {
      if (code === 'A') return 'unknown';
      return 'UNKNOWN';
    });
    const result = backfillWatchlistSectors();
    expect(result.unmatched).toBe(2);
    expect(result.filled).toBe(0);
  });

  it('공백 trim 처리 — "  반도체  " → 매칭 성공', () => {
    vi.mocked(loadWatchlist).mockReturnValue([
      makeEntry({ code: '005930', sector: undefined }),
    ]);
    vi.mocked(getSectorByCode).mockReturnValue('  반도체  ');
    const result = backfillWatchlistSectors();
    expect(result.filled).toBe(1);
  });
});
