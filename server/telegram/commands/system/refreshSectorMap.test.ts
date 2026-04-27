/**
 * @responsibility refreshSectorMap.cmd 회귀 테스트
 *
 * 검증:
 *   - 정상 실행: updateKrxSectorMap 호출 + invalidateSectorMapCache 호출 + 시작/완료 메시지 2건
 *   - 5분 rate-limit 차단 + 카운트다운 안내
 *   - rate-limit 갱신은 가드 통과 직후 → throw 후에도 폭주 차단
 *   - source='KRX' 정상 vs source!='KRX' 폴백 메시지 분기
 *   - updateKrxSectorMap throw → ❌ 실패 메시지 응답 + 캐시 무효화 미호출
 *   - 메타데이터: name + aliases (/update_sector_map) + category=SYS + riskLevel=1
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _updateKrxSectorMap = vi.fn(async (): Promise<{
  count: number;
  updatedAt: string;
  trdDd: string;
  source: string;
  diagnostics: string[];
}> => ({
  count: 2700,
  updatedAt: '2026-04-27T10:00:00.000Z',
  trdDd: '20260427',
  source: 'KRX',
  diagnostics: [],
}));

const _invalidateSectorMapCache = vi.fn(() => undefined);

vi.mock('../../../screener/sectorMapUpdater.js', () => ({
  updateKrxSectorMap: _updateKrxSectorMap,
}));

vi.mock('../../../screener/sectorMap.js', () => ({
  invalidateSectorMapCache: _invalidateSectorMapCache,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let refreshSectorMap: typeof import('./refreshSectorMap.cmd.js').default;
let __resetRefreshSectorMapRateLimitForTests: typeof import('./refreshSectorMap.cmd.js').__resetRefreshSectorMapRateLimitForTests;

beforeEach(async () => {
  const mod = await import('./refreshSectorMap.cmd.js');
  refreshSectorMap = mod.default;
  __resetRefreshSectorMapRateLimitForTests = mod.__resetRefreshSectorMapRateLimitForTests;
  __resetRefreshSectorMapRateLimitForTests();

  _updateKrxSectorMap.mockClear();
  _invalidateSectorMapCache.mockClear();
  _updateKrxSectorMap.mockResolvedValue({
    count: 2700,
    updatedAt: '2026-04-27T10:00:00.000Z',
    trdDd: '20260427',
    source: 'KRX',
    diagnostics: [],
  });
});

afterEach(() => {
  __resetRefreshSectorMapRateLimitForTests();
});

describe('/refresh_sector_map — 정상 실행 (KRX 본선 성공)', () => {
  it('updateKrxSectorMap 호출 + invalidateSectorMapCache 호출 + 시작/완료 메시지 2건', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply });

    expect(_updateKrxSectorMap).toHaveBeenCalledOnce();
    expect(_invalidateSectorMapCache).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledTimes(2);

    const startMsg = reply.mock.calls[0]![0];
    expect(startMsg).toContain('KRX 섹터맵 갱신 시작');
    expect(startMsg).toContain('Naver');

    const finishMsg = reply.mock.calls[1]![0];
    expect(finishMsg).toContain('KRX 본선');
    expect(finishMsg).toContain('2700');
    expect(finishMsg).toContain('20260427');
    expect(finishMsg).toMatch(/\d+\.\ds/);
  });

  it('args 무시 — 인자 있어도 동일하게 실행', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: ['ignored'], reply });

    expect(_updateKrxSectorMap).toHaveBeenCalledOnce();
  });

  it('source !== KRX 폴백 시 🟡 + 출처 라벨 노출', async () => {
    _updateKrxSectorMap.mockResolvedValueOnce({
      count: 2680,
      updatedAt: '2026-04-27T10:00:00.000Z',
      trdDd: '20260427',
      source: 'KRX-fail→Naver',
      diagnostics: ['KRX otp 401', 'Naver 백업 정상'],
    });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply });

    const finishMsg = reply.mock.calls[1]![0];
    expect(finishMsg).toContain('폴백 갱신');
    expect(finishMsg).toContain('KRX-fail→Naver');
    expect(finishMsg).toContain('2680');
    expect(_invalidateSectorMapCache).toHaveBeenCalledOnce();
  });
});

describe('/refresh_sector_map — 안전 가드', () => {
  it('5분 이내 재호출 → 차단 + 카운트다운 안내', async () => {
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply: reply1 });
    expect(_updateKrxSectorMap).toHaveBeenCalledOnce();

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply: reply2 });

    expect(reply2).toHaveBeenCalledOnce();
    expect(reply2.mock.calls[0]![0]).toContain('5분 이내');
    expect(reply2.mock.calls[0]![0]).toMatch(/\d+초 후/);

    expect(_updateKrxSectorMap).toHaveBeenCalledOnce();
  });

  it('rate-limit 리셋 후 재실행 가능', async () => {
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply: reply1 });
    expect(_updateKrxSectorMap).toHaveBeenCalledOnce();

    __resetRefreshSectorMapRateLimitForTests();

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply: reply2 });
    expect(_updateKrxSectorMap).toHaveBeenCalledTimes(2);
  });
});

describe('/refresh_sector_map — 에러 처리', () => {
  it('updateKrxSectorMap throw → ❌ 실패 메시지 + 캐시 무효화 미호출', async () => {
    _updateKrxSectorMap.mockRejectedValueOnce(new Error('KRX 본선 5xx + 모든 폴백 실패'));
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledTimes(2);
    const errMsg = reply.mock.calls[1]![0];
    expect(errMsg).toContain('실패');
    expect(errMsg).toContain('KRX 본선 5xx');
    expect(_invalidateSectorMapCache).not.toHaveBeenCalled();
  });

  it('throw 후에도 rate-limit 갱신 유지 (재시도 폭주 차단)', async () => {
    _updateKrxSectorMap.mockRejectedValueOnce(new Error('갱신 실패'));
    const reply1 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply: reply1 });

    const reply2 = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await refreshSectorMap.execute({ args: [], reply: reply2 });

    expect(reply2.mock.calls[0]![0]).toContain('5분 이내');
    expect(_updateKrxSectorMap).toHaveBeenCalledOnce();
  });
});

describe('TelegramCommand 메타데이터 정합', () => {
  it('name + alias /update_sector_map 양쪽 등록', () => {
    expect(refreshSectorMap.name).toBe('/refresh_sector_map');
    expect(refreshSectorMap.aliases).toContain('/update_sector_map');
  });

  it('category=SYS, riskLevel=1, visibility=ADMIN', () => {
    expect(refreshSectorMap.category).toBe('SYS');
    expect(refreshSectorMap.riskLevel).toBe(1);
    expect(refreshSectorMap.visibility).toBe('ADMIN');
  });

  it('description + usage 노출', () => {
    expect(refreshSectorMap.description).toBeTruthy();
    expect(refreshSectorMap.description).toContain('KRX');
    expect(refreshSectorMap.description).toContain('섹터맵');
    expect(refreshSectorMap.usage).toBe('/refresh_sector_map');
  });
});
