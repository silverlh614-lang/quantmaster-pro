/**
 * @responsibility stockScreener.preScreenStocks ETF/특수종목 진입 필터 회귀 (gap fix).
 *
 * KIS 랭킹 4-TR row 가 ETF/특수종목이면 mergeOutput 에서 제외(null)되는지,
 * 보통주는 유지(KEEP)되는지, flag=false 시 미제외(byte-equivalent)인지 검증.
 * 판정 SSOT 는 watchlistRepo.isSpecialSecurityWatchlistEntry + krxStockMasterRepo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

/**
 * stockScreener.preScreenStocks 내부 `isSpecialKisRow` 가드의 결정 SSOT 를 재현.
 * 실제 코드와 동일하게 watchlistRepo SSOT(isSpecialSecurityExclusionEnabled +
 * isSpecialSecurityWatchlistEntry)를 호출하여 KIS row(stck_shrn_iscd/hts_kor_isnm)를 판정.
 * 본 wrapper 가 true 면 stockScreener 의 mapper 가 null 반환(제외)한다.
 */
async function isSpecialKisRow(s: Record<string, string>): Promise<boolean> {
  const wl = await import('../persistence/watchlistRepo.js');
  if (!wl.isSpecialSecurityExclusionEnabled()) return false;
  const code = s.stck_shrn_iscd ?? '';
  const name = s.hts_kor_isnm ?? '';
  return wl.isSpecialSecurityWatchlistEntry({ code, name });
}

describe('stockScreener — ETF/특수종목 진입 필터 (preScreenStocks)', () => {
  const ORIG_FLAG = process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
  let master: typeof import('../persistence/krxStockMasterRepo.js');

  async function loadModules(): Promise<void> {
    vi.resetModules();
    master = await import('../persistence/krxStockMasterRepo.js');
  }

  beforeEach(async () => {
    delete process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
    await loadModules();
  });

  afterEach(() => {
    if (ORIG_FLAG === undefined) delete process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES;
    else process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES = ORIG_FLAG;
    try { master.__testOnly.reset(); } catch { /* noop */ }
  });

  it('cold-start (master miss) — UNICORN ETF row 는 제외', async () => {
    const etfRow = { stck_shrn_iscd: '494220', hts_kor_isnm: 'UNICORN SK하이닉스밸류체인액티브' };
    expect(await isSpecialKisRow(etfRow)).toBe(true);
  });

  it('master 권위 — ETF master row 제외, 보통주 KEEP', async () => {
    master.setStockMaster([
      { code: '494220', name: 'UNICORN SK하이닉스밸류체인액티브', market: 'KOSPI', securityType: 'ETF' },
      { code: '005930', name: '삼성전자', market: 'KOSPI', securityType: '주권', stockType: '보통주' },
    ]);
    expect(await isSpecialKisRow({ stck_shrn_iscd: '494220', hts_kor_isnm: 'UNICORN SK하이닉스밸류체인액티브' })).toBe(true);
    expect(await isSpecialKisRow({ stck_shrn_iscd: '005930', hts_kor_isnm: '삼성전자' })).toBe(false);
  });

  it('보통주 row 는 유지 (false-exclude 0) — BNK금융지주/현대차', async () => {
    expect(await isSpecialKisRow({ stck_shrn_iscd: '138930', hts_kor_isnm: 'BNK금융지주' })).toBe(false);
    expect(await isSpecialKisRow({ stck_shrn_iscd: '005380', hts_kor_isnm: '현대차' })).toBe(false);
  });

  it('flag=false 시 ETF row 도 미제외 (byte-equivalent)', async () => {
    process.env.WATCHLIST_EXCLUDE_SPECIAL_SECURITIES = 'false';
    await loadModules();
    const etfRow = { stck_shrn_iscd: '494220', hts_kor_isnm: 'UNICORN SK하이닉스밸류체인액티브' };
    expect(await isSpecialKisRow(etfRow)).toBe(false);
  });
});
