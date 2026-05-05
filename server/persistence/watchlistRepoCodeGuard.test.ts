/**
 * @responsibility ADR-0184 (PR-B12-A) site 2 — saveWatchlist invalid KRX code filter 회귀.
 *
 * 잘못된 code 가 watchlist 영속에 박제되던 결함 (예: `0070X0`) 차단 검증.
 * default ON + ENV `EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED=true` 우회 양 방향.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

describe('ADR-0184 saveWatchlist invalid KRX code filter', () => {
  let tmpDir: string;
  let repo: typeof import('./watchlistRepo.js');
  const ORIG_DISABLE = process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-codeguard-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED;
    vi.resetModules();
    repo = await import('./watchlistRepo.js');
    repo.saveWatchlist([]);
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    if (ORIG_DISABLE === undefined) delete process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED;
    else process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = ORIG_DISABLE;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  function makeEntry(code: string, name = `n-${code}`): import('./watchlistRepo.js').WatchlistEntry {
    return {
      code,
      name,
      entryPrice: 10_000,
      stopLoss:   9_500,
      targetPrice: 11_000,
      addedAt: new Date().toISOString(),
      addedBy: 'AUTO',
      section: 'MOMENTUM',
      gateScore: 5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  describe('default ON (회귀 차단)', () => {
    it('정상 6자리 code 만 영속 — 잘못된 code 자동 필터링', () => {
      const list = [
        makeEntry('005930'),   // 삼성전자
        makeEntry('0070X0'),   // 잘못된 code (사용자 4/30 보고 시나리오)
        makeEntry('035420'),   // NAVER
        makeEntry(''),         // 빈 문자열
        makeEntry('XXXXXX'),   // 알파벳 6자
        makeEntry('000660'),   // SK하이닉스
      ];
      repo.saveWatchlist(list);
      const loaded = repo.loadWatchlist();
      expect(loaded).toHaveLength(3);
      expect(loaded.map(e => e.code).sort()).toEqual(['000660', '005930', '035420']);
    });

    it('빈 배열 정상 처리', () => {
      repo.saveWatchlist([]);
      expect(repo.loadWatchlist()).toEqual([]);
    });

    it('모든 entry 가 invalid 면 빈 배열 영속', () => {
      const list = [
        makeEntry('XXXXXX'),
        makeEntry('0070X0'),
        makeEntry(''),
      ];
      repo.saveWatchlist(list);
      expect(repo.loadWatchlist()).toEqual([]);
    });

    it('정상 entry 모두 보존 (필터 무영향)', () => {
      const list = [
        makeEntry('005930'),
        makeEntry('035420'),
        makeEntry('000660'),
      ];
      repo.saveWatchlist(list);
      const loaded = repo.loadWatchlist();
      expect(loaded).toHaveLength(3);
    });
  });

  describe('ENV EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED=true (legacy 동작)', () => {
    beforeEach(async () => {
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = 'true';
      vi.resetModules();
      repo = await import('./watchlistRepo.js');
      repo.saveWatchlist([]);
    });

    it('ENV 우회 시 invalid code 도 영속 (legacy 회귀)', () => {
      const list = [
        makeEntry('005930'),
        makeEntry('0070X0'),
        makeEntry('XXXXXX'),
      ];
      repo.saveWatchlist(list);
      const loaded = repo.loadWatchlist();
      // 잘못된 code 도 그대로 통과 — 운영자 명시 활성화 시 ADR-0184 이전 동작
      expect(loaded.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('ENV "true" 정확 비교 (drift 차단)', () => {
    it('"1" 거부 — guard 활성 유지 (default ON)', async () => {
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = '1';
      vi.resetModules();
      repo = await import('./watchlistRepo.js');
      repo.saveWatchlist([]);
      const list = [makeEntry('005930'), makeEntry('XXXXXX')];
      repo.saveWatchlist(list);
      expect(repo.loadWatchlist()).toHaveLength(1);
    });
  });
});
