/**
 * @responsibility sectorConcentrationGate 단위 테스트 — 동일 섹터 보유 한도 검사
 *
 * ADR-0060: stock.sector 부재 시 getSectorByCode fallback. watchlist[].sector 도 동일.
 * sectorMap 은 vi.mock 으로 stub 하여 결정적 동작 검증.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sectorConcentrationGate } from '../sectorConcentrationGate.js';
import { MAX_SECTOR_CONCENTRATION } from '../../../riskManager.js';
import { makeMockCtx, makeMockStock, makeMockShadow } from './_testHelpers.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';

// sectorMap mock — 결정적 lookup 으로 fallback 분기 검증.
vi.mock('../../../../learning/counterfactualShadow.js', () => ({
  recordCounterfactualCase: vi.fn(() => ({ entry: null, created: true, duplicateSuppressed: false })),
}));

vi.mock('../../../../screener/sectorMap.js', () => ({
  getSectorByCode: vi.fn((code: string | undefined | null) => {
    if (!code) return '미분류';
    const trimmed = String(code).trim();
    if (!trimmed) return '미분류';
    const map: Record<string, string> = {
      '005930': '반도체',
      '000660': '반도체',
      '035420': 'IT서비스',
    };
    return map[trimmed.padStart(6, '0')] ?? '미분류';
  }),
}));

describe('sectorConcentrationGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 기존 5 케이스 (PR-58 ADR-0030) ──────────────────────────────────────────

  it('stock.sector 미설정 + getSectorByCode 미커버 → pass=true (no-op)', async () => {
    // ADR-0060: 둘 다 fallback 도 매핑 없으면 '미분류' 반환 — 명시적 라벨로 취급되어
    // 가드 작동. plan §6.2 edge case 1 의 의도된 동작.
    // 본 케이스는 sectorMap 의 '미분류' fallback 위에서 활성 카운트 = 0 → pass.
    const stock = makeMockStock({ code: '999999', sector: undefined as unknown as string });
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: [], shadows: [] }));
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

  it('PENDING 이 아닌 closed shadow 는 활성 카운트 제외 (isOpenShadowStatus)', async () => {
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

  // ─── 신규 4 케이스 (ADR-0060) ────────────────────────────────────────────────

  it('ADR-0060: stock.sector 부재 + getSectorByCode hit → 가드 fallback 작동', async () => {
    // stock.sector 가 명시 부재여도 getSectorByCode('005930') = '반도체' 로 fallback.
    // 동일 섹터 활성 MAX 종목 있으면 차단되어야 한다.
    const stock = makeMockStock({ code: '005930', sector: undefined as unknown as string });
    const wl: WatchlistEntry[] = Array.from({ length: MAX_SECTOR_CONCENTRATION }, (_, i) =>
      makeMockStock({ code: `00000${i}`, sector: '반도체' })
    );
    const sh = wl.map(w => makeMockShadow({ stockCode: w.code, status: 'ACTIVE' }));
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('반도체'); // fallback 결과로 메시지에 노출
    }
  });

  it('ADR-0060: stock.sector + watchlist[].sector 둘 다 부재 + sectorMap 미커버 → pass', async () => {
    // stock 미커버 코드 + sector 부재 → getSectorByCode '미분류' 반환.
    // watchlist 도 미커버 코드 + sector 부재 → '미분류'. 활성 카운트는 미분류 끼리 매칭되지만
    // MAX 미달이므로 pass.
    const stock = makeMockStock({ code: '999999', sector: undefined as unknown as string });
    const wl: WatchlistEntry[] = [
      makeMockStock({ code: '888888', sector: undefined as unknown as string }),
    ];
    const sh = wl.map(w => makeMockShadow({ stockCode: w.code, status: 'ACTIVE' }));
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    expect(r.pass).toBe(true);
  });

  it('ADR-0060: watchlist[].sector 부재 시 getSectorByCode fallback 으로 활성 카운트 정합', async () => {
    // stock.sector = '반도체' 직접. watchlist 의 sector 는 부재하지만
    // 코드 005930/000660 → fallback 으로 '반도체' 둘 다 매칭. MAX_SECTOR_CONCENTRATION
    // 만큼 채우면 차단되어야 한다. 본 케이스는 watchlist[].sector fallback 의 대칭성 검증.
    const stock = makeMockStock({ code: '042700', sector: '반도체' });
    const semiCodes = ['005930', '000660', '999990', '999991', '999992'].slice(0, MAX_SECTOR_CONCENTRATION);
    // 처음 2개는 sectorMap 에 '반도체' 로 매핑, 나머지는 '미분류'.
    // 매칭은 처음 2개만 — MAX_SECTOR_CONCENTRATION 가 5 면 부족, 2 이하면 이미 도달.
    const wl: WatchlistEntry[] = semiCodes.map(code =>
      makeMockStock({ code, sector: undefined as unknown as string })
    );
    const sh = wl.map(w => makeMockShadow({ stockCode: w.code, status: 'ACTIVE' }));
    const r = await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    // MAX_SECTOR_CONCENTRATION 가 2 이하면 차단, 그 이상이면 통과.
    if (MAX_SECTOR_CONCENTRATION <= 2) {
      expect(r.pass).toBe(false);
    } else {
      expect(r.pass).toBe(true);
    }
  });

  it('ADR-0060: stock.sector 명시 시 fallback 미호출 (기존 동작 100% 보존)', async () => {
    // stock.sector 가 명시되면 getSectorByCode 호출되지 않아야 한다 — 그 검증을 위해
    // mock 호출 카운트 검증.
    const sectorMapModule = await import('../../../../screener/sectorMap.js');
    const spy = vi.spyOn(sectorMapModule, 'getSectorByCode');
    spy.mockClear();

    const stock = makeMockStock({ code: '005930', sector: '반도체' });
    // watchlist 도 sector 명시 → fallback 미호출.
    const wl: WatchlistEntry[] = [makeMockStock({ code: '000660', sector: '반도체' })];
    const sh = wl.map(w => makeMockShadow({ stockCode: w.code, status: 'ACTIVE' }));
    await sectorConcentrationGate(makeMockCtx({ stock, watchlist: wl, shadows: sh }));
    // stock.sector + 모든 watchlist[].sector 명시 → getSectorByCode 호출 0회.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('sectorConcentrationGate — 차단 counterfactual 기록 (2026-06-11 처방)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('한도 초과 차단 시 SECTOR_CONCENTRATION_LIMIT counterfactual 1건 기록', async () => {
    const { recordCounterfactualCase } = await import('../../../../learning/counterfactualShadow.js');
    const { sectorConcentrationGate } = await import('../sectorConcentrationGate.js');
    const { makeMockCtx, makeMockStock } = await import('./_testHelpers.js');
    const stock = makeMockStock({ code: '089030', name: '테크윙', sector: '반도체장비', targetPrice: 22250, stopLoss: 11089 });
    const watchlist = [
      makeMockStock({ code: '084370', sector: '반도체장비' }),
      makeMockStock({ code: '403870', sector: '반도체장비' }),
    ];
    const shadows = watchlist.map((w) => ({ stockCode: w.code, status: 'ACTIVE' })) as never;
    const result = await sectorConcentrationGate(makeMockCtx({ stock, watchlist, shadows, currentPrice: 17000 }));
    expect(result.pass).toBe(false);
    expect(recordCounterfactualCase).toHaveBeenCalledTimes(1);
    expect(recordCounterfactualCase).toHaveBeenCalledWith(expect.objectContaining({
      stockCode: '089030',
      priceAtSignal: 17000,
      blockedReason: 'SECTOR_CONCENTRATION_LIMIT',
      hypotheticalTargetPrice: 22250,
      hypotheticalStopPrice: 11089,
    }));
  });

  it('통과 시 기록 0건 · 기록 throw 시에도 게이트 차단 동작 보존 (실패 격리)', async () => {
    const { recordCounterfactualCase } = await import('../../../../learning/counterfactualShadow.js');
    const { sectorConcentrationGate } = await import('../sectorConcentrationGate.js');
    const { makeMockCtx, makeMockStock } = await import('./_testHelpers.js');
    const passResult = await sectorConcentrationGate(makeMockCtx({
      stock: makeMockStock({ code: '089030', sector: '반도체장비' }), watchlist: [], shadows: [] as never,
    }));
    expect(passResult.pass).toBe(true);
    expect(recordCounterfactualCase).not.toHaveBeenCalled();

    (recordCounterfactualCase as any).mockImplementationOnce(() => { throw new Error('DISK_FULL'); });
    const stock = makeMockStock({ code: '089030', sector: '반도체장비' });
    const watchlist = [
      makeMockStock({ code: '084370', sector: '반도체장비' }),
      makeMockStock({ code: '403870', sector: '반도체장비' }),
    ];
    const shadows = watchlist.map((w) => ({ stockCode: w.code, status: 'ACTIVE' })) as never;
    const blocked = await sectorConcentrationGate(makeMockCtx({ stock, watchlist, shadows }));
    expect(blocked.pass).toBe(false);
  });
});
