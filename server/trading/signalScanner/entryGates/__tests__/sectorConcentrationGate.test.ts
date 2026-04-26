/**
 * @responsibility sectorConcentrationGate 단위 테스트 — 동일 섹터 보유 한도 검사
 */

import { describe, it, expect } from 'vitest';
import { sectorConcentrationGate } from '../sectorConcentrationGate.js';
import { MAX_SECTOR_CONCENTRATION } from '../../../riskManager.js';
import { makeMockCtx, makeMockStock, makeMockShadow } from './_testHelpers.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';

describe('sectorConcentrationGate', () => {
  it('stock.sector 미설정 → pass=true (no-op)', async () => {
    const stock = makeMockStock({ sector: undefined as unknown as string });
    const r = await sectorConcentrationGate(makeMockCtx({ stock }));
    expect(r.pass).toBe(true);
  });

  it('동일 섹터 활성 종목 = 0 → pass=true', async () => {
    const stock = makeMockStock({ sector: '반도체' });
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: [], shadows: [] }));
    expect(r.pass).toBe(true);
  });

  it(`동일 섹터 활성 = MAX (${MAX_SECTOR_CONCENTRATION}) → 차단 + 텔레그램 메시지 포함`, async () => {
    const stock = makeMockStock({ code: '005930', sector: '반도체' });
    const wl: WatchlistEntry[] = Array.from({ length: MAX_SECTOR_CONCENTRATION }, (_, i) =>
      makeMockStock({ code: `00000${i}`, sector: '반도체' })
    );
    const sh = wl.map(w =>
      makeMockShadow({ stockCode: w.code, status: 'ACTIVE' })
    );
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('CorrelationGuard');
      expect(r.logMessage).toContain('반도체');
      expect(r.logMessage).toContain(`${MAX_SECTOR_CONCENTRATION}/${MAX_SECTOR_CONCENTRATION}`);
      expect(r.telegramMessage).toContain('진입 보류');
      expect(r.telegramMessage).toContain('분산 한도 초과');
    }
  });

  it('다른 섹터 활성 종목 다수여도 본 종목은 통과', async () => {
    const stock = makeMockStock({ sector: '반도체' });
    const wl = Array.from({ length: MAX_SECTOR_CONCENTRATION + 2 }, (_, i) =>
      makeMockStock({ code: `00000${i}`, sector: '바이오' })
    );
    const sh = wl.map(w => makeMockShadow({ stockCode: w.code, status: 'ACTIVE' }));
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    expect(r.pass).toBe(true);
  });

  it('PENDING 상태 shadow 는 활성 카운트 제외 (isOpenShadowStatus)', async () => {
    const stock = makeMockStock({ code: '005930', sector: '반도체' });
    const wl: WatchlistEntry[] = Array.from({ length: MAX_SECTOR_CONCENTRATION + 1 }, (_, i) =>
      makeMockStock({ code: `00000${i}`, sector: '반도체' })
    );
    // 모든 shadows 가 HIT_STOP (closed) → 카운트 0
    const sh = wl.map(w =>
      makeMockShadow({ stockCode: w.code, status: 'HIT_STOP' })
    );
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    expect(r.pass).toBe(true);
  });
});
