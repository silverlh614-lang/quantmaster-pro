/**
 * @responsibility kisRankingClient 장외 게이트 회귀 — ADR-0009 호출 예산 정책 확인
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./kisClient.js', () => ({
  realDataKisGet: vi.fn(),
  HAS_REAL_DATA_CLIENT: true,
  KIS_IS_REAL: true,
  hasKisClientOverrides: () => false,
}));

import { realDataKisGet } from './kisClient.js';
import { getRanking, resetRankingCache } from './kisRankingClient.js';

const mockedKisGet = vi.mocked(realDataKisGet);

describe('kisRankingClient — ADR-0009 장외 게이트', () => {
  beforeEach(() => {
    resetRankingCache();
    mockedKisGet.mockReset();
    delete process.env.DATA_FETCH_FORCE_MARKET;
    delete process.env.DATA_FETCH_FORCE_OFF;
  });

  afterEach(() => {
    delete process.env.DATA_FETCH_FORCE_MARKET;
    delete process.env.DATA_FETCH_FORCE_OFF;
    vi.restoreAllMocks();
  });

  it('장외 + 캐시 miss → 빈 배열 반환, realDataKisGet 호출되지 않음', async () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const rows = await getRanking('volume', { limit: 10 });
    expect(rows).toEqual([]);
    expect(mockedKisGet).not.toHaveBeenCalled();
  });

  it('장중 + 캐시 miss → realDataKisGet 을 정상 호출한다', async () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    mockedKisGet.mockResolvedValue({
      output: [
        {
          mksc_shrn_iscd: '005930',
          hts_kor_isnm: '삼성전자',
          acml_vol: '1000000',
          prdy_ctrt: '0.5',
        },
      ],
    });
    const rows = await getRanking('volume', { limit: 10 });
    // KOSPI + KOSDAQ 2회 호출 (동일 mock 본문)
    expect(mockedKisGet).toHaveBeenCalled();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('장외에도 bypassCache=true 면 실제 호출된다 (관리자 진단 경로)', async () => {
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    mockedKisGet.mockResolvedValue({ output: [] });
    await getRanking('volume', { limit: 10, bypassCache: true });
    expect(mockedKisGet).toHaveBeenCalled();
  });

  it('장외 + 캐시 hit → 캐시 데이터 그대로 반환 (네트워크 호출 없음)', async () => {
    process.env.DATA_FETCH_FORCE_MARKET = 'true';
    mockedKisGet.mockResolvedValue({
      output: [
        {
          mksc_shrn_iscd: '000660',
          hts_kor_isnm: 'SK하이닉스',
          acml_vol: '500000',
          prdy_ctrt: '1.0',
        },
      ],
    });
    // 1) 장중 호출로 캐시 채움
    const warm = await getRanking('volume', { limit: 10 });
    expect(warm.length).toBeGreaterThan(0);
    mockedKisGet.mockReset();

    // 2) 장외 전환 후 재호출 → 캐시 hit, 네트워크 호출 없음
    delete process.env.DATA_FETCH_FORCE_MARKET;
    process.env.DATA_FETCH_FORCE_OFF = 'true';
    const cold = await getRanking('volume', { limit: 10 });
    expect(cold).toEqual(warm);
    expect(mockedKisGet).not.toHaveBeenCalled();
  });
});
