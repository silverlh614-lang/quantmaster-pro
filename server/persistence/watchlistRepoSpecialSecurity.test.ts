/**
 * @responsibility watchlist ETF/특수종목 제외 (loadWatchlist/saveWatchlist) 회귀.
 *
 * 138530(ETF·TIGER)·005935(삼성전자우 우선주) 제외, 005930(보통주) 유지,
 * cold-start master miss + 보통주 name → KEEP(오제외 0), flag=false byte-equal.
 * 판정 SSOT 는 krxStockMasterRepo.isTradableKrxEquity + isSpecialSecurityName.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

describe('watchlistRepo — ETF/특수종목 제외 (WATCHLIST_EXCLUDE_SPECIAL_SECURITIES)', () => {
  let tmpDir: string;
  let repo: typeof import('./watchlistRepo.js');
  let master: typeof import('./krxStockMasterRepo.js');
  const ORIG_FLAG = process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;

  function makeEntry(code: string, name: string): import('./watchlistRepo.js').WatchlistEntry {
    return {
      code,
      name,
      entryPrice: 10_000,
      stopLoss: 9_500,
      targetPrice: 11_000,
      addedAt: new Date().toISOString(),
      addedBy: 'AUTO',
      section: 'MOMENTUM',
      gateScore: 5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  async function loadModules(): Promise<void> {
    vi.resetModules();
    master = await import('./krxStockMasterRepo.js');
    repo = await import('./watchlistRepo.js');
  }

  function seedMaster(): void {
    // 보통주 + ETF + 우선주 master 시드. 우선주/ETF 는 isTradableKrxEquity=false 가 되도록
    // KRX securityType/stockType 분류를 채운다.
    master.setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', securityType: '주권', stockType: '보통주' },
      { code: '005935', name: '삼성전자우', market: 'KOSPI', securityType: '주권', stockType: '우선주' },
      { code: '138530', name: 'TIGER LG그룹플러스', market: 'KOSPI', securityType: 'ETF' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', securityType: '주권', stockType: '보통주' },
    ]);
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-special-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
    await loadModules();
    repo.saveWatchlist([]);
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    if (ORIG_FLAG === undefined) delete process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
    else process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES = ORIG_FLAG;
    try { master.__testOnly.reset(); } catch { /* noop */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  describe('default ON — master 권위', () => {
    it('138530(ETF) 제외 / 005935(우선주) 제외 / 005930·000660(보통주) 유지', () => {
      seedMaster();
      repo.saveWatchlist([
        makeEntry('005930', '삼성전자'),
        makeEntry('005935', '삼성전자우'),
        makeEntry('138530', 'TIGER LG그룹플러스'),
        makeEntry('000660', 'SK하이닉스'),
      ]);
      const loaded = repo.loadWatchlist();
      const codes = loaded.map((e) => e.code).sort();
      expect(codes).toEqual(['000660', '005930']);
    });

    it('isSpecialSecurityWatchlistEntry — master 기반 판정', () => {
      seedMaster();
      expect(repo.isSpecialSecurityWatchlistEntry({ code: '138530', name: 'TIGER LG그룹플러스' })).toBe(true);
      expect(repo.isSpecialSecurityWatchlistEntry({ code: '005935', name: '삼성전자우' })).toBe(true);
      expect(repo.isSpecialSecurityWatchlistEntry({ code: '005930', name: '삼성전자' })).toBe(false);
    });
  });

  describe('cold-start — master miss → name fallback (오제외 0)', () => {
    it('master 없이 ETF 브랜드 종목명 → 제외', () => {
      // master 미시드 (cold-start). name 패턴 fallback 만 동작.
      repo.saveWatchlist([
        makeEntry('138530', 'TIGER LG그룹플러스'),
        makeEntry('005930', '삼성전자'),
      ]);
      const loaded = repo.loadWatchlist();
      expect(loaded.map((e) => e.code)).toEqual(['005930']);
    });

    it('master miss + 우선주 종목명(삼성전자우) → 제외', () => {
      expect(repo.isSpecialSecurityWatchlistEntry({ code: '005935', name: '삼성전자우' })).toBe(true);
    });

    it('master miss + 보통주 종목명 → KEEP (false-exclude 0)', () => {
      // 보통주 종목명들 — ETF 브랜드/우선주/스팩 패턴 미일치 시 KEEP 이어야 함.
      for (const name of ['삼성전자', 'SK하이닉스', '카카오', 'NAVER', '현대차', 'LG화학', '셀트리온']) {
        expect(repo.isSpecialSecurityWatchlistEntry({ code: '999999', name })).toBe(false);
      }
    });
  });

  describe('candidate pool — watchlist ETF 제외 (단일 funnel)', () => {
    it('loadWatchlist 가 매매 후보로 ETF 를 노출하지 않음', () => {
      seedMaster();
      repo.saveWatchlist([
        makeEntry('138530', 'TIGER LG그룹플러스'),
        makeEntry('005930', '삼성전자'),
      ]);
      const candidatePool = repo.loadWatchlist();
      expect(candidatePool.some((e) => e.code === '138530')).toBe(false);
      expect(candidatePool.some((e) => e.code === '005930')).toBe(true);
    });
  });

  describe('flag=false — 기존 동작 복원 (byte-equal)', () => {
    beforeEach(async () => {
      process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES = 'false';
      await loadModules();
      repo.saveWatchlist([]);
      seedMaster();
    });

    it('flag=false 시 ETF·우선주 모두 유지', () => {
      repo.saveWatchlist([
        makeEntry('005930', '삼성전자'),
        makeEntry('005935', '삼성전자우'),
        makeEntry('138530', 'TIGER LG그룹플러스'),
      ]);
      const loaded = repo.loadWatchlist();
      expect(loaded.map((e) => e.code).sort()).toEqual(['005930', '005935', '138530']);
    });
  });
});
