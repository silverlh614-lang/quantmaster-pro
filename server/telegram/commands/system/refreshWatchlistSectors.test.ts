// @responsibility refreshWatchlistSectors 텔레그램 명령 회귀 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../persistence/watchlistSectorBackfill.js', () => ({
  backfillWatchlistSectors: vi.fn(),
}));
vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

import refreshWatchlistSectors, {
  __resetRefreshWatchlistSectorsRateLimitForTests,
} from './refreshWatchlistSectors.cmd.js';
import { backfillWatchlistSectors } from '../../../persistence/watchlistSectorBackfill.js';

function makeCtx() {
  const reply = vi.fn().mockResolvedValue(undefined);
  return { reply };
}

describe('refreshWatchlistSectors.cmd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRefreshWatchlistSectorsRateLimitForTests();
  });

  describe('정상 실행', () => {
    it('백필 대상 0건 → 단일 OK 메시지', async () => {
      vi.mocked(backfillWatchlistSectors).mockReturnValue({
        total: 47,
        scanned: 0,
        filled: 0,
        unmatched: 0,
      });
      const { reply } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(1);
      expect(reply).toHaveBeenCalledTimes(1);
      const msg = reply.mock.calls[0][0] as string;
      expect(msg).toContain('백필 대상 없음');
      expect(msg).toContain('47개');
    });

    it('백필 성공 케이스 (filled=N, unmatched=0)', async () => {
      vi.mocked(backfillWatchlistSectors).mockReturnValue({
        total: 50,
        scanned: 10,
        filled: 10,
        unmatched: 0,
      });
      const { reply } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply });
      expect(reply).toHaveBeenCalledTimes(1);
      const msg = reply.mock.calls[0][0] as string;
      expect(msg).toContain('백필 완료');
      expect(msg).toContain('전체: 50');
      expect(msg).toContain('검사 대상 (빈 sector): 10');
      expect(msg).toContain('백필 성공: 10');
      expect(msg).not.toContain('미매칭');
    });

    it('미매칭 존재 시 안내 메시지 + /refresh_sector_map 가이드', async () => {
      vi.mocked(backfillWatchlistSectors).mockReturnValue({
        total: 50,
        scanned: 10,
        filled: 7,
        unmatched: 3,
      });
      const { reply } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply });
      const msg = reply.mock.calls[0][0] as string;
      expect(msg).toContain('미매칭 (sectorMap 에 없음): 3개');
      expect(msg).toContain('/refresh_sector_map');
    });
  });

  describe('rate-limit 가드', () => {
    it('1분 이내 재호출 → 차단 + 카운트다운 + backfill 미호출', async () => {
      vi.mocked(backfillWatchlistSectors).mockReturnValue({
        total: 1, scanned: 0, filled: 0, unmatched: 0,
      });
      const { reply: reply1 } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply: reply1 });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(1);

      // 두 번째 즉시 호출 — 차단되어야 함
      const { reply: reply2 } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply: reply2 });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(1); // 누적 1회 유지
      const blockedMsg = reply2.mock.calls[0][0] as string;
      expect(blockedMsg).toContain('1분 이내 재호출 차단');
      expect(blockedMsg).toMatch(/\d+초 후/);
    });

    it('reset 후 재실행 가능', async () => {
      vi.mocked(backfillWatchlistSectors).mockReturnValue({
        total: 1, scanned: 0, filled: 0, unmatched: 0,
      });
      const { reply: r1 } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply: r1 });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(1);

      __resetRefreshWatchlistSectorsRateLimitForTests();

      const { reply: r2 } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply: r2 });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(2);
    });
  });

  describe('에러 처리', () => {
    it('backfill throw → ❌ 메시지', async () => {
      vi.mocked(backfillWatchlistSectors).mockImplementation(() => {
        throw new Error('disk full');
      });
      const { reply } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply });
      const msg = reply.mock.calls[0][0] as string;
      expect(msg).toContain('❌');
      expect(msg).toContain('disk full');
    });

    it('throw 후에도 rate-limit 갱신 유지 (재시도 폭주 차단)', async () => {
      vi.mocked(backfillWatchlistSectors).mockImplementation(() => {
        throw new Error('boom');
      });
      const { reply: r1 } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply: r1 });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(1);

      // throw 후에도 rate-limit 가 갱신됐어야 함
      const { reply: r2 } = makeCtx();
      await refreshWatchlistSectors.execute({ args: [], reply: r2 });
      expect(backfillWatchlistSectors).toHaveBeenCalledTimes(1); // 누적 1회
      expect(r2.mock.calls[0][0]).toContain('1분 이내 재호출 차단');
    });
  });

  describe('메타데이터', () => {
    it('name + aliases', () => {
      expect(refreshWatchlistSectors.name).toBe('/refresh_watchlist_sectors');
      expect(refreshWatchlistSectors.aliases).toContain('/backfill_watchlist_sectors');
    });
    it('category=SYS, riskLevel=1, visibility=ADMIN', () => {
      expect(refreshWatchlistSectors.category).toBe('SYS');
      expect(refreshWatchlistSectors.riskLevel).toBe(1);
      expect(refreshWatchlistSectors.visibility).toBe('ADMIN');
    });
    it('description + usage 비공란', () => {
      expect(refreshWatchlistSectors.description.length).toBeGreaterThan(0);
      expect(refreshWatchlistSectors.usage).toBe('/refresh_watchlist_sectors');
    });
  });
});
